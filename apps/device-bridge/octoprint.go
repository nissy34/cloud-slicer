package main

// Printers run by OctoPrint (https://docs.octoprint.org/en/master/api/), most
// often Marlin printers with a Raspberry Pi beside them. OctoPrint takes an API
// key in X-Api-Key (Settings, Application Keys); status comes from
// /api/printer and /api/job, files live in its "local" storage, G-code goes
// through /api/printer/command, the console's replies come from its push
// socket (/sockjs/websocket), and its cameras are in its settings. The Device
// tab speaks Klipper's commands, so the few it sends are put in Marlin's words
// here (heater targets, the jog's saved state); Klipper-only ones say so.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const kindOctoPrint = "octoprint"

type octoPrint struct {
	base   string
	key    string
	client *http.Client

	mu sync.Mutex
	// What the last file list said about each file, by its path.
	known map[string]octoFile
	// The file last seen printing: when it stops short of the end, it was cancelled
	// (OctoPrint itself only says it is ready again).
	printed string
	// Axes homed since OctoPrint last connected to the printer: OctoPrint doesn't know.
	homed     string
	connected bool
	// Where the head is, as the printer last said (M114): OctoPrint doesn't keep it.
	pos [3]float64
	// Position questions sent from here, whose answers stay out of the console.
	asked int
	// Speed and flow factors (M220, M221) set from here: OctoPrint doesn't report them.
	speed, flow float64
}

type octoFile struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	Type     string  `json:"type"`
	Size     int64   `json:"size"`
	Date     float64 `json:"date"`
	Thumb    string  `json:"thumbnail"`
	Analysis struct {
		EstimatedPrintTime float64 `json:"estimatedPrintTime"`
		Filament           map[string]struct {
			Length float64 `json:"length"`
		} `json:"filament"`
	} `json:"gcodeAnalysis"`
	Children []octoFile `json:"children"`
}

func newOctoPrint(base, key string) *octoPrint {
	return &octoPrint{base: strings.TrimRight(base, "/"), key: key, client: &http.Client{}, known: map[string]octoFile{}, speed: 1, flow: 1}
}

func (o *octoPrint) noun() string { return "OctoPrint printers" }

var errOctoKey = errors.New("OctoPrint did not accept the API key.")

type octoError struct {
	status int
	msg    string
}

func (e *octoError) Error() string { return e.msg }

// do sends one request with the API key; out, when given, takes the JSON answer.
func (o *octoPrint) do(ctx context.Context, method, path string, body io.Reader, size int64, contentType string, out any) (*http.Response, error) {
	if _, has := ctx.Deadline(); !has && body == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(ctx, method, o.base+path, body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.ContentLength = size
		req.Header.Set("Content-Type", contentType)
	}
	if o.key != "" {
		req.Header.Set("X-Api-Key", o.key)
	}
	res, err := o.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Could not reach OctoPrint: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return res, errOctoKey
	}
	if res.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		_ = json.Unmarshal(raw, &e)
		msg := strings.TrimSpace(e.Error)
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", res.StatusCode)
		}
		return res, &octoError{status: res.StatusCode, msg: "OctoPrint said: " + msg}
	}
	if out != nil && res.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil && !errors.Is(err, io.EOF) {
			return res, err
		}
	}
	return res, nil
}

func (o *octoPrint) post(ctx context.Context, path string, body any) (*http.Response, error) {
	buf, _ := json.Marshal(body)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return o.do(ctx, http.MethodPost, path, bytes.NewReader(buf), int64(len(buf)), "application/json", nil)
}

