package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type bridgeOptions struct {
	log        func(string)
	find       func(context.Context) []found
	onReplaced func()
	// uninstall removes the bridge from this computer when the Device tab asks; nil if it can't.
	uninstall func()
	// autoUpdate: check for and install new versions (the copy that starts with the computer).
	autoUpdate bool
	// onConnected runs each time the relay has taken the hello.
	onConnected func()
	// onState is told how the relay connection is: "online", "offline" or "refused", and why.
	onState func(state, reason string)
}

// Bridge is the connection to the relay and every browser session over it.
type Bridge struct {
	cfg  *Config
	opts bridgeOptions

	ctx    context.Context
	cancel context.CancelFunc

	mu       sync.Mutex
	relay    *websocket.Conn
	sessions map[string]*Session
	// Printers watched for print alerts, by printer id (watch.go).
	watches map[string]*printerWatch
}

// relayMessage is what the relay and the agent send each other: control messages
// ({ctl: open|close|drop|hello}) and browser messages wrapped as {c: session, m: text}.
type relayMessage struct {
	Ctl     string `json:"ctl,omitempty"`
	C       string `json:"c,omitempty"`
	M       string `json:"m,omitempty"`
	Printer string `json:"printer,omitempty"`
	Reason  string `json:"reason,omitempty"`
	// {ctl:"alerts"}: what to watch for on each printer, for print alerts.
	Printers map[string]alertWatch `json:"printers,omitempty"`
}

// runBridge connects to the relay and keeps reconnecting until stop.
func runBridge(cfg *Config, opts bridgeOptions) *Bridge {
	if opts.log == nil {
		opts.log = func(string) {}
	}
	if opts.onState == nil {
		opts.onState = func(string, string) {}
	}
	if opts.find == nil {
		opts.find = func(ctx context.Context) []found { return discover(ctx, opts.log) }
		// On the printer itself it serves that printer only.
		if _, ok := installedOnPrinter(); ok {
			opts.find = func(ctx context.Context) []found { return discoverOwn(ctx, opts.log) }
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	b := &Bridge{cfg: cfg, opts: opts, ctx: ctx, cancel: cancel, sessions: map[string]*Session{}, watches: map[string]*printerWatch{}}
	go b.loop()
	if opts.autoUpdate {
		go b.autoUpdate()
	}
	return b
}

func (b *Bridge) stop() {
	b.cancel()
	b.closeSessions()
	b.setAlerts(nil)
}

// setAlerts starts, changes and stops the printers' alert watches to match what the relay asks.
func (b *Bridge) setAlerts(want map[string]alertWatch) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for id, w := range b.watches {
		if _, ok := want[id]; !ok || b.ctx.Err() != nil {
			w.stop()
			delete(b.watches, id)
		}
	}
	if b.ctx.Err() != nil {
		return
	}
	for id, aw := range want {
		printer, ok := b.cfg.printer(id)
		if w := b.watches[id]; w != nil {
			if ok && w.printer == printer {
				w.setWatch(aw)
				continue
			}
			// Its address or key changed (or it's gone): start over.
			w.stop()
			delete(b.watches, id)
		}
		if !ok {
			continue
		}
		b.watches[id] = newPrinterWatch(printer, aw, func(msg map[string]any) { b.toRelay(msg) }, b.opts.log)
	}
}

func (b *Bridge) closeSessions() {
	b.mu.Lock()
	all := b.sessions
	b.sessions = map[string]*Session{}
	b.mu.Unlock()
	for _, s := range all {
		s.close()
	}
}

func (b *Bridge) toRelay(v any) {
	b.mu.Lock()
	ws := b.relay
	b.mu.Unlock()
	if ws == nil {
		return
	}
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	_ = ws.Write(b.ctx, websocket.MessageText, data)
}

func goosName() string {
	switch runtime.GOOS {
	case "windows":
		return "win32"
	default:
		return runtime.GOOS // linux, darwin
	}
}

var notHostChars = regexp.MustCompile(`\.(local|lan|home)$`)

// shortHost is this computer's name without the local-network suffix, for "Bridge on <name>".
func shortHost() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	return notHostChars.ReplaceAllString(h, "")
}

func (b *Bridge) hello() {
	msg := map[string]any{"ctl": "hello", "version": version, "build": build, "system": goosName(), "host": shortHost(), "printers": b.cfg.printerList()}
	// On the printer itself, so the Device tab's help fits (restart the printer, not a computer).
	if _, ok := installedOnPrinter(); ok {
		msg["place"] = "printer"
	}
	b.toRelay(msg)
}

