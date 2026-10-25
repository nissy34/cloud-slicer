package main

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/nissy34/cloud-slicer/apps/device-bridge/internal/fakebambu"
)

// newFakeBambu starts a pretend Bambu Lab printer (internal/fakebambu) and
// points the bridge at its ports and certificate authority.
func newFakeBambu(t *testing.T) *fakebambu.Printer {
	f, err := fakebambu.Start()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.Close)
	oldMQTT, oldFTP, oldCam, oldRoots := bambuMQTTPort, bambuFTPPort, bambuCameraPort, bambuRoots
	bambuMQTTPort, bambuFTPPort, bambuCameraPort = f.MQTT, f.FTP, f.Camera
	bambuRoots = x509.NewCertPool()
	bambuRoots.AppendCertsFromPEM(f.CAPEM)
	t.Cleanup(func() { bambuMQTTPort, bambuFTPPort, bambuCameraPort, bambuRoots = oldMQTT, oldFTP, oldCam, oldRoots })
	return f
}

func TestBambuCAEmbedded(t *testing.T) {
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(bambuCAPEM) {
		t.Fatal("bambu_ca.pem has no certificates")
	}
}

func TestFindBambu(t *testing.T) {
	newFakeBambu(t)
	ctx := context.Background()
	// Without the access code: found, and asks for it.
	var pe *probeError
	if _, _, err := probeBambu(ctx, "127.0.0.1", ""); !errors.As(err, &pe) || !pe.needsKey || !strings.Contains(err.Error(), "access code") {
		t.Fatalf("no code: %v", err)
	}
	if _, _, err := probeBambu(ctx, "127.0.0.1", "wrong"); !errors.As(err, &pe) || !pe.needsKey || !strings.Contains(err.Error(), "did not accept") {
		t.Fatalf("wrong code: %v", err)
	}
	url, name, kind, err := findPrinter(ctx, "127.0.0.1", fakebambu.Code, kindBambu)
	if err != nil || kind != kindBambu || url != "http://127.0.0.1" || name != "Bambu Lab "+fakebambu.Serial {
		t.Fatalf("found %q %q %q %v", url, name, kind, err)
	}
}

func TestBambuOnlyTrustsBambuCertificates(t *testing.T) {
	newFakeBambu(t)
	bambuRoots = x509.NewCertPool()
	bambuRoots.AppendCertsFromPEM(bambuCAPEM) // the real one only: the pretend printer's isn't from it
	if _, err := bambuSerial(context.Background(), "127.0.0.1"); !errors.Is(err, errNotBambu) {
		t.Fatalf("a certificate not from Bambu Lab passed: %v", err)
	}
}

func TestParseBambuNotify(t *testing.T) {
	f, ok := parseBambuNotify(fakebambu.Notify("192.168.1.40", "Workshop P1S"), "192.168.1.40")
	if !ok || f.URL != "http://192.168.1.40" || f.Name != "Workshop P1S" || f.Kind != kindBambu || !f.NeedsKey {
		t.Fatalf("found %+v %v", f, ok)
	}
	if _, ok := parseBambuNotify([]byte("NOTIFY * HTTP/1.1\r\nNT: upnp:rootdevice\r\n\r\n"), "10.0.0.2"); ok {
		t.Fatal("another device taken for a Bambu printer")
	}
}

func TestDiscoverBambu(t *testing.T) {
	// A free port in place of 2021, which a slicer on this computer may hold.
	probe, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	port := probe.LocalAddr().(*net.UDPAddr).Port
	probe.Close()
	old := bambuFindPort
	bambuFindPort = port
	t.Cleanup(func() { bambuFindPort = old })
	go func() {
		conn, err := net.Dial("udp4", fmt.Sprintf("127.0.0.1:%d", port))
		if err != nil {
			return
		}
		defer conn.Close()
		for i := 0; i < 10; i++ {
			time.Sleep(100 * time.Millisecond)
			_, _ = conn.Write(fakebambu.Notify("127.0.0.1", "Pretend P1S"))
		}
	}()
	list := discoverBambu(context.Background(), 1500*time.Millisecond)
	if len(list) != 1 || list[0].Name != "Pretend P1S" || list[0].Kind != kindBambu {
		t.Fatalf("found %+v", list)
	}
}