func (o *octoPrint) about(ctx context.Context) (string, string, error) {
	var v struct {
		Server string `json:"server"`
		Text   string `json:"text"`
	}
	if _, err := o.do(ctx, http.MethodGet, "/api/version", nil, 0, "", &v); err != nil {
		return "", "", err
	}
	var s struct {
		Appearance struct {
			Name string `json:"name"`
		} `json:"appearance"`
	}
	_, _ = o.do(ctx, http.MethodGet, "/api/settings", nil, 0, "", &s)
	host := strings.TrimSpace(s.Appearance.Name)
	if host == "" {
		if u, err := url.Parse(o.base); err == nil {
			host = u.Hostname()
		}
	}
	return host, strings.TrimSpace("OctoPrint " + v.Server), nil
}

type octoTemp struct {
	Actual float64 `json:"actual"`
	Target float64 `json:"target"`
}

// heaterName is a heater OctoPrint reports ("tool0", "bed", "chamber") by its Klipper name.
func heaterName(name string) string {
	switch {
	case name == "bed":
		return "heater_bed"
	case name == "chamber":
		return "heater_generic chamber"
	case name == "tool0":
		return "extruder"
	case strings.HasPrefix(name, "tool"):
		return "extruder" + strings.TrimPrefix(name, "tool")
	}
	return ""
}

