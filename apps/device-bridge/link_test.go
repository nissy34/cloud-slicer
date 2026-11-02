package main

import (
	"strconv"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// linkBrowser is a pretend page with its direct link to the bridge up.
type linkBrowser struct {
	t  *testing.T
	s  *Session
	pc *webrtc.PeerConnection
	id string
}

// pretendBrowser makes the offer the page makes (receive-only video slots and
// the data channel every link starts with), opens the direct link with it and waits until it connects.
// setup runs on the browser's connection before the offer.
func pretendBrowser(t *testing.T, s *Session, setup func(*webrtc.PeerConnection)) *linkBrowser {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	for i := 0; i < maxDirectCameras; i++ {
		if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pc.CreateDataChannel("link", nil); err != nil {
		t.Fatal(err)
	}
	if setup != nil {
		setup(pc)
	}
	connected := make(chan struct{})
	pc.OnConnectionStateChange(func(st webrtc.PeerConnectionState) {
		if st == webrtc.PeerConnectionStateConnected {
			select {
			case <-connected:
			default:
				close(connected)
			}
		}
	})
	offer, _ := pc.CreateOffer(nil)
	done := webrtc.GatheringCompletePromise(pc)
	_ = pc.SetLocalDescription(offer)
	<-done
	res, err := s.linkOpen(pc.LocalDescription().SDP)
	if err != nil {
		t.Fatal(err)
	}
	m := res.(map[string]any)
	if m["videoSlots"] != maxDirectCameras {
		t.Fatalf("video slots %v, want %d", m["videoSlots"], maxDirectCameras)
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: m["sdp"].(string)}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-connected:
	case <-time.After(15 * time.Second):
		t.Fatal("the direct link did not connect")
	}
	return &linkBrowser{t: t, s: s, pc: pc, id: m["id"].(string)}
}

func (b *linkBrowser) camera(p cameraOpenParams) (int, string) {
	b.t.Helper()
	p.Link = b.id
	res, err := b.s.linkCamera(p)
	if err != nil {
		b.t.Fatal(err)
	}
	m := res.(map[string]any)
	return m["slot"].(int), m["mode"].(string)
}

// pictures opens a pictures camera's channel and hands back each whole picture.
func (b *linkBrowser) pictures(slot int) chan []byte {
	b.t.Helper()
	dc, err := b.pc.CreateDataChannel("frames:"+strconv.Itoa(slot), nil)
	if err != nil {
		b.t.Fatal(err)
	}
	out := make(chan []byte, 4)
	var buf []byte
	dc.OnMessage(func(m webrtc.DataChannelMessage) {
		if m.IsString || len(m.Data) == 0 {
			return
		}
		buf = append(buf, m.Data[1:]...)
		if m.Data[0] == 1 {
			select {
			case out <- buf:
			default:
			}
			buf = nil
		}
	})
	return out
}

// Two cameras and their pictures share one link: no new connection per camera.
func TestCamerasShareOneLink(t *testing.T) {
	cam := newFakeVideoCamera(t, false)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: cam.URL}, func(string) {}, func(string) {})
	defer s.close()
	b := pretendBrowser(t, s, nil)
	first, _ := b.camera(cameraOpenParams{SnapshotURL: "/webcam/snapshot.jpg", FPS: 10})
	second, _ := b.camera(cameraOpenParams{SnapshotURL: "/webcam/snapshot.jpg", FPS: 10})
	if first == second {
		t.Fatalf("both cameras on slot %d", first)
	}
	for _, slot := range []int{first, second} {
		select {
		case <-b.pictures(slot):
		case <-time.After(15 * time.Second):
			t.Fatalf("no pictures on slot %d", slot)
		}
	}
	s.mu.Lock()
	links := len(s.links)
	s.mu.Unlock()
	if links != 1 {
		t.Fatalf("%d links, want 1", links)
	}
	// A closed camera frees its slot for the next one.
	if _, err := s.linkCameraClose(b.id, first); err != nil {
		t.Fatal(err)
	}
	again, _ := b.camera(cameraOpenParams{SnapshotURL: "/webcam/snapshot.jpg"})
	if again != first {
		t.Fatalf("next camera on slot %d, want the freed slot %d", again, first)
	}
}

func TestCamerasAreLimited(t *testing.T) {
	cam := newFakeVideoCamera(t, false)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: cam.URL}, func(string) {}, func(string) {})
	defer s.close()
	b := pretendBrowser(t, s, nil)
	for i := 0; i < maxDirectCameras; i++ {
		b.camera(cameraOpenParams{SnapshotURL: "/webcam/snapshot.jpg"})
	}
	if _, err := s.linkCamera(cameraOpenParams{Link: b.id, SnapshotURL: "/webcam/snapshot.jpg"}); err == nil {
		t.Fatal("one camera too many should be refused")
	}
}

// After a drop the page opens a new link: it replaces the old one, whose cameras end.
func TestNewLinkReplacesTheOldOne(t *testing.T) {
	cam := newFakeVideoCamera(t, false)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: cam.URL}, func(string) {}, func(string) {})
	defer s.close()
	old := pretendBrowser(t, s, nil)
	old.camera(cameraOpenParams{SnapshotURL: "/webcam/snapshot.jpg"})
	fresh := pretendBrowser(t, s, nil)
	if _, err := s.linkCamera(cameraOpenParams{Link: old.id, SnapshotURL: "/webcam/snapshot.jpg"}); err == nil {
		t.Fatal("the old link should be gone")
	}
	if slot, _ := fresh.camera(cameraOpenParams{SnapshotURL: "/webcam/snapshot.jpg"}); slot != 0 {
		t.Fatalf("first camera on the new link on slot %d", slot)
	}
}