func (b *Bridge) loop() {
	retries := 0
	for b.ctx.Err() == nil {
		code, reason, connected := b.connectOnce()
		if b.ctx.Err() != nil {
			return
		}
		if connected {
			retries = 0
		}
		// Another copy of this bridge (a second window, or the one running in the background) took
		// over: retrying would only take it back, and the two would swap forever.
		if code == 4000 {
			b.opts.log("Another copy of this bridge is running on this computer and took over, so this one stops.")
			b.cancel()
			if b.opts.onReplaced != nil {
				b.opts.onReplaced()
			}
			return
		}
		delay := time.Duration(math.Min(60_000, 2000*math.Pow(2, math.Min(float64(retries), 5)))) * time.Millisecond
		retries++
		// Refused (turned off, blocked, removed, or never set up): asking again soon won't change that.
		if code == 4003 || code == 4410 {
			b.opts.log("The relay refused this bridge: " + reason)
			b.opts.onState("refused", reason)
			delay = 10 * time.Minute
		} else {
			b.opts.onState("offline", reason)
		}
		why := ""
		if reason != "" {
			why = " (" + reason + ")"
		}
		b.opts.log(fmt.Sprintf("Relay connection closed%s; retrying in %d s.", why, int(delay.Seconds())))
		select {
		case <-time.After(delay):
		case <-b.ctx.Done():
			return
		}
	}
}

// connectOnce runs one relay connection to its end, and says how it closed.
func (b *Bridge) connectOnce() (code int, reason string, connected bool) {
	u := strings.Replace(b.cfg.Relay, "http", "ws", 1) + "/v1/bridges/" + url.PathEscape(b.cfg.BridgeID) + "/agent?key=" + url.QueryEscape(b.cfg.Key)
	ctx, cancel := context.WithTimeout(b.ctx, 20*time.Second)
	ws, _, err := websocket.Dial(ctx, u, nil)
	cancel()
	if err != nil {
		return 0, shortError(err), false
	}
	ws.SetReadLimit(2 << 20)
	b.mu.Lock()
	b.relay = ws
	b.mu.Unlock()
	names := []string{}
	for _, p := range b.cfg.printerList() {
		names = append(names, p["name"])
	}
	serving := strings.Join(names, ", ")
	if serving == "" {
		serving = "no printers yet"
	}
	b.opts.log(fmt.Sprintf("Connected to the relay (%s). Serving: %s", b.cfg.Relay, serving))
	b.hello()
	b.opts.onState("online", "")
	if b.opts.onConnected != nil {
		b.opts.onConnected()
	}

	for {
		_, data, err := ws.Read(b.ctx)
		if err != nil {
			b.mu.Lock()
			b.relay = nil
			b.mu.Unlock()
			b.closeSessions()
			var ce websocket.CloseError
			if errors.As(err, &ce) {
				return int(ce.Code), ce.Reason, true
			}
			ws.CloseNow()
			return 0, "", true
		}
		var msg relayMessage
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		b.handle(msg)
	}
}

func shortError(err error) string {
	s := err.Error()
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

func (b *Bridge) handle(msg relayMessage) {
	switch {
	case msg.Ctl == "alerts":
		b.setAlerts(msg.Printers)
	case msg.Ctl == "open":
		printer, ok := b.cfg.printer(msg.Printer)
		if !ok {
			b.toRelay(relayMessage{Ctl: "drop", C: msg.C, Reason: "This bridge no longer has that printer."})
			return
		}
		c := msg.C
		var s *Session
		dropSession := func(reason string) {
			b.mu.Lock()
			if b.sessions[c] == s {
				delete(b.sessions, c)
			}
			b.mu.Unlock()
			s.close()
			b.toRelay(relayMessage{Ctl: "drop", C: c, Reason: reason})
		}
		s = newSession(c, printer, func(text string) { b.toRelay(relayMessage{C: c, M: text}) }, dropSession)
		s.log = b.opts.log
		b.mu.Lock()
		old := b.sessions[c]
		b.sessions[c] = s
		b.mu.Unlock()
		if old != nil {
			old.close()
		}
		go func() {
			if err := s.open(); err != nil {
				dropSession(err.Error())
			}
		}()
	case msg.Ctl == "close":
		b.mu.Lock()
		s := b.sessions[msg.C]
		delete(b.sessions, msg.C)
		b.mu.Unlock()
		if s != nil {
			s.close()
		}
	case msg.C != "" && msg.M != "":
		b.mu.Lock()
		s := b.sessions[msg.C]
		b.mu.Unlock()
		if s != nil {
			s.fromBrowser(msg.M)
			return
		}
		// A window with no printer chosen: the Device tab managing this bridge.
		var call rpc
		if json.Unmarshal([]byte(msg.M), &call) != nil || len(call.ID) == 0 {
			return
		}
		c := msg.C
		go func() {
			result, err := b.manage(call.Method, call.Params)
			var out []byte
			if err != nil {
				out, _ = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": call.ID, "error": map[string]any{"code": -32000, "message": err.Error()}})
			} else {
				out, _ = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": result})
			}
			b.toRelay(relayMessage{C: c, M: string(out)})
		}()
	}
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n]
	}
	return s
}

