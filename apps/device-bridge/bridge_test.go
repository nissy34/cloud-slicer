package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestCandidateURLs(t *testing.T) {
	cases := map[string][]string{
		"192.168.1.50":                 {"http://192.168.1.50:7125", "http://192.168.1.50"},
		"u1.local:7125":                {"http://u1.local:7125"},
		"https://printer.example.com/": {"https://printer.example.com"},
		"  http://10.0.0.1:7125/  ":    {"http://10.0.0.1:7125"},
	}
	for in, want := range cases {
		if got := candidateURLs(in); !reflect.DeepEqual(got, want) {
			t.Errorf("candidateURLs(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestMergeDiffFieldByField(t *testing.T) {
	pending := mergeDiff(map[string]any{}, map[string]any{"extruder": map[string]any{"temperature": 20.0}, "fan": map[string]any{"speed": 0.0}})
	mergeDiff(pending, map[string]any{"extruder": map[string]any{"target": 200.0}, "fan": map[string]any{"speed": 1.0}})
	want := map[string]any{"extruder": map[string]any{"temperature": 20.0, "target": 200.0}, "fan": map[string]any{"speed": 1.0}}
	if !reflect.DeepEqual(pending, want) {
		t.Fatalf("got %v", pending)
	}
}

func TestPairingCodeMatchesTheNodeBridge(t *testing.T) {
	cfg := &Config{Relay: "https://r.example", BridgeID: "abcdefgh", Key: strings.Repeat("k", 32)}
	raw, err := base64.RawURLEncoding.DecodeString(pairingCode(cfg))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	// The same value the relay and the device tests derive (computed with node's crypto).
	want := map[string]string{"r": "https://r.example", "i": "abcdefgh", "k": "T0K4-u5XPGmA1JwjEWTw8vFv7CHmnoVm5sezDOJHS5c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestRefusesWhatTheDeviceTabNeverSends(t *testing.T) {
	for _, m := range []string{"access.get_api_key", "access.post_user", "machine.sudo.password", "machine.update.full", "server.files.move", "server.files.upload", "machine.reboot", ""} {
		if refusal(m, nil) == "" {
			t.Errorf("%q should be refused", m)
		}
	}
	for _, m := range []string{"printer.info", "printer.objects.subscribe", "printer.gcode.script", "camera.start_monitor", "server.webcams.list"} {
		if why := refusal(m, nil); why != "" {
			t.Errorf("%q refused: %s", m, why)
		}
	}
	if refusal("server.files.delete_file", json.RawMessage(`{"path":"gcodes/cube.gcode"}`)) != "" {
		t.Error("deleting a G-code file should pass")
	}
	for _, p := range []string{`{"path":"config/printer.cfg"}`, `{"path":"gcodes/../config/printer.cfg"}`, `{}`} {
		if refusal("server.files.delete_file", json.RawMessage(p)) == "" {
			t.Errorf("delete %s should be refused", p)
		}
	}
}

func TestConfigRoundTripKeepsTheNodeBridgeFormat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bridge.json")
	cfg, err := loadConfig(path, "https://relay.example/")
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.BridgeID) != 16 || len(cfg.Key) != 32 || cfg.Relay != "https://relay.example" {
		t.Fatalf("fresh config: %+v", cfg)
	}
	cfg.upsert("U1", "http://10.0.0.1:7125", "")
	if err := cfg.save(); err != nil {
		t.Fatal(err)
	}
	again, err := loadConfig(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if again.BridgeID != cfg.BridgeID || again.Key != cfg.Key || len(again.Printers) != 1 || again.Printers[0].URL != "http://10.0.0.1:7125" {
		t.Fatalf("reloaded: %+v", again)
	}
}

// A pretend Moonraker: upload endpoint, camera, and a websocket that answers printer.info.
type fakeMoonraker struct {
	*httptest.Server
	mu       sync.Mutex
	uploaded map[string]string
	received []string
	conns    []*websocket.Conn
}

func newFakeMoonraker(t *testing.T) *fakeMoonraker {
	f := &fakeMoonraker{uploaded: map[string]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/server/files/upload", func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength <= 0 {
			http.Error(w, "no length", http.StatusLengthRequired)
			return
		}
		mr, err := r.MultipartReader()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		root, name, content := "", "", ""
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			data, _ := io.ReadAll(part)
			switch part.FormName() {
			case "root":
				root = string(data)
			case "file":
				name, content = part.FileName(), string(data)
			}
		}
		if root != "gcodes" {
			http.Error(w, "wrong root "+root, http.StatusBadRequest)
			return
		}
		f.mu.Lock()
		f.uploaded[name] = content
		f.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"item": map[string]any{"path": name, "root": "gcodes"}}})
	})
	mux.HandleFunc("/webcam/snapshot.jpg", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("JPEGDATA"))
	})
	mux.HandleFunc("/websocket", func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		f.mu.Lock()
		f.conns = append(f.conns, c)
		f.mu.Unlock()
		for {
			_, data, err := c.Read(context.Background())
			if err != nil {
				return
			}
			var m rpc
			_ = json.Unmarshal(data, &m)
			f.mu.Lock()
			f.received = append(f.received, m.Method)
			f.mu.Unlock()
			out, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": m.ID, "result": map[string]any{"hostname": "fake-u1", "method": m.Method}})
			_ = c.Write(context.Background(), websocket.MessageText, out)
		}
	})
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

