package main

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

// The bridge running in the background keeps a small status file next to its
// settings, so the app opened by hand (Start menu, Applications) can say how it
// is doing without a connection of its own. It is rewritten every minute while
// the bridge runs; an older one means the bridge isn't running.

const statusFileEvery = time.Minute

type bridgeStatus struct {
	// State: "online", "offline" (no relay: the internet), "refused" (turned off or blocked in Cloud Slicer).
	State    string   `json:"state"`
	Reason   string   `json:"reason,omitempty"`
	Printers []string `json:"printers"`
	Build    string   `json:"build"`
	At       int64    `json:"at"`
}

func statusPath(configPath string) string { return configPath + ".status" }

type statusWriter struct {
	cfg  *Config
	path string
	mu   sync.Mutex
	last bridgeStatus
}

func newStatusWriter(cfg *Config, configPath string) *statusWriter {
	return &statusWriter{cfg: cfg, path: statusPath(configPath), last: bridgeStatus{State: "offline"}}
}

func (w *statusWriter) set(state, reason string) {
	w.mu.Lock()
	w.last.State, w.last.Reason = state, reason
	w.mu.Unlock()
	w.write()
}

func (w *statusWriter) write() {
	w.mu.Lock()
	s := w.last
	w.mu.Unlock()
	s.Printers = []string{}
	for _, p := range w.cfg.printerList() {
		s.Printers = append(s.Printers, p["name"])
	}
	s.Build, s.At = build, time.Now().Unix()
	data, _ := json.Marshal(s)
	_ = os.WriteFile(w.path+".new", data, 0o600)
	_ = os.Rename(w.path+".new", w.path)
}

// keepWriting rewrites the file every minute until stop is closed. It stays behind
// (soon too old to count): another copy taking over writes its own.
func (w *statusWriter) keepWriting(stop <-chan struct{}) {
	t := time.NewTicker(statusFileEvery)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			w.write()
		case <-stop:
			return
		}
	}
}

// readStatus is the background bridge's last status; ok is false when it isn't running.
func readStatus(configPath string) (s bridgeStatus, ok bool) {
	data, err := os.ReadFile(statusPath(configPath))
	if err != nil || json.Unmarshal(data, &s) != nil {
		return s, false
	}
	return s, time.Since(time.Unix(s.At, 0)) < 3*statusFileEvery
}
