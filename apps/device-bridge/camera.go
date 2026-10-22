package main

// A direct camera link: the page and the bridge swap one offer and answer over
// the relay (bridge.camera_open), then the camera flows straight from this
// computer to the browser over WebRTC and never crosses the relay. Cameras that
// already make live video (camera-streamer, MediaMTX, go2rtc, the paxx12 U1
// firmware) are forwarded as they come, without re-encoding; any other camera
// is sent as pictures over a data channel, as fast as the camera makes them up
// to the page's rate.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

const (
	// Direct cameras one browser may have open at once.
	maxDirectCameras = 4
	// How long the camera's own video gets to start before falling back to pictures.
	sourceTimeout = 6 * time.Second
	// Pictures per second over a direct link, at most.
	maxDirectFPS = 15
	// Pictures are cut into pieces this size: every browser takes data channel messages this big.
	frameChunk = 16 * 1024
	// Skip a picture rather than queue more than this for a slow connection.
	maxBuffered = 1 << 20
	// A direct camera nobody connected to within this time is dropped.
	connectTimeout = 30 * time.Second
)

// The same public STUN server the page uses, so either side can be found from outside its home network.
var iceServers = []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}}

type cameraOpenParams struct {
	SDP         string  `json:"sdp"`
	Service     string  `json:"service"`
	StreamURL   string  `json:"streamUrl"`
	SnapshotURL string  `json:"snapshotUrl"`
	FPS         float64 `json:"fps"`
}

// directCamera is one browser watching one camera over its own peer connection.
type directCamera struct {
	id       string
	pc       *webrtc.PeerConnection
	upstream *webrtc.PeerConnection
	cancel   context.CancelFunc
	once     sync.Once
}

func (c *directCamera) close() {
	c.once.Do(func() {
		c.cancel()
		_ = c.pc.Close()
		if c.upstream != nil {
			_ = c.upstream.Close()
		}
	})
}

