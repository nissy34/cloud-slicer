package main

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func zipped(t *testing.T, s string) []byte {
	var buf bytes.Buffer
	z := gzip.NewWriter(&buf)
	_, _ = z.Write([]byte(s))
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func startUpload(t *testing.T, s *Session, p uploadParams) map[string]any {
	res, err := s.uploadStart(p)
	if err != nil {
		t.Fatal(err)
	}
	return res.(map[string]any)
}

func TestZippedUploadReachesThePrinterUnzipped(t *testing.T) {
	m := newFakeMoonraker(t)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(string) {}, func(string) {})
	defer s.close()
	content := strings.Repeat("G1 X10 Y10 E0.5\n", 100_000)
	z := zipped(t, content)
	id := startUpload(t, s, uploadParams{Path: "z.gcode", Size: float64(len(content)), Wire: float64(len(z)), Zipped: true})["uploadId"].(string)
	half := len(z) / 2
	if _, err := s.uploadPiece(id, 0, z[:half]); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadPiece(id, 0, z[half:]); err == nil {
		t.Fatal("a piece at the wrong offset was accepted")
	}
	if _, err := s.uploadPiece(id, int64(half), z[half:]); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadEnd(id); err != nil {
		t.Fatal(err)
	}
	if m.file("z.gcode") != content {
		t.Fatalf("printer got %d bytes, want %d", len(m.file("z.gcode")), len(content))
	}
}

func TestZipThatUnzipsToTheWrongSizeIsRefused(t *testing.T) {
	m := newFakeMoonraker(t)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(string) {}, func(string) {})
	defer s.close()
	z := zipped(t, strings.Repeat("A", 5000))
	// Says 1000 bytes, unzips to 5000: the printer must not get a file.
	id := startUpload(t, s, uploadParams{Path: "bomb.gcode", Size: 1000, Wire: float64(len(z)), Zipped: true})["uploadId"].(string)
	_, _ = s.uploadPiece(id, 0, z)
	if _, err := s.uploadEnd(id); err == nil {
		t.Fatal("an oversized zip was uploaded")
	}
	if _, ok := m.uploaded["bomb.gcode"]; ok {
		t.Fatal("the printer kept the file")
	}
}

func TestBinaryPieceFromTheRelay(t *testing.T) {
	m := newFakeMoonraker(t)
	sent := make(chan string, 4)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(msg string) { sent <- msg }, func(string) {})
	defer s.close()
	content := "G28\nG1 X1\n"
	id := startUpload(t, s, uploadParams{Path: "b.gcode", Size: float64(len(content))})["uploadId"].(string)
	head, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": "b7", "method": "bridge.upload_piece", "params": map[string]any{"uploadId": id, "offset": 0}})
	msg := binary.BigEndian.AppendUint32(nil, uint32(len(head)))
	msg = append(append(msg, head...), content...)
	b := &Bridge{sessions: map[string]*Session{"c1": s}}
	b.handleBinary(append([]byte{2, 'c', '1'}, msg...))
	select {
	case reply := <-sent:
		if !strings.Contains(reply, `"id":"b7"`) || !strings.Contains(reply, `"received":10`) {
			t.Fatalf("reply %s", reply)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no reply to the piece")
	}
	if _, err := s.uploadEnd(id); err != nil {
		t.Fatal(err)
	}
	if m.file("b.gcode") != content {
		t.Fatalf("printer got %q", m.file("b.gcode"))
	}
}

// pretendUploader makes the offer the page makes for a direct upload.
func pretendUploader(t *testing.T) (*webrtc.PeerConnection, *webrtc.DataChannel, string) {
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	dc, err := pc.CreateDataChannel("upload", nil)
	if err != nil {
		t.Fatal(err)
	}
	offer, _ := pc.CreateOffer(nil)
	done := webrtc.GatheringCompletePromise(pc)
	_ = pc.SetLocalDescription(offer)
	<-done
	return pc, dc, pc.LocalDescription().SDP
}

