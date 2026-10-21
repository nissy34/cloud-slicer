package main

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

// The same cases as the browser's rules (apps/web/src/device/alerts.test.ts).
func TestAlertCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/alert-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Base  map[string]any `json:"base"`
		Cases []struct {
			Name   string           `json:"name"`
			Watch  alertWatch       `json:"watch"`
			Steps  []map[string]any `json:"steps"`
			Expect []map[string]any `json:"expect"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	for _, c := range doc.Cases {
		t.Run(c.Name, func(t *testing.T) {
			w := &alertWatcher{}
			state := map[string]any{}
			for k, v := range doc.Base {
				state[k] = v
			}
			got := []map[string]any{}
			for i, step := range c.Steps {
				for k, v := range step {
					if k != "at" {
						state[k] = v
					}
				}
				data, _ := json.Marshal(state)
				var s printSnapshot
				if err := json.Unmarshal(data, &s); err != nil {
					t.Fatal(err)
				}
				at := time.UnixMilli(int64(step["at"].(float64)))
				for _, a := range w.update(s, c.Watch, at) {
					data, _ := json.Marshal(a)
					m := map[string]any{"step": float64(i)}
					_ = json.Unmarshal(data, &m)
					got = append(got, m)
				}
			}
			for i := range got {
				if i >= len(c.Expect) || c.Expect[i]["file"] == nil {
					delete(got[i], "file")
				}
			}
			if len(got) == 0 && len(c.Expect) == 0 {
				return
			}
			if !reflect.DeepEqual(got, c.Expect) {
				g, _ := json.MarshalIndent(got, "", " ")
				e, _ := json.MarshalIndent(c.Expect, "", " ")
				t.Fatalf("got\n%s\nwant\n%s", g, e)
			}
		})
	}
}

func TestSnapshotFromObjects(t *testing.T) {
	objects := map[string]any{}
	_ = json.Unmarshal([]byte(`{
		"webhooks": {"state": "ready", "state_message": "Printer is ready"},
		"print_stats": {"state": "printing", "filename": "x.gcode", "print_duration": 100, "info": {"current_layer": 3, "total_layer": 9}, "message": ""},
		"virtual_sdcard": {"progress": 0.25},
		"heater_bed": {"temperature": 61.2, "target": 60},
		"filament_switch_sensor e0": {"enabled": true, "filament_detected": false},
		"filament_motion_sensor m": {"enabled": false, "filament_detected": false}
	}`), &objects)
	est := 1000.0
	s := snapshotFrom(objects, &est)
	if s.State != "printing" || s.File != "x.gcode" || s.Progress != 0.25 || s.Duration != 100 || *s.Layer != 3 || *s.TotalLayers != 9 || *s.Bed != 61.2 || !s.NoFilament || *s.Left != 750 || s.Klippy != "ready" {
		t.Fatalf("snapshot %+v", s)
	}
	empty := snapshotFrom(map[string]any{}, nil)
	if empty.State != "standby" || empty.Klippy != "ready" || empty.Layer != nil || empty.Bed != nil || empty.Left != nil {
		t.Fatalf("empty snapshot %+v", empty)
	}
}