func TestBambuStandIn(t *testing.T) {
	old := pollEvery
	pollEvery = 50 * time.Millisecond
	t.Cleanup(func() { pollEvery = old })
	f := newFakeBambu(t)
	p := Printer{ID: "p1s", Name: "P1S", URL: "http://127.0.0.1", APIKey: fakebambu.Code, Kind: kindBambu}
	ep := endpointFor(p)
	t.Cleanup(func() { forgetStandIn(p.ID) })
	if _, info, err := probeAddress(context.Background(), ep.URL, ""); err != nil || info["brand"] != kindBambu || info["software_version"] != "Bambu Lab firmware 01.08.02.00" {
		t.Fatalf("printer.info: %v %v", info, err)
	}
	c := dialStandIn(t, ep.URL)
	sub := c.must("printer.objects.subscribe", map[string]any{"objects": map[string]any{"webhooks": nil, "extruder": nil, "heater_bed": nil, "temperature_sensor chamber": nil, "print_stats": nil}}).(map[string]any)["status"].(map[string]any)
	if sub["extruder"].(map[string]any)["temperature"] != 25.0 || sub["heater_bed"].(map[string]any)["temperature"] != 26.0 || sub["temperature_sensor chamber"].(map[string]any)["temperature"] != 24.0 || sub["print_stats"].(map[string]any)["state"] != "standby" {
		t.Fatalf("subscribe %v", sub)
	}

	// Temperatures, in Marlin's words.
	c.must("printer.gcode.script", map[string]any{"script": "SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60"})
	c.until("bed heating", func(d map[string]any) bool {
		bed, _ := d["heater_bed"].(map[string]any)
		return bed["target"] == 60.0
	})
	// It doesn't say what is homed: homing from here is remembered.
	c.must("printer.gcode.script", map[string]any{"script": "G28"})
	if th := c.must("printer.objects.query", map[string]any{"objects": map[string]any{"toolhead": nil}}).(map[string]any)["status"].(map[string]any)["toolhead"].(map[string]any); th["homed_axes"] != "xyz" {
		t.Fatalf("homed after G28: %v", th)
	}
	if _, err := c.call("printer.gcode.script", map[string]any{"script": "SET_LED LED=x WHITE=1"}); err == nil || !strings.Contains(err.Error(), "Bambu Lab printers") {
		t.Fatalf("Klipper command: %v", err)
	}

	// Its camera, as pictures from the P1/A1 stream.
	cams := c.must("server.webcams.list", nil).(map[string]any)["webcams"].([]any)
	if len(cams) != 1 {
		t.Fatalf("webcams %v", cams)
	}
	s := newSession("c1", ep, func(string) {}, func(string) {})
	t.Cleanup(s.close)
	shot := cams[0].(map[string]any)["snapshot_url"].(string)
	if buf, _, err := s.frame(shot); err != nil || !bytes.Equal(buf, fakebambu.Picture) {
		t.Fatalf("camera picture %q %v", buf, err)
	}

	// Upload over FTPS.
	data := []byte("G28\nG1 X10\nM84\n")
	begin, err := s.uploadBegin("cube.gcode", int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	id := begin.(map[string]any)["uploadId"].(string)
	if _, err := s.uploadChunk(id, 0, base64.StdEncoding.EncodeToString(data)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadEnd(id); err != nil {
		t.Fatal(err)
	}
	if got := string(f.Files()["cube.gcode"]); got != string(data) {
		t.Fatalf("printer got %q", got)
	}
	files := fmt.Sprint(c.must("server.files.list", nil))
	if !strings.Contains(files, "cube.gcode") || !strings.Contains(files, "benchy.gcode") {
		t.Fatalf("files %v", files)
	}

	// Print, pause, resume, cancel.
	c.must("printer.print.start", map[string]any{"filename": "cube.gcode"})
	c.until("printing", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "printing" && ps["filename"] == "cube.gcode"
	})
	meta := c.must("server.files.metadata", map[string]any{"filename": "cube.gcode"}).(map[string]any)
	if est, _ := meta["estimated_time"].(float64); est < 42*60 {
		t.Fatalf("metadata %v", meta)
	}
	c.must("printer.print.pause", nil)
	c.until("paused", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "paused"
	})
	c.must("printer.print.resume", nil)
	c.until("printing again", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "printing"
	})
	c.must("printer.print.cancel", nil)
	c.until("cancelled", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "cancelled"
	})

	// Without Developer Mode the printer refuses: the reason, and how to fix it.
	f.Refuse("gcode_file")
	if _, err := c.call("printer.print.start", map[string]any{"filename": "cube.gcode"}); err == nil || !strings.Contains(err.Error(), "verify failed") || !strings.Contains(err.Error(), "Developer Mode") {
		t.Fatalf("refused start: %v", err)
	}

	c.must("server.files.delete_file", map[string]any{"path": "gcodes/cube.gcode"})
	if _, kept := f.Files()["cube.gcode"]; kept {
		t.Fatal("the file is still on the printer")
	}
	want := []string{"print.gcode_line: M140 S60", "print.gcode_line: G28", "print.gcode_file: /sdcard/cube.gcode", "print.pause", "print.resume", "print.stop", "print.gcode_file: /sdcard/cube.gcode"}
	if got := f.Commands(); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("commands %q, want %q", got, want)
	}
}