func (o *octoPrint) status(ctx context.Context) (map[string]any, error) {
	var pr struct {
		State struct {
			Text  string          `json:"text"`
			Error string          `json:"error"`
			Flags map[string]bool `json:"flags"`
		} `json:"state"`
		Temperature map[string]json.RawMessage `json:"temperature"`
	}
	_, err := o.do(ctx, http.MethodGet, "/api/printer", nil, 0, "", &pr)
	var oe *octoError
	if errors.As(err, &oe) && oe.status == http.StatusConflict {
		// OctoPrint answers, but isn't connected to the printer.
		return o.offline(ctx), nil
	}
	if err != nil {
		return nil, err
	}
	var job struct {
		Job struct {
			File struct {
				Path    string `json:"path"`
				Display string `json:"display"`
			} `json:"file"`
		} `json:"job"`
		Progress struct {
			Completion    *float64 `json:"completion"`
			PrintTime     *float64 `json:"printTime"`
			PrintTimeLeft *float64 `json:"printTimeLeft"`
		} `json:"progress"`
	}
	_, _ = o.do(ctx, http.MethodGet, "/api/job", nil, 0, "", &job)
	num := func(v *float64) float64 {
		if v == nil {
			return 0
		}
		return *v
	}
	f := pr.State.Flags
	file := job.Job.File.Path
	progress := num(job.Progress.Completion) / 100
	o.mu.Lock()
	if !o.connected {
		o.connected, o.homed = true, ""
	}
	state := "standby"
	switch {
	case f["paused"] || f["pausing"]:
		state = "paused"
	case f["printing"] || f["cancelling"] || f["resuming"] || f["finishing"]:
		state = "printing"
		o.printed = file
		// Prints home first.
		o.homed = "xyz"
	case f["error"]:
		state = "error"
	case file != "" && progress >= 1:
		state = "complete"
	case file != "" && o.printed == file:
		state = "cancelled"
	}
	homed := o.homed
	o.mu.Unlock()
	if state == "standby" {
		progress = 0
	}
	message := ""
	if f["error"] || f["closedOrError"] {
		message = strings.TrimSpace(pr.State.Error)
	}
	heaters := []any{}
	objects := map[string]any{}
	names := make([]string, 0, len(pr.Temperature))
	for k := range pr.Temperature {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, k := range names {
		name := heaterName(k)
		var t octoTemp
		if name == "" || json.Unmarshal(pr.Temperature[k], &t) != nil {
			continue
		}
		heaters = append(heaters, name)
		objects[name] = map[string]any{"temperature": t.Actual, "target": t.Target}
	}
	printed := num(job.Progress.PrintTime)
	o.mu.Lock()
	pos := []any{o.pos[0], o.pos[1], o.pos[2], 0.0}
	speed, flow := o.speed, o.flow
	o.mu.Unlock()
	objects["webhooks"] = map[string]any{"state": "ready", "state_message": ""}
	objects["print_stats"] = map[string]any{"state": state, "filename": file, "print_duration": printed, "total_duration": printed, "filament_used": 0.0, "message": message, "info": map[string]any{}}
	objects["virtual_sdcard"] = map[string]any{"progress": progress, "is_active": state == "printing"}
	objects["display_status"] = map[string]any{"progress": progress, "message": ""}
	objects["heaters"] = map[string]any{"available_heaters": heaters, "available_sensors": heaters}
	objects["toolhead"] = map[string]any{"position": pos, "extruder": "extruder", "homed_axes": homed}
	objects["gcode_move"] = map[string]any{"gcode_position": pos, "speed_factor": speed, "extrude_factor": flow}
	return objects, nil
}

// offline is the state while OctoPrint isn't connected to its printer: like
// Klipper stopped, so the page says so and offers to connect again.
func (o *octoPrint) offline(ctx context.Context) map[string]any {
	o.mu.Lock()
	o.connected, o.homed = false, ""
	o.mu.Unlock()
	var c struct {
		Current struct {
			State string `json:"state"`
		} `json:"current"`
	}
	_, _ = o.do(ctx, http.MethodGet, "/api/connection", nil, 0, "", &c)
	msg := "OctoPrint isn't connected to the printer"
	if s := strings.TrimSpace(c.Current.State); s != "" {
		msg += " (" + s + ")"
	}
	return map[string]any{
		"webhooks":       map[string]any{"state": "shutdown", "state_message": msg + "."},
		"print_stats":    map[string]any{"state": "standby", "filename": "", "print_duration": 0.0, "total_duration": 0.0, "filament_used": 0.0, "message": "", "info": map[string]any{}},
		"virtual_sdcard": map[string]any{"progress": 0.0, "is_active": false},
		"display_status": map[string]any{"progress": 0.0, "message": ""},
		"heaters":        map[string]any{"available_heaters": []any{}, "available_sensors": []any{}},
	}
}

func (o *octoPrint) list(files []octoFile, depth int, into map[string]octoFile, out *[]brandFile) {
	for _, f := range files {
		if f.Type == "folder" {
			if depth > 0 {
				o.list(f.Children, depth-1, into, out)
			}
			continue
		}
		if f.Type != "machinecode" && !isGcodeName(f.Path) {
			continue
		}
		into[f.Path] = f
		*out = append(*out, brandFile{Path: f.Path, Modified: f.Date, Size: f.Size})
	}
}

func (o *octoPrint) files(ctx context.Context) ([]brandFile, error) {
	var v struct {
		Files []octoFile `json:"files"`
	}
	if _, err := o.do(ctx, http.MethodGet, "/api/files/local?recursive=true", nil, 0, "", &v); err != nil {
		return nil, err
	}
	known := map[string]octoFile{}
	out := []brandFile{}
	o.list(v.Files, 3, known, &out)
	o.mu.Lock()
	o.known = known
	o.mu.Unlock()
	return out, nil
}

// file is what OctoPrint says about one file now (its analysis comes some time after the upload).
func (o *octoPrint) file(ctx context.Context, path string) (octoFile, error) {
	var f octoFile
	if _, err := o.do(ctx, http.MethodGet, "/api/files/local/"+escapePath(path), nil, 0, "", &f); err != nil {
		return f, err
	}
	o.mu.Lock()
	o.known[path] = f
	o.mu.Unlock()
	return f, nil
}

// octoThumbPrefix is where a file's picture is served, under the G-code folder.
const octoThumbPrefix = ".octoprint-thumb/"

func (o *octoPrint) metadata(ctx context.Context, path string) (map[string]any, error) {
	f, err := o.file(ctx, path)
	if err != nil {
		return nil, err
	}
	m := map[string]any{"filename": path, "size": f.Size, "modified": f.Date}
	if t := f.Analysis.EstimatedPrintTime; t > 0 {
		m["estimated_time"] = t
	}
	total := 0.0
	for _, fil := range f.Analysis.Filament {
		total += fil.Length
	}
	if total > 0 {
		m["filament_total"] = total
	}
	// Slicer thumbnails, as a plugin (PrusaSlicer Thumbnails, the most used) lists them.
	if f.Thumb != "" {
		dir := ""
		if i := strings.LastIndex(path, "/"); i >= 0 {
			dir = path[:i+1]
		}
		m["thumbnails"] = []any{map[string]any{"width": 220, "height": 124, "relative_path": octoThumbPrefix + path[len(dir):]}}
	}
	return m, nil
}

func (o *octoPrint) thumbnail(ctx context.Context, path string) ([]byte, string, error) {
	path = strings.TrimPrefix(path, octoThumbPrefix)
	if i := strings.Index(path, "/"+octoThumbPrefix); i >= 0 {
		path = path[:i+1] + path[i+1+len(octoThumbPrefix):]
	}
	o.mu.Lock()
	f, ok := o.known[path]
	o.mu.Unlock()
	if !ok || f.Thumb == "" {
		var err error
		if f, err = o.file(ctx, path); err != nil {
			return nil, "", err
		}
	}
	if f.Thumb == "" {
		return nil, "", errors.New("no picture")
	}
	return o.fetch(ctx, o.base+"/"+strings.TrimLeft(f.Thumb, "/"))
}

// fetch is one picture from OctoPrint's own host.
func (o *octoPrint) fetch(ctx context.Context, raw string) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, "", err
	}
	if o.key != "" {
		req.Header.Set("X-Api-Key", o.key)
	}
	res, err := o.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("HTTP %d", res.StatusCode)
	}
	buf, err := io.ReadAll(io.LimitReader(res.Body, maxFrame))
	ct := res.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/png"
	}
	return buf, ct, err
}

