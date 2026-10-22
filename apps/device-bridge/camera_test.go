package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// A pretend camera like the paxx12 U1 firmware's: pictures, and live H.264 at /webcam/webrtc (camera-streamer's messages).
func newFakeVideoCamera(t *testing.T, withVideo bool) *httptest.Server {
	var mu sync.Mutex
	viewers := map[string]*webrtc.PeerConnection{}
	mux := http.NewServeMux()
	mux.HandleFunc("/webcam/snapshot.jpg", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(fakePicture)
	})
	if withVideo {
		mux.HandleFunc("/webcam/webrtc", func(w http.ResponseWriter, r *http.Request) {
			var req struct{ Type, ID, SDP string }
			_ = json.NewDecoder(r.Body).Decode(&req)
			switch req.Type {
			case "request":
				pc, _ := webrtc.NewPeerConnection(webrtc.Configuration{})
				track, _ := webrtc.NewTrackLocalStaticSample(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000, SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"}, "video", "cam")
				_, _ = pc.AddTrack(track)
				go func() {
					for {
						// An H.264 key picture's start, enough for packets to flow.
						if err := track.WriteSample(media.Sample{Data: []byte{0, 0, 0, 1, 0x65, 1, 2, 3, 4}, Duration: 50 * time.Millisecond}); err != nil {
							return
						}
						time.Sleep(50 * time.Millisecond)
						if pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
							return
						}
					}
				}()
				offer, _ := pc.CreateOffer(nil)
				done := webrtc.GatheringCompletePromise(pc)
				_ = pc.SetLocalDescription(offer)
				<-done
				mu.Lock()
				viewers["1"] = pc
				mu.Unlock()
				_ = json.NewEncoder(w).Encode(map[string]any{"type": "offer", "id": "1", "sdp": pc.LocalDescription().SDP})
			case "answer":
				mu.Lock()
				pc := viewers[req.ID]
				mu.Unlock()
				_ = pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: req.SDP})
				_ = json.NewEncoder(w).Encode(map[string]any{"type": "ok"})
			}
		})
	}
	srv := httptest.NewServer(mux)
	t.Cleanup(func() {
		mu.Lock()
		for _, pc := range viewers {
			_ = pc.Close()
		}
		mu.Unlock()
		srv.Close()
	})
	return srv
}

var fakePicture = func() []byte {
	// Bigger than one piece, so reassembly is tested.
	b := make([]byte, 40*1024+7)
	for i := range b {
		b[i] = byte(i)
	}
	return b
}()

// pretendBrowser makes the offer the page makes: receive-only video plus a "frames" channel.
func pretendBrowser(t *testing.T) (*webrtc.PeerConnection, *webrtc.DataChannel, string) {
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		t.Fatal(err)
	}
	dc, err := pc.CreateDataChannel("frames", nil)
	if err != nil {
		t.Fatal(err)
	}
	offer, _ := pc.CreateOffer(nil)
	done := webrtc.GatheringCompletePromise(pc)
	_ = pc.SetLocalDescription(offer)
	<-done
	return pc, dc, pc.LocalDescription().SDP
}

func openDirect(t *testing.T, s *Session, p cameraOpenParams) (string, string) {
	res, err := s.cameraOpen(p)
	if err != nil {
		t.Fatal(err)
	}
	m := res.(map[string]any)
	return m["mode"].(string), m["sdp"].(string)
}

func TestDirectCameraForwardsTheCamerasOwnVideo(t *testing.T) {
	cam := newFakeVideoCamera(t, true)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: cam.URL}, func(string) {}, func(string) {})
	defer s.close()
	pc, _, offer := pretendBrowser(t)
	got := make(chan string, 1)
	pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		pkt, _, err := tr.ReadRTP()
		if err == nil && len(pkt.Payload) > 0 {
			got <- tr.Codec().MimeType
		}
	})
	mode, answer := openDirect(t, s, cameraOpenParams{SDP: offer, Service: "iframe", StreamURL: "/webcam/player", SnapshotURL: "/webcam/snapshot.jpg"})
	if mode != "video" {
		t.Fatalf("mode %q, want video", mode)
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer}); err != nil {
		t.Fatal(err)
	}
	select {
	case mime := <-got:
		if mime != webrtc.MimeTypeH264 {
			t.Fatalf("got %s", mime)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("no video reached the browser")
	}
}

