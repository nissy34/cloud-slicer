package main

// Printers that don't run Klipper (Prusa with PrusaLink, ...) reach the Device
// tab through a small stand-in Moonraker inside the bridge: one local web
// server per printer, on 127.0.0.1 only, that answers the Moonraker calls the
// Device tab and the print alerts use, and works them out with the printer's
// own API (a "brand"). Everything else in the bridge (sessions, uploads,
// thumbnails, alert watches) talks to it like to any Moonraker, so a new brand
// is only the brand itself. Calls a printer can't do (G-code, for one) answer
// with an error in plain words, and the stand-in tells the Device tab which
// brand it is, so the page leaves out the controls that would need them.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The brands the bridge can stand in for, by Printer.Kind ("" is Moonraker itself):
// kindPrusaLink (prusalink.go), kindOctoPrint (octoprint.go), kindElegoo (elegoo.go), kindBambu (bambu.go).
const kindPrusaLink = "prusalink"

// pollEvery: how often a stand-in asks its printer how it is, while someone is watching.
var pollEvery = 2 * time.Second

// brand is one kind of printer, spoken to in its own language.
type brand interface {
	// about: the printer's name on the network and its software, for printer.info.
	about(ctx context.Context) (hostname, software string, err error)
	// status is the printer's state as Klipper objects (print_stats, extruder, heater_bed, ...).
	status(ctx context.Context) (map[string]any, error)
	files(ctx context.Context) ([]brandFile, error)
	// metadata is what Moonraker's server.files.metadata would say about a file.
	metadata(ctx context.Context, path string) (map[string]any, error)
	remove(ctx context.Context, path string) error
	// upload stores a file of exactly size bytes from body.
	upload(ctx context.Context, path string, body io.Reader, size int64) error
	start(ctx context.Context, path string) error
	pause(ctx context.Context) error
	resume(ctx context.Context) error
	cancel(ctx context.Context) error
	// thumbnail is a picture at a path its metadata named, under the G-code folder.
	thumbnail(ctx context.Context, path string) ([]byte, string, error)
	// noun: how the Device tab's errors name it ("Prusa printers").
	noun() string
}

// commander is a brand that takes G-code (in Klipper's words; it says which it doesn't know).
type commander interface {
	gcode(ctx context.Context, script string) error
	emergencyStop(ctx context.Context) error
	// restart gets the printer going again after it stopped (Klipper's firmware restart).
	restart(ctx context.Context) error
}

// camerer is a brand with cameras the bridge can fetch.
type camerer interface {
	cameras(ctx context.Context) ([]brandCamera, error)
	// cameraOpen fetches an address one of its cameras gave.
	cameraOpen(ctx context.Context, raw string) (*http.Response, error)
}

// requester is a brand that passes the page's own messages to the printer as
// they are (printer.request): the page's printer add-on knows the printer's
// language, the bridge only carries it.
type requester interface {
	request(ctx context.Context, message map[string]any) (any, error)
}

// follower is a brand whose printer's replies to G-code can be read as they come.
type follower interface {
	follow(ctx context.Context, reply func(line string))
}

// brandCamera is one camera; its addresses are the printer's own, which the stand-in passes on.
type brandCamera struct {
	Name, Stream, Snapshot string
	FlipH, FlipV           bool
	Rotation               int
}

type brandFile struct {
	Path     string  `json:"path"`
	Modified float64 `json:"modified"`
	Size     int64   `json:"size"`
}

func newBrand(p Printer) (brand, error) {
	switch p.Kind {
	case kindPrusaLink:
		return newPrusaLink(p.URL, p.APIKey), nil
	case kindOctoPrint:
		return newOctoPrint(p.URL, p.APIKey), nil
	case kindElegoo:
		return newElegoo(p.URL), nil
	case kindBambu:
		return newBambu(p.URL, p.APIKey), nil
	}
	return nil, fmt.Errorf("This bridge doesn't know printers of kind %q: update the bridge.", p.Kind)
}

// standIn is the local Moonraker for one printer.
type standIn struct {
	printer Printer
	b       brand
	url     string
	srv     *http.Server
	every   time.Duration

	mu      sync.Mutex
	clients map[*standInClient]bool
	objects map[string]any
	polling bool
	wake    chan struct{}
	// The cameras server.webcams.list gave last, by number in their stand-in address.
	cams []brandCamera
}

type standInClient struct {
	ws   *websocket.Conn
	ctx  context.Context
	mu   sync.Mutex
	subs map[string]bool
}

