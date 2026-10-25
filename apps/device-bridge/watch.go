package main

// The bridge's own quiet watch on a printer, for print alerts: one Moonraker
// websocket per printer someone wants alerts from, kept open whether or not a
// browser is connected. It stays on the home network; only the alerts
// themselves (a few small messages per print) go to the relay.

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The objects the rules look at; filament sensors and feeders are added from the printer's own list.
var watchObjects = []string{"webhooks", "print_stats", "virtual_sdcard", "display_status", "heater_bed"}

// watchPrefixes: per-printer objects that say what ran out of filament.
var watchPrefixes = []string{"filament_switch_sensor ", "filament_motion_sensor ", "filament_feed "}

// problemEvents carry the printer's own errors (the U1's or a Bambu Lab's error codes), when it has any.
var problemEvents = map[string]bool{"paused": true, "failed": true, "error": true}

// watchEvery: the most often the rules run (Moonraker sends temperatures several times a second).
const watchEvery = time.Second

func num(v any) (float64, bool) {
	f, ok := v.(float64)
	return f, ok
}

func obj(objects map[string]any, name string) map[string]any {
	m, _ := objects[name].(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

func str(v any, d string) string {
	if s, ok := v.(string); ok {
		return s
	}
	return d
}

// snapshotFrom reduces Moonraker's printer objects to what the alert rules look at (as snapshotOf in the browser).
func snapshotFrom(objects map[string]any, estimate *float64) printSnapshot {
	ps := obj(objects, "print_stats")
	info, _ := ps["info"].(map[string]any)
	s := printSnapshot{
		Klippy:        str(obj(objects, "webhooks")["state"], "ready"),
		KlippyMessage: str(obj(objects, "webhooks")["state_message"], ""),
		State:         "standby",
		File:          str(ps["filename"], ""),
		Message:       str(ps["message"], ""),
	}
	switch st := str(ps["state"], ""); st {
	case "standby", "printing", "paused", "complete", "cancelled", "error":
		s.State = st
	}
	if p, ok := num(obj(objects, "virtual_sdcard")["progress"]); ok {
		s.Progress = p
	} else if p, ok := num(obj(objects, "display_status")["progress"]); ok {
		s.Progress = p
	}
	s.Duration, _ = num(ps["print_duration"])
	if v, ok := num(info["current_layer"]); ok {
		s.Layer = intp(int(v))
	}
	if v, ok := num(info["total_layer"]); ok {
		s.TotalLayers = intp(int(v))
	}
	if v, ok := num(obj(objects, "heater_bed")["temperature"]); ok {
		s.Bed = &v
	}
	for name, v := range objects {
		if !strings.HasPrefix(name, "filament_switch_sensor ") && !strings.HasPrefix(name, "filament_motion_sensor ") {
			continue
		}
		m, _ := v.(map[string]any)
		if m["enabled"] != false && m["filament_detected"] == false {
			s.NoFilament = true
		}
	}
	s.Left = remainingSeconds(s.State, s.Progress, s.Duration, estimate)
	return s
}

// printerWatch keeps one printer watched while the relay asks for it.
type printerWatch struct {
	printer Printer
	send    func(map[string]any)
	log     func(string)

	ctx    context.Context
	cancel context.CancelFunc

	mu    sync.Mutex
	watch alertWatch
}

func newPrinterWatch(p Printer, w alertWatch, send func(map[string]any), log func(string)) *printerWatch {
	ctx, cancel := context.WithCancel(context.Background())
	pw := &printerWatch{printer: p, watch: w, send: send, log: log, ctx: ctx, cancel: cancel}
	go pw.loop()
	return pw
}

func (pw *printerWatch) setWatch(w alertWatch) {
	pw.mu.Lock()
	pw.watch = w
	pw.mu.Unlock()
}

func (pw *printerWatch) current() alertWatch {
	pw.mu.Lock()
	defer pw.mu.Unlock()
	return pw.watch
}

func (pw *printerWatch) stop() { pw.cancel() }

func (pw *printerWatch) loop() {
	retries := 0
	for pw.ctx.Err() == nil {
		started := time.Now()
		pw.once()
		if pw.ctx.Err() != nil {
			return
		}
		if time.Since(started) > time.Minute {
			retries = 0
		}
		delay := time.Duration(min(60, 2<<min(retries, 5))) * time.Second
		retries++
		select {
		case <-time.After(delay):
		case <-pw.ctx.Done():
			return
		}
	}
}

// moonrakerConn is a small JSON-RPC client over one Moonraker websocket.
type moonrakerConn struct {
	ws      *websocket.Conn
	mu      sync.Mutex
	seq     int
	pending map[int]chan rpcAnswer
}

type rpcAnswer struct {
	Result json.RawMessage
	Err    bool
}

func (c *moonrakerConn) call(ctx context.Context, method string, params any) (json.RawMessage, bool) {
	c.mu.Lock()
	c.seq++
	id := c.seq
	ch := make(chan rpcAnswer, 1)
	c.pending[id] = ch
	c.mu.Unlock()
	data, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if c.ws.Write(ctx, websocket.MessageText, data) != nil {
		return nil, false
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	select {
	case a := <-ch:
		return a.Result, !a.Err
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, false
	}
}

// once runs one connection to the printer until it drops.
func (pw *printerWatch) once() {
	s := &Session{printer: pw.printer, ctx: pw.ctx}
	wsURL := "ws" + strings.TrimPrefix(pw.printer.URL, "http") + "/websocket"
	if pw.printer.APIKey != "" {
		token, err := s.oneshotToken()
		if err != nil {
			return
		}
		wsURL += "?token=" + url.QueryEscape(token)
	}
	ctx, cancel := context.WithTimeout(pw.ctx, 10*time.Second)
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	cancel()
	if err != nil {
		return
	}
	defer ws.CloseNow()
	ws.SetReadLimit(16 << 20)
	conn := &moonrakerConn{ws: ws, pending: map[int]chan rpcAnswer{}}
	// Roomy, so a slow call (file metadata, a camera picture) never holds up its own answer.
	notes := make(chan []byte, 1024)
	go func() {
		defer close(notes)
		for {
			_, data, err := ws.Read(pw.ctx)
			if err != nil {
				return
			}
			var m struct {
				ID     *int            `json:"id"`
				Result json.RawMessage `json:"result"`
				Error  json.RawMessage `json:"error"`
			}
			if json.Unmarshal(data, &m) == nil && m.ID != nil {
				conn.mu.Lock()
				ch := conn.pending[*m.ID]
				delete(conn.pending, *m.ID)
				conn.mu.Unlock()
				if ch != nil {
					ch <- rpcAnswer{m.Result, len(m.Error) > 0}
				}
				continue
			}
			select {
			case notes <- data:
			case <-pw.ctx.Done():
				return
			}
		}
	}()

	watcher := &alertWatcher{}
	objects := map[string]any{}
	var facts fileFacts
	factsFor := ""
	// The U1's current errors ("exceptions"); other printers don't have the call.
	var exceptions json.RawMessage
	hasExceptions := false
	queryExceptions := func() {
		res, ok := conn.call(pw.ctx, "server.exception.query", map[string]any{})
		hasExceptions = ok
		var e struct {
			Exceptions json.RawMessage `json:"exceptions"`
		}
		if ok && json.Unmarshal(res, &e) == nil {
			exceptions = e.Exceptions
		}
	}
	subscribe := func() bool {
		list, ok := conn.call(pw.ctx, "printer.objects.list", map[string]any{})
		if !ok {
			return false
		}
		var l struct {
			Objects []string `json:"objects"`
		}
		_ = json.Unmarshal(list, &l)
		want := map[string]any{}
		for _, o := range watchObjects {
			want[o] = nil
		}
		// Only which head is in use: the rest of the toolhead changes many times a second.
		want["toolhead"] = []string{"extruder"}
		for _, o := range l.Objects {
			if o == "bambu" {
				// A Bambu Lab printer's own errors, passed on as they are for the relay to put in words.
				want[o] = []string{"print_error", "hms"}
			}
			for _, p := range watchPrefixes {
				if strings.HasPrefix(o, p) {
					want[o] = nil
				}
			}
		}
		res, ok := conn.call(pw.ctx, "printer.objects.subscribe", map[string]any{"objects": want})
		if !ok {
			return false
		}
		var r struct {
			Status map[string]any `json:"status"`
		}
		_ = json.Unmarshal(res, &r)
		objects = r.Status
		exceptions = nil
		queryExceptions()
		watcher.reset()
		return true
	}
	var last time.Time
	dirty := false
	tick := time.NewTicker(watchEvery)
	defer tick.Stop()
	evaluate := func() {
		dirty = false
		last = time.Now()
		file := str(obj(objects, "print_stats")["filename"], "")
		if file != factsFor {
			factsFor, facts = file, fileFacts{}
			if file != "" {
				if res, ok := conn.call(pw.ctx, "server.files.metadata", map[string]any{"filename": file}); ok {
					var m map[string]any
					if json.Unmarshal(res, &m) == nil {
						facts = factsFrom(m)
					}
				}
			}
		}
		w := pw.current()
		for _, a := range watcher.update(snapshotFrom(objects, facts.Estimate), w, last) {
			if !w.wants(a.Event) {
				continue
			}
			msg := map[string]any{"ctl": "alert", "printer": pw.printer.ID}
			data, _ := json.Marshal(a)
			_ = json.Unmarshal(data, &msg)
			msg["details"] = detailsFrom(objects, facts)
			if problemEvents[a.Event] && hasExceptions {
				// The error may land just after the pause: ask again rather than wait for its notice.
				queryExceptions()
			}
			if problemEvents[a.Event] && len(exceptions) > 2 && len(exceptions) < 8192 {
				msg["exceptions"] = exceptions
			}
			if b, ok := objects["bambu"].(map[string]any); ok && problemEvents[a.Event] {
				msg["bambu"] = map[string]any{"print_error": b["print_error"], "hms": b["hms"]}
			}
			if w.Pictures && pictureEvents[a.Event] {
				if pic := pw.picture(conn); pic != "" {
					msg["picture"] = pic
				}
			}
			pw.send(msg)
		}
	}
	// The state the subscription answers with sets the scene. Klippy may still be
	// starting: then Moonraker answers later, with notify_klippy_ready.
	if subscribe() {
		evaluate()
	}
	for {
		select {
		case <-pw.ctx.Done():
			return
		case <-tick.C:
			if dirty && time.Since(last) >= watchEvery {
				evaluate()
			}
		case data, ok := <-notes:
			if !ok {
				return
			}
			var n struct {
				Method string            `json:"method"`
				Params []json.RawMessage `json:"params"`
			}
			if json.Unmarshal(data, &n) != nil {
				continue
			}
			switch n.Method {
			case "notify_status_update":
				var diff map[string]any
				if len(n.Params) > 0 && json.Unmarshal(n.Params[0], &diff) == nil {
					mergeDiff(objects, diff)
					// A change of print state is worth looking at at once; temperatures can wait a second.
					if _, ps := diff["print_stats"]; ps || diff["webhooks"] != nil {
						evaluate()
					} else {
						dirty = true
					}
				}
			case "notify_klippy_shutdown":
				mergeDiff(objects, map[string]any{"webhooks": map[string]any{"state": "shutdown"}})
				evaluate()
			case "notify_exception_status":
				var e struct {
					Exceptions json.RawMessage `json:"exceptions"`
				}
				if len(n.Params) > 0 && json.Unmarshal(n.Params[0], &e) == nil {
					exceptions = e.Exceptions
				}
			case "notify_klippy_ready":
				if subscribe() {
					evaluate()
				}
			}
		}
	}
}

// picture is one frame from the printer's first camera, base64, or "" when it has none.
func (pw *printerWatch) picture(conn *moonrakerConn) string {
	res, ok := conn.call(pw.ctx, "server.webcams.list", map[string]any{})
	if !ok {
		return ""
	}
	var r struct {
		Webcams []struct {
			Enabled     *bool  `json:"enabled"`
			SnapshotURL string `json:"snapshot_url"`
		} `json:"webcams"`
	}
	_ = json.Unmarshal(res, &r)
	s := &Session{printer: pw.printer, ctx: pw.ctx}
	for _, c := range r.Webcams {
		if (c.Enabled != nil && !*c.Enabled) || c.SnapshotURL == "" {
			continue
		}
		frame, err := s.snapshot(c.SnapshotURL)
		if err != nil {
			continue
		}
		if m, ok := frame.(map[string]any); ok {
			if data, ok := m["data"].(string); ok && len(data) < 800*1024 {
				return data
			}
		}
		return ""
	}
	return ""
}
