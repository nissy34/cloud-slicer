package main

// Printer pages: a page the printer's own web server serves for a camera that
// Moonraker lists as service "iframe" (paxx12's remote screen at /screen/ on
// the U1, a camera's player page), opened inside the Device tab. The page runs
// in the browser; each request it makes comes here, over a direct WebRTC data
// channel (bridge.page_open) or over the relay (bridge.page_fetch), and goes to
// the printer's web server with the printer's API key, as it would from Fluidd.
// Only the folder of a page Moonraker lists can be reached, and never
// Moonraker's own API: the bridge's allow-list of Moonraker calls still holds.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

const (
	// A page's own request (a form, a tap) is small.
	maxPageRequest = 1 << 20
	// Larger answers are refused: a page is not a file download.
	maxPageResponse = 8 << 20
	// Over the relay an answer must fit one message, as camera frames do.
	maxRelayedPage = maxFrame
	// Pages one browser may have open over direct links at once.
	maxDirectPages = 2
	// Requests one direct page link works on at once.
	pageParallel = 6
	// The printer's page list is asked again after this long.
	pageListTTL = 30 * time.Second
	pageTimeout = 15 * time.Second
)

// Moonraker's API, never reachable as a page (on any port of the printer).
var moonrakerPaths = []string{"/access", "/machine", "/server", "/printer", "/api", "/websocket", "/debug"}

// Headers a page may send to the printer, and headers of the printer's answer passed back.
var (
	pageRequestHeaders  = []string{"Accept", "Accept-Language", "Content-Type", "If-None-Match", "If-Modified-Since", "Range"}
	pageResponseHeaders = []string{"Content-Type", "Content-Range", "Content-Disposition", "Cache-Control", "ETag", "Last-Modified", "Location"}
)

type pageRequest struct {
	ID      uint32            `json:"id"`
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	// Base64.
	Body string `json:"body"`
}

type pageResponse struct {
	Status  int
	Headers map[string]string
	Body    []byte
}

