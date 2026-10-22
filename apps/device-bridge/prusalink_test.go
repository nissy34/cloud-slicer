package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// fakePrusa is a pretend Prusa printer: PrusaLink's API with digest login, as an MK4 answers it.
type fakePrusa struct {
	password string
	mu       sync.Mutex
	state    string
	jobFile  string
	files    map[string][]byte // by long name; the short name is upper case
	srv      *httptest.Server
	puts     int
}

func newFakePrusa(t *testing.T, password string) *fakePrusa {
	f := &fakePrusa{password: password, state: "IDLE", files: map[string][]byte{"benchy.bgcode": []byte("old print")}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

const fakeNonce = "abc123"

func (f *fakePrusa) authorised(r *http.Request) bool {
	p := parseChallenge(r.Header.Get("Authorization"))
	if p["username"] != "maker" || p["nonce"] != fakeNonce {
		return false
	}
	ha1 := md5hex("maker:Printer API:" + f.password)
	ha2 := md5hex(r.Method + ":" + p["uri"])
	return p["response"] == md5hex(ha1+":"+p["nonce"]+":"+p["nc"]+":"+p["cnonce"]+":"+p["qop"]+":"+ha2)
}

func short(name string) string { return strings.ToUpper(strings.TrimSuffix(name, ".bgcode")) + ".BGC" }

func (f *fakePrusa) serve(w http.ResponseWriter, r *http.Request) {
	if !f.authorised(r) {
		w.Header().Set("WWW-Authenticate", `Digest realm="Printer API", nonce="`+fakeNonce+`", qop="auth"`)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	js := func(v any) { w.Header().Set("Content-Type", "application/json"); _ = json.NewEncoder(w).Encode(v) }
	byShort := func(s string) string {
		for name := range f.files {
			if short(name) == s || name == s {
				return name
			}
		}
		return ""
	}
	path := r.URL.Path
	switch {
	case path == "/api/version":
		js(map[string]any{"api": "2.0.0", "server": "2.1.2", "text": "PrusaLink", "hostname": "prusa-mk4"})
	case path == "/api/v1/info":
		js(map[string]any{"hostname": "Prusa MK4", "serial": "x"})
	case path == "/api/v1/storage":
		js(map[string]any{"storage_list": []any{map[string]any{"path": "/usb", "name": "usb", "read_only": false, "available": true}}})
	case path == "/api/v1/status":
		st := map[string]any{"printer": map[string]any{"state": f.state, "temp_nozzle": 215.2, "target_nozzle": 215, "temp_bed": 60.1, "target_bed": 60, "axis_x": 10, "axis_y": 20, "axis_z": 1.2, "flow": 100, "speed": 110}}
		if f.jobFile != "" {
			st["job"] = map[string]any{"id": 7, "progress": 42.0, "time_remaining": 600, "time_printing": 400}
		}
		js(st)
	case path == "/api/v1/job":
		if f.jobFile == "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		js(map[string]any{"id": 7, "state": f.state, "file": map[string]any{"name": short(f.jobFile), "display_name": f.jobFile}})
	case path == "/api/v1/job/7/pause" && r.Method == http.MethodPut:
		f.state = "PAUSED"
		w.WriteHeader(http.StatusNoContent)
	case path == "/api/v1/job/7/resume" && r.Method == http.MethodPut:
		f.state = "PRINTING"
		w.WriteHeader(http.StatusNoContent)
	case path == "/api/v1/job/7" && r.Method == http.MethodDelete:
		f.state, f.jobFile = "STOPPED", ""
		w.WriteHeader(http.StatusNoContent)
	case path == "/api/v1/files/usb/" && r.Method == http.MethodGet:
		var children []any
		for name, data := range f.files {
			children = append(children, map[string]any{"name": short(name), "display_name": name, "type": "PRINT_FILE", "size": len(data), "m_timestamp": 1700000000, "refs": map[string]any{"thumbnail": "/thumb/l/usb/" + short(name)}})
		}
		js(map[string]any{"type": "FOLDER", "name": "usb", "children": children})
	case strings.HasPrefix(path, "/thumb/l/usb/"):
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("PNG of " + strings.TrimPrefix(path, "/thumb/l/usb/")))
	case strings.HasPrefix(path, "/api/v1/files/usb/"):
		name := strings.TrimPrefix(path, "/api/v1/files/usb/")
		switch r.Method {
		case http.MethodPut:
			if r.Header.Get("Overwrite") != "?1" || r.ContentLength < 0 {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			data, _ := io.ReadAll(r.Body)
			f.files[name] = data
			f.puts++
			w.WriteHeader(http.StatusCreated)
		case http.MethodGet:
			long := byShort(name)
			if long == "" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			js(map[string]any{"name": short(long), "display_name": long, "size": len(f.files[long]), "meta": map[string]any{"estimated printing time (normal mode)": "1h 2m", "filament used [g]": "5.1", "filament_type": "PLA"}, "refs": map[string]any{"thumbnail": "/thumb/l/usb/" + short(long)}})
		case http.MethodPost:
			long := byShort(name)
			if long == "" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if f.jobFile != "" {
				w.WriteHeader(http.StatusConflict)
				return
			}
			f.state, f.jobFile = "PRINTING", long
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			long := byShort(name)
			delete(f.files, long)
			w.WriteHeader(http.StatusNoContent)
		}
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func TestFindPrusaLink(t *testing.T) {
	f := newFakePrusa(t, "secret")
	ctx := context.Background()
	addr := strings.TrimPrefix(f.srv.URL, "http://")
	_, _, kind, err := findPrinter(ctx, addr, "", "")
	var pe *probeError
	if !errors.As(err, &pe) || !pe.needsKey || kind != kindPrusaLink {
		t.Fatalf("no password: want a Prusa printer asking for it, got %q %v", kind, err)
	}
	if _, _, _, err := findPrinter(ctx, addr, "wrong", ""); !errors.As(err, &pe) || !pe.needsKey {
		t.Fatalf("wrong password: want it refused, got %v", err)
	}
	url, name, kind, err := findPrinter(ctx, addr, "secret", "")
	if err != nil || kind != kindPrusaLink || name != "Prusa MK4" || url != f.srv.URL {
		t.Fatalf("got %q %q %q %v", url, name, kind, err)
	}
	hosts := strings.Split(addr, ":")
	if _, ok := probePrusaHost(ctx, http.DefaultClient, addr); !ok || hosts[0] == "" {
		t.Fatal("the search should know PrusaLink by its login challenge")
	}
}

// rpcClient talks to a stand-in like a Moonraker client.
type rpcClient struct {
	t      *testing.T
	ws     *websocket.Conn
	mu     sync.Mutex
	seq    int
	wait   map[int]chan map[string]any
	notify chan map[string]any
}

func dialStandIn(t *testing.T, base string) *rpcClient {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(base, "http")+"/websocket", nil)
	if err != nil {
		t.Fatal(err)
	}
	c := &rpcClient{t: t, ws: ws, wait: map[int]chan map[string]any{}, notify: make(chan map[string]any, 100)}
	t.Cleanup(func() { ws.CloseNow() })
	go func() {
		for {
			_, data, err := ws.Read(context.Background())
			if err != nil {
				return
			}
			var m map[string]any
			_ = json.Unmarshal(data, &m)
			if id, ok := m["id"].(float64); ok {
				c.mu.Lock()
				ch := c.wait[int(id)]
				c.mu.Unlock()
				if ch != nil {
					ch <- m
				}
				continue
			}
			c.notify <- m
		}
	}()
	return c
}

func (c *rpcClient) call(method string, params any) (any, error) {
	c.mu.Lock()
	c.seq++
	id := c.seq
	ch := make(chan map[string]any, 1)
	c.wait[id] = ch
	c.mu.Unlock()
	data, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err := c.ws.Write(context.Background(), websocket.MessageText, data); err != nil {
		c.t.Fatal(err)
	}
	select {
	case m := <-ch:
		if e, ok := m["error"].(map[string]any); ok {
			return nil, errors.New(fmt.Sprint(e["message"]))
		}
		return m["result"], nil
	case <-time.After(5 * time.Second):
		c.t.Fatalf("%s: no answer", method)
	}
	return nil, nil
}

func (c *rpcClient) must(method string, params any) any {
	r, err := c.call(method, params)
	if err != nil {
		c.t.Fatalf("%s: %v", method, err)
	}
	return r
}

// until waits for a status update in which pick finds what it wants.
func (c *rpcClient) until(what string, pick func(diff map[string]any) bool) {
	deadline := time.After(5 * time.Second)
	for {
		select {
		case m := <-c.notify:
			if m["method"] != "notify_status_update" {
				continue
			}
			params, _ := m["params"].([]any)
			if diff, ok := params[0].(map[string]any); ok && pick(diff) {
				return
			}
		case <-deadline:
			c.t.Fatalf("no status update with %s", what)
		}
	}
}

func TestPrusaLinkStandIn(t *testing.T) {
	old := pollEvery
	pollEvery = 50 * time.Millisecond
	t.Cleanup(func() { pollEvery = old })
	f := newFakePrusa(t, "secret")
	p := Printer{ID: "mk4", Name: "MK4", URL: f.srv.URL, APIKey: "secret", Kind: kindPrusaLink}
	ep := endpointFor(p)
	t.Cleanup(func() { forgetStandIn(p.ID) })
	if ep.URL == p.URL || ep.APIKey != "" || ep.shown != p.URL {
		t.Fatalf("endpoint %+v", ep)
	}
	if endpointFor(p) != ep {
		t.Fatal("the same printer should keep its stand-in")
	}
	// The bridge's checks on a Moonraker address work on the stand-in too.
	if _, info, err := probeAddress(context.Background(), ep.URL, ""); err != nil || info["brand"] != kindPrusaLink || info["hostname"] != "Prusa MK4" {
		t.Fatalf("printer.info: %v %v", info, err)
	}

	c := dialStandIn(t, ep.URL)
	if r := c.must("server.info", nil).(map[string]any); r["klippy_state"] != "ready" {
		t.Fatalf("server.info %v", r)
	}
	list := c.must("printer.objects.list", nil).(map[string]any)["objects"].([]any)
	if fmt.Sprint(list) == "" || !strings.Contains(fmt.Sprint(list), "extruder") {
		t.Fatalf("objects %v", list)
	}
	sub := c.must("printer.objects.subscribe", map[string]any{"objects": map[string]any{"webhooks": nil, "extruder": nil, "heater_bed": nil, "print_stats": nil, "gcode_move": []any{"speed_factor"}}}).(map[string]any)["status"].(map[string]any)
	if sub["extruder"].(map[string]any)["temperature"] != 215.2 || sub["print_stats"].(map[string]any)["state"] != "standby" || sub["gcode_move"].(map[string]any)["speed_factor"] != 1.1 {
		t.Fatalf("subscribe %v", sub)
	}
	if _, has := sub["gcode_move"].(map[string]any)["extrude_factor"]; has {
		t.Fatal("a field list should give only those fields")
	}

	// G-code isn't something PrusaLink takes.
	if _, err := c.call("printer.gcode.script", map[string]any{"script": "G28"}); err == nil || !strings.Contains(err.Error(), "Prusa printers") {
		t.Fatalf("gcode: %v", err)
	}
	if r := c.must("server.webcams.list", nil).(map[string]any); len(r["webcams"].([]any)) != 0 {
		t.Fatal("no cameras")
	}

	// An upload goes through the bridge's own upload, exactly as to Moonraker.
	var sent []string
	s := newSession("c1", ep, func(m string) { sent = append(sent, m) }, func(string) {})
	t.Cleanup(s.close)
	data := []byte("G28\nG1 X10\n")
	begin, err := s.uploadBegin("cube.bgcode", int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	id := begin.(map[string]any)["uploadId"].(string)
	if _, err := s.uploadChunk(id, 0, base64.StdEncoding.EncodeToString(data)); err != nil {
		t.Fatal(err)
	}
	end, err := s.uploadEnd(id)
	if err != nil || end.(map[string]any)["path"] != "cube.bgcode" {
		t.Fatalf("upload end %v %v", end, err)
	}
	f.mu.Lock()
	got := string(f.files["cube.bgcode"])
	f.mu.Unlock()
	if got != string(data) {
		t.Fatalf("the printer got %q", got)
	}

	files := c.must("server.files.list", map[string]any{"root": "gcodes"}).([]any)
	if !strings.Contains(fmt.Sprint(files), "cube.bgcode") || !strings.Contains(fmt.Sprint(files), "benchy.bgcode") {
		t.Fatalf("files %v", files)
	}
	meta := c.must("server.files.metadata", map[string]any{"filename": "benchy.bgcode"}).(map[string]any)
	if meta["estimated_time"] != 3720.0 || meta["filament_weight_total"] != 5.1 || meta["filament_type"] != "PLA" {
		t.Fatalf("metadata %v", meta)
	}
	thumb := meta["thumbnails"].([]any)[0].(map[string]any)["relative_path"].(string)
	buf, _, err := s.frame("/server/files/gcodes/" + thumb)
	if err != nil || string(buf) != "PNG of BENCHY.BGC" {
		t.Fatalf("thumbnail %q %v", buf, err)
	}

	// Start, pause, resume, cancel: each shows in the next update.
	c.must("printer.print.start", map[string]any{"filename": "cube.bgcode"})
	c.until("printing cube", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "printing" && ps["filename"] == "cube.bgcode"
	})
	if _, err := c.call("printer.print.start", map[string]any{"filename": "benchy.bgcode"}); err == nil || !strings.Contains(err.Error(), "busy") {
		t.Fatalf("a second print while one runs: %v", err)
	}
	meta = c.must("server.files.metadata", map[string]any{"filename": "cube.bgcode"}).(map[string]any)
	if meta["estimated_time"] != 1000.0 {
		t.Fatalf("the print going on should use the printer's own time left: %v", meta["estimated_time"])
	}
	c.must("printer.print.pause", nil)
	c.until("paused", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "paused"
	})
	c.must("printer.print.resume", nil)
	c.until("printing again", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "printing"
	})
	c.must("printer.print.cancel", nil)
	c.until("cancelled", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "cancelled"
	})

	c.must("server.files.delete_file", map[string]any{"path": "gcodes/benchy.bgcode"})
	f.mu.Lock()
	_, still := f.files["benchy.bgcode"]
	f.mu.Unlock()
	if still {
		t.Fatal("delete should remove the file on the printer")
	}

	// A printer that stops answering shows like Klipper going away.
	f.srv.Close()
	c.until("the printer gone", func(d map[string]any) bool { wh, _ := d["webhooks"].(map[string]any); return wh["state"] == "error" })
}

func TestPrusaSeconds(t *testing.T) {
	for in, want := range map[string]float64{"1h 2m": 3720, "1d 0h 1m 5s": 86465, "45s": 45} {
		if got, _ := prusaSeconds(map[string]any{"k": in}, "k"); got != want {
			t.Errorf("%q: %v", in, got)
		}
	}
}

func TestDigestChallenge(t *testing.T) {
	p := parseChallenge(`Digest realm="Printer API", nonce="n1", qop="auth", opaque="o"`)
	if p["realm"] != "Printer API" || p["nonce"] != "n1" || p["qop"] != "auth" || p["opaque"] != "o" {
		t.Fatalf("%v", p)
	}
	if !isPrusaChallenge(`Digest realm="Printer API", nonce="n1"`) || isPrusaChallenge(`Basic realm="router"`) {
		t.Fatal("realm check")
	}
}