func TestDirectUploadOverTheDataChannel(t *testing.T) {
	m := newFakeMoonraker(t)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(string) {}, func(string) {})
	defer s.close()
	content := strings.Repeat("G1 X20 Y20 E1\n", 60_000)
	z := zipped(t, content)
	pc, dc, offer := pretendUploader(t)
	res := startUpload(t, s, uploadParams{Path: "d.gcode", Size: float64(len(content)), Wire: float64(len(z)), Zipped: true, SDP: offer})
	sdp, _ := res["sdp"].(string)
	if sdp == "" {
		t.Fatal("no direct link offered")
	}
	answer := make(chan string, 1)
	dc.OnMessage(func(msg webrtc.DataChannelMessage) { answer <- string(msg.Data) })
	opened := make(chan struct{})
	dc.OnOpen(func() { close(opened) })
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdp}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-opened:
	case <-time.After(10 * time.Second):
		t.Fatal("the direct link did not open")
	}
	// Over the relay, pieces are refused while the direct link carries the upload.
	if _, err := s.uploadPiece(res["uploadId"].(string), 0, z[:10]); err == nil {
		t.Fatal("a relay piece was accepted during a direct upload")
	}
	for off := 0; off < len(z); off += 16 << 10 {
		if err := dc.Send(z[off:min(off+16<<10, len(z))]); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case a := <-answer:
		if !strings.Contains(a, `"path":"d.gcode"`) {
			t.Fatalf("answer %s", a)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("no answer on the direct link")
	}
	if m.file("d.gcode") != content {
		t.Fatalf("printer got %d bytes, want %d", len(m.file("d.gcode")), len(content))
	}
}

func TestResumeOverTheRelayWhenTheDirectLinkFails(t *testing.T) {
	m := newFakeMoonraker(t)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(string) {}, func(string) {})
	defer s.close()
	content := "G28\n"
	_, _, offer := pretendUploader(t)
	res := startUpload(t, s, uploadParams{Path: "r.gcode", Size: float64(len(content)), SDP: offer})
	id := res["uploadId"].(string)
	// The browser never connects; it asks where to carry on from.
	out, err := s.uploadResume(id)
	if err != nil || out.(map[string]any)["received"] != int64(0) {
		t.Fatalf("resume: %v %v", out, err)
	}
	if _, err := s.uploadPiece(id, 0, []byte(content)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadEnd(id); err != nil {
		t.Fatal(err)
	}
	if m.file("r.gcode") != content {
		t.Fatalf("printer got %q", m.file("r.gcode"))
	}
}

func (f *fakeMoonraker) file(name string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.uploaded[name]
}

func TestCancelledUploadLeavesNothingOnThePrinter(t *testing.T) {
	m := newFakeMoonraker(t)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(string) {}, func(string) {})
	defer s.close()
	id := startUpload(t, s, uploadParams{Path: "c.gcode", Size: 10})["uploadId"].(string)
	if _, err := s.uploadPiece(id, 0, []byte("12345")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadCancel(id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadPiece(id, 5, []byte("67890")); err == nil {
		t.Fatal("a piece after cancelling was accepted")
	}
	time.Sleep(50 * time.Millisecond)
	if m.file("c.gcode") != "" {
		t.Fatal("the printer kept a cancelled file")
	}
}

func TestRefusedUploadSaysWhy(t *testing.T) {
	refuse := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":403,"message":"Forbidden"}}`))
	}))
	defer refuse.Close()
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: refuse.URL}, func(string) {}, func(string) {})
	defer s.close()
	id := startUpload(t, s, uploadParams{Path: "f.gcode", Size: 3})["uploadId"].(string)
	_, _ = s.uploadPiece(id, 0, []byte("G28"))
	_, err := s.uploadEnd(id)
	if err == nil || err.Error() != "The printer refused the file: Forbidden (HTTP 403)." {
		t.Fatalf("error %v", err)
	}
}
