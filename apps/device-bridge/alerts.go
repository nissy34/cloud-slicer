package main

// Print alerts: which moments of a print are worth telling someone about. The
// same rules as the browser's (apps/web/src/device/alerts.ts), checked against
// the same cases (testdata/alert-cases.json). The relay says what to look for
// ({ctl:"alerts"}); the bridge watches each such printer itself (watch.go), so
// alerts come with every browser closed.

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	almostDoneS     = 600
	bedCoolC        = 40.0
	bedWarmMarginC  = 5.0
	bedCoolGiveUp   = 4 * time.Hour
	errorSuppresses = time.Minute
)

// maxAlertCameras is the most cameras one alert's picture joins (a 2×2 grid).
const maxAlertCameras = 4

// cameraList is which of the printer's cameras (names, in its order) an alert's
// picture comes from: the chosen ones it has, or its first camera when it has none
// of them ("*" in the defaults, or choices carried over from another printer).
// Same as camerasFor in the browser (testdata/camera-cases.json).
func cameraList(chosen, names []string) []string {
	if len(chosen) == 0 || len(names) == 0 {
		return nil
	}
	var hit []string
	for _, n := range names {
		for _, c := range chosen {
			if n == c {
				hit = append(hit, n)
				break
			}
		}
	}
	if len(hit) == 0 {
		hit = names[:1]
	}
	if len(hit) > maxAlertCameras {
		hit = hit[:maxAlertCameras]
	}
	return hit
}

// alertWatch is what the relay asked to look for on one printer, over everyone watching it.
type alertWatch struct {
	Events   []string `json:"events"`
	Layers   []int    `json:"layers"`
	Percents []int    `json:"percents"`
	Hours    bool     `json:"hours"`
	// Cameras holds, for each alert, every different choice of cameras someone asked for:
	// one picture is sent per choice, keyed by its names joined with newlines.
	Cameras map[string][][]string `json:"cameras"`
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

// printDetails is where the print stands when an alert goes out (as PrintDetails in the browser).
type printDetails struct {
	Percent  *int     `json:"percent,omitempty"`
	Layer    *int     `json:"layer,omitempty"`
	Total    *int     `json:"total,omitempty"`
	Left     *int     `json:"left,omitempty"`
	Printed  *int     `json:"printed,omitempty"`
	Estimate *int     `json:"estimate,omitempty"`
	UsedMm   *int     `json:"usedMm,omitempty"`
	TotalMm  *int     `json:"totalMm,omitempty"`
	TotalG   *float64 `json:"totalG,omitempty"`
	Runout   string   `json:"runout,omitempty"`
}

// fileFacts is what the G-code file says about the whole print (Moonraker's file metadata).
type fileFacts struct {
	Estimate *float64 `json:"estimate"`
	TotalMm  *float64 `json:"totalMm"`
	TotalG   *float64 `json:"totalG"`
}

func factsFrom(m map[string]any) fileFacts {
	pos := func(v any) *float64 {
		if f, ok := v.(float64); ok && f > 0 && !math.IsInf(f, 0) {
			return &f
		}
		return nil
	}
	return fileFacts{Estimate: pos(m["estimated_time"]), TotalMm: pos(m["filament_total"]), TotalG: pos(m["filament_weight_total"])}
}

// runoutFrom names what ran out: the active head on printers whose feeders report per head (U1), else the one empty sensor.
func runoutFrom(objects map[string]any) string {
	names := make([]string, 0, len(objects))
	for n := range objects {
		names = append(names, n)
	}
	sort.Strings(names)
	if ext, ok := obj(objects, "toolhead")["extruder"].(string); ok && strings.HasPrefix(ext, "extruder") {
		head, err := strconv.Atoi(strings.TrimPrefix(ext, "extruder"))
		if ext == "extruder" {
			head, err = 0, nil
		}
		if err == nil {
			for _, n := range names {
				if !strings.HasPrefix(n, "filament_feed ") {
					continue
				}
				if ch, ok := obj(objects, n)["extruder"+strconv.Itoa(head)].(map[string]any); ok && ch["filament_detected"] == false {
					return "T" + strconv.Itoa(head+1)
				}
			}
		}
	}
	var empty []string
	for _, n := range names {
		if !strings.HasPrefix(n, "filament_switch_sensor ") && !strings.HasPrefix(n, "filament_motion_sensor ") {
			continue
		}
		m := obj(objects, n)
		if m["enabled"] != false && m["filament_detected"] == false {
			empty = append(empty, n)
		}
	}
	if len(empty) == 1 {
		return strings.ReplaceAll(empty[0][strings.Index(empty[0], " ")+1:], "_", " ")
	}
	return ""
}

// detailsFrom reads printDetails from the printer's objects and the file's facts (as detailsOf in the browser).
func detailsFrom(objects map[string]any, f fileFacts) printDetails {
	s := snapshotFrom(objects, f.Estimate)
	r := func(v *float64) *int {
		if v == nil || *v < 0 || math.IsNaN(*v) || math.IsInf(*v, 0) {
			return nil
		}
		return roundp(v)
	}
	fp := func(v float64) *float64 { return &v }
	d := printDetails{Layer: s.Layer, Total: s.TotalLayers, Left: r(s.Left), Estimate: r(f.Estimate), TotalMm: r(f.TotalMm)}
	if f.TotalG != nil {
		g := math.Round(*f.TotalG*10) / 10
		d.TotalG = &g
	}
	if s.State != "standby" {
		d.Percent = r(fp(math.Min(1, s.Progress) * 100))
		d.Printed = r(fp(s.Duration))
		if used, ok := num(obj(objects, "print_stats")["filament_used"]); ok && used > 0 {
			d.UsedMm = r(&used)
		}
	}
	if isActive(s.State) {
		d.Runout = runoutFrom(objects)
	}
	return d
}
