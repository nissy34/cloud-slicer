package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// fakeElegoo is a Centauri Carbon as far as the bridge uses it: SDCP over a
// websocket, the UDP "who is there", uploads in parts and an MJPEG camera.
type fakeElegoo struct {
	web, ws, cam *httptest.Server
	udp          *net.UDPConn
	mu           sync.Mutex
	files        map[string][]byte
	parts        map[string][]byte
	commands     []int
	status       int // PrintInfo.Status
	file         string
}

const fakeMainboard = "MB0123456789"

func newFakeElegoo(t *testing.T) *fakeElegoo {
	f := &fakeElegoo{files: map[string][]byte{"/local/benchy.gcode": []byte("G28\n")}, parts: map[string][]byte{}}
	f.web = httptest.NewServer(http.HandlerFunc(f.upload))
	f.ws = httptest.NewServer(http.HandlerFunc(f.socket))
	f.cam = httptest.NewServer(http.HandlerFunc(f.camera))
	udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	f.udp = udp
	go f.answer()
	t.Cleanup(func() { f.web.Close(); f.ws.Close(); f.cam.Close(); udp.Close() })
	oldWS, oldFind, oldCam, oldPart := elegooWSPort, elegooFindPort, elegooCameraPort, elegooUploadPart
	elegooWSPort, elegooCameraPort = portOf(f.ws.URL), portOf(f.cam.URL)
	elegooFindPort = udp.LocalAddr().(*net.UDPAddr).Port
	elegooUploadPart = 4
	t.Cleanup(func() {
		elegooWSPort, elegooFindPort, elegooCameraPort, elegooUploadPart = oldWS, oldFind, oldCam, oldPart
	})
	return f
}

func portOf(raw string) string {
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(raw, "http://"))
	return port
}

func (f *fakeElegoo) answer() {
	buf := make([]byte, 64)
	for {
		n, from, err := f.udp.ReadFromUDP(buf)
		if err != nil {
			return
		}
		if string(buf[:n]) == "M99999" {
			reply, _ := json.Marshal(map[string]any{"Id": "x", "Data": map[string]any{"Name": "Carbon", "MachineName": "Centauri Carbon", "MainboardID": fakeMainboard, "MainboardIP": "127.0.0.1", "FirmwareVersion": "V1.1.25", "ProtocolVersion": "V3.0.0"}})
			_, _ = f.udp.WriteToUDP(reply, from)
		}
	}
}

func (f *fakeElegoo) statusMsg() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	progress := 0
	if f.status != 0 {
		progress = 42
	}
	msg, _ := json.Marshal(map[string]any{
		"Status": map[string]any{
			"CurrentStatus": []int{0}, "TempOfNozzle": 215.5, "TempTargetNozzle": 220, "TempOfHotbed": 59.5, "TempTargetHotbed": 60, "TempOfBox": 31,
			"CurrenCoord":     "10.00,20.00,0.40",
			"CurrentFanSpeed": map[string]any{"ModelFan": 100, "AuxiliaryFan": 50, "BoxFan": 0},
			"PrintInfo":       map[string]any{"Status": f.status, "CurrentLayer": 12, "TotalLayer": 100, "CurrentTicks": 600, "TotalTicks": 3600, "Filename": f.file, "Progress": progress, "PrintSpeedPct": 100},
		},
		"MainboardID": fakeMainboard, "TimeStamp": time.Now().Unix(), "Topic": "sdcp/status/" + fakeMainboard,
	})
	return msg
}