// notify sends a Moonraker notification to every connected bridge.
func (f *fakeMoonraker) notify(t *testing.T, method string, params any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
	for _, c := range f.conns {
		_ = c.Write(context.Background(), websocket.MessageText, out)
	}
}

type sink struct {
	mu   sync.Mutex
	msgs []string
}

func (s *sink) add(m string) {
	s.mu.Lock()
	s.msgs = append(s.msgs, m)
	s.mu.Unlock()
}

func (s *sink) wait(t *testing.T, match func(string) bool) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		for _, m := range s.msgs {
			if match(m) {
				s.mu.Unlock()
				return m
			}
		}
		s.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no matching message; got %v", s.msgs)
	return ""
}

func TestUploadStreamsIntoMoonraker(t *testing.T) {
	m := newFakeMoonraker(t)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(string) {}, func(string) {})
	defer s.close()
	content := strings.Repeat("G1 X10 Y10\n", 50_000) // ~550 KB, several chunks
	name := `odd "name".gcode`
	res, err := s.uploadBegin(name, int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	id := res.(map[string]any)["uploadId"].(string)
	// Out of order is refused, and nothing is written.
	if _, err := s.uploadChunk(id, 5, base64.StdEncoding.EncodeToString([]byte("x"))); err == nil {
		t.Fatal("out-of-order chunk accepted")
	}
	for off := 0; off < len(content); off += 128 * 1024 {
		end := min(off+128*1024, len(content))
		if _, err := s.uploadChunk(id, int64(off), base64.StdEncoding.EncodeToString([]byte(content[off:end]))); err != nil {
			t.Fatal(err)
		}
	}
	out, err := s.uploadEnd(id)
	if err != nil {
		t.Fatal(err)
	}
	if out.(map[string]any)["path"] != name {
		t.Fatalf("path %v", out)
	}
	if m.uploaded[name] != content {
		t.Fatalf("printer got %d bytes, want %d", len(m.uploaded[name]), len(content))
	}
}

func TestUploadEndedEarlyIsAnErrorNotAShortFile(t *testing.T) {
	m := newFakeMoonraker(t)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(string) {}, func(string) {})
	defer s.close()
	res, _ := s.uploadBegin("a.gcode", 10)
	id := res.(map[string]any)["uploadId"].(string)
	if _, err := s.uploadChunk(id, 0, base64.StdEncoding.EncodeToString([]byte("12345"))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadEnd(id); err == nil {
		t.Fatal("a short upload succeeded")
	}
	time.Sleep(50 * time.Millisecond)
	if _, ok := m.uploaded["a.gcode"]; ok {
		t.Fatal("the printer kept a short file")
	}
}

func TestMultipartPartsParse(t *testing.T) {
	head, tail := multipartParts("BOUNDARY", `a"b.gcode`)
	r := multipart.NewReader(strings.NewReader(head+"DATA"+tail), "BOUNDARY")
	p, _ := r.NextPart()
	v, _ := io.ReadAll(p)
	if p.FormName() != "root" || string(v) != "gcodes" {
		t.Fatalf("root part: %s=%s", p.FormName(), v)
	}
	p, _ = r.NextPart()
	v, _ = io.ReadAll(p)
	if p.FileName() != `a"b.gcode` || string(v) != "DATA" {
		t.Fatalf("file part: %q %q", p.FileName(), v)
	}
}