func (c *standInClient) write(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
	defer cancel()
	_ = c.ws.Write(ctx, websocket.MessageText, data)
}

var standIns = struct {
	mu sync.Mutex
	m  map[string]*standIn // by printer id
}{m: map[string]*standIn{}}

// endpointFor is how the bridge reaches a printer: itself for Moonraker, its
// stand-in for any other kind. The same printer always gets the same stand-in
// (so comparing endpoints tells whether a printer changed).
func endpointFor(p Printer) Printer {
	if p.Kind == "" {
		return p
	}
	standIns.mu.Lock()
	defer standIns.mu.Unlock()
	s := standIns.m[p.ID]
	if s != nil && s.printer != p {
		// Its address or password changed: start over.
		s.close()
		s = nil
	}
	if s == nil {
		var err error
		s, err = startStandIn(p)
		if err != nil {
			// Unreachable on purpose: the session says it can't reach the printer.
			return Printer{ID: p.ID, Name: p.Name, URL: "http://127.0.0.1:1", shown: p.URL}
		}
		standIns.m[p.ID] = s
	}
	return Printer{ID: p.ID, Name: p.Name, URL: s.url, shown: p.URL}
}

// forgetStandIn stops a removed printer's stand-in.
func forgetStandIn(id string) {
	standIns.mu.Lock()
	defer standIns.mu.Unlock()
	if s := standIns.m[id]; s != nil {
		s.close()
		delete(standIns.m, id)
	}
}

func startStandIn(p Printer) (*standIn, error) {
	b, err := newBrand(p)
	if err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := &standIn{printer: p, b: b, url: "http://" + ln.Addr().String(), clients: map[*standInClient]bool{}, wake: make(chan struct{}, 1), every: pollEvery}
	mux := http.NewServeMux()
	mux.HandleFunc("/websocket", s.serveWebsocket)
	mux.HandleFunc("/printer/info", s.servePrinterInfo)
	mux.HandleFunc("/server/files/upload", s.serveUpload)
	mux.HandleFunc("/server/files/gcodes/", s.serveThumbnail)
	mux.HandleFunc("/camera/", s.serveCamera)
	s.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = s.srv.Serve(ln) }()
	return s, nil
}

func (s *standIn) close() { _ = s.srv.Close() }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *standIn) info(ctx context.Context) (map[string]any, error) {
	host, software, err := s.b.about(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"state": "ready", "state_message": "Printer is ready", "hostname": host, "software_version": software, "brand": s.printer.Kind}, nil
}

func (s *standIn) servePrinterInfo(w http.ResponseWriter, r *http.Request) {
	info, err := s.info(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": map[string]any{"message": err.Error()}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": info})
}

func (s *standIn) serveWebsocket(w http.ResponseWriter, r *http.Request) {
	// Only a printer that answers gets a connection, so the Device tab says when it can't be reached.
	objects, err := s.b.status(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	ws, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	ws.SetReadLimit(1 << 20)
	c := &standInClient{ws: ws, ctx: r.Context(), subs: map[string]bool{}}
	s.mu.Lock()
	if s.objects == nil {
		s.objects = objects
	}
	s.clients[c] = true
	if !s.polling {
		s.polling = true
		go s.poll()
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.clients, c)
		s.mu.Unlock()
		ws.CloseNow()
	}()
	for {
		_, data, err := ws.Read(r.Context())
		if err != nil {
			return
		}
		var msg rpc
		if json.Unmarshal(data, &msg) != nil || msg.Method == "" {
			continue
		}
		go func() {
			result, err := s.call(r.Context(), c, msg.Method, msg.Params)
			if len(msg.ID) == 0 {
				return
			}
			if err != nil {
				code := -32000
				if errors.Is(err, errNoMethod) {
					code = -32601
				}
				c.write(map[string]any{"jsonrpc": "2.0", "id": msg.ID, "error": map[string]any{"code": code, "message": err.Error()}})
				return
			}
			c.write(map[string]any{"jsonrpc": "2.0", "id": msg.ID, "result": result})
		}()
	}
}

var errNoMethod = errors.New("method not found")

