package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTimelapseFilesOnlyReachVideosInTimelapseFolders(t *testing.T) {
	for in, want := range map[string]string{
		"timelapse/benchy.mp4":      "timelapse/benchy.mp4",
		"/timelapse/a/b.MKV":        "timelapse/a/b.MKV",
		"camera/print_1.mp4":        "camera/print_1.mp4",
		"timelapse/benchy.jpg":      "timelapse/benchy.jpg",
		"timelapse/../config/x.mp4": "",
		"timelapse/./x.mp4":         "",
		"config/printer.cfg":        "",
		"gcodes/a.mp4":              "",
		"timelapse/notes.txt":       "",
		"timelapse/":                "",
		"timelapse":                 "",
		"camera//x.mp4":             "",
	} {
		if got := timelapseRel(in); got != want {
			t.Errorf("timelapseRel(%q) = %q, want %q", in, got, want)
		}
	}
	if timelapsePath("/server/files/camera/x.mp4?_t=1") != "/server/files/camera/x.mp4" {
		t.Error("a timelapse address with a query should pass, without it")
	}
	for _, p := range []string{"/server/files/config/printer.cfg", "/server/files/gcodes/a.gcode", "/printer/info", "/server/files/timelapse/../../x.mp4"} {
		if timelapsePath(p) != "" {
			t.Errorf("%s should not be a timelapse address", p)
		}
	}
	if why := refusal("server.files.delete_file", json.RawMessage(`{"path":"timelapse/benchy.mp4"}`)); why != "" {
		t.Errorf("deleting a timelapse refused: %s", why)
	}
	for _, p := range []string{`{"path":"camera/monitor.txt"}`, `{"path":"timelapse/../config/printer.cfg"}`} {
		if refusal("server.files.delete_file", json.RawMessage(p)) == "" {
			t.Errorf("delete %s should be refused", p)
		}
	}
}

func TestOctoPrintTimelapsesAsAFolder(t *testing.T) {
	video := []byte("0123456789")
	deleted := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "k" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		switch {
		case r.URL.Path == "/api/timelapse" && r.Method == http.MethodGet:
			writeJSON(w, 200, map[string]any{"files": []any{
				map[string]any{"name": "benchy_20261102.mp4", "bytes": 10, "size": "10B", "date": "2026-11-02 10:42", "timestamp": 1793612520.0},
				map[string]any{"name": "old.mpg", "bytes": 5, "date": "2020-01-01 00:00"},
			}})
		case r.URL.Path == "/downloads/timelapse/benchy_20261102.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			http.ServeContent(w, r, "x.mp4", time.Unix(1793612520, 0), strings.NewReader(string(video)))
		case strings.HasPrefix(r.URL.Path, "/api/timelapse/") && r.Method == http.MethodDelete:
			deleted = strings.TrimPrefix(r.URL.Path, "/api/timelapse/")
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	o := newOctoPrint(srv.URL, "k")
	ctx := context.Background()
	list, err := o.timelapses(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Path != "benchy_20261102.mp4" || list[0].Size != 10 || list[0].Modified != 1793612520 || list[1].Modified == 0 {
		t.Fatalf("list: %+v", list)
	}
	res, err := o.timelapseOpen(ctx, "benchy_20261102.mp4", "bytes=2-5")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusPartialContent || string(body) != "2345" {
		t.Fatalf("range: %d %q", res.StatusCode, body)
	}
	if err := o.removeTimelapse(ctx, "benchy_20261102.mp4"); err != nil || deleted != "benchy_20261102.mp4" {
		t.Fatalf("delete: %v %q", err, deleted)
	}
}

func TestTimelapseVideosComeThroughThePageLinkInPieces(t *testing.T) {
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.Method+" "+r.URL.Path)
		if r.Header.Get("X-Api-Key") != "printer-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/server/files/camera/print_1.mp4" {
			w.Header().Set("Content-Type", "video/mp4")
			http.ServeContent(w, r, "print_1.mp4", time.Unix(1793612520, 0), strings.NewReader("abcdefghij"))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: srv.URL, APIKey: "printer-key"}, func(string) {}, func(string) {})
	defer s.close()
	res, err := s.pageFetch(pageRequest{Method: "GET", Path: "/server/files/camera/print_1.mp4", Headers: map[string]string{"Range": "bytes=0-3"}}, maxRelayedPage)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != http.StatusPartialContent || string(res.Body) != "abcd" || res.Headers["Content-Range"] != "bytes 0-3/10" {
		t.Fatalf("piece: %d %q %v", res.Status, res.Body, res.Headers)
	}
	for _, r := range []pageRequest{
		{Method: "POST", Path: "/server/files/camera/print_1.mp4"},
		{Method: "GET", Path: "/server/files/config/printer.cfg"},
		{Method: "GET", Path: "/server/files/camera/../config/printer.cfg"},
	} {
		if _, err := s.pageFetch(r, maxRelayedPage); err == nil {
			t.Errorf("%s %s should be refused", r.Method, r.Path)
		}
	}
	for _, a := range asked {
		if strings.Contains(a, "config") || strings.HasPrefix(a, "POST") {
			t.Fatalf("reached %v", asked)
		}
	}
}
