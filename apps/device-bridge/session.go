package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	// notify_status_update is merged and sent at most this often per browser, to keep the relay within its free tier.
	statusEvery = time.Second
	// Base64 of a frame must stay under the relay's 1 MiB message limit.
	maxFrame = 700 * 1024
	// A G-code file bigger than this is surely a mistake.
	maxUpload = 4 << 30
	// The largest upload piece the relay passes on as raw bytes (the browser sends 8 MiB).
	relayPiece = 9 << 20
	// Uploads a browser may have open at once.
	maxUploads = 2
)

// Moonraker notifications the Device tab doesn't use; dropping them saves relay traffic.
var dropped = map[string]bool{"notify_proc_stat_update": true, "notify_cpu_throttled": true}

type rpc struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
}

// Session is one browser's connection to one printer.
type Session struct {
	id      string
	printer Printer
	send    func(string)
	drop    func(string)

	ctx    context.Context
	cancel context.CancelFunc

	mu      sync.Mutex
	ws      *websocket.Conn
	queue   []string
	pending map[string]any
	timer   *time.Timer
	uploads map[string]*upload
	cameras map[string]*directCamera
	// pictureAt remembers which address answered for each camera picture path.
	pictureAt map[string]*url.URL
	// Printer pages: open direct links, the folders the printer lists, and which address answered for each folder.
	pages      map[string]*directPage
	pageList   []string
	pageListAt time.Time
	pageAt     map[string]*url.URL
	closed     bool
	// log is for details only a developer needs (may be nil).
	log func(string)
}

func newSession(id string, p Printer, send func(string), drop func(string)) *Session {
	ctx, cancel := context.WithCancel(context.Background())
	return &Session{id: id, printer: p, send: send, drop: drop, ctx: ctx, cancel: cancel, uploads: map[string]*upload{}, cameras: map[string]*directCamera{}, pictureAt: map[string]*url.URL{}, pages: map[string]*directPage{}, pageAt: map[string]*url.URL{}}
}

// open connects to the printer's Moonraker websocket, then passes its messages on until either end closes.
func (s *Session) open() error {
	wsURL := "ws" + strings.TrimPrefix(s.printer.URL, "http") + "/websocket"
	if s.printer.APIKey != "" {
		token, err := s.oneshotToken()
		if err != nil {
			return err
		}
		wsURL += "?token=" + url.QueryEscape(token)
	}
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	cancel()
	if err != nil {
		if s.ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("%s did not answer.", s.printer.Name)
		}
		where := s.printer.URL
		if s.printer.shown != "" {
			where = s.printer.shown
		}
		return fmt.Errorf("Could not reach %s at %s.", s.printer.Name, where)
	}
	// File lists and object lists can be large.
	ws.SetReadLimit(64 << 20)
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		ws.CloseNow()
		return nil
	}
	s.ws = ws
	queued := s.queue
	s.queue = nil
	s.mu.Unlock()
	for _, m := range queued {
		_ = ws.Write(s.ctx, websocket.MessageText, []byte(m))
	}
	go func() {
		for {
			_, data, err := ws.Read(s.ctx)
			if err != nil {
				s.mu.Lock()
				closed := s.closed
				s.mu.Unlock()
				if !closed {
					s.drop("Lost the connection to " + s.printer.Name + ".")
				}
				return
			}
			s.fromPrinter(data)
		}
	}()
	return nil
}