func (o *octoPrint) remove(ctx context.Context, path string) error {
	_, err := o.do(ctx, http.MethodDelete, "/api/files/local/"+escapePath(path), nil, 0, "", nil)
	var oe *octoError
	if errors.As(err, &oe) && oe.status == http.StatusConflict {
		return errors.New("OctoPrint is printing this file: it can be deleted once the print ends.")
	}
	return err
}

// upload streams the file to OctoPrint's upload form; the form's other parts
// are known up front, so its length is too, and nothing is kept here.
func (o *octoPrint) upload(ctx context.Context, path string, body io.Reader, size int64) error {
	dir, name := "", path
	if i := strings.LastIndex(path, "/"); i >= 0 {
		dir, name = path[:i], path[i+1:]
	}
	boundary := fmt.Sprintf("cloudslicer%d", time.Now().UnixNano())
	quoted := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\r", "", "\n", "").Replace(name)
	field := func(k, v string) string {
		return "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + k + "\"\r\n\r\n" + v + "\r\n"
	}
	head := field("path", dir) + field("select", "false") + field("print", "false") +
		"--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + quoted + "\"\r\nContent-Type: application/octet-stream\r\n\r\n"
	tail := "\r\n--" + boundary + "--\r\n"
	form := io.MultiReader(strings.NewReader(head), io.LimitReader(body, size), strings.NewReader(tail))
	_, err := o.do(ctx, http.MethodPost, "/api/files/local", form, int64(len(head))+size+int64(len(tail)), "multipart/form-data; boundary="+boundary, nil)
	var oe *octoError
	if errors.As(err, &oe) && oe.status == http.StatusConflict {
		return errors.New("OctoPrint is printing a file of that name: wait for its print to end.")
	}
	return err
}

func (o *octoPrint) start(ctx context.Context, path string) error {
	_, err := o.post(ctx, "/api/files/local/"+escapePath(path), map[string]any{"command": "select", "print": true})
	var oe *octoError
	if errors.As(err, &oe) && oe.status == http.StatusConflict {
		return errors.New("The printer is busy, or OctoPrint isn't connected to it: it can start a print once it's ready.")
	}
	return err
}

