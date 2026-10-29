package main

// The Elegoo Centauri Carbon, through Elegoo's own local protocol (SDCP v3):
// JSON over a websocket on port 3030 (/websocket), without a login. Each
// request names the printer's mainboard ID, which it says when found (UDP
// "M99999" on port 3000) and in the attributes it sends on connecting.
// Status comes as pushes on "sdcp/status/<id>" (after a subscribe) or after
// Cmd 0; files are listed (258), deleted (259), printed (128), paused (129),
// stopped (130) and resumed (131). Uploads are plain HTTP on port 80
// (/uploadFile/upload), in 1 MB parts that each carry the whole file's MD5,
// so a file is kept on disk while it is sent. Its camera is an MJPEG stream on
// port 3031 (/video) with few connections: one is shared for pictures.
// Sources: Elegoo's elegoo-link SDK as used by OrcaSlicer (ElegooLink.cpp),
// and pycentauri's protocol notes. The Centauri Carbon 2 speaks MQTT instead
// and isn't covered. It takes no G-code: temperatures are read only.

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const kindElegoo = "elegoo"

// The printer's ports: websocket, finding, camera. Its web port (uploads) is
// the address's own, 80 unless it says. Tests move them with
// CLOUD_SLICER_ELEGOO_PORTS="ws,find,camera".
var (
	elegooWSPort     = "3030"
	elegooFindPort   = 3000
	elegooCameraPort = "3031"
)

// Parts of an upload: the most the printer takes at once.
var elegooUploadPart = 1 << 20

func init() {
	if p := strings.Split(os.Getenv("CLOUD_SLICER_ELEGOO_PORTS"), ","); len(p) == 3 {
		if n, err := strconv.Atoi(p[1]); err == nil {
			elegooWSPort, elegooFindPort, elegooCameraPort = p[0], n, p[2]
		}
	}
}

type elegoo struct {
	host   string // the name or IP alone
	web    string // the web address, for uploads
	client *http.Client

	mu        sync.Mutex
	ws        *websocket.Conn
	mainboard string
	name      string
	firmware  string
	waiting   map[string]chan map[string]any
	last      map[string]any
	lastAt    time.Time
	fresh     chan struct{}
	// The camera's shared stream and its latest picture.
	frame   []byte
	frameAt time.Time
	wanted  time.Time
	reading bool
}

func newElegoo(base string) *elegoo {
	host, web := base, "http://"+base
	if u, err := url.Parse(base); err == nil && u.Hostname() != "" {
		host, web = u.Hostname(), "http://"+u.Host
	}
	return &elegoo{host: host, web: web, client: &http.Client{}, waiting: map[string]chan map[string]any{}, fresh: make(chan struct{})}
}

func (e *elegoo) noun() string { return "Elegoo printers" }

// elegooFind asks one address, or the whole network (255.255.255.255), who is
// there: each Elegoo printer answers with its name and mainboard ID.
func elegooFind(ctx context.Context, address string, wait time.Duration) []elegooFound {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{})
	if err != nil {
		return nil
	}
	defer conn.Close()
	to := &net.UDPAddr{IP: net.ParseIP(address), Port: elegooFindPort}
	if to.IP == nil {
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip4", address)
		if err != nil || len(ips) == 0 {
			return nil
		}
		to.IP = ips[0]
	}
	end := time.Now().Add(wait)
	if d, ok := ctx.Deadline(); ok && d.Before(end) {
		end = d
	}
	var out []elegooFound
	seen := map[string]bool{}
	buf := make([]byte, 4096)
	for try := 0; time.Now().Before(end); try++ {
		if try < 3 {
			_, _ = conn.WriteToUDP([]byte("M99999"), to)
		}
		_ = conn.SetReadDeadline(time.Now().Add(wait / 4))
		n, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			continue
		}
		var reply struct {
			Data struct {
				Name            string `json:"Name"`
				MachineName     string `json:"MachineName"`
				MainboardID     string `json:"MainboardID"`
				MainboardIP     string `json:"MainboardIP"`
				FirmwareVersion string `json:"FirmwareVersion"`
				ProtocolVersion string `json:"ProtocolVersion"`
			} `json:"Data"`
		}
		if json.Unmarshal(buf[:n], &reply) != nil || reply.Data.MainboardID == "" || seen[from.IP.String()] {
			continue
		}
		seen[from.IP.String()] = true
		name := reply.Data.Name
		if name == "" {
			name = reply.Data.MachineName
		}
		out = append(out, elegooFound{ip: from.IP.String(), name: name, mainboard: reply.Data.MainboardID, firmware: reply.Data.FirmwareVersion})
		if address != "255.255.255.255" {
			break
		}
	}
	return out
}

