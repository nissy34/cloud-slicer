package main

// The direct link: one WebRTC connection between a browser page and this
// bridge, made once over the relay (bridge.link_open) and then shared by
// everything that goes straight between them: cameras (live video on one of a
// few video slots fixed when the link opens, or pictures on channel
// "frames:<slot>"), printer pages (channel "page") and uploads (channel
// "upload:<id>"). Adding a camera or a page later needs no new connection: a
// camera is a short relay call (bridge.link_camera) and a channel. When the
// link drops, the page makes a new one and everything moves to it together.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

const (
	// Cameras one page may show over its direct link at once: also its number of video slots.
	maxDirectCameras = 4
	// How long the camera's own video gets to start before falling back to pictures.
	sourceTimeout = 6 * time.Second
	// Pictures per second over a direct link, at most.
	maxDirectFPS = 15
	// Pictures are cut into pieces this size: every browser takes data channel messages this big.
	frameChunk = 16 * 1024
	// Skip a picture rather than queue more than this for a slow connection.
	maxBuffered = 1 << 20
	// A direct link nobody connected to within this time is dropped.
	connectTimeout = 30 * time.Second
)

// The same public STUN server the page uses, so either side can be found from outside its home network.
var iceServers = []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}}

// slotCodec is what a video slot says it sends. Cameras' live video is H.264;
// the browser decodes what actually comes, whatever profile the camera uses.
var slotCodec = webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000, SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"}

type cameraOpenParams struct {
	Link        string  `json:"link"`
	Service     string  `json:"service"`
	StreamURL   string  `json:"streamUrl"`
	SnapshotURL string  `json:"snapshotUrl"`
	FPS         float64 `json:"fps"`
}

// videoSlot is one video track on the link; a camera's video goes out on it while the camera is open.
type videoSlot struct {
	track *webrtc.TrackLocalStaticRTP
	mu    sync.Mutex
	// owner is the camera on this slot now; keyframe asks it for a full picture (nil while no video camera is on it).
	owner    context.Context
	keyframe func()
}

func (v *videoSlot) take(owner context.Context, keyframe func()) {
	v.mu.Lock()
	v.owner, v.keyframe = owner, keyframe
	v.mu.Unlock()
}

// leave frees the slot, unless another camera took it meanwhile.
func (v *videoSlot) leave(owner context.Context) {
	v.mu.Lock()
	if v.owner == owner {
		v.owner, v.keyframe = nil, nil
	}
	v.mu.Unlock()
}

// linkCamera is one camera shown over the link.
type linkCamera struct {
	cancel   context.CancelFunc
	ctx      context.Context
	upstream *webrtc.PeerConnection
	// For a camera sent as pictures: where and how fast.
	snapshot string
	fps      float64
}

func (c *linkCamera) close() {
	c.cancel()
	if c.upstream != nil {
		_ = c.upstream.Close()
	}
}

type sharedLink struct {
	id     string
	pc     *webrtc.PeerConnection
	ctx    context.Context
	cancel context.CancelFunc
	slots  []*videoSlot
	mu     sync.Mutex
	cams   map[int]*linkCamera
	once   sync.Once
}

func (l *sharedLink) close() {
	l.once.Do(func() {
		l.cancel()
		l.mu.Lock()
		cams := l.cams
		l.cams = map[int]*linkCamera{}
		l.mu.Unlock()
		for _, c := range cams {
			c.close()
		}
		_ = l.pc.Close()
	})
}

