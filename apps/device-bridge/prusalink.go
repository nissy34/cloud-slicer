package main

// Prusa printers (MK4/MK4S, Core One, XL, Mini, and the MK3 family with
// PrusaLink on a Raspberry Pi) through PrusaLink, the printer's own local web
// API: https://github.com/prusa3d/Prusa-Link-Web/blob/master/spec/openapi.yaml.
// It logs in with digest authentication as user "maker" and the password the
// printer shows (Settings, Network, PrusaLink); older PrusaLink takes an API
// key in X-Api-Key instead, which is sent too. Status comes from /api/v1/status
// and /api/v1/job; files live on one storage (the USB stick, or "local" on a
// Pi); there is no G-code console and no local camera stream.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type prusaLink struct {
	base   string
	key    string
	client *http.Client

	mu      sync.Mutex
	storage string
	jobID   int
	// The print going on: its file and the printer's own time left, for its metadata.
	jobFile          string
	jobPrinted, left float64
	// What the last file list said about each file, by the name shown (PrusaLink
	// also has a short 8.3 name for each file on a USB stick, which always works in URLs).
	known map[string]prusaFile
}

type prusaFile struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Type        string `json:"type"`
	Size        int64  `json:"size"`
	Modified    int64  `json:"m_timestamp"`
	Refs        struct {
		Thumbnail string `json:"thumbnail"`
		Icon      string `json:"icon"`
	} `json:"refs"`
	Meta     map[string]any `json:"meta"`
	Children []prusaFile    `json:"children"`
}

func (f prusaFile) shown() string {
	if f.DisplayName != "" {
		return f.DisplayName
	}
	return f.Name
}

func newPrusaLink(base, password string) *prusaLink {
	client := &http.Client{Timeout: 0, Transport: &digestTransport{user: "maker", password: password}}
	return &prusaLink{base: strings.TrimRight(base, "/"), key: password, client: client, known: map[string]prusaFile{}}
}

func (p *prusaLink) noun() string { return "Prusa printers" }

// do sends one request; ok lists the answers that count as success.
func (p *prusaLink) do(ctx context.Context, method, path string, body io.Reader, size int64, headers map[string]string, out any) (*http.Response, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if _, has := ctx.Deadline(); !has && body == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(ctx, method, p.base+path, body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.ContentLength = size
	}
	if p.key != "" {
		req.Header.Set("X-Api-Key", p.key)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Could not reach the printer: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return res, errPrusaPassword
	}
	if res.StatusCode >= 300 {
		var e struct {
			Title string `json:"title"`
			Text  string `json:"text"`
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		_ = json.Unmarshal(raw, &e)
		msg := strings.TrimSpace(e.Text)
		if msg == "" {
			msg = strings.TrimSpace(e.Title)
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", res.StatusCode)
		}
		return res, &prusaError{status: res.StatusCode, msg: "The printer said: " + msg}
	}
	if out != nil && res.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil && !errors.Is(err, io.EOF) {
			return res, err
		}
	}
	return res, nil
}

var errPrusaPassword = errors.New("The printer did not accept the PrusaLink password.")

type prusaError struct {
	status int
	msg    string
}

func (e *prusaError) Error() string { return e.msg }

func escapePath(p string) string {
	parts := strings.Split(strings.Trim(p, "/"), "/")
	for i, s := range parts {
		parts[i] = url.PathEscape(s)
	}
	return strings.Join(parts, "/")
}

func (p *prusaLink) about(ctx context.Context) (string, string, error) {
	var v struct {
		Server   string `json:"server"`
		Text     string `json:"text"`
		Hostname string `json:"hostname"`
	}
	if _, err := p.do(ctx, http.MethodGet, "/api/version", nil, 0, nil, &v); err != nil {
		return "", "", err
	}
	var info struct {
		Hostname string `json:"hostname"`
	}
	_, _ = p.do(ctx, http.MethodGet, "/api/v1/info", nil, 0, nil, &info)
	host := info.Hostname
	if host == "" {
		host = v.Hostname
	}
	software := strings.TrimSpace("PrusaLink " + v.Server)
	return host, software, nil
}