func (o *octoPrint) jobCommand(ctx context.Context, body map[string]any) error {
	_, err := o.post(ctx, "/api/job", body)
	var oe *octoError
	if errors.As(err, &oe) && oe.status == http.StatusConflict {
		return errors.New("The printer isn't printing.")
	}
	return err
}

func (o *octoPrint) pause(ctx context.Context) error {
	return o.jobCommand(ctx, map[string]any{"command": "pause", "action": "pause"})
}

func (o *octoPrint) resume(ctx context.Context) error {
	return o.jobCommand(ctx, map[string]any{"command": "pause", "action": "resume"})
}

func (o *octoPrint) cancel(ctx context.Context) error {
	return o.jobCommand(ctx, map[string]any{"command": "cancel"})
}

// Klipper's own commands the Device tab sends, in Marlin's words.
var (
	klipperCommand = regexp.MustCompile(`^[A-Z][A-Z0-9]*_[A-Z0-9_]+`)
	klipperArg     = regexp.MustCompile(`([A-Z_]+)=(\S+)`)
)

// marlinLines turns a script from the Device tab into lines OctoPrint sends as they are.
func marlinLines(script string) ([]string, error) {
	var out []string
	relative, relativeE := false, false
	for _, raw := range strings.Split(script, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		upper := strings.ToUpper(line)
		word := strings.Fields(upper)[0]
		args := map[string]string{}
		for _, m := range klipperArg.FindAllStringSubmatch(upper, -1) {
			args[m[1]] = m[2]
		}
		switch {
		case word == "SAVE_GCODE_STATE":
		case word == "RESTORE_GCODE_STATE":
			// Marlin can't save its state: go back to its usual absolute moves.
			if relative {
				out = append(out, "G90")
			}
			if relativeE {
				out = append(out, "M82")
			}
			relative, relativeE = false, false
		case word == "SET_HEATER_TEMPERATURE":
			target, err := strconv.ParseFloat(args["TARGET"], 64)
			if err != nil {
				target = 0
			}
			heater := strings.ToLower(args["HEATER"])
			s := strconv.Itoa(int(target + 0.5))
			switch {
			case heater == "heater_bed":
				out = append(out, "M140 S"+s)
			case heater == "extruder":
				out = append(out, "M104 T0 S"+s)
			case strings.HasPrefix(heater, "extruder"):
				out = append(out, "M104 T"+strings.TrimPrefix(heater, "extruder")+" S"+s)
			case strings.Contains(heater, "chamber"):
				out = append(out, "M141 S"+s)
			default:
				return nil, fmt.Errorf("OctoPrint has no heater called %s.", args["HEATER"])
			}
		case klipperCommand.MatchString(word):
			return nil, fmt.Errorf("%s is a Klipper command: OctoPrint printers don't know it.", word)
		default:
			switch word {
			case "G91":
				relative = true
			case "G90":
				relative = false
			case "M83":
				relativeE = true
			case "M82":
				relativeE = false
			}
			out = append(out, line)
		}
	}
	return out, nil
}

