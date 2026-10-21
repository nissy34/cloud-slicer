package main

// Print alerts: which moments of a print are worth telling someone about. The
// same rules as the browser's (apps/web/src/device/alerts.ts), checked against
// the same cases (testdata/alert-cases.json). The relay says what to look for
// ({ctl:"alerts"}); the bridge watches each such printer itself (watch.go), so
// alerts come with every browser closed.

import (
	"math"
	"sort"
	"time"
)

const (
	almostDoneS     = 600
	bedCoolC        = 40.0
	bedWarmMarginC  = 5.0
	bedCoolGiveUp   = 4 * time.Hour
	errorSuppresses = time.Minute
)

// pictureEvents carry a camera picture, when the printer has a camera.
var pictureEvents = map[string]bool{"layer1": true, "layer3": true, "layer": true, "paused": true, "failed": true, "error": true, "almostDone": true, "finished": true}

// alertWatch is what the relay asked to look for on one printer, over everyone watching it.
type alertWatch struct {
	Events   []string `json:"events"`
	Layers   []int    `json:"layers"`
	Percents []int    `json:"percents"`
	Hours    bool     `json:"hours"`
	Pictures bool     `json:"pictures"`
}

func (w alertWatch) wants(event string) bool {
	for _, e := range w.Events {
		if e == event {
			return true
		}
	}
	return false
}

// printSnapshot is the printer at one moment, reduced to what the rules look at.
type printSnapshot struct {
	Klippy        string   `json:"klippy"`
	KlippyMessage string   `json:"klippyMessage"`
	State         string   `json:"state"`
	File          string   `json:"file"`
	Progress      float64  `json:"progress"`
	Duration      float64  `json:"duration"`
	Layer         *int     `json:"layer"`
	TotalLayers   *int     `json:"totalLayers"`
	Bed           *float64 `json:"bed"`
	NoFilament    bool     `json:"noFilament"`
	Left          *float64 `json:"left"`
	Message       string   `json:"message"`
}