// pageClient never follows a redirect: the page gets it, and its next request comes here again.
var pageClient = &http.Client{
	Timeout:       pageTimeout,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// pageFolder is the folder of a camera page address: "/screen/" for "/screen/", "/webcam/" for "/webcam/player".
func pageFolder(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Path == "" {
		return ""
	}
	return u.Path[:strings.LastIndex(u.Path, "/")+1]
}

func isMoonrakerPath(p string) bool {
	lower := strings.ToLower(p)
	for _, m := range moonrakerPaths {
		if lower == m || strings.HasPrefix(lower, m+"/") {
			return true
		}
	}
	return false
}

// pageFolders are the folders of the pages this printer lists (Moonraker cameras of service "iframe").
func (s *Session) pageFolders() ([]string, error) {
	s.mu.Lock()
	if s.pageList != nil && time.Since(s.pageListAt) < pageListTTL {
		list := s.pageList
		s.mu.Unlock()
		return list, nil
	}
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.printer.URL, "/")+"/server/webcams/list", nil)
	s.keyFor(req)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Could not reach %s.", s.printer.Name)
	}
	defer res.Body.Close()
	var body struct {
		Result struct {
			Webcams []struct {
				Service   string `json:"service"`
				Enabled   *bool  `json:"enabled"`
				StreamURL string `json:"stream_url"`
			} `json:"webcams"`
		} `json:"result"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body) != nil {
		return nil, fmt.Errorf("%s did not list its cameras (HTTP %d).", s.printer.Name, res.StatusCode)
	}
	base, _ := url.Parse(s.printer.URL)
	list := []string{}
	for _, w := range body.Result.Webcams {
		if !strings.EqualFold(strings.TrimSpace(w.Service), "iframe") || (w.Enabled != nil && !*w.Enabled) {
			continue
		}
		u, err := url.Parse(strings.TrimSpace(w.StreamURL))
		// A page on another computer is not this printer's to open.
		if err != nil || (u.Host != "" && (base == nil || u.Hostname() != base.Hostname())) {
			continue
		}
		if f := pageFolder(u.Path); f != "" && !isMoonrakerPath(f) {
			list = append(list, f)
		}
	}
	s.mu.Lock()
	s.pageList, s.pageListAt = list, time.Now()
	s.mu.Unlock()
	return list, nil
}

// pageTarget checks a path a page asked for: it must sit in the folder of a page
// the printer lists, outside Moonraker's API. Returns the clean path and its folder.
func (s *Session) pageTarget(raw string) (*url.URL, string, error) {
	ref, err := url.Parse(raw)
	if err != nil || ref.Scheme != "" || ref.Host != "" || !strings.HasPrefix(ref.Path, "/") {
		return nil, "", errors.New("A printer page can only ask for addresses on the printer.")
	}
	clean := path.Clean(ref.Path)
	if strings.HasSuffix(ref.Path, "/") && clean != "/" {
		clean += "/"
	}
	refused := errors.New("This address is not part of a page the printer lists.")
	if isMoonrakerPath(clean) {
		return nil, "", refused
	}
	folders, err := s.pageFolders()
	if err != nil {
		return nil, "", err
	}
	for _, f := range folders {
		if strings.HasPrefix(clean, f) || clean+"/" == f {
			return &url.URL{Path: clean, RawQuery: ref.RawQuery}, f, nil
		}
	}
	return nil, "", refused
}

func pageMethodOK(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodPost
}

// pageFetch does one request of a page on the printer's web server, with the printer's key.
func (s *Session) pageFetch(r pageRequest, limit int) (*pageResponse, error) {
	method := strings.ToUpper(r.Method)
	if method == "" {
		method = http.MethodGet
	}
	if !pageMethodOK(method) {
		return nil, errors.New("A printer page can only read and send forms through the bridge.")
	}
	target, folder, err := s.pageTarget(r.Path)
	if err != nil {
		return nil, err
	}
	body, err := base64.StdEncoding.DecodeString(r.Body)
	if err != nil || len(body) > maxPageRequest {
		return nil, errors.New("The page sent too much at once.")
	}
	// The web server Fluidd is served from comes first, then Moonraker's port, as for cameras.
	tries, err := s.cameraAddresses(folder)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	known := s.pageAt[folder]
	s.mu.Unlock()
	if known != nil {
		tries = []*url.URL{known}
	}
	var last error
	for i, base := range tries {
		u := *base
		u.Path, u.RawPath, u.RawQuery, u.Fragment = target.Path, "", target.RawQuery, ""
		res, err := s.pageDo(method, &u, r.Headers, body, limit)
		if err == nil && (known != nil || i == len(tries)-1 || (res.Status != http.StatusNotFound && res.Status != http.StatusUnauthorized && res.Status != http.StatusForbidden)) {
			if known == nil && res.Status < 400 {
				s.mu.Lock()
				if s.pageAt == nil {
					s.pageAt = map[string]*url.URL{}
				}
				s.pageAt[folder] = base
				s.mu.Unlock()
			}
			return res, nil
		}
		if err != nil {
			last = err
		}
	}
	if last == nil {
		last = errors.New("The printer did not answer.")
	}
	return nil, last
}

func (s *Session) pageDo(method string, u *url.URL, headers map[string]string, body []byte, limit int) (*pageResponse, error) {
	ctx, cancel := context.WithTimeout(s.ctx, pageTimeout)
	defer cancel()
	var rd io.Reader
	if method == http.MethodPost {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), rd)
	if err != nil {
		return nil, err
	}
	for _, h := range pageRequestHeaders {
		for k, v := range headers {
			if strings.EqualFold(k, h) && v != "" {
				req.Header.Set(h, v)
			}
		}
	}
	s.keyFor(req)
	res, err := pageClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Could not reach %s.", s.printer.Name)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, int64(limit)+1))
	if err != nil {
		return nil, fmt.Errorf("%s stopped answering.", s.printer.Name)
	}
	if len(data) > limit {
		return nil, errors.New("The printer's answer is too large to pass on.")
	}
	out := &pageResponse{Status: res.StatusCode, Headers: map[string]string{}, Body: data}
	for _, h := range pageResponseHeaders {
		v := res.Header.Get(h)
		if v == "" {
			continue
		}
		if h == "Location" {
			// Only a move within the printer's pages: the page asks again through here.
			loc, err := u.Parse(v)
			if err != nil || loc.Hostname() != u.Hostname() {
				continue
			}
			v = (&url.URL{Path: loc.Path, RawQuery: loc.RawQuery}).String()
		}
		out.Headers[h] = v
	}
	return out, nil
}

// pageFetchRelayed answers bridge.page_fetch: the whole answer in one relay message.
func (s *Session) pageFetchRelayed(r pageRequest) (any, error) {
	res, err := s.pageFetch(r, maxRelayedPage)
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": res.Status, "headers": res.Headers, "data": base64.StdEncoding.EncodeToString(res.Body)}, nil
}

// directPage is one browser's direct link for the pages it has open.
type directPage struct {
	id     string
	pc     *webrtc.PeerConnection
	cancel context.CancelFunc
	once   sync.Once
}

func (p *directPage) close() {
	p.once.Do(func() {
		p.cancel()
		_ = p.pc.Close()
	})
}

// pageOpen answers the browser's offer for a direct page link. Requests come
// as text on data channel "page"; each answer is a text header
// {id, status, headers, size} (or {id, error}), then its body in pieces of
// 4 bytes id, 1 byte "last piece", and the data.
func (s *Session) pageOpen(sdp string) (any, error) {
	if sdp == "" {
		return nil, errors.New("No offer from the browser.")
	}
	s.mu.Lock()
	n := len(s.pages)
	s.mu.Unlock()
	if n >= maxDirectPages {
		return nil, fmt.Errorf("Up to %d printer pages at a time.", maxDirectPages)
	}
	ctx, cancel := context.WithCancel(s.ctx)
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		cancel()
		return nil, err
	}
	pg := &directPage{id: fmt.Sprintf("page%d", time.Now().UnixNano()), pc: pc, cancel: cancel}
	fail := func(err error) (any, error) {
		pg.close()
		return nil, err
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		return fail(errors.New("The browser's offer could not be read."))
	}
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		if dc.Label() != "page" {
			return
		}
		busy := make(chan struct{}, pageParallel)
		var sendMu sync.Mutex
		dc.OnMessage(func(m webrtc.DataChannelMessage) {
			if !m.IsString {
				return
			}
			var r pageRequest
			if json.Unmarshal(m.Data, &r) != nil {
				return
			}
			go func() {
				select {
				case busy <- struct{}{}:
				case <-ctx.Done():
					return
				}
				defer func() { <-busy }()
				res, err := s.pageFetch(r, maxPageResponse)
				sendMu.Lock()
				defer sendMu.Unlock()
				sendPageAnswer(ctx, dc, r.ID, res, err)
			}()
		})
	})
	connected := make(chan struct{})
	var connectedOnce sync.Once
	pc.OnConnectionStateChange(func(st webrtc.PeerConnectionState) {
		switch st {
		case webrtc.PeerConnectionStateConnected:
			connectedOnce.Do(func() { close(connected) })
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			s.dropPage(pg.id)
		}
	})
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		return fail(err)
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		return fail(err)
	}
	select {
	case <-gathered:
	case <-time.After(3 * time.Second):
	case <-ctx.Done():
		return fail(errors.New("The browser went away."))
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fail(errors.New("The browser went away."))
	}
	if s.pages == nil {
		s.pages = map[string]*directPage{}
	}
	s.pages[pg.id] = pg
	s.mu.Unlock()
	go func() {
		select {
		case <-connected:
		case <-time.After(connectTimeout):
			s.dropPage(pg.id)
		case <-ctx.Done():
		}
	}()
	return map[string]any{"id": pg.id, "sdp": pc.LocalDescription().SDP}, nil
}

// sendPageAnswer sends one answer on a direct page link, waiting while the browser catches up.
func sendPageAnswer(ctx context.Context, dc *webrtc.DataChannel, id uint32, res *pageResponse, err error) {
	if err != nil {
		head, _ := json.Marshal(map[string]any{"id": id, "error": err.Error()})
		_ = dc.SendText(string(head))
		return
	}
	head, _ := json.Marshal(map[string]any{"id": id, "status": res.Status, "headers": res.Headers, "size": len(res.Body)})
	if dc.SendText(string(head)) != nil {
		return
	}
	for off := 0; off < len(res.Body); off += frameChunk {
		for dc.BufferedAmount() > maxBuffered {
			select {
			case <-time.After(10 * time.Millisecond):
			case <-ctx.Done():
				return
			}
		}
		end := min(off+frameChunk, len(res.Body))
		piece := make([]byte, 5, 5+end-off)
		binary.BigEndian.PutUint32(piece, id)
		if end == len(res.Body) {
			piece[4] = 1
		}
		if dc.Send(append(piece, res.Body[off:end]...)) != nil {
			return
		}
	}
}

func (s *Session) pageClose(id string) (any, error) {
	s.dropPage(id)
	return map[string]any{"ok": true}, nil
}

func (s *Session) dropPage(id string) {
	s.mu.Lock()
	pg := s.pages[id]
	delete(s.pages, id)
	s.mu.Unlock()
	if pg != nil {
		go pg.close()
	}
}
