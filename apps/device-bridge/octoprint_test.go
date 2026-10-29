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
)

// fakeOcto is OctoPrint's REST API as far as the bridge uses it, with an API key.
type fakeOcto struct {
	srv      *httptest.Server
	mu       sync.Mutex
	key      string
	files    map[string][]byte
	commands []string
	state    string // Operational, Printing, Paused, Offline
	job      string
	done     float64
}

func newFakeOcto(t *testing.T, key string) *fakeOcto {
	f := &fakeOcto{key: key, files: map[string][]byte{"benchy.gcode": []byte("G28\n")}, state: "Operational"}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeOcto) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.URL.Path == "/login/" {
		_, _ = io.WriteString(w, "<html><head><title>OctoPrint Login</title></head></html>")
		return
	}
	if r.Header.Get("X-Api-Key") != f.key {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "You don't have the permission"})
		return
	}
	body := map[string]any{}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	switch p := r.URL.Path; {
	case p == "/api/version":
		writeJSON(w, 200, map[string]any{"api": "0.1", "server": "1.11.8", "text": "OctoPrint 1.11.8"})
	case p == "/api/settings":
		writeJSON(w, 200, map[string]any{"appearance": map[string]any{"name": "Ender 3"}, "webcam": map[string]any{"webcamEnabled": true, "webcams": []any{
			map[string]any{"name": "classic", "displayName": "Classic Webcam", "flipH": true, "compat": map[string]any{"stream": "/webcam/?action=stream", "snapshot": "http://127.0.0.1:" + strings.Split(f.srv.URL, ":")[2] + "/webcam/?action=snapshot"}},
		}}})
	case p == "/webcam/":
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = io.WriteString(w, "jpeg-"+r.URL.Query().Get("action"))
	case p == "/api/printer":
		if f.state == "Offline" {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "Printer is not operational"})
			return
		}
		flags := map[string]bool{"operational": true, "printing": f.state == "Printing", "paused": f.state == "Paused", "ready": f.state == "Operational"}
		writeJSON(w, 200, map[string]any{"state": map[string]any{"text": f.state, "flags": flags}, "temperature": map[string]any{
			"tool0": map[string]any{"actual": 210.5, "target": 210}, "tool1": map[string]any{"actual": 30, "target": 0}, "bed": map[string]any{"actual": 60.1, "target": 60},
		}})
	case p == "/api/connection" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]any{"current": map[string]any{"state": "Closed"}})
	case p == "/api/connection":
		f.state = "Operational"
		w.WriteHeader(204)
	case p == "/api/job" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]any{"job": map[string]any{"file": map[string]any{"path": f.job}}, "progress": map[string]any{"completion": f.done, "printTime": 60, "printTimeLeft": 240}})
	case p == "/api/job":
		switch {
		case f.state == "Operational":
			writeJSON(w, http.StatusConflict, map[string]any{"error": "Printer is not printing"})
			return
		case body["command"] == "cancel":
			f.state = "Operational"
		case body["action"] == "pause":
			f.state = "Paused"
		case body["action"] == "resume":
			f.state = "Printing"
		}
		w.WriteHeader(204)
	case p == "/api/printer/command":
		for _, c := range body["commands"].([]any) {
			f.commands = append(f.commands, c.(string))
		}
		w.WriteHeader(204)
	case p == "/api/files/local" && r.Method == http.MethodGet:
		var list []any
		for name, data := range f.files {
			list = append(list, map[string]any{"name": name, "path": name, "type": "machinecode", "size": len(data), "date": 1760000000})
		}
		writeJSON(w, 200, map[string]any{"files": []any{map[string]any{"name": "sub", "path": "sub", "type": "folder", "children": list}}})
	case p == "/api/files/local" && r.Method == http.MethodPost:
		if r.ContentLength <= 0 {
			w.WriteHeader(http.StatusLengthRequired)
			return
		}
		file, head, err := r.FormFile("file")
		if err != nil {
			w.WriteHeader(400)
			return
		}
		data, _ := io.ReadAll(file)
		name := head.Filename
		if dir := r.FormValue("path"); dir != "" {
			name = dir + "/" + name
		}
		if r.FormValue("print") != "false" {
			w.WriteHeader(400)
			return
		}
		f.files[name] = data
		writeJSON(w, 201, map[string]any{"done": true})
	case strings.HasPrefix(p, "/api/files/local/"):
		name := strings.TrimPrefix(p, "/api/files/local/")
		if _, ok := f.files[name]; !ok {
			writeJSON(w, 404, map[string]any{"error": "File not found"})
			return
		}
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, 200, map[string]any{"name": name, "path": name, "type": "machinecode", "size": len(f.files[name]), "date": 1760000000, "thumbnail": "plugin/thumbs/" + name + ".png",
				"gcodeAnalysis": map[string]any{"estimatedPrintTime": 3720.5, "filament": map[string]any{"tool0": map[string]any{"length": 1200.0}, "tool1": map[string]any{"length": 34.5}}}})
		case http.MethodDelete:
			delete(f.files, name)
			w.WriteHeader(204)
		case http.MethodPost:
			// Like OctoPrint's own page (its file "Print" button): select with print on.
			// Another command is refused; select without print only selects.
			if body["command"] != "select" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Unknown command"})
				return
			}
			if f.state != "Operational" {
				writeJSON(w, http.StatusConflict, map[string]any{"error": "Printer is busy"})
				return
			}
			f.job = name
			if body["print"] == true {
				f.state, f.done = "Printing", 25
			}
			w.WriteHeader(204)
		}
	case strings.HasPrefix(p, "/plugin/thumbs/"):
		w.Header().Set("Content-Type", "image/png")
		_, _ = io.WriteString(w, "png")
	default:
		http.NotFound(w, r)
	}
}