func TestSnapshotOnlyFromThePrintersOwnHost(t *testing.T) {
	m := newFakeMoonraker(t)
	s := newSession("c1", Printer{ID: "p", Name: "fake", URL: m.URL}, func(string) {}, func(string) {})
	defer s.close()
	got, err := s.snapshot("/webcam/snapshot.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if got.(map[string]any)["data"] != base64.StdEncoding.EncodeToString([]byte("JPEGDATA")) {
		t.Fatalf("frame %v", got)
	}
	if _, err := s.snapshot("http://169.254.169.254/latest/meta-data"); err == nil {
		t.Fatal("fetched another host")
	}
}

// The whole path: a pretend relay hands the bridge a browser, which talks to the pretend Moonraker.
func TestBridgeThroughARelay(t *testing.T) {
	moon := newFakeMoonraker(t)
	toAgent := make(chan string, 16)
	fromAgent := &sink{}
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/agent") || r.URL.Query().Get("key") != "secret" {
			http.Error(w, "no", http.StatusForbidden)
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		ctx := r.Context()
		go func() {
			for m := range toAgent {
				_ = c.Write(ctx, websocket.MessageText, []byte(m))
			}
		}()
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			fromAgent.add(string(data))
		}
	}))
	defer relay.Close()
	cfg := &Config{path: filepath.Join(t.TempDir(), "b.json"), BridgeID: "bid", Key: "secret", Relay: relay.URL, Printers: []Printer{{ID: "u1", Name: "fake-u1", URL: moon.URL}}}
	b := runBridge(cfg, bridgeOptions{})
	defer b.stop()

	hello := fromAgent.wait(t, func(m string) bool { return strings.Contains(m, `"ctl":"hello"`) })
	if !strings.Contains(hello, `"version":"6"`) || !strings.Contains(hello, `"id":"u1"`) || strings.Contains(hello, "secret") {
		t.Fatalf("hello: %s", hello)
	}
	toAgent <- `{"ctl":"open","c":"s1","printer":"u1"}`
	toAgent <- `{"c":"s1","m":"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"printer.info\"}"}`
	toAgent <- `{"c":"s1","m":"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"access.get_api_key\"}"}`
	fromAgent.wait(t, func(m string) bool { return strings.Contains(m, `fake-u1`) && strings.Contains(m, `\"id\":1`) })
	fromAgent.wait(t, func(m string) bool {
		return strings.Contains(m, `\"id\":2`) && strings.Contains(m, "does not pass on access.get_api_key")
	})
	moon.mu.Lock()
	for _, m := range moon.received {
		if strings.HasPrefix(m, "access.") {
			t.Fatalf("Moonraker got %s", m)
		}
	}
	moon.mu.Unlock()

	// Status updates arrive merged, at most once a second.
	moon.notify(t, "notify_status_update", []any{map[string]any{"extruder": map[string]any{"temperature": 20}}, 1})
	moon.notify(t, "notify_status_update", []any{map[string]any{"extruder": map[string]any{"target": 200}}, 2})
	moon.notify(t, "notify_proc_stat_update", []any{map[string]any{}})
	merged := fromAgent.wait(t, func(m string) bool { return strings.Contains(m, "notify_status_update") })
	if !strings.Contains(merged, `temperature\":20`) || !strings.Contains(merged, `target\":200`) {
		t.Fatalf("not merged: %s", merged)
	}
	fromAgent.mu.Lock()
	for _, m := range fromAgent.msgs {
		if strings.Contains(m, "notify_proc_stat_update") {
			t.Fatal("proc stats passed on")
		}
	}
	fromAgent.mu.Unlock()

	// A window with no printer chosen manages the bridge's printers.
	toAgent <- `{"c":"w1","m":"{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"bridge.remove_printer\",\"params\":{\"id\":\"u1\"}}"}`
	fromAgent.wait(t, func(m string) bool { return strings.Contains(m, `\"id\":7`) && strings.Contains(m, `\"removed\":true`) })
	fromAgent.wait(t, func(m string) bool { return strings.Contains(m, `"ctl":"drop","c":"s1"`) })
	if len(cfg.Printers) != 0 {
		t.Fatalf("printer still there: %v", cfg.Printers)
	}
	close(toAgent)
}

func TestStartWithWindowsUsesARunEntryAndCopiesTheAppOutOfDownloads(t *testing.T) {
	p := autostartPlan(planEnv{goos: "windows", home: `C:\Users\n`, localAppData: `C:\Users\n\AppData\Local`})
	if p.copyTo != filepath.Join(`C:\Users\n\AppData\Local`, "Cloud Slicer Bridge", "cloud-slicer-bridge.exe") {
		t.Fatalf("copy to %s", p.copyTo)
	}
	s := p.enable[0]
	if s.cmd != "reg" || s.args[1] != runKey {
		t.Fatalf("enable %v", s)
	}
	value := s.args[len(s.args)-2]
	// Paths with spaces stay quoted, and the bridge never opens a browser by itself at sign-in.
	if !strings.HasPrefix(value, `"`) || !strings.HasSuffix(value, `cloud-slicer-bridge.exe" run --no-browser`) {
		t.Fatalf("run entry %s", value)
	}
}