func TestBambuState(t *testing.T) {
	for _, c := range []struct {
		state string
		err   float64
		want  string
	}{{"IDLE", 0, "standby"}, {"PREPARE", 0, "printing"}, {"RUNNING", 0, "printing"}, {"PAUSE", 0, "paused"}, {"FINISH", 0, "complete"}, {"FAILED", 0, "cancelled"}, {"FAILED", 0x0300400C, "error"}} {
		if got := bambuState(map[string]any{"gcode_state": c.state, "print_error": c.err}); got != c.want {
			t.Errorf("%s/%v: %s, want %s", c.state, c.err, got, c.want)
		}
	}
	if got := bambuFile(map[string]any{"gcode_file": "/data/Metadata/plate_1.gcode", "subtask_name": "Benchy"}); got != "Benchy" {
		t.Errorf("project file %q", got)
	}
	if got := bambuFile(map[string]any{"gcode_file": "/sdcard/cube.gcode", "subtask_name": "cube"}); got != "cube.gcode" {
		t.Errorf("plain file %q", got)
	}
}

func TestHomedAfter(t *testing.T) {
	for _, c := range []struct {
		before string
		lines  []string
		want   string
	}{{"", []string{"G28"}, "xyz"}, {"", []string{"G28 X Y"}, "xy"}, {"x", []string{"G28 Z"}, "xz"}, {"xyz", []string{"M84"}, ""}, {"xyz", []string{"G1 X10"}, "xyz"}} {
		if got := homedAfter(c.before, c.lines); got != c.want {
			t.Errorf("%q after %q: %q, want %q", c.before, c.lines, got, c.want)
		}
	}
}

func TestBambuPassesItsOwnMessages(t *testing.T) {
	old := pollEvery
	pollEvery = 50 * time.Millisecond
	t.Cleanup(func() { pollEvery = old })
	f := newFakeBambu(t)
	p := Printer{ID: "p1s-raw", Name: "P1S", URL: "http://127.0.0.1", APIKey: fakebambu.Code, Kind: kindBambu}
	ep := endpointFor(p)
	t.Cleanup(func() { forgetStandIn(p.ID) })
	c := dialStandIn(t, ep.URL)

	// The printer's own report, untouched, for the page to read its AMS.
	raw := c.must("printer.objects.subscribe", map[string]any{"objects": map[string]any{"bambu": nil, "print_stats": nil}}).(map[string]any)["status"].(map[string]any)["bambu"].(map[string]any)
	trays := raw["ams"].(map[string]any)["ams"].([]any)[0].(map[string]any)["tray"].([]any)
	if len(trays) != 4 || trays[2].(map[string]any)["tray_color"] != "C12E1FFF" {
		t.Fatalf("ams %v", raw["ams"])
	}

	// The page's message goes to the printer as it is.
	s := newSession("c1", ep, func(string) {}, func(string) {})
	t.Cleanup(s.close)
	data := []byte("PK")
	begin, err := s.uploadBegin("cube.gcode.3mf", int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	id := begin.(map[string]any)["uploadId"].(string)
	if _, err := s.uploadChunk(id, 0, base64.StdEncoding.EncodeToString(data)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.uploadEnd(id); err != nil {
		t.Fatal(err)
	}
	msg := map[string]any{"print": map[string]any{"command": "project_file", "param": "Metadata/plate_2.gcode", "url": "file:///sdcard/cube.gcode.3mf",
		"use_ams": true, "ams_mapping": []any{0, 2}, "bed_leveling": false}}
	c.must("printer.request", map[string]any{"message": msg})
	got := f.Last("project_file")
	if got == nil || got["param"] != "Metadata/plate_2.gcode" || fmt.Sprint(got["ams_mapping"]) != "[0 2]" || got["bed_leveling"] != false || got["sequence_id"] == nil {
		t.Fatalf("printer got %v", got)
	}
	c.until("printing", func(d map[string]any) bool {
		ps, _ := d["print_stats"].(map[string]any)
		return ps["state"] == "printing"
	})

	// Its refusal comes back.
	f.Refuse("project_file")
	if _, err := c.call("printer.request", map[string]any{"message": msg}); err == nil || !strings.Contains(err.Error(), "verify failed") {
		t.Fatalf("refused: %v", err)
	}
	if _, err := c.call("printer.request", map[string]any{"message": map[string]any{"print": map[string]any{}}}); err == nil {
		t.Fatal("a message without a command went through")
	}
}