func TestFindOctoPrint(t *testing.T) {
	f := newFakeOcto(t, "KEY")
	ctx := context.Background()
	addr := strings.TrimPrefix(f.srv.URL, "http://")
	_, _, kind, err := findPrinter(ctx, addr, "", "")
	var pe *probeError
	if !errors.As(err, &pe) || !pe.needsKey || kind != kindOctoPrint {
		t.Fatalf("no key: want OctoPrint asking for one, got %q %v", kind, err)
	}
	if _, _, _, err := findPrinter(ctx, addr, "wrong", ""); !errors.As(err, &pe) || !pe.needsKey {
		t.Fatalf("wrong key: want it refused, got %v", err)
	}
	url, name, kind, err := findPrinter(ctx, addr, "KEY", "")
	if err != nil || kind != kindOctoPrint || name != "Ender 3" || url != f.srv.URL {
		t.Fatalf("got %q %q %q %v", url, name, kind, err)
	}
	if f, ok := probeOctoHost(ctx, http.DefaultClient, addr); !ok || !f.NeedsKey || f.Kind != kindOctoPrint {
		t.Fatal("the search should know OctoPrint by its login page")
	}
}

func TestMarlinLines(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"SET_HEATER_TEMPERATURE HEATER=extruder TARGET=215", "M104 T0 S215"},
		{"SET_HEATER_TEMPERATURE HEATER=extruder2 TARGET=199.6", "M104 T2 S200"},
		{"SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60", "M140 S60"},
		{"SET_HEATER_TEMPERATURE HEATER=chamber TARGET=40", "M141 S40"},
		{"SAVE_GCODE_STATE NAME=_device_jog\nG91\nG1 X10 F6000\nRESTORE_GCODE_STATE NAME=_device_jog", "G91|G1 X10 F6000|G90"},
		{"SAVE_GCODE_STATE NAME=_device_extrude\nM83\nG1 E5 F300\nRESTORE_GCODE_STATE NAME=_device_extrude", "M83|G1 E5 F300|M82"},
		{"G28 X Y", "G28 X Y"},
		{"M106 S128", "M106 S128"},
	} {
		got, err := marlinLines(c.in, "OctoPrint printers")
		if err != nil || strings.Join(got, "|") != c.want {
			t.Errorf("%q: got %q %v, want %q", c.in, got, err, c.want)
		}
	}
	for _, in := range []string{"SET_FAN_SPEED FAN=aux SPEED=0.5", "SET_LED LED=x WHITE=1", "SET_HEATER_TEMPERATURE HEATER=dryer TARGET=50"} {
		if _, err := marlinLines(in, "OctoPrint printers"); err == nil {
			t.Errorf("%q should be refused", in)
		}
	}
}