func TestDirectCameraSendsPicturesWhenTheCameraHasNoVideo(t *testing.T) {
	cam := newFakeVideoCamera(t, false)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: cam.URL}, func(string) {}, func(string) {})
	defer s.close()
	pc, dc, offer := pretendBrowser(t)
	pictures := make(chan []byte, 4)
	var buf []byte
	dc.OnMessage(func(m webrtc.DataChannelMessage) {
		if m.IsString || len(m.Data) == 0 {
			return
		}
		buf = append(buf, m.Data[1:]...)
		if m.Data[0] == 1 {
			pictures <- buf
			buf = nil
		}
	})
	mode, answer := openDirect(t, s, cameraOpenParams{SDP: offer, Service: "iframe", StreamURL: "/webcam/player", SnapshotURL: "/webcam/snapshot.jpg", FPS: 10})
	if mode != "pictures" {
		t.Fatalf("mode %q, want pictures", mode)
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer}); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	for i := 0; i < 3; i++ {
		select {
		case p := <-pictures:
			if !reflect.DeepEqual(p, fakePicture) {
				t.Fatalf("picture %d: %d bytes, want %d", i, len(p), len(fakePicture))
			}
		case <-time.After(15 * time.Second):
			t.Fatal("no pictures reached the browser")
		}
	}
	// Three pictures at 10 a second come well within a second of the first.
	t.Logf("3 pictures in %s", time.Since(start))
	s.close()
	s.mu.Lock()
	left := len(s.cameras)
	s.mu.Unlock()
	if left != 0 {
		t.Fatal("closing the session should close its cameras")
	}
}

func TestVideoSourcesStayOnThePrintersHost(t *testing.T) {
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: "http://10.0.0.5:7125"}, func(string) {}, func(string) {})
	urls := func(p cameraOpenParams) []string {
		var out []string
		for _, v := range s.videoSources(p) {
			out = append(out, v.protocol+" "+v.url.String())
		}
		return out
	}
	cases := []struct {
		p    cameraOpenParams
		want []string
	}{
		{cameraOpenParams{Service: "iframe", StreamURL: "/webcam/player", SnapshotURL: "/webcam/snapshot.jpg"}, []string{"camera-streamer http://10.0.0.5:7125/webcam/webrtc", "camera-streamer http://10.0.0.5/webcam/webrtc"}},
		{cameraOpenParams{Service: "webrtc-camerastreamer", StreamURL: "http://10.0.0.5/webcam/webrtc"}, []string{"camera-streamer http://10.0.0.5/webcam/webrtc"}},
		{cameraOpenParams{Service: "webrtc-mediamtx", StreamURL: "http://10.0.0.5:8889/cam"}, []string{"whep http://10.0.0.5:8889/cam/whep"}},
		{cameraOpenParams{Service: "webrtc-go2rtc", StreamURL: "http://10.0.0.5:1984/stream.html?src=cam&mode=webrtc"}, []string{"go2rtc http://10.0.0.5:1984/api/webrtc?src=cam"}},
		// Another computer is never asked.
		{cameraOpenParams{Service: "webrtc-camerastreamer", StreamURL: "http://169.254.169.254/webrtc"}, nil},
		// The U1's built-in camera is only a picture file: the paxx12 firmware's video is asked for where it usually lives.
		{cameraOpenParams{Service: "mjpegstreamer-adaptive", SnapshotURL: "/server/files/camera/monitor.jpg"}, []string{"camera-streamer http://10.0.0.5:7125/webcam/webrtc", "camera-streamer http://10.0.0.5/webcam/webrtc"}},
	}
	for _, c := range cases {
		if got := urls(c.p); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%+v: got %v, want %v", c.p, got, c.want)
		}
	}
}