// firedAlert is one alert, as sent to the relay (with the printer id and maybe a picture added).
type firedAlert struct {
	Event    string `json:"event"`
	File     string `json:"file"`
	Layer    *int   `json:"layer,omitempty"`
	Total    *int   `json:"total,omitempty"`
	Percent  *int   `json:"percent,omitempty"`
	Left     *int   `json:"left,omitempty"`
	Duration *int   `json:"duration,omitempty"`
	Hours    *int   `json:"hours,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

func intp(v int) *int { return &v }

func roundp(v *float64) *int {
	if v == nil {
		return nil
	}
	return intp(int(math.Round(*v)))
}

func isActive(state string) bool { return state == "printing" || state == "paused" }

// alertWatcher follows one printer. The first snapshot only sets the scene, so
// a watcher that starts mid-print never repeats what already passed;
// thresholds fire when crossed.
type alertWatcher struct {
	prev       *printSnapshot
	almostDone bool
	cooling    *struct {
		since time.Time
		file  string
	}
	lastError time.Time
}

func (w *alertWatcher) reset() { w.prev = nil }

func (w *alertWatcher) update(s printSnapshot, watch alertWatch, now time.Time) []firedAlert {
	p := w.prev
	w.prev = &s
	if p == nil {
		return nil
	}
	var out []firedAlert
	file := s.File

	if p.Klippy == "ready" && (s.Klippy == "shutdown" || s.Klippy == "error") {
		out = append(out, firedAlert{Event: "error", File: file, Reason: s.KlippyMessage})
		w.lastError = now
	}

	was := isActive(p.State)
	reasonOr := func(r string) string {
		if s.NoFilament {
			return "filament"
		}
		return r
	}
	switch {
	case s.State == "printing" && !was:
		w.almostDone = false
		w.cooling = nil
		out = append(out, firedAlert{Event: "started", File: file, Left: roundp(s.Left), Total: s.TotalLayers})
	case s.State == "printing" && p.State == "paused":
		out = append(out, firedAlert{Event: "resumed", File: file, Left: roundp(s.Left)})
	case s.State == "paused" && p.State == "printing":
		out = append(out, firedAlert{Event: "paused", File: file, Layer: s.Layer, Reason: reasonOr(s.Message)})
	case was && s.State == "complete":
		out = append(out, firedAlert{Event: "finished", File: file, Duration: intp(int(math.Round(s.Duration)))})
		if s.Bed != nil && *s.Bed >= bedCoolC+bedWarmMarginC {
			w.cooling = &struct {
				since time.Time
				file  string
			}{now, file}
		}
	case was && s.State == "cancelled":
		out = append(out, firedAlert{Event: "failed", File: file, Reason: "cancelled", Layer: s.Layer})
	case was && s.State == "error" && now.Sub(w.lastError) > errorSuppresses:
		out = append(out, firedAlert{Event: "failed", File: file, Reason: s.Message, Layer: s.Layer})
	}

	if s.State == "printing" && p.State == "printing" && s.File == p.File {
		left := roundp(s.Left)
		if p.Layer != nil && s.Layer != nil {
			crossed := func(t int) bool { return *p.Layer < t && *s.Layer >= t }
			// Layer N is done once layer N + 1 starts.
			if crossed(2) {
				out = append(out, firedAlert{Event: "layer1", File: file, Layer: intp(1), Total: s.TotalLayers, Left: left})
			}
			if crossed(4) {
				out = append(out, firedAlert{Event: "layer3", File: file, Layer: intp(3), Total: s.TotalLayers, Left: left})
			}
			layers := append([]int(nil), watch.Layers...)
			sort.Ints(layers)
			for i, n := range layers {
				if (i == 0 || layers[i-1] != n) && crossed(n+1) {
					out = append(out, firedAlert{Event: "layer", File: file, Layer: intp(n), Total: s.TotalLayers, Left: left})
				}
			}
		}
		best := -1
		for _, x := range watch.Percents {
			if p.Progress*100 < float64(x) && s.Progress*100 >= float64(x) && x > best {
				best = x
			}
		}
		if best >= 0 {
			out = append(out, firedAlert{Event: "progress", File: file, Percent: intp(best), Left: left})
		}
		if watch.Hours {
			h := int(math.Floor(s.Duration / 3600))
			if h >= 1 && h > int(math.Floor(p.Duration/3600)) {
				out = append(out, firedAlert{Event: "stillPrinting", File: file, Hours: intp(h), Duration: intp(int(math.Round(s.Duration))), Left: left})
			}
		}
		if !w.almostDone && s.Left != nil && p.Left != nil && *s.Left <= almostDoneS && *p.Left > almostDoneS && s.Progress >= 0.5 {
			w.almostDone = true
			out = append(out, firedAlert{Event: "almostDone", File: file, Left: left})
		}
	}

	if w.cooling != nil {
		if isActive(s.State) || now.Sub(w.cooling.since) > bedCoolGiveUp {
			w.cooling = nil
		} else if s.Bed != nil && *s.Bed < bedCoolC {
			out = append(out, firedAlert{Event: "bedCooled", File: w.cooling.file})
			w.cooling = nil
		}
	}
	return out
}

// remainingSeconds is the time left: the slicer's estimate scaled by progress
// when the file has one, otherwise extrapolated (as the Device tab shows it).
func remainingSeconds(state string, progress, printed float64, estimate *float64) *float64 {
	if !isActive(state) {
		return nil
	}
	f := func(v float64) *float64 { v = math.Max(0, v); return &v }
	switch {
	case !(progress > 0):
		return estimate
	case progress >= 1:
		return f(0)
	case estimate != nil && *estimate > 0:
		return f(*estimate * (1 - progress))
	case printed > 0:
		return f(printed/progress - printed)
	}
	return nil
}