// manage answers the calls that find, add and remove this bridge's printers from the Device tab.
func (b *Bridge) manage(method string, params json.RawMessage) (any, error) {
	var p struct {
		Address string `json:"address"`
		APIKey  string `json:"apiKey"`
		Name    string `json:"name"`
		ID      string `json:"id"`
	}
	_ = json.Unmarshal(params, &p)
	switch method {
	case "bridge.discover":
		b.opts.log("Looking for printers on the network for the Device tab...")
		list := b.opts.find(b.ctx)
		out := make([]map[string]any, 0, len(list))
		b.cfg.mu.Lock()
		for _, f := range list {
			var added any
			for _, x := range b.cfg.Printers {
				if x.URL == f.URL {
					added = x.ID
				}
			}
			out = append(out, map[string]any{"url": f.URL, "name": f.Name, "needsKey": f.NeedsKey, "added": added})
		}
		b.cfg.mu.Unlock()
		return map[string]any{"printers": out}, nil
	case "bridge.add_printer":
		address, apiKey := clip(p.Address, 200), clip(p.APIKey, 200)
		if address == "" {
			return nil, errors.New("Type the printer's address.")
		}
		url, info, err := probeAddress(b.ctx, address, apiKey)
		if err != nil {
			var pe *probeError
			if errors.As(err, &pe) && pe.needsKey {
				if apiKey != "" {
					return nil, errors.New("The printer did not accept that API key.")
				}
				return nil, errors.New("This printer needs its Moonraker API key.")
			}
			return nil, fmt.Errorf("No printer answered at %s. Check the address, and that the printer is on.", address)
		}
		name := p.Name
		if name == "" {
			name, _ = info["hostname"].(string)
		}
		if name == "" {
			name = address
		}
		printer := b.cfg.upsert(clip(name, 80), url, apiKey)
		if err := b.save(); err != nil {
			return nil, err
		}
		b.opts.log(fmt.Sprintf("Added %s (%s) from the Device tab.", printer.Name, url))
		b.hello()
		return map[string]any{"id": printer.ID, "name": printer.Name}, nil
	case "bridge.remove_printer":
		printer, ok := b.cfg.remove(p.ID, false)
		if !ok {
			return map[string]any{"removed": false}, nil
		}
		if err := b.save(); err != nil {
			return nil, err
		}
		b.mu.Lock()
		var gone []*Session
		for c, s := range b.sessions {
			if s.printer.ID == printer.ID {
				gone = append(gone, s)
				delete(b.sessions, c)
			}
		}
		b.mu.Unlock()
		for _, s := range gone {
			s.close()
			b.toRelay(relayMessage{Ctl: "drop", C: s.id, Reason: "This printer was removed from the bridge."})
		}
		b.mu.Lock()
		if w := b.watches[printer.ID]; w != nil {
			w.stop()
			delete(b.watches, printer.ID)
		}
		b.mu.Unlock()
		b.opts.log("Removed " + printer.Name + " from the Device tab.")
		b.hello()
		return map[string]any{"removed": true}, nil
	case "bridge.update":
		b.opts.log("Asked from the Device tab to update.")
		u, err := b.prepareUpdate()
		if errors.Is(err, errUpToDate) {
			return map[string]any{"upToDate": true}, nil
		}
		if err != nil {
			return nil, err
		}
		// Answer first, then restart into it.
		time.AfterFunc(300*time.Millisecond, func() {
			if err := b.applyUpdate(u); err != nil {
				b.opts.log("Update: " + err.Error())
			}
		})
		return map[string]any{"updating": true, "build": u.build}, nil
	case "bridge.uninstall":
		if b.opts.uninstall == nil {
			return nil, errors.New("This bridge can't remove itself: remove it on its computer.")
		}
		b.opts.log("Removed from the Device tab: uninstalling this bridge.")
		// Answer first, then go.
		time.AfterFunc(300*time.Millisecond, func() {
			b.stop()
			b.opts.uninstall()
		})
		return map[string]any{"uninstalling": true}, nil
	}
	return nil, errors.New("Unknown bridge call " + method)
}

func (b *Bridge) save() error {
	b.cfg.mu.Lock()
	defer b.cfg.mu.Unlock()
	return b.cfg.save()
}