func (f *fakeElegoo) socket(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer ws.CloseNow()
	ctx := r.Context()
	at, _ := json.Marshal(map[string]any{"Attributes": map[string]any{"Name": "Carbon", "MachineName": "Centauri Carbon", "MainboardID": fakeMainboard, "FirmwareVersion": "V1.1.25"}, "Topic": "sdcp/attributes/" + fakeMainboard})
	_ = ws.Write(ctx, websocket.MessageText, at)
	var wmu sync.Mutex
	write := func(b []byte) { wmu.Lock(); _ = ws.Write(ctx, websocket.MessageText, b); wmu.Unlock() }
	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		var req struct {
			Data struct {
				Cmd         int            `json:"Cmd"`
				Data        map[string]any `json:"Data"`
				RequestID   string         `json:"RequestID"`
				MainboardID string         `json:"MainboardID"`
			} `json:"Data"`
		}
		if json.Unmarshal(data, &req) != nil || req.Data.MainboardID != fakeMainboard {
			continue
		}
		out := map[string]any{"Ack": 0}
		f.mu.Lock()
		f.commands = append(f.commands, req.Data.Cmd)
		switch req.Data.Cmd {
		case 128:
			name, _ := req.Data.Data["Filename"].(string)
			switch {
			case f.status != 0:
				out["Ack"] = 1
			case f.files[name] == nil:
				out["Ack"] = 2
			default:
				f.status, f.file = 13, name
			}
		case 129:
			f.status = 6
		case 131:
			f.status = 13
		case 130:
			f.status = 8
		case 258:
			list := []map[string]any{}
			for name, b := range f.files {
				list = append(list, map[string]any{"name": name, "FileSize": len(b), "CreateTime": 1700000000, "TotalLayers": 100, "type": 1})
			}
			out["FileList"] = list
		case 259:
			for _, n := range req.Data.Data["FileList"].([]any) {
				delete(f.files, n.(string))
			}
		}
		f.mu.Unlock()
		reply, _ := json.Marshal(map[string]any{"Id": "x", "Data": map[string]any{"Cmd": req.Data.Cmd, "Data": out, "RequestID": req.Data.RequestID, "MainboardID": fakeMainboard}, "Topic": "sdcp/response/" + fakeMainboard})
		write(reply)
		if req.Data.Cmd == 0 || req.Data.Cmd == 512 || req.Data.Cmd >= 128 && req.Data.Cmd <= 131 {
			write(f.statusMsg())
		}
	}
}

// upload takes the parts, each naming the whole file's MD5, like the printer.
func (f *fakeElegoo) upload(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/uploadFile/upload" || r.ParseMultipartForm(1<<20) != nil {
		http.NotFound(w, r)
		return
	}
	file, head, err := r.FormFile("File")
	if err != nil {
		http.Error(w, "no file", 400)
		return
	}
	body, _ := io.ReadAll(file)
	offset, _ := strconv.Atoi(r.FormValue("Offset"))
	total, _ := strconv.Atoi(r.FormValue("TotalSize"))
	id := r.FormValue("Uuid")
	f.mu.Lock()
	defer f.mu.Unlock()
	got := f.parts[id]
	if offset != len(got) || r.FormValue("Check") != "1" {
		fmt.Fprint(w, `{"code":"111111","messages":[{"field":"Offset","message":"wrong offset"}]}`)
		return
	}
	got = append(got, body...)
	f.parts[id] = got
	if len(got) == total {
		sum := md5.Sum(got)
		if hex.EncodeToString(sum[:]) != r.FormValue("S-File-MD5") {
			fmt.Fprint(w, `{"code":"111111","messages":[{"field":"S-File-MD5","message":"md5 mismatch"}]}`)
			return
		}
		f.files["/local/"+head.Filename] = got
	}
	fmt.Fprint(w, `{"code":"000000","messages":null,"data":null,"success":true}`)
}