func (o *octoPrint) gcode(ctx context.Context, script string) error {
	lines, err := marlinLines(script)
	if err != nil {
		return err
	}
	if len(lines) == 0 {
		return nil
	}
	// After a move, ask where the head is (for the Move card), and keep the answer out of the console.
	moved := false
	for _, l := range lines {
		switch strings.Fields(strings.ToUpper(l))[0] {
		case "G0", "G1", "G28", "G29":
			moved = true
		}
	}
	if moved {
		lines = append(lines, "M114")
	}
	if _, err := o.post(ctx, "/api/printer/command", map[string]any{"commands": lines}); err != nil {
		var oe *octoError
		if errors.As(err, &oe) && oe.status == http.StatusConflict {
			return errors.New("OctoPrint isn't connected to the printer.")
		}
		return err
	}
	if moved {
		o.mu.Lock()
		o.asked++
		o.mu.Unlock()
	}
	// Homing from here: OctoPrint doesn't say which axes are homed, so remember (and the speed and flow).
	for _, l := range lines {
		f := strings.Fields(strings.ToUpper(l))
		if (f[0] == "M220" || f[0] == "M221") && len(f) > 1 && strings.HasPrefix(f[1], "S") {
			if v, err := strconv.ParseFloat(f[1][1:], 64); err == nil && v > 0 {
				o.mu.Lock()
				if f[0] == "M220" {
					o.speed = v / 100
				} else {
					o.flow = v / 100
				}
				o.mu.Unlock()
			}
			continue
		}
		if f[0] != "G28" {
			continue
		}
		o.mu.Lock()
		if len(f) == 1 {
			o.homed = "xyz"
		} else {
			for _, a := range f[1:] {
				if ax := strings.ToLower(a[:1]); strings.Contains("xyz", ax) && !strings.Contains(o.homed, ax) {
					o.homed += ax
				}
			}
		}
		o.mu.Unlock()
	}
	return nil
}

// emergencyStop: OctoPrint sends M112 ahead of everything else waiting.
func (o *octoPrint) emergencyStop(ctx context.Context) error {
	_, err := o.post(ctx, "/api/printer/command", map[string]any{"commands": []string{"M112"}})
	return err
}

// restart connects OctoPrint to the printer again, with the settings it has.
func (o *octoPrint) restart(ctx context.Context) error {
	_, err := o.post(ctx, "/api/connection", map[string]any{"command": "connect"})
	return err
}

// cameras are the webcams in OctoPrint's settings (several since OctoPrint 1.9, one before).
func (o *octoPrint) cameras(ctx context.Context) ([]brandCamera, error) {
	var s struct {
		Webcam struct {
			Enabled     *bool  `json:"webcamEnabled"`
			StreamURL   string `json:"streamUrl"`
			SnapshotURL string `json:"snapshotUrl"`
			FlipH       bool   `json:"flipH"`
			FlipV       bool   `json:"flipV"`
			Rotate90    bool   `json:"rotate90"`
			Webcams     []struct {
				Name        string `json:"name"`
				DisplayName string `json:"displayName"`
				CanSnapshot bool   `json:"canSnapshot"`
				FlipH       bool   `json:"flipH"`
				FlipV       bool   `json:"flipV"`
				Rotate90    bool   `json:"rotate90"`
				Compat      *struct {
					Stream   string `json:"stream"`
					Snapshot string `json:"snapshot"`
				} `json:"compat"`
			} `json:"webcams"`
		} `json:"webcam"`
	}
	if _, err := o.do(ctx, http.MethodGet, "/api/settings", nil, 0, "", &s); err != nil {
		return nil, err
	}
	w := s.Webcam
	if w.Enabled != nil && !*w.Enabled {
		return nil, nil
	}
	rotation := func(r bool) int {
		if r {
			return 270
		}
		return 0
	}
	var out []brandCamera
	for _, c := range w.Webcams {
		if c.Compat == nil || (c.Compat.Stream == "" && c.Compat.Snapshot == "") {
			continue
		}
		name := c.DisplayName
		if name == "" {
			name = c.Name
		}
		out = append(out, brandCamera{Name: name, Stream: o.cameraURL(c.Compat.Stream), Snapshot: o.cameraURL(c.Compat.Snapshot), FlipH: c.FlipH, FlipV: c.FlipV, Rotation: rotation(c.Rotate90)})
	}
	if len(out) == 0 && (w.StreamURL != "" || w.SnapshotURL != "") {
		out = append(out, brandCamera{Name: "Camera", Stream: o.cameraURL(w.StreamURL), Snapshot: o.cameraURL(w.SnapshotURL), FlipH: w.FlipH, FlipV: w.FlipV, Rotation: rotation(w.Rotate90)})
	}
	return out, nil
}