// linkOpen answers the page's offer. The offer carries a few receive-only video
// slots and a data channel; the answer fills each video slot with a track.
func (s *Session) linkOpen(sdp string) (any, error) {
	if sdp == "" {
		return nil, errors.New("No offer from the browser.")
	}
	ctx, cancel := context.WithCancel(s.ctx)
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		cancel()
		return nil, err
	}
	l := &sharedLink{id: fmt.Sprintf("link%d", time.Now().UnixNano()), pc: pc, ctx: ctx, cancel: cancel, cams: map[int]*linkCamera{}}
	fail := func(err error) (any, error) {
		l.close()
		return nil, err
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		return fail(errors.New("The browser's offer could not be read."))
	}
	// Video slots only when the browser plays H.264, the cameras' own video.
	if sdpOffersH264(sdp) {
		for _, t := range pc.GetTransceivers() {
			if t.Kind() != webrtc.RTPCodecTypeVideo || len(l.slots) >= maxDirectCameras {
				continue
			}
			track, err := webrtc.NewTrackLocalStaticRTP(slotCodec, "video", fmt.Sprintf("slot%d", len(l.slots)))
			if err != nil {
				return fail(err)
			}
			sender, err := pc.AddTrack(track)
			if err != nil {
				return fail(err)
			}
			slot := &videoSlot{track: track}
			l.slots = append(l.slots, slot)
			go readSlotRTCP(sender, slot)
		}
	}
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		label := dc.Label()
		switch {
		case label == "page":
			s.servePage(ctx, dc)
		case strings.HasPrefix(label, "frames:"):
			l.servePictures(s, dc, strings.TrimPrefix(label, "frames:"))
		case strings.HasPrefix(label, "upload:"):
			// The link is up already: a file to this printer can ride it.
			s.uploadOverLink(dc)
		}
	})
	connected := make(chan struct{})
	var connectedOnce sync.Once
	pc.OnConnectionStateChange(func(st webrtc.PeerConnectionState) {
		switch st {
		case webrtc.PeerConnectionStateConnected:
			connectedOnce.Do(func() { close(connected) })
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			s.dropLink(l.id)
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
	// A page has one link: a new one replaces the one that dropped.
	old := s.links
	s.links = map[string]*sharedLink{l.id: l}
	s.mu.Unlock()
	for _, o := range old {
		go o.close()
	}
	go func() {
		select {
		case <-connected:
		case <-time.After(connectTimeout):
			s.dropLink(l.id)
		case <-ctx.Done():
		}
	}()
	return map[string]any{"id": l.id, "sdp": pc.LocalDescription().SDP, "videoSlots": len(l.slots)}, nil
}

func (s *Session) linkClose(id string) (any, error) {
	s.dropLink(id)
	return map[string]any{"ok": true}, nil
}

func (s *Session) dropLink(id string) {
	s.mu.Lock()
	l := s.links[id]
	delete(s.links, id)
	s.mu.Unlock()
	if l != nil {
		go l.close()
	}
}

func (s *Session) getLink(id string) (*sharedLink, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	l := s.links[id]
	if l == nil {
		return nil, errors.New("The direct link closed.")
	}
	return l, nil
}

// linkCamera starts a camera on the link. The answer says which slot it is on
// and how it comes: "video" on that video slot, or "pictures" on channel
// "frames:<slot>", which the page opens next.
func (s *Session) linkCamera(p cameraOpenParams) (any, error) {
	l, err := s.getLink(p.Link)
	if err != nil {
		return nil, err
	}
	l.mu.Lock()
	slot := -1
	for i := 0; i < maxDirectCameras; i++ {
		if l.cams[i] == nil {
			slot = i
			break
		}
	}
	if slot < 0 {
		l.mu.Unlock()
		return nil, fmt.Errorf("Up to %d cameras at a time.", maxDirectCameras)
	}
	ctx, cancel := context.WithCancel(l.ctx)
	cam := &linkCamera{ctx: ctx, cancel: cancel}
	// Held while the camera's video is asked for, so a second camera takes another slot.
	l.cams[slot] = cam
	l.mu.Unlock()
	fail := func(err error) (any, error) {
		l.mu.Lock()
		if l.cams[slot] == cam {
			delete(l.cams, slot)
		}
		l.mu.Unlock()
		cam.close()
		return nil, err
	}

	// The camera's own live video, when it has one and the browser can play it.
	if slot < len(l.slots) {
		for _, sig := range s.videoSources(p) {
			up, track, err := connectSource(ctx, sig)
			if err == nil {
				cam.upstream = up
				go forwardVideo(ctx, track, l.slots[slot], up)
				return map[string]any{"slot": slot, "mode": "video"}, nil
			}
			s.debug("camera video from " + sig.url.String() + ": " + err.Error())
		}
	}
	if ctx.Err() != nil {
		return fail(errors.New("The direct link closed."))
	}
	if p.SnapshotURL == "" {
		return fail(errors.New("This camera has no live video the bridge can pass on, and no pictures."))
	}
	fps := p.FPS
	if fps <= 0 || fps > maxDirectFPS {
		fps = maxDirectFPS
	}
	cam.snapshot, cam.fps = p.SnapshotURL, fps
	return map[string]any{"slot": slot, "mode": "pictures"}, nil
}

func (s *Session) linkCameraClose(id string, slot int) (any, error) {
	l, err := s.getLink(id)
	if err != nil {
		return map[string]any{"ok": true}, nil
	}
	l.mu.Lock()
	cam := l.cams[slot]
	delete(l.cams, slot)
	l.mu.Unlock()
	if cam != nil {
		cam.close()
	}
	return map[string]any{"ok": true}, nil
}

// servePictures sends a pictures camera's pictures on its channel "frames:<slot>".
func (l *sharedLink) servePictures(s *Session, dc *webrtc.DataChannel, which string) {
	var slot int
	if _, err := fmt.Sscan(which, &slot); err != nil {
		_ = dc.Close()
		return
	}
	l.mu.Lock()
	cam := l.cams[slot]
	l.mu.Unlock()
	if cam == nil || cam.snapshot == "" {
		_ = dc.Close()
		return
	}
	dc.OnOpen(func() { go s.sendPictures(cam.ctx, dc, cam.snapshot, cam.fps) })
}

// readSlotRTCP passes the browser's requests for a fresh full picture (after a
// lost packet, or on joining) to whichever camera is on the slot.
func readSlotRTCP(sender *webrtc.RTPSender, slot *videoSlot) {
	for {
		pkts, _, err := sender.ReadRTCP()
		if err != nil {
			return
		}
		for _, p := range pkts {
			switch p.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				slot.mu.Lock()
				ask := slot.keyframe
				slot.mu.Unlock()
				if ask != nil {
					ask()
				}
			}
		}
	}
}

// forwardVideo passes the camera's video packets on to the slot unchanged until the camera closes.
func forwardVideo(ctx context.Context, src *webrtc.TrackRemote, slot *videoSlot, upstream *webrtc.PeerConnection) {
	askKeyframe := func() {
		_ = upstream.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(src.SSRC())}})
	}
	slot.take(ctx, askKeyframe)
	defer slot.leave(ctx)
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
		if ctx.Err() != nil {
			return
		}
		_ = slot.track.WriteRTP(pkt)
	}
}