func (s *Session) oneshotToken() (string, error) {
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.printer.URL+"/access/oneshot_token", nil)
	req.Header.Set("X-Api-Key", s.printer.APIKey)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Could not reach %s at %s.", s.printer.Name, s.printer.URL)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("The printer refused the API key (HTTP %d).", res.StatusCode)
	}
	var body struct {
		Result string `json:"result"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", err
	}
	return body.Result, nil
}

func (s *Session) fromPrinter(data []byte) {
	var msg struct {
		Method string            `json:"method"`
		Params []json.RawMessage `json:"params"`
	}
	if json.Unmarshal(data, &msg) != nil {
		return
	}
	if dropped[msg.Method] {
		return
	}
	if msg.Method == "notify_status_update" {
		var diff map[string]any
		if len(msg.Params) > 0 {
			_ = json.Unmarshal(msg.Params[0], &diff)
		}
		s.mu.Lock()
		if s.pending == nil {
			s.pending = map[string]any{}
		}
		mergeDiff(s.pending, diff)
		if s.timer == nil {
			s.timer = time.AfterFunc(statusEvery, s.flushStatus)
		}
		s.mu.Unlock()
		return
	}
	// Anything else goes straight through, after the status it may depend on.
	s.flushStatus()
	s.send(string(data))
}

func (s *Session) flushStatus() {
	s.mu.Lock()
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	diff := s.pending
	s.pending = nil
	s.mu.Unlock()
	if diff == nil {
		return
	}
	out, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": "notify_status_update", "params": []any{diff, float64(time.Now().UnixMilli()) / 1000}})
	s.send(string(out))
}

// mergeDiff merges a notify_status_update diff into a pending one (same rules as Moonraker's own diffs).
func mergeDiff(into, diff map[string]any) map[string]any {
	for k, v := range diff {
		nv, okNew := v.(map[string]any)
		old, okOld := into[k].(map[string]any)
		if okNew && okOld {
			merged := make(map[string]any, len(old)+len(nv))
			for kk, vv := range old {
				merged[kk] = vv
			}
			for kk, vv := range nv {
				merged[kk] = vv
			}
			into[k] = merged
		} else {
			into[k] = v
		}
	}
	return into
}

func (s *Session) reply(id json.RawMessage, result any, err error) {
	if len(id) == 0 {
		return
	}
	var out []byte
	if err != nil {
		out, _ = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": -32000, "message": err.Error()}})
	} else {
		out, _ = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	}
	s.send(string(out))
}

func (s *Session) fromBrowser(text string) {
	var msg rpc
	if json.Unmarshal([]byte(text), &msg) != nil {
		return
	}
	if strings.HasPrefix(msg.Method, "bridge.") {
		go func() {
			result, err := s.local(msg)
			s.reply(msg.ID, result, err)
		}()
		return
	}
	if why := refusal(msg.Method, msg.Params); why != "" {
		if len(msg.ID) > 0 {
			out, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": msg.ID, "error": map[string]any{"code": -32601, "message": why}})
			s.send(string(out))
		}
		return
	}
	s.mu.Lock()
	ws := s.ws
	if ws == nil {
		s.queue = append(s.queue, text)
	}
	s.mu.Unlock()
	if ws != nil {
		_ = ws.Write(s.ctx, websocket.MessageText, []byte(text))
	}
}

// resolve checks a URL the browser wants fetched: only the printer's own host can be reached.
func (s *Session) resolve(raw string) (*url.URL, error) {
	base, err := url.Parse(s.printer.URL)
	if err != nil {
		return nil, err
	}
	ref, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	// Relative paths keep the printer's port; Moonraker's webcam paths are relative to the web server.
	u := base.ResolveReference(ref)
	if u.Hostname() != base.Hostname() || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("Only the printer itself can be reached through the bridge.")
	}
	return u, nil
}

// keyFor is the printer's API key header, for requests to the printer's own
// host only (any port: its web server checks the same key, as for Fluidd's cameras).
func (s *Session) keyFor(req *http.Request) {
	base, _ := url.Parse(s.printer.URL)
	if s.printer.APIKey != "" && base != nil && req.URL.Hostname() == base.Hostname() {
		req.Header.Set("X-Api-Key", s.printer.APIKey)
	}
}

func (s *Session) local(msg rpc) (any, error) {
	switch msg.Method {
	case "bridge.snapshot":
		var p struct {
			URL string `json:"url"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.snapshot(p.URL)
	case "bridge.upload_begin":
		var p struct {
			Path string  `json:"path"`
			Size float64 `json:"size"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.uploadBegin(p.Path, int64(p.Size))
	case "bridge.upload_start":
		var p uploadParams
		_ = json.Unmarshal(msg.Params, &p)
		return s.uploadStart(p)
	case "bridge.upload_cancel":
		var p struct {
			UploadID string `json:"uploadId"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.uploadCancel(p.UploadID)
	case "bridge.upload_resume":
		var p struct {
			UploadID string `json:"uploadId"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.uploadResume(p.UploadID)
	case "bridge.upload_chunk":
		var p struct {
			UploadID string  `json:"uploadId"`
			Offset   float64 `json:"offset"`
			Data     string  `json:"data"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.uploadChunk(p.UploadID, int64(p.Offset), p.Data)
	case "bridge.upload_end":
		var p struct {
			UploadID string `json:"uploadId"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.uploadEnd(p.UploadID)
	case "bridge.camera_open":
		var p cameraOpenParams
		_ = json.Unmarshal(msg.Params, &p)
		return s.cameraOpen(p)
	case "bridge.camera_close":
		var p struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.cameraClose(p.ID)
	case "bridge.page_fetch":
		var p pageRequest
		_ = json.Unmarshal(msg.Params, &p)
		return s.pageFetchRelayed(p)
	case "bridge.page_open":
		var p struct {
			SDP string `json:"sdp"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.pageOpen(p.SDP)
	case "bridge.page_close":
		var p struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		return s.pageClose(p.ID)
	}
	return nil, errors.New("Unknown bridge call " + msg.Method)
}

func (s *Session) snapshot(raw string) (any, error) {
	buf, ct, err := s.frame(raw)
	if err != nil {
		return nil, err
	}
	return map[string]any{"contentType": ct, "data": base64.StdEncoding.EncodeToString(buf)}, nil
}

// cameraAddresses is where a camera path from Moonraker's webcam list may be
// fetched, best first, on the printer's own host only. A relative path belongs
// to the web server Fluidd and Mainsail are served from (they open it next to
// their own page), so that comes first; Moonraker's port is tried after it.
func (s *Session) cameraAddresses(raw string) ([]*url.URL, error) {
	first, err := s.resolve(raw)
	if err != nil {
		return nil, err
	}
	ref, err := url.Parse(raw)
	if err != nil || ref.IsAbs() {
		return []*url.URL{first}, nil
	}
	web, err := s.resolve((&url.URL{Scheme: first.Scheme, Host: first.Hostname()}).ResolveReference(ref).String())
	if err != nil || web.String() == first.String() {
		return []*url.URL{first}, nil
	}
	return []*url.URL{web, first}, nil
}

// frame is one camera picture from the printer's own host.
func (s *Session) frame(raw string) ([]byte, string, error) {
	tries, err := s.cameraAddresses(raw)
	if err != nil {
		return nil, "", err
	}
	// Pictures come many times a second: start with the address that answered last time.
	s.mu.Lock()
	if known := s.pictureAt[raw]; known != nil {
		tries = append([]*url.URL{known}, tries...)
	}
	s.mu.Unlock()
	var last error
	for i, u := range tries {
		if i > 0 && u.String() == tries[0].String() {
			continue
		}
		buf, ct, err := s.fetchBytes(u)
		if err == nil {
			s.mu.Lock()
			if s.pictureAt == nil {
				// Sessions made just for one picture (print alerts) start without it.
				s.pictureAt = map[string]*url.URL{}
			}
			s.pictureAt[raw] = u
			s.mu.Unlock()
			return buf, ct, nil
		}
		last = err
	}
	return nil, "", last
}

func (s *Session) fetchBytes(u *url.URL) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	s.keyFor(req)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("Camera answered HTTP %d", res.StatusCode)
	}
	buf, err := io.ReadAll(io.LimitReader(res.Body, maxFrame+1))
	if err != nil {
		return nil, "", err
	}
	if len(buf) == 0 {
		return nil, "", errors.New("Empty frame")
	}
	if len(buf) > maxFrame {
		return nil, "", errors.New("Camera frame too large to relay")
	}
	ct := res.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	return buf, ct, nil
}

func (s *Session) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	if s.timer != nil {
		s.timer.Stop()
	}
	ws := s.ws
	ups := s.uploads
	s.uploads = map[string]*upload{}
	cams := s.cameras
	s.cameras = map[string]*directCamera{}
	pages := s.pages
	s.pages = map[string]*directPage{}
	s.mu.Unlock()
	for _, c := range cams {
		c.close()
	}
	for _, p := range pages {
		p.close()
	}
	for _, up := range ups {
		up.abort(errors.New("The browser went away."))
	}
	s.cancel()
	if ws != nil {
		ws.Close(websocket.StatusNormalClosure, "")
	}
}