type elegooFound struct{ ip, name, mainboard, firmware string }

// discoverElegoo is the search's part for Elegoo printers: one question to the whole network.
func discoverElegoo(ctx context.Context) []found {
	var out []found
	for _, f := range elegooFind(ctx, "255.255.255.255", 2*time.Second) {
		name := f.name
		if name == "" {
			name = f.ip
		}
		out = append(out, found{URL: "http://" + f.ip, Name: name, Kind: kindElegoo})
	}
	return out
}

// probeElegoo finds an Elegoo printer at an address the user typed.
func probeElegoo(ctx context.Context, address string) (string, string, error) {
	a := strings.TrimRight(strings.TrimSpace(address), "/")
	if !strings.Contains(a, "://") {
		a = "http://" + a
	}
	u, err := url.Parse(a)
	if err != nil || u.Hostname() == "" {
		return "", "", errors.New("not an Elegoo printer")
	}
	list := elegooFind(ctx, u.Hostname(), 2*time.Second)
	if len(list) == 0 {
		return "", "", errors.New("not an Elegoo printer")
	}
	return "http://" + u.Host, list[0].name, nil
}

// connect opens the printer's websocket, once, and learns its mainboard ID.
func (e *elegoo) connect(ctx context.Context) (*websocket.Conn, string, error) {
	e.mu.Lock()
	if e.ws != nil && e.mainboard != "" {
		ws, id := e.ws, e.mainboard
		e.mu.Unlock()
		return ws, id, nil
	}
	e.mu.Unlock()
	dctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(dctx, "ws://"+net.JoinHostPort(e.host, elegooWSPort)+"/websocket", nil)
	if err != nil {
		return nil, "", fmt.Errorf("Could not reach the printer: %v", err)
	}
	ws.SetReadLimit(4 << 20)
	e.mu.Lock()
	if e.ws != nil {
		// Another call connected meanwhile.
		e.mu.Unlock()
		ws.CloseNow()
		return e.connect(ctx)
	}
	e.ws = ws
	e.mu.Unlock()
	go e.read(ws)
	// The mainboard ID: from the attributes it sends on connecting, else by asking.
	id := ""
	for wait := time.Now().Add(1500 * time.Millisecond); time.Now().Before(wait); time.Sleep(50 * time.Millisecond) {
		e.mu.Lock()
		id = e.mainboard
		e.mu.Unlock()
		if id != "" {
			break
		}
	}
	if id == "" {
		if list := elegooFind(ctx, e.host, 2*time.Second); len(list) > 0 {
			id = list[0].mainboard
			e.mu.Lock()
			if e.mainboard == "" {
				e.mainboard, e.name, e.firmware = id, list[0].name, list[0].firmware
			}
			e.mu.Unlock()
		}
	}
	if id == "" {
		e.drop(ws)
		return nil, "", errors.New("The printer didn't say who it is: is it an Elegoo Centauri Carbon?")
	}
	// Status every 2 seconds while connected.
	_ = e.send(ctx, ws, id, 512, map[string]any{"TimePeriod": 2000}, "")
	return ws, id, nil
}

func (e *elegoo) drop(ws *websocket.Conn) {
	e.mu.Lock()
	if e.ws == ws {
		e.ws = nil
		for id, ch := range e.waiting {
			close(ch)
			delete(e.waiting, id)
		}
	}
	e.mu.Unlock()
	ws.CloseNow()
}