// poll asks the printer how it is while anyone is connected, and sends each
// client what changed in the objects it subscribed to.
func (s *standIn) poll() {
	failed := false
	if f, ok := s.b.(follower); ok {
		ctx, stop := context.WithCancel(context.Background())
		defer stop()
		go f.follow(ctx, s.reply)
	}
	for {
		select {
		case <-time.After(s.every):
		case <-s.wake:
		}
		s.mu.Lock()
		if len(s.clients) == 0 {
			s.polling = false
			s.objects = nil
			s.mu.Unlock()
			return
		}
		s.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		objects, err := s.b.status(ctx)
		cancel()
		if err != nil {
			if failed {
				continue
			}
			// Like Klipper going away: the page shows the printer isn't answering and keeps waiting.
			failed = true
			s.mu.Lock()
			prev := s.objects
			s.mu.Unlock()
			objects = cloneObjects(prev)
			objects["webhooks"] = map[string]any{"state": "error", "state_message": "The printer stopped answering: " + err.Error()}
		} else {
			failed = false
		}
		s.mu.Lock()
		diff := diffObjects(s.objects, objects)
		s.objects = objects
		clients := make([]*standInClient, 0, len(s.clients))
		for c := range s.clients {
			clients = append(clients, c)
		}
		s.mu.Unlock()
		if len(diff) == 0 {
			continue
		}
		now := float64(time.Now().UnixMilli()) / 1000
		for _, c := range clients {
			c.mu.Lock()
			mine := map[string]any{}
			for k, v := range diff {
				if c.subs[k] {
					mine[k] = v
				}
			}
			c.mu.Unlock()
			if len(mine) > 0 {
				c.write(map[string]any{"jsonrpc": "2.0", "method": "notify_status_update", "params": []any{mine, now}})
			}
		}
	}
}

// reply passes on a line the printer said, like Moonraker's console replies.
func (s *standIn) reply(line string) {
	s.mu.Lock()
	clients := make([]*standInClient, 0, len(s.clients))
	for c := range s.clients {
		clients = append(clients, c)
	}
	s.mu.Unlock()
	for _, c := range clients {
		c.write(map[string]any{"jsonrpc": "2.0", "method": "notify_gcode_response", "params": []any{line}})
	}
}