// storageName is where files go: the first storage that can be written to.
func (p *prusaLink) storageName(ctx context.Context) string {
	p.mu.Lock()
	s := p.storage
	p.mu.Unlock()
	if s != "" {
		return s
	}
	var list struct {
		StorageList []struct {
			Path      string `json:"path"`
			Name      string `json:"name"`
			ReadOnly  bool   `json:"read_only"`
			Available *bool  `json:"available"`
		} `json:"storage_list"`
	}
	s = "usb"
	if _, err := p.do(ctx, http.MethodGet, "/api/v1/storage", nil, 0, nil, &list); err == nil {
		for _, st := range list.StorageList {
			if st.ReadOnly || (st.Available != nil && !*st.Available) {
				continue
			}
			if name := strings.Trim(st.Path, "/"); name != "" {
				s = name
				break
			}
		}
	}
	p.mu.Lock()
	p.storage = s
	p.mu.Unlock()
	return s
}

// The printer's states in Klipper's words (print_stats.state).
var prusaStates = map[string]string{
	"IDLE": "standby", "READY": "standby", "BUSY": "standby",
	"PRINTING": "printing", "PAUSED": "paused", "ATTENTION": "paused",
	"FINISHED": "complete", "STOPPED": "cancelled", "ERROR": "error",
}

func (p *prusaLink) status(ctx context.Context) (map[string]any, error) {
	var st struct {
		Printer struct {
			State        string   `json:"state"`
			TempNozzle   float64  `json:"temp_nozzle"`
			TargetNozzle float64  `json:"target_nozzle"`
			TempBed      float64  `json:"temp_bed"`
			TargetBed    float64  `json:"target_bed"`
			AxisX        *float64 `json:"axis_x"`
			AxisY        *float64 `json:"axis_y"`
			AxisZ        *float64 `json:"axis_z"`
			Flow         *float64 `json:"flow"`
			Speed        *float64 `json:"speed"`
		} `json:"printer"`
		Job *struct {
			ID            int     `json:"id"`
			Progress      float64 `json:"progress"`
			TimeRemaining float64 `json:"time_remaining"`
			TimePrinting  float64 `json:"time_printing"`
		} `json:"job"`
	}
	if _, err := p.do(ctx, http.MethodGet, "/api/v1/status", nil, 0, nil, &st); err != nil {
		return nil, err
	}
	pr := st.Printer
	state := prusaStates[strings.ToUpper(pr.State)]
	if state == "" {
		state = "standby"
	}
	message := ""
	switch strings.ToUpper(pr.State) {
	case "ATTENTION":
		message = "The printer needs you: check its screen."
	case "ERROR":
		message = "The printer has a problem: check its screen."
	}
	filename := ""
	progress, printing, left := 0.0, 0.0, 0.0
	if st.Job != nil {
		progress, printing, left = st.Job.Progress/100, st.Job.TimePrinting, st.Job.TimeRemaining
		p.mu.Lock()
		p.jobID = st.Job.ID
		p.mu.Unlock()
		var job struct {
			File struct {
				Name        string `json:"name"`
				DisplayName string `json:"display_name"`
			} `json:"file"`
		}
		if _, err := p.do(ctx, http.MethodGet, "/api/v1/job", nil, 0, nil, &job); err == nil {
			filename = job.File.DisplayName
			if filename == "" {
				filename = job.File.Name
			}
		}
	} else {
		p.mu.Lock()
		p.jobID = 0
		p.mu.Unlock()
	}
	if state == "standby" {
		progress = 0
	}
	p.mu.Lock()
	p.jobFile, p.jobPrinted, p.left = filename, printing, left
	p.mu.Unlock()
	axis := func(v *float64) float64 {
		if v == nil {
			return 0
		}
		return *v
	}
	factor := func(v *float64) float64 {
		if v == nil || *v <= 0 {
			return 1
		}
		return *v / 100
	}
	pos := []any{axis(pr.AxisX), axis(pr.AxisY), axis(pr.AxisZ), 0.0}
	return map[string]any{
		"webhooks":       map[string]any{"state": "ready", "state_message": ""},
		"print_stats":    map[string]any{"state": state, "filename": filename, "print_duration": printing, "total_duration": printing, "filament_used": 0.0, "message": message, "info": map[string]any{}},
		"virtual_sdcard": map[string]any{"progress": progress, "is_active": state == "printing"},
		"display_status": map[string]any{"progress": progress, "message": ""},
		"heaters":        map[string]any{"available_heaters": []any{"extruder", "heater_bed"}, "available_sensors": []any{"extruder", "heater_bed"}},
		"extruder":       map[string]any{"temperature": pr.TempNozzle, "target": pr.TargetNozzle},
		"heater_bed":     map[string]any{"temperature": pr.TempBed, "target": pr.TargetBed},
		"toolhead":       map[string]any{"position": pos, "extruder": "extruder", "homed_axes": ""},
		"gcode_move":     map[string]any{"gcode_position": pos, "speed_factor": factor(pr.Speed), "extrude_factor": factor(pr.Flow)},
	}, nil
}