func TestStartWithMacWritesALaunchAgentThatKeepsTheBridgeRunning(t *testing.T) {
	p := autostartPlan(planEnv{goos: "darwin", home: "/Users/n"})
	if p.copyTo != "/Users/n/Library/Application Support/Cloud Slicer Bridge/cloud-slicer-bridge" {
		t.Fatalf("copy to %s", p.copyTo)
	}
	f := p.files[0]
	if f.path != "/Users/n/Library/LaunchAgents/io.qzz.awesomestuff.cloud-slicer-bridge.plist" {
		t.Fatalf("plist at %s", f.path)
	}
	for _, want := range []string{"<string>/Users/n/Library/Application Support/Cloud Slicer Bridge/cloud-slicer-bridge</string><string>run</string><string>--no-browser</string>", "<key>KeepAlive</key><true/>"} {
		if !strings.Contains(f.content, want) {
			t.Fatalf("plist lacks %s:\n%s", want, f.content)
		}
	}
}

func TestStartWithLinuxRunsWithoutASignInAndHasAMenuEntry(t *testing.T) {
	p := autostartPlan(planEnv{goos: "linux", home: "/home/pi", user: "pi"})
	unit, menu := p.files[0], p.files[1]
	if unit.path != "/home/pi/.config/systemd/user/cloud-slicer-bridge.service" || !strings.Contains(unit.content, "\nExecStart=/home/pi/.local/share/cloud-slicer-bridge/cloud-slicer-bridge run --no-browser\n") || !strings.Contains(unit.content, "\nRestart=always\n") {
		t.Fatalf("unit %s:\n%s", unit.path, unit.content)
	}
	last := p.enable[len(p.enable)-1]
	if last.cmd != "loginctl" || !reflect.DeepEqual(last.args, []string{"enable-linger", "pi"}) {
		t.Fatalf("linger %v", last)
	}
	if menu.path != "/home/pi/.local/share/applications/cloud-slicer-bridge.desktop" || !strings.Contains(menu.content, "\nExec=/home/pi/.local/share/cloud-slicer-bridge/cloud-slicer-bridge pair --open\n") || !strings.Contains(menu.content, "\nIcon=/home/pi/.local/share/cloud-slicer-bridge/icon.png\n") {
		t.Fatalf("menu %s:\n%s", menu.path, menu.content)
	}
	if p.link != "/home/pi/.local/bin/cloud-slicer-bridge" || len(iconPNG) < 1000 {
		t.Fatalf("link %s, icon %d bytes", p.link, len(iconPNG))
	}
}

// Go quotes a Windows argument that is empty or has a space, tab or quote, the C
// way, which cmd and some programs misread ("Windows cannot find '\\'"). The
// command that opens the pairing link must pass every argument as it is.
func TestBrowserOpensThePairingLinkUnchanged(t *testing.T) {
	c := &Config{Relay: "wss://relay.example/bridge", BridgeID: "abc", Key: "secret"}
	link := pairingLink(c, "https://slicer.awesomestuff.qzz.io/")
	for _, goos := range []string{"windows", "darwin", "linux"} {
		name, args := browserCommand(goos, link)
		if args[len(args)-1] != link {
			t.Fatalf("%s: link not passed as is: %q", goos, args)
		}
		if name == "cmd" {
			t.Fatalf("%s: opens the link through cmd", goos)
		}
		for _, a := range args {
			if a == "" || strings.ContainsAny(a, " \t\"") {
				t.Fatalf("%s: argument %q would be quoted on Windows", goos, a)
			}
		}
	}
	if name, args := browserCommand("windows", link); name != "rundll32" || args[0] != "url.dll,FileProtocolHandler" {
		t.Fatalf("windows: %s %q", name, args)
	}
}

func TestDoneMessageGivesTheLinkWhenNoBrowserOpened(t *testing.T) {
	if m := doneMessage(true, "https://x/#pair=1"); strings.Contains(m, "#pair=") {
		t.Fatalf("link shown although the browser opened: %q", m)
	}
	if m := doneMessage(false, "https://x/#pair=1"); !strings.Contains(m, "https://x/#pair=1") {
		t.Fatalf("no link to open by hand: %q", m)
	}
}
