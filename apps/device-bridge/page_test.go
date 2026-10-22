package main

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// A pretend printer behind a login, like the paxx12 U1: its remote screen page at
// /screen/ (listed as an "iframe" camera), an MJPEG camera, and Moonraker's API.
type fakePagePrinter struct {
	*httptest.Server
	mu      sync.Mutex
	touches []string
	api     []string
}

func newFakePagePrinter(t *testing.T) *fakePagePrinter {
	p := &fakePagePrinter{}
	mux := http.NewServeMux()
	authed := func(w http.ResponseWriter, r *http.Request) bool {
		if r.Header.Get("X-Api-Key") != "printer-key" {
			http.Error(w, "login first", http.StatusUnauthorized)
			return false
		}
		return true
	}
	mux.HandleFunc("/server/webcams/list", func(w http.ResponseWriter, r *http.Request) {
		if !authed(w, r) {
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"webcams": []map[string]any{
			{"name": "gui", "service": "iframe", "stream_url": "/screen/", "snapshot_url": "/screen/snapshot"},
			{"name": "case", "service": "mjpegstreamer", "stream_url": "/webcam/?action=stream"},
			{"name": "off", "service": "iframe", "enabled": false, "stream_url": "/hidden/page"},
			{"name": "elsewhere", "service": "iframe", "stream_url": "http://example.com/page/"},
		}}})
	})
	mux.HandleFunc("/screen/", func(w http.ResponseWriter, r *http.Request) {
		if !authed(w, r) {
			return
		}
		switch r.URL.Path {
		case "/screen/":
			w.Header().Set("Content-Type", "text/html")
			w.Header().Set("Set-Cookie", "session=secret")
			_, _ = io.WriteString(w, "<img src=snapshot>")
		case "/screen/snapshot":
			if r.Header.Get("If-None-Match") == `"1"` {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", `"1"`)
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(fakePicture)
		case "/screen/touch":
			p.mu.Lock()
			p.touches = append(p.touches, r.Method+" "+r.URL.RawQuery)
			p.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		case "/screen/old":
			http.Redirect(w, r, "/screen/", http.StatusFound)
		case "/screen/away":
			http.Redirect(w, r, "http://example.com/", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	})
	for _, api := range []string{"/access/", "/machine/", "/printer/", "/hidden/"} {
		mux.HandleFunc(api, func(w http.ResponseWriter, r *http.Request) {
			p.mu.Lock()
			p.api = append(p.api, r.URL.Path)
			p.mu.Unlock()
		})
	}
	p.Server = httptest.NewServer(mux)
	t.Cleanup(p.Close)
	return p
}

func pageSession(p *fakePagePrinter) *Session {
	return newSession("c1", Printer{ID: "p", Name: "fake", URL: p.URL, APIKey: "printer-key"}, func(string) {}, func(string) {})
}

func TestPagesOpenWithThePrintersKey(t *testing.T) {
	p := newFakePagePrinter(t)
	s := pageSession(p)
	defer s.close()
	res, err := s.pageFetch(pageRequest{Method: "GET", Path: "/screen/"}, maxPageResponse)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != 200 || string(res.Body) != "<img src=snapshot>" || res.Headers["Content-Type"] != "text/html" {
		t.Fatalf("page: %d %q %v", res.Status, res.Body, res.Headers)
	}
	if _, ok := res.Headers["Set-Cookie"]; ok {
		t.Fatal("the printer's cookies must not reach the browser")
	}
	// A tap is a small POST in the page's folder.
	res, err = s.pageFetch(pageRequest{Method: "POST", Path: "/screen/touch?a=tap&x=10&y=20"}, maxPageResponse)
	if err != nil || res.Status != http.StatusNoContent {
		t.Fatalf("touch: %v %v", res, err)
	}
	p.mu.Lock()
	touches := strings.Join(p.touches, ",")
	p.mu.Unlock()
	if touches != "POST a=tap&x=10&y=20" {
		t.Fatalf("touches %q", touches)
	}
}

func TestPagesPassConditionalAnswers(t *testing.T) {
	p := newFakePagePrinter(t)
	s := pageSession(p)
	defer s.close()
	res, err := s.pageFetch(pageRequest{Path: "/screen/snapshot?ts=1"}, maxPageResponse)
	if err != nil || res.Status != 200 || res.Headers["ETag"] != `"1"` || len(res.Body) != len(fakePicture) {
		t.Fatalf("first picture: %v %v", res, err)
	}
	res, err = s.pageFetch(pageRequest{Path: "/screen/snapshot?ts=2", Headers: map[string]string{"if-none-match": `"1"`, "Cookie": "x"}}, maxPageResponse)
	if err != nil || res.Status != http.StatusNotModified {
		t.Fatalf("unchanged picture: %v %v", res, err)
	}
}

func TestPagesStayInTheListedFolders(t *testing.T) {
	p := newFakePagePrinter(t)
	s := pageSession(p)
	defer s.close()
	for _, path := range []string{
		"/access/api_key", "/machine/sudo/password", "/printer/gcode/script?script=G28", "/server/files/list",
		"/screen/../access/api_key", "/screen/%2e%2e/access/api_key", "/hidden/page", "/page/",
		"http://example.com/screen/", "//example.com/screen/", "screen/", "/webcam/?action=stream",
	} {
		if res, err := s.pageFetch(pageRequest{Path: path}, maxPageResponse); err == nil {
			t.Errorf("%s: should be refused, got %d", path, res.Status)
		}
	}
	for _, m := range []string{"PUT", "DELETE", "PATCH"} {
		if _, err := s.pageFetch(pageRequest{Method: m, Path: "/screen/touch"}, maxPageResponse); err == nil {
			t.Errorf("%s should be refused", m)
		}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.api) > 0 {
		t.Fatalf("reached %v", p.api)
	}
}

func TestPageRedirectsStayOnThePrinter(t *testing.T) {
	p := newFakePagePrinter(t)
	s := pageSession(p)
	defer s.close()
	res, err := s.pageFetch(pageRequest{Path: "/screen/old"}, maxPageResponse)
	if err != nil || res.Status != http.StatusFound || res.Headers["Location"] != "/screen/" {
		t.Fatalf("move within the page: %v %v", res, err)
	}
	res, err = s.pageFetch(pageRequest{Path: "/screen/away"}, maxPageResponse)
	if err != nil || res.Status != http.StatusFound || res.Headers["Location"] != "" {
		t.Fatalf("a move to another computer must not be passed on: %v %v", res, err)
	}
}

func TestRelayedPagesFitOneMessage(t *testing.T) {
	p := newFakePagePrinter(t)
	s := pageSession(p)
	defer s.close()
	out, err := s.pageFetchRelayed(pageRequest{Path: "/screen/snapshot"})
	if err != nil {
		t.Fatal(err)
	}
	m := out.(map[string]any)
	data, _ := base64.StdEncoding.DecodeString(m["data"].(string))
	if m["status"] != 200 || len(data) != len(fakePicture) {
		t.Fatalf("relayed: %v, %d bytes", m["status"], len(data))
	}
	if _, err := s.pageFetch(pageRequest{Path: "/screen/snapshot"}, 1000); err == nil {
		t.Fatal("an answer over the limit should be refused")
	}
}

func TestDirectPageLink(t *testing.T) {
	p := newFakePagePrinter(t)
	s := pageSession(p)
	defer s.close()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	dc, _ := pc.CreateDataChannel("page", nil)
	type answer struct {
		head map[string]any
		body []byte
	}
	answers := make(chan answer, 4)
	bodies := map[uint32][]byte{}
	heads := map[uint32]map[string]any{}
	dc.OnMessage(func(m webrtc.DataChannelMessage) {
		if m.IsString {
			var h map[string]any
			_ = json.Unmarshal(m.Data, &h)
			id := uint32(h["id"].(float64))
			if h["error"] != nil || h["size"].(float64) == 0 {
				answers <- answer{h, nil}
				return
			}
			heads[id] = h
			return
		}
		id := binary.BigEndian.Uint32(m.Data)
		bodies[id] = append(bodies[id], m.Data[5:]...)
		if m.Data[4] == 1 {
			answers <- answer{heads[id], bodies[id]}
		}
	})
	offer, _ := pc.CreateOffer(nil)
	done := webrtc.GatheringCompletePromise(pc)
	_ = pc.SetLocalDescription(offer)
	<-done
	res, err := s.pageOpen(pc.LocalDescription().SDP)
	if err != nil {
		t.Fatal(err)
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: res.(map[string]any)["sdp"].(string)}); err != nil {
		t.Fatal(err)
	}
	opened := make(chan struct{})
	dc.OnOpen(func() { close(opened) })
	select {
	case <-opened:
	case <-time.After(15 * time.Second):
		t.Fatal("the direct page link did not open")
	}
	send := func(r pageRequest) answer {
		b, _ := json.Marshal(r)
		_ = dc.SendText(string(b))
		select {
		case a := <-answers:
			return a
		case <-time.After(15 * time.Second):
			t.Fatalf("no answer to %s", r.Path)
		}
		return answer{}
	}
	a := send(pageRequest{ID: 7, Path: "/screen/snapshot"})
	if a.head["status"].(float64) != 200 || len(a.body) != len(fakePicture) || string(a.body) != string(fakePicture) {
		t.Fatalf("picture over the direct link: %v, %d bytes", a.head, len(a.body))
	}
	a = send(pageRequest{ID: 8, Method: "POST", Path: "/screen/touch?a=down&x=1&y=2"})
	if a.head["status"].(float64) != 204 {
		t.Fatalf("touch over the direct link: %v", a.head)
	}
	a = send(pageRequest{ID: 9, Path: "/access/api_key"})
	if a.head["error"] == nil {
		t.Fatalf("Moonraker's API over the direct link: %v", a.head)
	}
	s.close()
	s.mu.Lock()
	left := len(s.pages)
	s.mu.Unlock()
	if left != 0 {
		t.Fatal("closing the session should close its page links")
	}
}
