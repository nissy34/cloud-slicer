package main

import (
	"encoding/json"
	"strings"
)

// The Moonraker calls the bridge passes on: exactly what the Device tab uses.
// Everything else is refused, so a browser key (or the relay) can't reach the
// parts of Moonraker that go beyond running the printer: its API keys and
// users (access.*), the sudo password and system updates (machine.*), or
// moving files into the config folder. A new Device tab feature that needs
// another call adds it here, and older bridges say they need an update.
var allowed = map[string]bool{
	"printer.info":              true,
	"server.info":               true,
	"printer.objects.list":      true,
	"printer.objects.subscribe": true,
	"printer.objects.query":     true,
	"printer.gcode.script":      true,
	"printer.print.start":       true,
	"printer.print.pause":       true,
	"printer.print.resume":      true,
	"printer.print.cancel":      true,
	"printer.emergency_stop":    true,
	"printer.firmware_restart":  true,
	"server.files.list":         true,
	"server.files.metadata":     true,
	"server.files.delete_file":  true,
	"server.webcams.list":       true,
	"server.exception.query":    true,
	// The U1's own camera: turns the monitor picture on for a while.
	"camera.start_monitor": true,
	// A printer the bridge stands in for, in its own language (a Bambu Lab
	// print with its AMS slots); Moonraker itself has no such call.
	"printer.request": true,
}

// requests are the printer's own commands a page may send with printer.request,
// by message part and command. Anything else (firmware updates, settings, the
// printer's own access code) stays with the maker's apps.
var requests = map[string]map[string]bool{
	// A Bambu Lab .gcode.3mf print, with its AMS slots and the checks before it.
	"print": {"project_file": true},
}

// refusal says why a browser's call isn't passed on, or "" when it may go to the printer.
func refusal(method string, params json.RawMessage) string {
	if !allowed[method] {
		return "The bridge does not pass on " + method + ". If the Device tab needs it, update the bridge."
	}
	// Deleting stays inside the G-code folder: never the printer's config files.
	if method == "server.files.delete_file" {
		var p struct {
			Path string `json:"path"`
		}
		_ = json.Unmarshal(params, &p)
		if !strings.HasPrefix(strings.TrimLeft(p.Path, "/"), "gcodes/") || strings.Contains(p.Path, "..") {
			return "The bridge only deletes files in the G-code folder."
		}
	}
	if method == "printer.request" {
		var p struct {
			Message map[string]struct {
				Command string `json:"command"`
			} `json:"message"`
		}
		_ = json.Unmarshal(params, &p)
		for part, body := range p.Message {
			if !requests[part][body.Command] {
				return "The bridge does not pass on the printer command " + part + "." + body.Command + ". If the Device tab needs it, update the bridge."
			}
		}
	}
	return ""
}
