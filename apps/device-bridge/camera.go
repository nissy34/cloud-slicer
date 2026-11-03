package main

// Cameras over the direct link (link.go): the camera flows straight from this
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
	"time"

	"github.com/pion/webrtc/v4"
)

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
	apiKey   string // the printer's API key: its web server may want it, as it does from Fluidd
}

// videoSources lists where this camera's live video may be asked for, best first, on the printer's own host only.
func (s *Session) videoSources(p cameraOpenParams) []videoSignal {
	var out []videoSignal
	add := func(protocol, raw string) {
		if raw == "" {
			return
		}
		addrs, err := s.cameraAddresses(raw)
		if err != nil {
			return
		}
	next:
		for _, u := range addrs {
			for _, o := range out {
				if o.url.String() == u.String() {
					continue next
				}
			}
			out = append(out, videoSignal{protocol, u, s.printer.APIKey})
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
		if err := postJSON(ctx, sig.url, sig.apiKey, map[string]any{"type": "request", "keepAlive": true}, &offer); err != nil {
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
		return postJSON(ctx, sig.url, sig.apiKey, map[string]any{"type": "answer", "id": offer.ID, "sdp": pc.LocalDescription().SDP}, nil)
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
	sig.sign(req)
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

// sign adds the printer's API key. Video is only ever asked for on the printer's own host.
func (sig videoSignal) sign(req *http.Request) {
	withKey(req, sig.apiKey)
}

func withKey(req *http.Request, apiKey string) {
	if apiKey != "" {
		req.Header.Set("X-Api-Key", apiKey)
	}
}

// postJSON talks to a camera; u is always on the printer's own host (Session.resolve checks it).
func postJSON(ctx context.Context, u *url.URL, apiKey string, body any, out any) error {
	data, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	withKey(req, apiKey)
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