// cameraOpen answers the browser's offer. The answer says which way the camera comes: "video" or "pictures".
func (s *Session) cameraOpen(p cameraOpenParams) (any, error) {
	if p.SDP == "" {
		return nil, errors.New("No offer from the browser.")
	}
	s.mu.Lock()
	n := len(s.cameras)
	s.mu.Unlock()
	if n >= maxDirectCameras {
		return nil, fmt.Errorf("Up to %d cameras at a time.", maxDirectCameras)
	}
	ctx, cancel := context.WithCancel(s.ctx)
	cam := &directCamera{id: fmt.Sprintf("cam%d", time.Now().UnixNano()), cancel: cancel}
	fail := func(err error) (any, error) {
		if cam.pc != nil {
			cam.close()
		} else {
			cancel()
		}
		return nil, err
	}

	// The camera's own live video, when it has one and the browser can play it.
	var source *webrtc.TrackRemote
	// why says, in plain words, why pictures come instead of video.
	why := "This browser can't play the camera's live video."
	if sdpOffersH264(p.SDP) {
		sources := s.videoSources(p)
		why = "The bridge found no live video on this camera."
		if len(sources) > 0 {
			why = "The camera's live video didn't answer."
		}
		for _, sig := range sources {
			up, track, err := connectSource(ctx, sig)
			if err == nil {
				cam.upstream, source = up, track
				break
			}
			s.debug("Camera video from " + sig.url.String() + ": " + err.Error())
		}
	}

	if source == nil && p.SnapshotURL == "" {
		return fail(errors.New("This camera has no live video the bridge can pass on, and no pictures."))
	}
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		return fail(err)
	}
	cam.pc = pc
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: p.SDP}); err != nil {
		return fail(errors.New("The browser's offer could not be read."))
	}
	mode := "pictures"
	if source != nil {
		local, err := webrtc.NewTrackLocalStaticRTP(source.Codec().RTPCodecCapability, "video", "camera")
		if err != nil {
			return fail(err)
		}
		sender, err := pc.AddTrack(local)
		if err != nil {
			return fail(err)
		}
		mode = "video"
		go forwardVideo(ctx, source, local, sender, cam.upstream)
	} else {
		fps := p.FPS
		if fps <= 0 || fps > maxDirectFPS {
			fps = maxDirectFPS
		}
		snap := p.SnapshotURL
		pc.OnDataChannel(func(dc *webrtc.DataChannel) {
			if dc.Label() != "frames" {
				return
			}
			dc.OnOpen(func() { go s.sendPictures(ctx, dc, snap, fps) })
		})
	}
	connected := make(chan struct{})
	var connectedOnce sync.Once
	pc.OnConnectionStateChange(func(st webrtc.PeerConnectionState) {
		switch st {
		case webrtc.PeerConnectionStateConnected:
			connectedOnce.Do(func() { close(connected) })
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			s.dropCamera(cam.id)
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
		// Without a STUN answer the host addresses are still enough at home.
	case <-ctx.Done():
		return fail(errors.New("The browser went away."))
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fail(errors.New("The browser went away."))
	}
	s.cameras[cam.id] = cam
	s.mu.Unlock()
	go func() {
		select {
		case <-connected:
		case <-time.After(connectTimeout):
			s.dropCamera(cam.id)
		case <-ctx.Done():
		}
	}()
	out := map[string]any{"id": cam.id, "mode": mode, "sdp": pc.LocalDescription().SDP}
	if mode == "pictures" {
		out["why"] = why
	}
	return out, nil
}

func (s *Session) cameraClose(id string) (any, error) {
	s.dropCamera(id)
	return map[string]any{"ok": true}, nil
}

func (s *Session) dropCamera(id string) {
	s.mu.Lock()
	cam := s.cameras[id]
	delete(s.cameras, id)
	s.mu.Unlock()
	if cam != nil {
		go cam.close()
	}
}

func (s *Session) debug(msg string) {
	if s.log != nil {
		s.log(msg)
	}
}

func sdpOffersH264(sdp string) bool {
	return strings.Contains(strings.ToUpper(sdp), "H264/90000")
}

// videoSignal is one way to ask a camera for its live video.
type videoSignal struct {
	protocol string // camera-streamer, whep or go2rtc
	url      *url.URL
}

// videoSources lists where this camera's live video may be asked for, best first, on the printer's own host only.
func (s *Session) videoSources(p cameraOpenParams) []videoSignal {
	var out []videoSignal
	add := func(protocol, raw string) {
		if raw == "" {
			return
		}
		u, err := s.resolve(raw)
		if err != nil {
			return
		}
		tries := []*url.URL{u}
		if ref, err := url.Parse(raw); err == nil && !ref.IsAbs() {
			// A relative camera path may belong to the web server on port 80 instead of Moonraker's port.
			if web, err := s.resolve((&url.URL{Scheme: "http", Host: u.Hostname()}).ResolveReference(ref).String()); err == nil {
				tries = append(tries, web)
			}
		}
	next:
		for _, t := range tries {
			for _, o := range out {
				if o.url.String() == t.String() {
					continue next
				}
			}
			out = append(out, videoSignal{protocol, t})
		}
	}
	switch p.Service {
	case "webrtc-camerastreamer":
		add("camera-streamer", p.StreamURL)
	case "webrtc-mediamtx":
		if p.StreamURL != "" {
			add("whep", whepEndpoint(p.StreamURL))
		}
	case "webrtc-go2rtc":
		if p.StreamURL != "" {
			add("go2rtc", go2rtcEndpoint(p.StreamURL))
		}
	default:
		// The paxx12 U1 firmware (and v4l2-mpp's stream-http) answers WebRTC at
		// <camera folder>/webrtc, next to its player page and snapshots, with
		// camera-streamer's messages.
		for _, raw := range []string{p.StreamURL, p.SnapshotURL} {
			if raw == "" {
				continue
			}
			ref, err := url.Parse(raw)
			if err != nil || strings.HasPrefix(ref.Path, "/server/") || strings.HasPrefix(ref.Path, "/printer/") {
				continue
			}
			ref.RawQuery, ref.Fragment = "", ""
			ref.Path = ref.Path[:strings.LastIndex(ref.Path, "/")+1] + "webrtc"
			add("camera-streamer", ref.String())
		}
		if len(out) == 0 {
			// A camera known only by a picture file (the U1's built-in one):
			// the paxx12 firmware still serves its live video here.
			add("camera-streamer", "/webcam/webrtc")
		}
	}
	return out
}

func whepEndpoint(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if !strings.HasSuffix(strings.TrimSuffix(u.Path, "/"), "/whep") {
		u.Path = strings.TrimSuffix(u.Path, "/") + "/whep"
	}
	return u.String()
}

// go2rtcEndpoint is go2rtc's HTTP offer address, <folder>/api/webrtc?src=<name>.
func go2rtcEndpoint(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if !strings.HasSuffix(u.Path, "/api/webrtc") {
		u.Path = u.Path[:strings.LastIndex(u.Path, "/")+1] + "api/webrtc"
	}
	q := url.Values{}
	if src := u.Query().Get("src"); src != "" {
		q.Set("src", src)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// connectSource asks the camera for its live video and waits for the first of it.
func connectSource(ctx context.Context, sig videoSignal) (*webrtc.PeerConnection, *webrtc.TrackRemote, error) {
	ctx, cancel := context.WithTimeout(ctx, sourceTimeout)
	defer cancel()
	// On the same network as the camera: no STUN needed.
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return nil, nil, err
	}
	tracks := make(chan *webrtc.TrackRemote, 1)
	pc.OnTrack(func(t *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if t.Kind() != webrtc.RTPCodecTypeVideo {
			return
		}
		select {
		case tracks <- t:
		default:
		}
	})
	// camera-streamer and paxx12 ping over "keepalive" and drop silent viewers.
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		dc.OnMessage(func(m webrtc.DataChannelMessage) {
			if string(m.Data) == "ping" {
				_ = dc.SendText("pong")
			}
		})
	})
	if err := askCamera(ctx, pc, sig); err != nil {
		_ = pc.Close()
		return nil, nil, err
	}
	select {
	case t := <-tracks:
		if !strings.EqualFold(t.Codec().MimeType, webrtc.MimeTypeH264) {
			_ = pc.Close()
			return nil, nil, errors.New("the camera's video is " + t.Codec().MimeType + ", not H.264")
		}
		return pc, t, nil
	case <-ctx.Done():
		_ = pc.Close()
		return nil, nil, errors.New("no video from the camera in time")
	}
}