// soon asks the printer again right away (after a command, so the page shows it at once).
func (s *standIn) soon() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func cloneObjects(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// diffObjects is what changed from old to new, field by field, like Moonraker's own updates.
func diffObjects(old, new map[string]any) map[string]any {
	out := map[string]any{}
	for name, v := range new {
		nv, ok := v.(map[string]any)
		ov, _ := old[name].(map[string]any)
		if !ok {
			continue
		}
		changed := map[string]any{}
		for k, x := range nv {
			if y, had := ov[k]; !had || !reflect.DeepEqual(x, y) {
				changed[k] = x
			}
		}
		if len(changed) > 0 {
			out[name] = changed
		}
	}
	return out
}

// subset is the objects (and fields) a subscribe or query asks for.
func subset(objects map[string]any, want map[string]any) map[string]any {
	out := map[string]any{}
	for name, fields := range want {
		o, ok := objects[name].(map[string]any)
		if !ok {
			continue
		}
		list, _ := fields.([]any)
		if len(list) == 0 {
			out[name] = o
			continue
		}
		part := map[string]any{}
		for _, f := range list {
			if k, ok := f.(string); ok {
				if v, had := o[k]; had {
					part[k] = v
				}
			}
		}
		out[name] = part
	}
	return out
}

func (s *standIn) current(ctx context.Context) (map[string]any, error) {
	s.mu.Lock()
	objects := s.objects
	s.mu.Unlock()
	if objects != nil {
		return objects, nil
	}
	return s.b.status(ctx)
}

func gcodePath(p string) string { return strings.TrimPrefix(strings.TrimLeft(p, "/"), "gcodes/") }

func (s *standIn) call(ctx context.Context, c *standInClient, method string, params json.RawMessage) (any, error) {
	var p struct {
		Filename string         `json:"filename"`
		Path     string         `json:"path"`
		Objects  map[string]any `json:"objects"`
		Script   string         `json:"script"`
		Message  map[string]any `json:"message"`
	}
	_ = json.Unmarshal(params, &p)
	done := func(err error) (any, error) {
		if err != nil {
			return nil, err
		}
		s.soon()
		return "ok", nil
	}
	switch method {
	case "server.info":
		return map[string]any{"klippy_connected": true, "klippy_state": "ready", "components": []string{}, "failed_components": []string{}, "moonraker_version": "cloud-slicer-bridge " + version}, nil
	case "printer.info":
		return s.info(ctx)
	case "printer.objects.list":
		objects, err := s.current(ctx)
		if err != nil {
			return nil, err
		}
		names := make([]string, 0, len(objects))
		for k := range objects {
			names = append(names, k)
		}
		return map[string]any{"objects": names}, nil
	case "printer.objects.subscribe", "printer.objects.query":
		objects, err := s.current(ctx)
		if err != nil {
			return nil, err
		}
		if method == "printer.objects.subscribe" {
			c.mu.Lock()
			c.subs = map[string]bool{}
			for name := range p.Objects {
				c.subs[name] = true
			}
			c.mu.Unlock()
		}
		return map[string]any{"eventtime": float64(time.Now().UnixMilli()) / 1000, "status": subset(objects, p.Objects)}, nil
	case "printer.print.start":
		return done(s.b.start(ctx, gcodePath(p.Filename)))
	case "printer.print.pause":
		return done(s.b.pause(ctx))
	case "printer.print.resume":
		return done(s.b.resume(ctx))
	case "printer.print.cancel":
		return done(s.b.cancel(ctx))
	case "server.files.list":
		files, err := s.b.files(ctx)
		if err != nil {
			return nil, err
		}
		if files == nil {
			files = []brandFile{}
		}
		return files, nil
	case "server.files.metadata":
		return s.b.metadata(ctx, gcodePath(p.Filename))
	case "server.files.delete_file":
		path := gcodePath(p.Path)
		if err := s.b.remove(ctx, path); err != nil {
			return nil, err
		}
		s.filesChanged("delete_file", path)
		return map[string]any{"item": map[string]any{"root": "gcodes", "path": path}, "action": "delete_file"}, nil
	case "server.webcams.list":
		return s.webcams(ctx)
	case "printer.request":
		r, ok := s.b.(requester)
		if !ok {
			return nil, fmt.Errorf("%w: %s", errNoMethod, method)
		}
		out, err := r.request(ctx, p.Message)
		if err != nil {
			return nil, err
		}
		s.soon()
		return out, nil
	case "printer.gcode.script", "printer.emergency_stop", "printer.firmware_restart":
		cmd, ok := s.b.(commander)
		if !ok {
			return nil, fmt.Errorf("%s don't take commands like this from Cloud Slicer: use the printer's screen.", s.b.noun())
		}
		switch method {
		case "printer.gcode.script":
			return done(cmd.gcode(ctx, p.Script))
		case "printer.emergency_stop":
			return done(cmd.emergencyStop(ctx))
		}
		return done(cmd.restart(ctx))
	}
	return nil, fmt.Errorf("%w: %s", errNoMethod, method)
}

// webcams lists the printer's cameras the way Moonraker does, at addresses
// on the stand-in (the bridge only fetches cameras from the printer's own
// host, which is the stand-in's), which pass them on.
func (s *standIn) webcams(ctx context.Context) (any, error) {
	list := []any{}
	cam, ok := s.b.(camerer)
	if !ok {
		return map[string]any{"webcams": list}, nil
	}
	cams, err := cam.cameras(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.cams = cams
	s.mu.Unlock()
	for i, c := range cams {
		at := func(which, raw string) string {
			if raw == "" {
				return ""
			}
			return fmt.Sprintf("%s/camera/%d/%s", s.url, i, which)
		}
		list = append(list, map[string]any{
			"name": c.Name, "uid": fmt.Sprintf("%s-%d", s.printer.Kind, i), "enabled": true, "service": "mjpegstreamer-adaptive",
			"stream_url": at("stream", c.Stream), "snapshot_url": at("snapshot", c.Snapshot), "target_fps": 15,
			"flip_horizontal": c.FlipH, "flip_vertical": c.FlipV, "rotation": c.Rotation, "aspect_ratio": "16:9",
		})
	}
	return map[string]any{"webcams": list}, nil
}

// serveCamera passes on one camera's stream or picture (/camera/<n>/stream|snapshot).
func (s *standIn) serveCamera(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/camera/"), "/")
	cam, ok := s.b.(camerer)
	if !ok || len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	i, err := strconv.Atoi(parts[0])
	s.mu.Lock()
	cams := s.cams
	s.mu.Unlock()
	if cams == nil {
		if cams, err = cam.cameras(r.Context()); err == nil {
			s.mu.Lock()
			s.cams = cams
			s.mu.Unlock()
		}
	}
	if err != nil || i < 0 || i >= len(cams) {
		http.NotFound(w, r)
		return
	}
	raw := cams[i].Snapshot
	if parts[1] == "stream" {
		raw = cams[i].Stream
	}
	if raw == "" {
		http.NotFound(w, r)
		return
	}
	res, err := cam.cameraOpen(r.Context(), raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(res.StatusCode)
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 32<<10)
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

// filesChanged tells every client the G-code folder changed, as Moonraker does.
func (s *standIn) filesChanged(action, path string) {
	s.mu.Lock()
	clients := make([]*standInClient, 0, len(s.clients))
	for c := range s.clients {
		clients = append(clients, c)
	}
	s.mu.Unlock()
	for _, c := range clients {
		c.write(map[string]any{"jsonrpc": "2.0", "method": "notify_filelist_changed", "params": []any{map[string]any{"action": action, "item": map[string]any{"root": "gcodes", "path": path}}}})
	}
}

// serveUpload takes Moonraker's upload form and streams the file to the printer.
// The bridge's own uploads (upload.go) build the form with multipartParts, so
// the file's size is the body's length without that form: no copy is kept here.
func (s *standIn) serveUpload(w http.ResponseWriter, r *http.Request) {
	fail := func(status int, err error) {
		writeJSON(w, status, map[string]any{"error": map[string]any{"code": status, "message": err.Error()}})
	}
	if r.Method != http.MethodPost {
		fail(http.StatusMethodNotAllowed, errors.New("POST only"))
		return
	}
	_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || params["boundary"] == "" {
		fail(http.StatusBadRequest, errors.New("Not a file upload."))
		return
	}
	mr, err := r.MultipartReader()
	if err != nil {
		fail(http.StatusBadRequest, err)
		return
	}
	for {
		part, err := mr.NextPart()
		if err != nil {
			fail(http.StatusBadRequest, errors.New("The upload has no file."))
			return
		}
		if part.FormName() != "file" {
			continue
		}
		// The whole path, folders too (FileName keeps only its last part).
		name := part.FileName()
		if _, dp, err := mime.ParseMediaType(part.Header.Get("Content-Disposition")); err == nil && dp["filename"] != "" {
			name = strings.TrimLeft(dp["filename"], "/")
		}
		head, tail := multipartParts(params["boundary"], name)
		size := r.ContentLength - int64(len(head)) - int64(len(tail))
		if r.ContentLength <= 0 || size < 0 {
			fail(http.StatusLengthRequired, errors.New("The upload has no length."))
			return
		}
		if err := s.b.upload(r.Context(), name, part, size); err != nil {
			fail(http.StatusBadGateway, err)
			return
		}
		s.filesChanged("create_file", name)
		writeJSON(w, http.StatusCreated, map[string]any{"result": map[string]any{"item": map[string]any{"path": name, "root": "gcodes"}, "action": "create_file"}})
		return
	}
}

func (s *standIn) serveThumbnail(w http.ResponseWriter, r *http.Request) {
	buf, ct, err := s.b.thumbnail(r.Context(), strings.TrimPrefix(r.URL.Path, "/server/files/gcodes/"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Length", strconv.Itoa(len(buf)))
	_, _ = w.Write(buf)
}

// findPrinter finds the printer at an address, of the given kind, or of any
// kind the bridge knows when kind is "" (Moonraker first). It gives the
// address to keep, the printer's own name and its kind.
func findPrinter(ctx context.Context, address, key, kind string) (string, string, string, error) {
	if kind == "" || kind == "moonraker" {
		url, info, err := probeAddress(ctx, address, key)
		if err == nil {
			name, _ := info["hostname"].(string)
			return url, name, "", nil
		}
		if kind == "moonraker" {
			return "", "", "", err
		}
		// Not Moonraker: maybe another kind. Its own answer wins only when it is one.
		// Elegoo last: it waits for an answer the longest.
		for _, k := range []string{kindPrusaLink, kindOctoPrint, kindBambu, kindElegoo} {
			url, name, perr := probeKind(ctx, k, address, key)
			if perr == nil {
				return url, name, k, nil
			}
			if errors.As(perr, new(*probeError)) {
				return "", "", k, perr
			}
		}
		return "", "", "", err
	}
	if kind == kindPrusaLink || kind == kindOctoPrint || kind == kindElegoo || kind == kindBambu {
		url, name, err := probeKind(ctx, kind, address, key)
		return url, name, kind, err
	}
	return "", "", "", fmt.Errorf("This bridge doesn't know printers of kind %q: update the bridge.", kind)
}

func probeKind(ctx context.Context, kind, address, key string) (string, string, error) {
	switch kind {
	case kindOctoPrint:
		return probeOctoPrint(ctx, address, key)
	case kindElegoo:
		return probeElegoo(ctx, address)
	case kindBambu:
		return probeBambu(ctx, address, key)
	}
	return probePrusaLink(ctx, address, key)
}