// list reads one folder of the storage, and its folders below.
func (p *prusaLink) list(ctx context.Context, dir string, depth int, into map[string]prusaFile, out *[]brandFile) error {
	var folder prusaFile
	path := "/api/v1/files/" + escapePath(p.storageName(ctx)+"/"+dir)
	if dir == "" {
		path += "/"
	}
	if _, err := p.do(ctx, http.MethodGet, path, nil, 0, nil, &folder); err != nil {
		return err
	}
	for _, f := range folder.Children {
		shown := f.shown()
		if dir != "" {
			shown = dir + "/" + shown
		}
		if strings.EqualFold(f.Type, "FOLDER") {
			if depth > 0 {
				short := f.Name
				if dir != "" {
					short = shortPath(into, dir) + "/" + short
				}
				into[shown] = prusaFile{Name: short, DisplayName: shown, Type: "FOLDER"}
				_ = p.list(ctx, shown, depth-1, into, out)
			}
			continue
		}
		if !strings.EqualFold(f.Type, "PRINT_FILE") && !isGcodeName(shown) {
			continue
		}
		short := f.Name
		if dir != "" {
			short = shortPath(into, dir) + "/" + f.Name
		}
		f.Name = short
		into[shown] = f
		*out = append(*out, brandFile{Path: shown, Modified: float64(f.Modified), Size: f.Size})
	}
	return nil
}

// shortPath is a folder's path in short names, as the last list gave it.
func shortPath(known map[string]prusaFile, dir string) string {
	if f, ok := known[dir]; ok && f.Name != "" {
		return f.Name
	}
	return dir
}

func isGcodeName(name string) bool {
	n := strings.ToLower(name)
	return strings.HasSuffix(n, ".gcode") || strings.HasSuffix(n, ".bgcode") || strings.HasSuffix(n, ".gco") || strings.HasSuffix(n, ".g")
}

func (p *prusaLink) files(ctx context.Context) ([]brandFile, error) {
	known := map[string]prusaFile{}
	out := []brandFile{}
	if err := p.list(ctx, "", 2, known, &out); err != nil {
		return nil, err
	}
	p.mu.Lock()
	p.known = known
	p.mu.Unlock()
	return out, nil
}

// file is what the last list knew about a file, listing again when it's new.
func (p *prusaLink) file(ctx context.Context, path string) prusaFile {
	p.mu.Lock()
	f, ok := p.known[path]
	p.mu.Unlock()
	if ok {
		return f
	}
	_, _ = p.files(ctx)
	p.mu.Lock()
	f, ok = p.known[path]
	p.mu.Unlock()
	if ok {
		return f
	}
	return prusaFile{Name: path, DisplayName: path}
}