func askCamera(ctx context.Context, pc *webrtc.PeerConnection, sig videoSignal) error {
	if sig.protocol == "camera-streamer" {
		// The camera offers, we answer.
		var offer struct {
			Type  string `json:"type"`
			ID    string `json:"id"`
			SDP   string `json:"sdp"`
			Error string `json:"error"`
		}
		if err := postJSON(ctx, sig.url, map[string]any{"type": "request", "keepAlive": true}, &offer); err != nil {
			return err
		}
		if offer.Error != "" || offer.SDP == "" {
			return errors.New("the camera refused: " + offer.Error)
		}
		if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer.SDP}); err != nil {
			return err
		}
		answer, err := pc.CreateAnswer(nil)
		if err != nil {
			return err
		}
		gathered := webrtc.GatheringCompletePromise(pc)
		if err := pc.SetLocalDescription(answer); err != nil {
			return err
		}
		<-gathered
		return postJSON(ctx, sig.url, map[string]any{"type": "answer", "id": offer.ID, "sdp": pc.LocalDescription().SDP}, nil)
	}
	// WHEP and go2rtc: we offer, the camera answers.
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		return err
	}
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return err
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(offer); err != nil {
		return err
	}
	<-gathered
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, sig.url.String(), strings.NewReader(pc.LocalDescription().SDP))
	req.Header.Set("Content-Type", "application/sdp")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("the camera answered HTTP %d", res.StatusCode)
	}
	return pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: string(body)})
}

func postJSON(ctx context.Context, u *url.URL, body any, out any) error {
	data, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return fmt.Errorf("the camera answered HTTP %d", res.StatusCode)
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
		return nil
	}
	return json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(out)
}

// forwardVideo passes the camera's video packets on unchanged, and the browser's
// requests for a fresh full picture (after a lost packet, or on joining) back.
func forwardVideo(ctx context.Context, src *webrtc.TrackRemote, dst *webrtc.TrackLocalStaticRTP, sender *webrtc.RTPSender, upstream *webrtc.PeerConnection) {
	askKeyframe := func() {
		_ = upstream.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(src.SSRC())}})
	}
	go func() {
		for {
			pkts, _, err := sender.ReadRTCP()
			if err != nil {
				return
			}
			for _, p := range pkts {
				switch p.(type) {
				case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
					askKeyframe()
				}
			}
		}
	}()
	go func() {
		// Some cameras only send a full picture every few seconds; ask early so the video starts at once.
		for _, d := range []time.Duration{0, time.Second, 3 * time.Second} {
			select {
			case <-time.After(d):
				askKeyframe()
			case <-ctx.Done():
				return
			}
		}
	}()
	for ctx.Err() == nil {
		pkt, _, err := src.ReadRTP()
		if err != nil {
			return
		}
		_ = dst.WriteRTP(pkt)
	}
}

// sendPictures fetches pictures and sends each in pieces: a leading byte of 1 marks a picture's last piece.
func (s *Session) sendPictures(ctx context.Context, dc *webrtc.DataChannel, raw string, fps float64) {
	period := time.Duration(float64(time.Second) / fps)
	misses := 0
	for ctx.Err() == nil && dc.ReadyState() == webrtc.DataChannelStateOpen {
		started := time.Now()
		if dc.BufferedAmount() < maxBuffered {
			frame, _, err := s.frame(raw)
			if err != nil {
				misses++
				if misses == 3 {
					_ = dc.SendText("error:" + err.Error())
				}
			} else {
				misses = 0
				for off := 0; off < len(frame); off += frameChunk {
					end := min(off+frameChunk, len(frame))
					last := byte(0)
					if end == len(frame) {
						last = 1
					}
					if dc.Send(append([]byte{last}, frame[off:end]...)) != nil {
						return
					}
				}
			}
		}
		wait := period - time.Since(started)
		if misses >= 3 {
			wait = 5 * time.Second
		}
		select {
		case <-time.After(max(wait, 10*time.Millisecond)):
		case <-ctx.Done():
			return
		}
	}
}