func TestPrinterReply(t *testing.T) {
	for in, want := range map[string]string{
		"Recv: echo:Unknown command: \"G999\"":  "echo:Unknown command: \"G999\"",
		"Recv: ok X:10.00 Y:0.00 Z:0.00 E:0.00": "X:10.00 Y:0.00 Z:0.00 E:0.00",
		"Recv: ok":                              "",
		"Recv:  T:21.3 /0.0 B:21.3 /0.0 @:64":   "",
		"Recv: ok T:21.3 /0.0 B:21.3 /0.0":      "",
		"Recv: echo:busy: processing":           "",
		"Recv: Not SD printing":                 "",
		"Send: G28":                             "",
	} {
		got, ok := printerReply(in)
		if got != want || ok != (want != "") {
			t.Errorf("%q: got %q %v", in, got, ok)
		}
	}
}

func TestReportedPosition(t *testing.T) {
	if p, ok := reportedPosition("X:10.0 Y:-2.5 Z:0.30 E:0 Count: A:1000 B:0 C:0"); !ok || p != [3]float64{10, -2.5, 0.3} {
		t.Fatalf("got %v %v", p, ok)
	}
	if _, ok := reportedPosition("echo:Unknown command"); ok {
		t.Fatal("not a position")
	}
}

func TestOctoPrintStandIn(t *testing.T) {
	old := pollEvery
	pollEvery = 50 * time.Millisecond
	t.Cleanup(func() { pollEvery = old })
	f := newFakeOcto(t, "KEY")
	p := Printer{ID: "ender", Name: "Ender", URL: f.srv.URL, APIKey: "KEY", Kind: kindOctoPrint}
	ep := endpointFor(p)
	t.Cleanup(func() { forgetStandIn(p.ID) })
	if _, info, err := probeAddress(context.Background(), ep.URL, ""); err != nil || info["brand"] != kindOctoPrint || info["hostname"] != "Ender 3" {
		t.Fatalf("printer.info: %v %v", info, err)
	}
	c := dialStandIn(t, ep.URL)
	sub := c.must("printer.objects.subscribe", map[string]any{"objects": map[string]any{"webhooks": nil, "extruder": nil, "extruder1": nil, "heater_bed": nil, "heaters": nil, "print_stats": nil, "toolhead": nil, "gcode_move": nil}}).(map[string]any)["status"].(map[string]any)
	if sub["extruder"].(map[string]any)["temperature"] != 210.5 || sub["extruder1"] == nil || sub["heater_bed"].(map[string]any)["target"] != 60.0 || sub["print_stats"].(map[string]any)["state"] != "standby" {
		t.Fatalf("subscribe %v", sub)
	}
	if fmt.Sprint(sub["heaters"].(map[string]any)["available_heaters"]) != "[heater_bed extruder extruder1]" {
		t.Fatalf("heaters %v", sub["heaters"])
	}

	// G-code goes to OctoPrint in Marlin's words, and homing lets the Move card move.
	c.must("printer.gcode.script", map[string]any{"script": "SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=70"})
	c.must("printer.gcode.script", map[string]any{"script": "G28"})
	c.until("homed axes", func(d map[string]any) bool {
		th, _ := d["toolhead"].(map[string]any)
		return th["homed_axes"] == "xyz"
	})
	if _, err := c.call("printer.gcode.script", map[string]any{"script": "SET_LED LED=caselight WHITE=1"}); err == nil || !strings.Contains(err.Error(), "Klipper command") {
		t.Fatalf("a Klipper-only command: %v", err)
	}
	c.must("printer.gcode.script", map[string]any{"script": "M220 S120"})
	c.until("speed factor", func(d map[string]any) bool {
		gm, _ := d["gcode_move"].(map[string]any)
		return gm["speed_factor"] == 1.2
	})
	c.must("printer.emergency_stop", nil)
	f.mu.Lock()
	sent := strings.Join(f.commands, "|")
	f.mu.Unlock()
	if sent != "M140 S70|G28|M114|M220 S120|M112" {
		t.Fatalf("OctoPrint got %q", sent)
	}

	// Its cameras, through the stand-in (the bridge only fetches from the printer's host).
	cams := c.must("server.webcams.list", nil).(map[string]any)["webcams"].([]any)
	if len(cams) != 1 {
		t.Fatalf("webcams %v", cams)
	}
	cam := cams[0].(map[string]any)
	if cam["name"] != "Classic Webcam" || cam["flip_horizontal"] != true || !strings.HasPrefix(cam["snapshot_url"].(string), ep.URL+"/camera/0/") {
		t.Fatalf("camera %v", cam)
	}
	s := newSession("c1", ep, func(string) {}, func(string) {})
	t.Cleanup(s.close)
	if buf, _, err := s.frame(cam["snapshot_url"].(string)); err != nil || string(buf) != "jpeg-snapshot" {
		t.Fatalf("camera picture %q %v", buf, err)
	}

	// Upload through the bridge's own upload, into a folder.
	data := []byte("G28\nG1 X10\n")
	begin, err := s.uploadBegin("parts/cube.gcode", int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	id := begin.(map[string]any)["uploadId"].(string)
	if _, err := s.uploadChunk(id, 0, base64.StdEncoding.EncodeToString(data)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadEnd(id); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	got := string(f.files["parts/cube.gcode"])
	f.mu.Unlock()
	if got != string(data) {
		t.Fatalf("OctoPrint got %q", got)
	}
	files := fmt.Sprint(c.must("server.files.list", nil))
	if !strings.Contains(files, "parts/cube.gcode") || !strings.Contains(files, "benchy.gcode") {
		t.Fatalf("files %v", files)
	}
	meta := c.must("server.files.metadata", map[string]any{"filename": "parts/cube.gcode"}).(map[string]any)
	if meta["estimated_time"] != 3720.5 || meta["filament_total"] != 1234.5 {
		t.Fatalf("metadata %v", meta)
	}
	thumb := meta["thumbnails"].([]any)[0].(map[string]any)["relative_path"].(string)
	if buf, _, err := s.frame(ep.URL + "/server/files/gcodes/parts/" + thumb); err != nil || string(buf) != "png" {
		t.Fatalf("thumbnail %q %v", buf, err)
	}

	// Print, pause, cancel.
	c.must("printer.print.start", map[string]any{"filename": "parts/cube.gcode"})
	c.until("printing", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "printing"
	})
	if _, err := c.call("printer.print.start", map[string]any{"filename": "benchy.gcode"}); err == nil || !strings.Contains(err.Error(), "busy") {
		t.Fatalf("start while printing: %v", err)
	}
	c.must("printer.print.pause", nil)
	c.until("paused", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "paused"
	})
	c.must("printer.print.cancel", nil)
	c.until("cancelled", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "cancelled"
	})

	// OctoPrint without its printer: like Klipper stopped, and "restart" connects it again.
	f.mu.Lock()
	f.state = "Offline"
	f.mu.Unlock()
	c.until("not connected", func(d map[string]any) bool {
		wh, _ := d["webhooks"].(map[string]any)
		return wh["state"] == "shutdown" && strings.Contains(fmt.Sprint(wh["state_message"]), "isn't connected")
	})
	c.must("printer.firmware_restart", nil)
	c.until("connected again", func(d map[string]any) bool {
		wh, _ := d["webhooks"].(map[string]any)
		return wh["state"] == "ready"
	})
}