func (p *prusaLink) fileURL(ctx context.Context, path string) string {
	return "/api/v1/files/" + escapePath(p.storageName(ctx)+"/"+p.file(ctx, path).Name)
}

// thumbPrefix is where a file's picture is served, under the G-code folder.
const thumbPrefix = ".prusalink-thumb/"

func (p *prusaLink) metadata(ctx context.Context, path string) (map[string]any, error) {
	f := p.file(ctx, path)
	var full prusaFile
	if _, err := p.do(ctx, http.MethodGet, p.fileURL(ctx, path), nil, 0, nil, &full); err == nil {
		if full.Meta != nil {
			f.Meta = full.Meta
		}
		if full.Refs.Thumbnail != "" {
			f.Refs = full.Refs
		}
	}
	m := map[string]any{"filename": path, "size": f.Size, "modified": float64(f.Modified)}
	if v, ok := prusaSeconds(f.Meta, "estimated printing time (normal mode)"); ok {
		m["estimated_time"] = v
	}
	// The print going on: the printer's own estimate is better than the slicer's.
	p.mu.Lock()
	if path == p.jobFile && p.left > 0 {
		m["estimated_time"] = p.jobPrinted + p.left
	}
	p.mu.Unlock()
	if v, ok := prusaNumber(f.Meta, "filament used [mm]"); ok {
		m["filament_total"] = v
	}
	if v, ok := prusaNumber(f.Meta, "filament used [g]"); ok {
		m["filament_weight_total"] = v
	}
	if s, ok := f.Meta["filament_type"].(string); ok {
		m["filament_type"] = s
	}
	if f.Refs.Thumbnail != "" || f.Refs.Icon != "" {
		dir := ""
		if i := strings.LastIndex(path, "/"); i >= 0 {
			dir = path[:i+1]
		}
		// Relative to the file's own folder, like Moonraker's .thumbs/.
		m["thumbnails"] = []any{map[string]any{"width": 220, "height": 124, "relative_path": thumbPrefix + path[len(dir):]}}
	}
	return m, nil
}

func prusaNumber(meta map[string]any, key string) (float64, bool) {
	switch v := meta[key].(type) {
	case float64:
		return v, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return f, err == nil
	}
	return 0, false
}

var durationPart = regexp.MustCompile(`(\d+)\s*([dhms])`)

// prusaSeconds reads PrusaSlicer's "1d 2h 3m 4s" (or a number of seconds).
func prusaSeconds(meta map[string]any, key string) (float64, bool) {
	if v, ok := meta[key].(float64); ok {
		return v, true
	}
	s, _ := meta[key].(string)
	if s == "" {
		return 0, false
	}
	total := 0.0
	unit := map[string]float64{"d": 86400, "h": 3600, "m": 60, "s": 1}
	found := false
	for _, m := range durationPart.FindAllStringSubmatch(s, -1) {
		n, _ := strconv.ParseFloat(m[1], 64)
		total += n * unit[m[2]]
		found = true
	}
	return total, found
}