// cameraURL is a camera address OctoPrint keeps, from the bridge's side: a
// path is on OctoPrint's own web server, and "127.0.0.1" or "localhost" is
// OctoPrint's own computer (OctoPi's usual snapshot address).
func (o *octoPrint) cameraURL(raw string) string {
	if raw == "" {
		return ""
	}
	base, err := url.Parse(o.base)
	if err != nil {
		return ""
	}
	ref, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	u := base.ResolveReference(ref)
	if h := u.Hostname(); h == "127.0.0.1" || h == "localhost" || h == "::1" {
		if p := u.Port(); p != "" {
			u.Host = net.JoinHostPort(base.Hostname(), p)
		} else {
			u.Host = base.Hostname()
		}
	}
	return u.String()
}

// cameraOpen is a camera address (one cameras gave) fetched with the API key,
// for OctoPrint's own host only: its camera usually sits behind the same web server.
func (o *octoPrint) cameraOpen(ctx context.Context, raw string) (*http.Response, error) {
	u, err := url.Parse(raw)
	base, berr := url.Parse(o.base)
	if err != nil || berr != nil || u.Hostname() != base.Hostname() || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("Only OctoPrint's own computer can be reached through the bridge.")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if o.key != "" {
		req.Header.Set("X-Api-Key", o.key)
	}
	return o.client.Do(req)
}

// follow reads OctoPrint's push socket while someone watches, and passes on
// what the printer answers (not its "ok"s, temperature reports and "busy"s),
// as the console's replies. It ends with ctx.
func (o *octoPrint) follow(ctx context.Context, reply func(line string)) {
	for ctx.Err() == nil {
		o.followOnce(ctx, reply)
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
		}
	}
}

func (o *octoPrint) followOnce(ctx context.Context, reply func(line string)) {
	// A passive login with the API key gives the session the socket wants.
	var login struct {
		Name    string `json:"name"`
		Session string `json:"session"`
	}
	buf, _ := json.Marshal(map[string]any{"passive": true})
	lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	_, err := o.do(lctx, http.MethodPost, "/api/login", bytes.NewReader(buf), int64(len(buf)), "application/json", &login)
	cancel()
	if err != nil || login.Session == "" {
		return
	}
	ws := "ws" + strings.TrimPrefix(o.base, "http") + "/sockjs/websocket"
	dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	conn, _, err := websocket.Dial(dctx, ws, nil)
	cancel()
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(4 << 20)
	auth, _ := json.Marshal(map[string]string{"auth": login.Name + ":" + login.Session})
	if conn.Write(ctx, websocket.MessageText, auth) != nil {
		return
	}
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var msg struct {
			Current *struct {
				Logs []string `json:"logs"`
			} `json:"current"`
		}
		if json.Unmarshal(data, &msg) != nil || msg.Current == nil {
			continue
		}
		for _, l := range msg.Current.Logs {
			line, ok := printerReply(l)
			if !ok {
				continue
			}
			if p, ok := reportedPosition(line); ok {
				o.mu.Lock()
				o.pos = p
				mine := o.asked > 0
				if mine {
					o.asked--
				}
				o.mu.Unlock()
				if mine {
					continue
				}
			}
			reply(line)
		}
	}
}

// printerReply is a terminal line OctoPrint shows that the printer said and a
// person would want to read.
func printerReply(log string) (string, bool) {
	line, ok := strings.CutPrefix(log, "Recv: ")
	if !ok {
		return "", false
	}
	line = strings.TrimSpace(line)
	l := strings.ToLower(line)
	switch {
	case line == "", l == "ok", l == "wait", strings.HasPrefix(l, "echo:busy"):
		return "", false
	case strings.HasPrefix(l, "ok t:"), strings.HasPrefix(l, "t:"), strings.HasPrefix(l, "ok b:"):
		return "", false
	// Answers to the questions OctoPrint itself keeps asking (SD card progress).
	case strings.HasPrefix(l, "not sd printing"), strings.HasPrefix(l, "sd printing byte"):
		return "", false
	}
	return strings.TrimPrefix(line, "ok "), true
}