func (f *fakeElegoo) camera(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary=frame")
	for i := 0; i < 50; i++ {
		frame := []byte{0xFF, 0xD8, 'p', 'i', 'c', 0xFF, 0xD9}
		if _, err := fmt.Fprintf(w, "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n%s\r\n", len(frame), frame); err != nil {
			return
		}
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
			return
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func TestJpegFrames(t *testing.T) {
	stream := "--b\r\n\r\n\xFF\xD8one\xFF\xD9\r\n--b\r\n\r\n\xFF\xD8two\xFF\xD9"
	var got []string
	_ = jpegFrames(strings.NewReader(stream), func(b []byte) { got = append(got, string(b[2:len(b)-2])) })
	if strings.Join(got, ",") != "one,two" {
		t.Fatalf("frames %v", got)
	}
}

func TestFindElegoo(t *testing.T) {
	f := newFakeElegoo(t)
	url, name, kind, err := findPrinter(context.Background(), "127.0.0.1:"+portOf(f.web.URL), "", "")
	if err != nil || kind != kindElegoo || name != "Carbon" || url != f.web.URL {
		t.Fatalf("found %q %q %q %v", url, name, kind, err)
	}
	if _, _, err := probeElegoo(context.Background(), "127.0.0.2"); err == nil {
		t.Fatal("found an Elegoo where none is")
	}
}

func TestWithElegoos(t *testing.T) {
	list := withElegoos([]found{{URL: "http://10.0.0.5", Kind: kindPrusaLink}, {URL: "http://10.0.0.6:7125"}}, []found{{URL: "http://10.0.0.5", Name: "Carbon", Kind: kindElegoo}})
	if len(list) != 2 || list[0].URL != "http://10.0.0.6:7125" || list[1].Kind != kindElegoo {
		t.Fatalf("list %v", list)
	}
}

func TestElegooStandIn(t *testing.T) {
	old := pollEvery
	pollEvery = 50 * time.Millisecond
	t.Cleanup(func() { pollEvery = old })
	f := newFakeElegoo(t)
	p := Printer{ID: "carbon", Name: "Carbon", URL: f.web.URL, Kind: kindElegoo}
	ep := endpointFor(p)
	t.Cleanup(func() { forgetStandIn(p.ID) })
	if _, info, err := probeAddress(context.Background(), ep.URL, ""); err != nil || info["brand"] != kindElegoo || info["hostname"] != "Carbon" {
		t.Fatalf("printer.info: %v %v", info, err)
	}
	c := dialStandIn(t, ep.URL)
	sub := c.must("printer.objects.subscribe", map[string]any{"objects": map[string]any{"webhooks": nil, "extruder": nil, "heater_bed": nil, "temperature_sensor chamber": nil, "print_stats": nil, "toolhead": nil, "fan": nil}}).(map[string]any)["status"].(map[string]any)
	if sub["extruder"].(map[string]any)["temperature"] != 215.5 || sub["heater_bed"].(map[string]any)["target"] != 60.0 || sub["temperature_sensor chamber"].(map[string]any)["temperature"] != 31.0 || sub["fan"].(map[string]any)["speed"] != 1.0 || sub["print_stats"].(map[string]any)["state"] != "standby" {
		t.Fatalf("subscribe %v", sub)
	}
	if fmt.Sprint(sub["toolhead"].(map[string]any)["position"]) != "[10 20 0.4 0]" {
		t.Fatalf("position %v", sub["toolhead"])
	}

	// It takes no G-code: a command says so rather than doing something else.
	if _, err := c.call("printer.gcode.script", map[string]any{"script": "G28"}); err == nil {
		t.Fatal("G-code went to an Elegoo")
	}

	// Its camera, as pictures from one shared stream.
	cams := c.must("server.webcams.list", nil).(map[string]any)["webcams"].([]any)
	if len(cams) != 1 {
		t.Fatalf("webcams %v", cams)
	}
	s := newSession("c1", ep, func(string) {}, func(string) {})
	t.Cleanup(s.close)
	shot := cams[0].(map[string]any)["snapshot_url"].(string)
	if buf, _, err := s.frame(shot); err != nil || !bytes.Equal(buf, []byte{0xFF, 0xD8, 'p', 'i', 'c', 0xFF, 0xD9}) {
		t.Fatalf("camera picture %q %v", buf, err)
	}

	// Upload in parts (4 bytes in this test), whole-file MD5 on each.
	data := []byte("G28\nG1 X10\nM84\n")
	begin, err := s.uploadBegin("cube.gcode", int64(len(data)))
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
	got := string(f.files["/local/cube.gcode"])
	f.mu.Unlock()
	if got != string(data) {
		t.Fatalf("printer got %q", got)
	}
	files := fmt.Sprint(c.must("server.files.list", nil))
	if !strings.Contains(files, "cube.gcode") || !strings.Contains(files, "benchy.gcode") {
		t.Fatalf("files %v", files)
	}
	meta := c.must("server.files.metadata", map[string]any{"filename": "cube.gcode"}).(map[string]any)
	if meta["layer_count"] != 100.0 {
		t.Fatalf("metadata %v", meta)
	}

	// Print, pause, resume, cancel.
	c.must("printer.print.start", map[string]any{"filename": "cube.gcode"})
	c.until("printing", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "printing" && ps["filename"] == "cube.gcode"
	})
	if _, err := c.call("printer.print.start", map[string]any{"filename": "benchy.gcode"}); err == nil || !strings.Contains(err.Error(), "busy") {
		t.Fatalf("start while printing: %v", err)
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
	c.must("server.files.delete_file", map[string]any{"path": "gcodes/cube.gcode"})
	f.mu.Lock()
	_, kept := f.files["/local/cube.gcode"]
	f.mu.Unlock()
	if kept {
		t.Fatal("the file is still on the printer")
	}
}