func (p *prusaLink) thumbnail(ctx context.Context, path string) ([]byte, string, error) {
	path = strings.TrimPrefix(path, thumbPrefix)
	if i := strings.Index(path, "/"+thumbPrefix); i >= 0 {
		path = path[:i+1] + path[i+1+len(thumbPrefix):]
	}
	f := p.file(ctx, path)
	ref := f.Refs.Thumbnail
	if ref == "" {
		ref = f.Refs.Icon
	}
	if ref == "" {
		return nil, "", errors.New("no picture")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, p.base+ref, nil)
	if p.key != "" {
		req.Header.Set("X-Api-Key", p.key)
	}
	res, err := p.client.Do(req)
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

func (p *prusaLink) remove(ctx context.Context, path string) error {
	_, err := p.do(ctx, http.MethodDelete, p.fileURL(ctx, path), nil, 0, nil, nil)
	if err == nil {
		p.mu.Lock()
		delete(p.known, path)
		p.mu.Unlock()
	}
	return err
}

func (p *prusaLink) upload(ctx context.Context, path string, body io.Reader, size int64) error {
	// A request with a body can't be repeated after a login challenge: log in first.
	storage := p.storageName(ctx)
	_, _ = p.do(ctx, http.MethodGet, "/api/v1/storage", nil, 0, nil, nil)
	_, err := p.do(ctx, http.MethodPut, "/api/v1/files/"+escapePath(storage+"/"+path), body, size, map[string]string{
		"Content-Type":       "application/octet-stream",
		"Overwrite":          "?1",
		"Print-After-Upload": "?0",
	}, nil)
	if err != nil {
		var pe *prusaError
		if errors.As(err, &pe) && pe.status == http.StatusConflict {
			return errors.New("The printer is busy with this file: wait for its print to end.")
		}
		return err
	}
	p.mu.Lock()
	delete(p.known, path)
	p.mu.Unlock()
	return nil
}

func (p *prusaLink) start(ctx context.Context, path string) error {
	_, err := p.do(ctx, http.MethodPost, p.fileURL(ctx, path), nil, 0, nil, nil)
	var pe *prusaError
	if errors.As(err, &pe) && pe.status == http.StatusConflict {
		return errors.New("The printer is busy: it can start a print once it's idle.")
	}
	return err
}

func (p *prusaLink) job(ctx context.Context, action string) error {
	p.mu.Lock()
	id := p.jobID
	p.mu.Unlock()
	if id == 0 {
		if _, err := p.status(ctx); err != nil {
			return err
		}
		p.mu.Lock()
		id = p.jobID
		p.mu.Unlock()
	}
	if id == 0 {
		return errors.New("The printer isn't printing.")
	}
	path := fmt.Sprintf("/api/v1/job/%d", id)
	method := http.MethodPut
	if action == "" {
		method = http.MethodDelete
	} else {
		path += "/" + action
	}
	_, err := p.do(ctx, method, path, nil, 0, nil, nil)
	return err
}

func (p *prusaLink) pause(ctx context.Context) error  { return p.job(ctx, "pause") }
func (p *prusaLink) resume(ctx context.Context) error { return p.job(ctx, "resume") }
func (p *prusaLink) cancel(ctx context.Context) error { return p.job(ctx, "") }

// probePrusaLink finds PrusaLink at an address the user typed, or one the
// search found. It says needsKey when the printer wants its password.
func probePrusaLink(ctx context.Context, address, password string) (string, string, error) {
	a := strings.TrimRight(strings.TrimSpace(address), "/")
	if !strings.HasPrefix(strings.ToLower(a), "http://") && !strings.HasPrefix(strings.ToLower(a), "https://") {
		a = "http://" + a
	}
	p := newPrusaLink(a, password)
	var v struct {
		API      string `json:"api"`
		Text     string `json:"text"`
		Hostname string `json:"hostname"`
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	res, err := p.do(ctx, http.MethodGet, "/api/version", nil, 0, nil, &v)
	if errors.Is(err, errPrusaPassword) {
		if res != nil && !isPrusaChallenge(res.Header.Get("WWW-Authenticate")) && password == "" {
			return "", "", errors.New("not PrusaLink")
		}
		if password == "" {
			return "", "", &probeError{msg: "This Prusa printer needs its PrusaLink password", needsKey: true}
		}
		return "", "", &probeError{msg: "The printer did not accept that password", needsKey: true}
	}
	if err != nil {
		return "", "", err
	}
	if !strings.Contains(strings.ToLower(v.Text), "prusa") {
		return "", "", errors.New("not PrusaLink")
	}
	host, _, _ := p.about(ctx)
	if host == "" {
		host = v.Hostname
	}
	return a, host, nil
}

// isPrusaChallenge: PrusaLink's login challenge names its realm "Printer API".
func isPrusaChallenge(h string) bool {
	return strings.HasPrefix(strings.ToLower(h), "digest ") && strings.Contains(parseChallenge(h)["realm"], "Printer API")
}