var positionPart = regexp.MustCompile(`\b([XYZ]):(-?[0-9.]+)`)

// reportedPosition reads Marlin's answer to M114 ("X:10.00 Y:0.00 Z:5.00 E:0.00 Count: ...").
func reportedPosition(line string) ([3]float64, bool) {
	var p [3]float64
	head, _, _ := strings.Cut(line, "Count")
	seen := 0
	for _, m := range positionPart.FindAllStringSubmatch(head, -1) {
		v, err := strconv.ParseFloat(m[2], 64)
		if err != nil {
			return p, false
		}
		p[strings.Index("XYZ", m[1])] = v
		seen++
	}
	return p, seen == 3
}

// probeOctoPrint finds OctoPrint at an address the user typed, or one the
// search found: on the port given, else the usual web port, then OctoPrint's
// own 5000. It says needsKey when OctoPrint wants its API key.
func probeOctoPrint(ctx context.Context, address, key string) (string, string, error) {
	a := strings.TrimRight(strings.TrimSpace(address), "/")
	if !strings.HasPrefix(strings.ToLower(a), "http://") && !strings.HasPrefix(strings.ToLower(a), "https://") {
		a = "http://" + a
	}
	tries := []string{a}
	if u, err := url.Parse(a); err == nil && u.Port() == "" {
		tries = append(tries, strings.TrimRight(a, "/")+":5000")
	}
	var last error = errors.New("not OctoPrint")
	for _, base := range tries {
		url, name, err := probeOctoAt(ctx, base, key)
		if err == nil {
			return url, name, nil
		}
		if errors.As(err, new(*probeError)) {
			return "", "", err
		}
		last = err
	}
	return "", "", last
}

func probeOctoAt(ctx context.Context, base, key string) (string, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	o := newOctoPrint(base, key)
	var v struct {
		Text string `json:"text"`
	}
	_, err := o.do(ctx, http.MethodGet, "/api/version", nil, 0, "", &v)
	if errors.Is(err, errOctoKey) {
		if !isOctoPrintPage(ctx, o.client, o.base) {
			return "", "", errors.New("not OctoPrint")
		}
		if key == "" {
			return "", "", &probeError{msg: "OctoPrint needs an API key", needsKey: true}
		}
		return "", "", &probeError{msg: "OctoPrint did not accept that API key", needsKey: true}
	}
	if err != nil {
		return "", "", err
	}
	if !strings.Contains(strings.ToLower(v.Text), "octoprint") {
		return "", "", errors.New("not OctoPrint")
	}
	host, _, _ := o.about(ctx)
	return o.base, host, nil
}

// isOctoPrintPage: OctoPrint's login page (or, before 1.9, its main page) names it.
func isOctoPrintPage(ctx context.Context, client *http.Client, base string) bool {
	for _, path := range []string{"/login/", "/"} {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
		if err != nil {
			return false
		}
		res, err := client.Do(req)
		if err != nil {
			return false
		}
		page, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		res.Body.Close()
		if res.StatusCode == http.StatusOK && bytes.Contains(bytes.ToLower(page), []byte("<title>octoprint")) {
			return true
		}
	}
	return false
}

// probeOctoHost says whether OctoPrint answers on a host's web port or its own 5000.
func probeOctoHost(ctx context.Context, client *http.Client, h string) (found, bool) {
	for _, base := range []string{"http://" + h, "http://" + h + ":5000"} {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/version", nil)
		if err != nil {
			return found{}, false
		}
		res, err := client.Do(req)
		if err != nil {
			continue
		}
		res.Body.Close()
		if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusUnauthorized {
			continue
		}
		if isOctoPrintPage(ctx, client, base) {
			return found{URL: base, Name: h, Kind: kindOctoPrint, NeedsKey: true}, true
		}
	}
	return found{}, false
}