// read takes the printer's messages: answers to requests, status and attributes.
func (e *elegoo) read(ws *websocket.Conn) {
	defer e.drop(ws)
	for {
		_, data, err := ws.Read(context.Background())
		if err != nil {
			return
		}
		var msg map[string]any
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		topic, _ := msg["Topic"].(string)
		inner, _ := msg["Data"].(map[string]any)
		e.mu.Lock()
		if id, _ := msg["MainboardID"].(string); id != "" && e.mainboard == "" {
			e.mainboard = id
		}
		switch {
		case strings.Contains(topic, "sdcp/status") || msg["Status"] != nil:
			if st, ok := msg["Status"].(map[string]any); ok {
				e.last, e.lastAt = st, time.Now()
				close(e.fresh)
				e.fresh = make(chan struct{})
			}
		case strings.Contains(topic, "sdcp/attributes") || msg["Attributes"] != nil:
			if at, ok := msg["Attributes"].(map[string]any); ok {
				if id, _ := at["MainboardID"].(string); id != "" {
					e.mainboard = id
				}
				if s, _ := at["Name"].(string); s != "" {
					e.name = s
				} else if s, _ := at["MachineName"].(string); s != "" {
					e.name = s
				}
				if s, _ := at["FirmwareVersion"].(string); s != "" {
					e.firmware = s
				}
			}
		}
		if inner != nil {
			if id, _ := inner["RequestID"].(string); id != "" {
				if ch := e.waiting[id]; ch != nil {
					delete(e.waiting, id)
					ch <- inner
					close(ch)
				}
			}
		}
		e.mu.Unlock()
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// send writes one request; with a request ID, its answer goes to that waiter.
func (e *elegoo) send(ctx context.Context, ws *websocket.Conn, id string, cmd int, data map[string]any, requestID string) error {
	if requestID == "" {
		requestID = randomHex(16)
	}
	msg, _ := json.Marshal(map[string]any{
		"Id":    id,
		"Topic": "sdcp/request/" + id,
		"Data":  map[string]any{"Cmd": cmd, "Data": data, "RequestID": requestID, "MainboardID": id, "TimeStamp": time.Now().UnixMilli(), "From": 1},
	})
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := ws.Write(wctx, websocket.MessageText, msg); err != nil {
		e.drop(ws)
		return fmt.Errorf("Could not reach the printer: %v", err)
	}
	return nil
}

// request sends a command and gives its answer's Data (with Ack).
func (e *elegoo) request(ctx context.Context, cmd int, data map[string]any) (map[string]any, error) {
	ws, id, err := e.connect(ctx)
	if err != nil {
		return nil, err
	}
	rid := randomHex(16)
	ch := make(chan map[string]any, 1)
	e.mu.Lock()
	e.waiting[rid] = ch
	e.mu.Unlock()
	if err := e.send(ctx, ws, id, cmd, data, rid); err != nil {
		return nil, err
	}
	select {
	case inner, ok := <-ch:
		if !ok {
			return nil, errors.New("The printer closed the connection.")
		}
		out, _ := inner["Data"].(map[string]any)
		if out == nil {
			out = map[string]any{}
		}
		return out, nil
	case <-time.After(10 * time.Second):
		e.mu.Lock()
		delete(e.waiting, rid)
		e.mu.Unlock()
		return nil, errors.New("The printer didn't answer.")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func ack(out map[string]any) int {
	v, _ := out["Ack"].(float64)
	return int(v)
}

func (e *elegoo) about(ctx context.Context) (string, string, error) {
	if _, _, err := e.connect(ctx); err != nil {
		return "", "", err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	name := e.name
	if name == "" {
		name = "Centauri Carbon"
	}
	return name, strings.TrimSpace("Elegoo " + e.firmware), nil
}

// current is the latest status, asking for it when the pushes went quiet.
func (e *elegoo) current(ctx context.Context) (map[string]any, error) {
	if _, _, err := e.connect(ctx); err != nil {
		return nil, err
	}
	e.mu.Lock()
	st, at, fresh := e.last, e.lastAt, e.fresh
	e.mu.Unlock()
	if st != nil && time.Since(at) < 5*time.Second {
		return st, nil
	}
	if _, err := e.request(ctx, 0, map[string]any{}); err != nil {
		return nil, err
	}
	select {
	case <-fresh:
	case <-time.After(5 * time.Second):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	e.mu.Lock()
	st, at = e.last, e.lastAt
	e.mu.Unlock()
	if st == nil || time.Since(at) > 15*time.Second {
		return nil, errors.New("The printer stopped sending its status.")
	}
	return st, nil
}

// The print states (PrintInfo.Status) in Klipper's words.
func elegooState(code int) string {
	switch code {
	case 1, 13, 15, 16, 18, 19, 20, 21, 7:
		return "printing"
	case 5, 6:
		return "paused"
	case 8:
		return "cancelled"
	case 9:
		return "complete"
	case 14:
		return "error"
	}
	return "standby"
}

func number(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f
	}
	return 0
}

// temp reads a temperature and its target; older firmware sends [target, actual].
func temp(st map[string]any, now, target string) (float64, float64) {
	if pair, ok := st[now].([]any); ok && len(pair) == 2 {
		return number(pair[1]), number(pair[0])
	}
	return number(st[now]), number(st[target])
}

func (e *elegoo) status(ctx context.Context) (map[string]any, error) {
	st, err := e.current(ctx)
	if err != nil {
		return nil, err
	}
	info, _ := st["PrintInfo"].(map[string]any)
	if info == nil {
		info = map[string]any{}
	}
	state := elegooState(int(number(info["Status"])))
	file, _ := info["Filename"].(string)
	file = strings.TrimPrefix(file, "/local/")
	progress := number(info["Progress"]) / 100
	printed := number(info["CurrentTicks"])
	if state == "standby" {
		progress = 0
	}
	message := ""
	if state == "error" {
		message = "The printer has a problem: check its screen."
	}
	nozzle, nozzleTarget := temp(st, "TempOfNozzle", "TempTargetNozzle")
	bed, bedTarget := temp(st, "TempOfHotbed", "TempTargetHotbed")
	box, _ := temp(st, "TempOfBox", "TempTargetBox")
	pos := []any{0.0, 0.0, 0.0, 0.0}
	coord, _ := st["CurrenCoord"].(string)
	if coord == "" {
		coord, _ = st["CurrentCoord"].(string)
	}
	if parts := strings.Split(coord, ","); len(parts) == 3 {
		for i, p := range parts {
			pos[i] = number(p)
		}
	}
	fans, _ := st["CurrentFanSpeed"].(map[string]any)
	speed := number(info["PrintSpeedPct"]) / 100
	if speed <= 0 {
		speed = 1
	}
	return map[string]any{
		"webhooks": map[string]any{"state": "ready", "state_message": ""},
		"print_stats": map[string]any{"state": state, "filename": file, "print_duration": printed, "total_duration": printed, "filament_used": 0.0, "message": message,
			"info": map[string]any{"current_layer": number(info["CurrentLayer"]), "total_layer": number(info["TotalLayer"])}},
		"virtual_sdcard":             map[string]any{"progress": progress, "is_active": state == "printing"},
		"display_status":             map[string]any{"progress": progress, "message": ""},
		"heaters":                    map[string]any{"available_heaters": []any{"extruder", "heater_bed"}, "available_sensors": []any{"extruder", "heater_bed", "temperature_sensor chamber"}},
		"extruder":                   map[string]any{"temperature": nozzle, "target": nozzleTarget},
		"heater_bed":                 map[string]any{"temperature": bed, "target": bedTarget},
		"temperature_sensor chamber": map[string]any{"temperature": box},
		"fan":                        map[string]any{"speed": number(fans["ModelFan"]) / 100},
		"fan_generic auxiliary_fan":  map[string]any{"speed": number(fans["AuxiliaryFan"]) / 100},
		"fan_generic chamber_fan":    map[string]any{"speed": number(fans["BoxFan"]) / 100},
		"toolhead":                   map[string]any{"position": pos, "extruder": "extruder", "homed_axes": ""},
		"gcode_move":                 map[string]any{"gcode_position": pos, "speed_factor": speed, "extrude_factor": 1.0},
	}, nil
}

type elegooFile struct {
	Name        string  `json:"name"`
	FileSize    float64 `json:"FileSize"`
	CreateTime  float64 `json:"CreateTime"`
	TotalLayers float64 `json:"TotalLayers"`
}

func (e *elegoo) list(ctx context.Context) ([]elegooFile, error) {
	out, err := e.request(ctx, 258, map[string]any{"Url": "/local"})
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(out["FileList"])
	var files []elegooFile
	_ = json.Unmarshal(raw, &files)
	return files, nil
}

func (e *elegoo) files(ctx context.Context) ([]brandFile, error) {
	list, err := e.list(ctx)
	if err != nil {
		return nil, err
	}
	out := []brandFile{}
	for _, f := range list {
		name := strings.TrimPrefix(f.Name, "/local/")
		if name == "" || strings.Contains(name, "/") || !isGcodeName(name) {
			continue
		}
		out = append(out, brandFile{Path: name, Modified: f.CreateTime, Size: int64(f.FileSize)})
	}
	return out, nil
}

func (e *elegoo) metadata(ctx context.Context, path string) (map[string]any, error) {
	list, err := e.list(ctx)
	if err != nil {
		return nil, err
	}
	for _, f := range list {
		if strings.TrimPrefix(f.Name, "/local/") != path {
			continue
		}
		m := map[string]any{"filename": path, "size": int64(f.FileSize), "modified": f.CreateTime}
		if f.TotalLayers > 0 {
			m["layer_count"] = f.TotalLayers
		}
		// The print going on: the printer's own estimate.
		e.mu.Lock()
		st := e.last
		e.mu.Unlock()
		if info, ok := st["PrintInfo"].(map[string]any); ok && strings.TrimPrefix(fmt.Sprint(info["Filename"]), "/local/") == path && number(info["TotalTicks"]) > 0 {
			m["estimated_time"] = number(info["TotalTicks"])
		}
		return m, nil
	}
	return nil, errors.New("No such file on the printer.")
}

func (e *elegoo) thumbnail(ctx context.Context, path string) ([]byte, string, error) {
	return nil, "", errors.New("no picture")
}

func (e *elegoo) remove(ctx context.Context, path string) error {
	out, err := e.request(ctx, 259, map[string]any{"FileList": []string{"/local/" + path}})
	if err == nil && ack(out) != 0 {
		return errors.New("The printer did not delete the file.")
	}
	return err
}

// upload keeps the file on disk while it comes (every part names the whole
// file's MD5), then sends it in parts.
func (e *elegoo) upload(ctx context.Context, path string, body io.Reader, size int64) error {
	if strings.Contains(path, "/") {
		return errors.New("Elegoo printers keep files in one folder: send it without a folder.")
	}
	tmp, err := os.CreateTemp("", "cloud-slicer-elegoo-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	sum := md5.New()
	n, err := io.Copy(io.MultiWriter(tmp, sum), io.LimitReader(body, size))
	if err != nil {
		return err
	}
	if n != size {
		return errors.New("The upload stopped early.")
	}
	md5sum := hex.EncodeToString(sum.Sum(nil))
	id := randomHex(16)
	buf := make([]byte, elegooUploadPart)
	for offset := int64(0); offset < size; {
		k, err := tmp.ReadAt(buf, offset)
		if k == 0 && err != nil {
			return err
		}
		var form bytes.Buffer
		w := multipart.NewWriter(&form)
		for _, f := range [][2]string{{"Check", "1"}, {"S-File-MD5", md5sum}, {"Offset", strconv.FormatInt(offset, 10)}, {"Uuid", id}, {"TotalSize", strconv.FormatInt(size, 10)}} {
			_ = w.WriteField(f[0], f[1])
		}
		part, _ := w.CreateFormFile("File", path)
		_, _ = part.Write(buf[:k])
		_ = w.Close()
		pctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		req, _ := http.NewRequestWithContext(pctx, http.MethodPost, e.web+"/uploadFile/upload", &form)
		req.Header.Set("Content-Type", w.FormDataContentType())
		res, err := e.client.Do(req)
		if err != nil {
			cancel()
			return fmt.Errorf("Could not reach the printer: %v", err)
		}
		var reply struct {
			Code     string `json:"code"`
			Messages []struct {
				Field   string `json:"field"`
				Message string `json:"message"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&reply)
		res.Body.Close()
		cancel()
		if res.StatusCode != http.StatusOK || reply.Code != "000000" {
			msg := ""
			for _, m := range reply.Messages {
				msg += " " + m.Message
			}
			return fmt.Errorf("The printer refused the file (%s%s).", reply.Code, msg)
		}
		offset += int64(k)
	}
	return nil
}

// Why the printer won't start a print (the start command's Ack).
var elegooStartErrors = map[int]string{
	1: "The printer is busy.",
	2: "The printer can't find that file.",
	3: "The file came out damaged: send it again.",
	4: "The printer couldn't read the file.",
	5: "The printer can't print a file of that resolution.",
	6: "The printer doesn't know that file's format.",
	7: "That file was sliced for another printer.",
}

func (e *elegoo) start(ctx context.Context, path string) error {
	return e.startWith(ctx, path, startOptions{})
}

// startWith starts a print the way Orca's ElegooLink does (print()): bed
// levelling and time-lapse as chosen, and the plate side the file was sliced for.
func (e *elegoo) startWith(ctx context.Context, path string, o startOptions) error {
	flag := func(v int) int {
		if v != 0 {
			return 1
		}
		return 0
	}
	out, err := e.request(ctx, 128, map[string]any{"Filename": "/local/" + path, "StartLayer": 0, "Calibration_switch": flag(o.BedLevel), "PrintPlatformType": flag(o.PlateType), "Tlp_Switch": flag(o.TimeLapse)})
	if err != nil {
		return err
	}
	if a := ack(out); a != 0 {
		if msg := elegooStartErrors[a]; msg != "" {
			return errors.New(msg)
		}
		return fmt.Errorf("The printer did not start the print (%d).", a)
	}
	return nil
}

func (e *elegoo) control(ctx context.Context, cmd int) error {
	out, err := e.request(ctx, cmd, map[string]any{})
	if err == nil && ack(out) != 0 {
		return errors.New("The printer isn't printing.")
	}
	return err
}

func (e *elegoo) pause(ctx context.Context) error  { return e.control(ctx, 129) }
func (e *elegoo) resume(ctx context.Context) error { return e.control(ctx, 131) }
func (e *elegoo) cancel(ctx context.Context) error { return e.control(ctx, 130) }

// cameras: the one camera, as pictures from its shared stream.
func (e *elegoo) cameras(ctx context.Context) ([]brandCamera, error) {
	return []brandCamera{{Name: "Camera", Snapshot: "http://" + net.JoinHostPort(e.host, elegooCameraPort) + "/video?picture"}}, nil
}

// cameraOpen gives the camera's latest picture. One stream from the printer
// feeds every picture (the printer has few camera connections, and loses
// some), and it closes when nobody asked for a while.
func (e *elegoo) cameraOpen(ctx context.Context, raw string) (*http.Response, error) {
	e.mu.Lock()
	e.wanted = time.Now()
	if !e.reading {
		e.reading = true
		go e.watchCamera()
	}
	e.mu.Unlock()
	end := time.Now().Add(8 * time.Second)
	for time.Now().Before(end) {
		e.mu.Lock()
		frame, at := e.frame, e.frameAt
		e.mu.Unlock()
		if frame != nil && time.Since(at) < 5*time.Second {
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"image/jpeg"}}, Body: io.NopCloser(bytes.NewReader(frame)), ContentLength: int64(len(frame))}, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return nil, errors.New("The camera sent no picture.")
}

func (e *elegoo) watchCamera() {
	defer func() {
		e.mu.Lock()
		e.reading = false
		e.mu.Unlock()
	}()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		for {
			time.Sleep(time.Second)
			e.mu.Lock()
			idle := time.Since(e.wanted) > 15*time.Second
			e.mu.Unlock()
			if idle {
				cancel()
				return
			}
		}
	}()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(e.host, elegooCameraPort)+"/video", nil)
	res, err := e.client.Do(req)
	if err != nil {
		return
	}
	defer res.Body.Close()
	frames := jpegFrames(res.Body, func(frame []byte) {
		e.mu.Lock()
		e.frame, e.frameAt = frame, time.Now()
		e.mu.Unlock()
	})
	_ = frames
}

// jpegFrames cuts an MJPEG stream into its pictures (from each FFD8 to its FFD9).
func jpegFrames(r io.Reader, each func([]byte)) error {
	var buf []byte
	chunk := make([]byte, 64<<10)
	for {
		n, err := r.Read(chunk)
		buf = append(buf, chunk[:n]...)
		for {
			start := bytes.Index(buf, []byte{0xFF, 0xD8})
			if start < 0 {
				if len(buf) > 1 {
					buf = buf[len(buf)-1:]
				}
				break
			}
			end := bytes.Index(buf[start+2:], []byte{0xFF, 0xD9})
			if end < 0 {
				buf = buf[start:]
				if len(buf) > maxFrame {
					buf = nil
				}
				break
			}
			frame := append([]byte(nil), buf[start:start+2+end+2]...)
			each(frame)
			buf = buf[start+2+end+2:]
		}
		if err != nil {
			return err
		}
	}
}
