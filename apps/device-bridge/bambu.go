package main

// Bambu Lab printers (X1, P1, A1, H2, P2S, ...) on the local network, the way
// Bambu Studio talks to them in LAN mode: MQTT over TLS on port 8883 (user
// "bblp", the access code from the printer's screen as password), on the
// topics device/<serial>/report and device/<serial>/request; files over FTPS
// (implicit TLS, port 990, the same login); and on P1 and A1 a camera on port
// 6000 that sends JPEG pictures (X1, H2 and P2S stream RTSP video instead,
// which the bridge can't show). Every reply comes on the report topic: the
// full status after "pushall", then the parts that changed, and each command's
// result under its sequence_id. The serial is the name on the printer's
// certificate, which Bambu Lab's own CA signed (bambu_ca.pem), so an address
// and an access code are all it takes. Printers say they're there with SSDP on
// UDP port 2021 (Bambu Studio's search).
//
// Since Bambu's 2025 firmware ("Authorization Control"), a printer only takes
// prints and G-code from programs other than Bambu's own in LAN Only mode with
// Developer Mode on; without it, it still reports how it is, and refuses the
// commands with a reason, which the bridge passes on. Commands are never
// signed: the bridge has no key of Bambu's and doesn't want one.
//
// Source: OpenBambuAPI (github.com/Doridian/OpenBambuAPI): mqtt.md, ftp.md,
// video.md, tls.md.

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/eclipse/paho.mqtt.golang/packets"
	"github.com/jlaffaye/ftp"
)

const kindBambu = "bambu"

// The printer's ports: MQTT, FTPS, the P1/A1 camera, and where printers say
// they're there. Tests move them with CLOUD_SLICER_BAMBU_PORTS="mqtt,ftp,camera,find",
// and add their own certificate authority with CLOUD_SLICER_BAMBU_CA=<pem file>.
var (
	bambuMQTTPort   = "8883"
	bambuFTPPort    = "990"
	bambuCameraPort = "6000"
	bambuFindPort   = 2021
)

//go:embed bambu_ca.pem
var bambuCAPEM []byte

var bambuRoots = x509.NewCertPool()

func init() {
	bambuRoots.AppendCertsFromPEM(bambuCAPEM)
	if f := os.Getenv("CLOUD_SLICER_BAMBU_CA"); f != "" {
		if pem, err := os.ReadFile(f); err == nil {
			bambuRoots.AppendCertsFromPEM(pem)
		}
	}
	if p := strings.Split(os.Getenv("CLOUD_SLICER_BAMBU_PORTS"), ","); len(p) == 4 {
		if n, err := strconv.Atoi(p[3]); err == nil {
			bambuMQTTPort, bambuFTPPort, bambuCameraPort, bambuFindPort = p[0], p[1], p[2], n
		}
	}
}

var errNotBambu = errors.New("not a Bambu Lab printer")

// bambuTLS checks the printer's certificate came from Bambu Lab and, once its
// serial is known, that it is that printer. The serial also goes out as the
// server name (the printers want it), which keeps one TLS session for the FTP
// control and data connections (the printer's FTP server insists).
func bambuTLS(serial string) *tls.Config {
	return &tls.Config{
		ServerName:         serial,
		InsecureSkipVerify: true, // checked below: the name on it is a serial, not the address
		ClientSessionCache: tls.NewLRUClientSessionCache(4),
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errNotBambu
			}
			leaf := cs.PeerCertificates[0]
			chain := x509.NewCertPool()
			for _, c := range cs.PeerCertificates[1:] {
				chain.AddCert(c)
			}
			// At the time it was made: printers keep their certificate for years.
			if _, err := leaf.Verify(x509.VerifyOptions{Roots: bambuRoots, Intermediates: chain, CurrentTime: leaf.NotBefore.Add(time.Minute), KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny}}); err != nil {
				return errNotBambu
			}
			if serial != "" && leaf.Subject.CommonName != serial {
				return fmt.Errorf("Another printer (%s) answered at this address.", leaf.Subject.CommonName)
			}
			return nil
		},
	}
}

// bambuSerial is the serial of the Bambu Lab printer at host, from its certificate.
func bambuSerial(ctx context.Context, host string) (string, error) {
	d := tls.Dialer{NetDialer: &net.Dialer{Timeout: 3 * time.Second}, Config: bambuTLS("")}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, bambuMQTTPort))
	if err != nil {
		if errors.Is(err, errNotBambu) {
			return "", errNotBambu
		}
		return "", fmt.Errorf("Could not reach the printer: %v", err)
	}
	defer conn.Close()
	cn := conn.(*tls.Conn).ConnectionState().PeerCertificates[0].Subject.CommonName
	if cn == "" {
		return "", errNotBambu
	}
	return cn, nil
}

type bambu struct {
	host string
	code string

	mu       sync.Mutex
	client   mqtt.Client
	serial   string
	firmware string
	// The latest "print" report, the parts that changed merged in.
	report  map[string]any
	fresh   chan struct{}
	seq     int
	waiting map[string]chan map[string]any
	// Axes homed from here: the printer doesn't say.
	homed string
	// The P1/A1 camera: whether there is one, its shared stream and latest picture.
	camKnown, camHere bool
	frame             []byte
	frameAt, wanted   time.Time
	reading           bool
}

func newBambu(base, code string) *bambu {
	host := base
	if u, err := url.Parse(base); err == nil && u.Hostname() != "" {
		host = u.Hostname()
	}
	return &bambu{host: host, code: code, fresh: make(chan struct{}), waiting: map[string]chan map[string]any{}}
}

func (b *bambu) noun() string { return "Bambu Lab printers" }

// bambuLogin turns the printer's answer to the login into words.
func bambuLogin(err error) error {
	if errors.Is(err, packets.ErrorRefusedBadUsernameOrPassword) || errors.Is(err, packets.ErrorRefusedNotAuthorised) {
		return &probeError{msg: "The printer did not accept that access code", needsKey: true}
	}
	if errors.Is(err, errNotBambu) {
		return err
	}
	return fmt.Errorf("Could not reach the printer: %v", err)
}

// connect logs in to the printer's MQTT, once, and asks for its whole status.
func (b *bambu) connect(ctx context.Context) error {
	b.mu.Lock()
	connected := b.client != nil
	b.mu.Unlock()
	if connected {
		return nil
	}
	serial, err := b.serialOf(ctx)
	if err != nil {
		return err
	}
	if b.code == "" {
		return &probeError{msg: "This Bambu Lab printer needs its access code", needsKey: true}
	}
	report := "device/" + serial + "/report"
	opts := mqtt.NewClientOptions().
		AddBroker("ssl://" + net.JoinHostPort(b.host, bambuMQTTPort)).
		SetClientID("cloud-slicer-" + randomHex(4)).
		SetUsername("bblp").SetPassword(b.code).
		SetTLSConfig(bambuTLS(serial)).
		SetConnectTimeout(6 * time.Second).SetKeepAlive(30 * time.Second).
		SetAutoReconnect(false).SetConnectRetry(false).SetOrderMatters(false)
	var client mqtt.Client
	opts.SetConnectionLostHandler(func(c mqtt.Client, _ error) { b.drop(c) })
	client = mqtt.NewClient(opts)
	tok := client.Connect()
	if !tok.WaitTimeout(8 * time.Second) {
		client.Disconnect(0)
		return errors.New("Could not reach the printer: it didn't answer.")
	}
	if err := tok.Error(); err != nil {
		return bambuLogin(err)
	}
	if t := client.Subscribe(report, 0, func(_ mqtt.Client, m mqtt.Message) { b.got(m.Payload()) }); !t.WaitTimeout(6*time.Second) || t.Error() != nil {
		client.Disconnect(0)
		return errors.New("The printer didn't let the bridge follow it.")
	}
	b.mu.Lock()
	if b.client != nil {
		// Another call connected meanwhile.
		b.mu.Unlock()
		client.Disconnect(0)
		return nil
	}
	b.client = client
	b.mu.Unlock()
	b.publish(map[string]any{"pushing": map[string]any{"sequence_id": "0", "command": "pushall", "version": 1, "push_target": 1}})
	b.publish(map[string]any{"info": map[string]any{"sequence_id": "0", "command": "get_version"}})
	return nil
}

// serialOf is the printer's serial, asked once.
func (b *bambu) serialOf(ctx context.Context) (string, error) {
	b.mu.Lock()
	serial := b.serial
	b.mu.Unlock()
	if serial != "" {
		return serial, nil
	}
	serial, err := bambuSerial(ctx, b.host)
	if err != nil {
		return "", err
	}
	b.mu.Lock()
	b.serial = serial
	b.mu.Unlock()
	return serial, nil
}

func (b *bambu) drop(c mqtt.Client) {
	b.mu.Lock()
	if b.client == c {
		b.client, b.report = nil, nil
		for id, ch := range b.waiting {
			close(ch)
			delete(b.waiting, id)
		}
	}
	b.mu.Unlock()
	c.Disconnect(0)
}

func (b *bambu) publish(v map[string]any) error {
	b.mu.Lock()
	client, serial := b.client, b.serial
	b.mu.Unlock()
	if client == nil {
		return errors.New("Could not reach the printer.")
	}
	data, _ := json.Marshal(v)
	tok := client.Publish("device/"+serial+"/request", 1, false, data)
	if !tok.WaitTimeout(10*time.Second) || tok.Error() != nil {
		b.drop(client)
		return errors.New("Could not reach the printer.")
	}
	return nil
}

// got takes one report: status, the firmware's versions, or a command's result.
func (b *bambu) got(payload []byte) {
	var msg map[string]map[string]any
	if json.Unmarshal(payload, &msg) != nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if info := msg["info"]; info != nil && info["command"] == "get_version" {
		mods, _ := info["module"].([]any)
		for _, m := range mods {
			if mod, _ := m.(map[string]any); mod != nil && mod["name"] == "ota" {
				b.firmware, _ = mod["sw_ver"].(string)
			}
		}
	}
	for typ, part := range msg {
		cmd, _ := part["command"].(string)
		if typ == "print" && cmd == "push_status" {
			if b.report == nil {
				b.report = map[string]any{}
			}
			for k, v := range part {
				b.report[k] = v
			}
			close(b.fresh)
			b.fresh = make(chan struct{})
			continue
		}
		if id := fmt.Sprint(part["sequence_id"]); b.waiting[id] != nil {
			b.waiting[id] <- part
			close(b.waiting[id])
			delete(b.waiting, id)
		}
	}
}

// command sends one command and passes on the printer's refusal, if it says
// one (its reason when it gives one). Not all printers answer every command:
// no answer within a few seconds counts as done.
func (b *bambu) command(ctx context.Context, typ, cmd string, fields map[string]any) error {
	if err := b.connect(ctx); err != nil {
		return err
	}
	b.mu.Lock()
	b.seq++
	id := strconv.Itoa(b.seq)
	ch := make(chan map[string]any, 1)
	b.waiting[id] = ch
	b.mu.Unlock()
	body := map[string]any{"sequence_id": id, "command": cmd}
	for k, v := range fields {
		body[k] = v
	}
	if err := b.publish(map[string]any{typ: body}); err != nil {
		return err
	}
	select {
	case reply, ok := <-ch:
		if !ok {
			return errors.New("The printer closed the connection.")
		}
		result, _ := reply["result"].(string)
		if strings.EqualFold(result, "fail") || strings.EqualFold(result, "failed") {
			reason, _ := reply["reason"].(string)
			if reason == "" {
				reason = "no reason given"
			}
			return fmt.Errorf("The printer refused (%s). Turn on LAN Only mode and Developer Mode on the printer's screen to let Cloud Slicer control it.", reason)
		}
		return nil
	case <-time.After(3 * time.Second):
		b.mu.Lock()
		delete(b.waiting, id)
		b.mu.Unlock()
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (b *bambu) about(ctx context.Context) (string, string, error) {
	if err := b.connect(ctx); err != nil {
		return "", "", err
	}
	// The versions come a moment after connecting.
	for wait := time.Now().Add(2 * time.Second); time.Now().Before(wait); time.Sleep(50 * time.Millisecond) {
		b.mu.Lock()
		known := b.firmware != ""
		b.mu.Unlock()
		if known {
			break
		}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return "Bambu Lab " + b.serial, strings.TrimSpace("Bambu Lab firmware " + b.firmware), nil
}

// current is the latest report, waiting for the first one after connecting.
func (b *bambu) current(ctx context.Context) (map[string]any, error) {
	if err := b.connect(ctx); err != nil {
		return nil, err
	}
	b.mu.Lock()
	r, fresh := b.report, b.fresh
	b.mu.Unlock()
	if r != nil {
		return r, nil
	}
	select {
	case <-fresh:
	case <-time.After(6 * time.Second):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.report == nil {
		return nil, errors.New("The printer sent no status.")
	}
	return b.report, nil
}

// copyReport is a copy that is safe to read after the lock.
func (b *bambu) copyReport(ctx context.Context) (map[string]any, error) {
	r, err := b.current(ctx)
	if err != nil {
		return nil, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return cloneObjects(r), nil
}

// bambuState is gcode_state in Klipper's words. A stopped print ends FAILED,
// with no error.
func bambuState(r map[string]any) string {
	switch fmt.Sprint(r["gcode_state"]) {
	case "RUNNING", "PREPARE", "SLICING":
		return "printing"
	case "PAUSE":
		return "paused"
	case "FINISH":
		return "complete"
	case "FAILED":
		if number(r["print_error"]) != 0 {
			return "error"
		}
		return "cancelled"
	}
	return "standby"
}

// bambuFile is the name of the file printing, as the file list has it.
func bambuFile(r map[string]any) string {
	f, _ := r["gcode_file"].(string)
	base := path.Base(f)
	if f == "" || strings.HasPrefix(base, "plate_") {
		// A project printing: its name, without the file's own folder inside.
		if name, _ := r["subtask_name"].(string); name != "" {
			return name
		}
	}
	if base == "." || base == "/" {
		return ""
	}
	return base
}

func (b *bambu) status(ctx context.Context) (map[string]any, error) {
	r, err := b.copyReport(ctx)
	if err != nil {
		return nil, err
	}
	state := bambuState(r)
	progress := number(r["mc_percent"]) / 100
	elapsed := 0.0
	if start := number(r["gcode_start_time"]); start > 0 && state != "standby" {
		elapsed = float64(time.Now().Unix()) - start
		if elapsed < 0 {
			elapsed = 0
		}
	}
	if state == "standby" {
		progress = 0
	}
	message := ""
	if state == "error" {
		message = fmt.Sprintf("The printer stopped with error %08X: check its screen.", int64(number(r["print_error"])))
	}
	fan := func(k string) float64 { return number(r[k]) / 15 }
	b.mu.Lock()
	if state == "printing" || state == "paused" {
		// Prints home first.
		b.homed = "xyz"
	}
	homed := b.homed
	b.mu.Unlock()
	speed := number(r["spd_mag"]) / 100
	if speed <= 0 {
		speed = 1
	}
	objects := map[string]any{
		"webhooks": map[string]any{"state": "ready", "state_message": ""},
		"print_stats": map[string]any{"state": state, "filename": bambuFile(r), "print_duration": elapsed, "total_duration": elapsed, "filament_used": 0.0, "message": message,
			"info": map[string]any{"current_layer": number(r["layer_num"]), "total_layer": number(r["total_layer_num"])}},
		"virtual_sdcard":            map[string]any{"progress": progress, "is_active": state == "printing"},
		"display_status":            map[string]any{"progress": progress, "message": ""},
		"extruder":                  map[string]any{"temperature": number(r["nozzle_temper"]), "target": number(r["nozzle_target_temper"])},
		"heater_bed":                map[string]any{"temperature": number(r["bed_temper"]), "target": number(r["bed_target_temper"])},
		"fan":                       map[string]any{"speed": fan("cooling_fan_speed")},
		"fan_generic auxiliary_fan": map[string]any{"speed": fan("big_fan1_speed")},
		"fan_generic chamber_fan":   map[string]any{"speed": fan("big_fan2_speed")},
		"toolhead":                  map[string]any{"position": []any{0.0, 0.0, 0.0, 0.0}, "extruder": "extruder", "homed_axes": homed},
		"gcode_move":                map[string]any{"gcode_position": []any{0.0, 0.0, 0.0, 0.0}, "speed_factor": speed, "extrude_factor": 1.0},
	}
	sensors := []any{"extruder", "heater_bed"}
	// Only printers with a chamber sensor (X1, H2) say its temperature.
	if _, ok := r["chamber_temper"]; ok {
		objects["temperature_sensor chamber"] = map[string]any{"temperature": number(r["chamber_temper"])}
		sensors = append(sensors, "temperature_sensor chamber")
	}
	objects["heaters"] = map[string]any{"available_heaters": []any{"extruder", "heater_bed"}, "available_sensors": sensors}
	return objects, nil
}

// ftp logs in to the printer's file storage (the SD card or its own).
func (b *bambu) ftp(ctx context.Context) (*ftp.ServerConn, error) {
	if b.code == "" {
		return nil, &probeError{msg: "This Bambu Lab printer needs its access code", needsKey: true}
	}
	serial, err := b.serialOf(ctx)
	if err != nil {
		return nil, err
	}
	c, err := ftp.Dial(net.JoinHostPort(b.host, bambuFTPPort), ftp.DialWithContext(ctx), ftp.DialWithTimeout(10*time.Second), ftp.DialWithTLS(bambuTLS(serial)), ftp.DialWithDisabledEPSV(true))
	if err != nil {
		return nil, fmt.Errorf("Could not reach the printer's files: %v", err)
	}
	if err := c.Login("bblp", b.code); err != nil {
		_ = c.Quit()
		return nil, &probeError{msg: "The printer did not accept that access code", needsKey: true}
	}
	return c, nil
}

// bambuPrintable: plain G-code, or a project with its G-code inside (.gcode.3mf from Bambu Studio).
func bambuPrintable(name string) bool {
	return isGcodeName(name) || strings.HasSuffix(strings.ToLower(name), ".3mf")
}

func (b *bambu) list(ctx context.Context) ([]*ftp.Entry, error) {
	c, err := b.ftp(ctx)
	if err != nil {
		return nil, err
	}
	defer c.Quit()
	entries, err := c.List("/")
	if err != nil {
		return nil, fmt.Errorf("The printer didn't list its files: %v", err)
	}
	out := []*ftp.Entry{}
	for _, e := range entries {
		if e.Type == ftp.EntryTypeFile && bambuPrintable(e.Name) {
			out = append(out, e)
		}
	}
	return out, nil
}

func (b *bambu) files(ctx context.Context) ([]brandFile, error) {
	list, err := b.list(ctx)
	if err != nil {
		return nil, err
	}
	out := []brandFile{}
	for _, e := range list {
		out = append(out, brandFile{Path: e.Name, Modified: float64(e.Time.Unix()), Size: int64(e.Size)})
	}
	return out, nil
}

func (b *bambu) metadata(ctx context.Context, p string) (map[string]any, error) {
	list, err := b.list(ctx)
	if err != nil {
		return nil, err
	}
	for _, e := range list {
		if e.Name != p {
			continue
		}
		m := map[string]any{"filename": p, "size": int64(e.Size), "modified": float64(e.Time.Unix())}
		// The print going on: the printer's own estimate (minutes left).
		b.mu.Lock()
		r := b.report
		var file string
		var left, start float64
		if r != nil {
			file, left, start = bambuFile(r), number(r["mc_remaining_time"]), number(r["gcode_start_time"])
		}
		b.mu.Unlock()
		if (file == p || file == strings.TrimSuffix(strings.TrimSuffix(p, ".3mf"), ".gcode")) && left > 0 && start > 0 {
			m["estimated_time"] = float64(time.Now().Unix()) - start + left*60
		}
		return m, nil
	}
	return nil, errors.New("No such file on the printer.")
}

func (b *bambu) thumbnail(ctx context.Context, p string) ([]byte, string, error) {
	return nil, "", errors.New("no picture")
}

func (b *bambu) remove(ctx context.Context, p string) error {
	c, err := b.ftp(ctx)
	if err != nil {
		return err
	}
	defer c.Quit()
	if err := c.Delete(p); err != nil {
		return fmt.Errorf("The printer did not delete the file: %v", err)
	}
	return nil
}

func (b *bambu) upload(ctx context.Context, p string, body io.Reader, size int64) error {
	if strings.Contains(p, "/") {
		return errors.New("Bambu Lab printers print from one folder: send it without a folder.")
	}
	c, err := b.ftp(ctx)
	if err != nil {
		return err
	}
	defer c.Quit()
	counted := &countingReader{r: io.LimitReader(body, size)}
	if err := c.Stor(p, counted); err != nil {
		return fmt.Errorf("The printer refused the file: %v", err)
	}
	if counted.n != size {
		return errors.New("The upload stopped early.")
	}
	return nil
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

// start prints a file from the printer's storage: plain G-code as it is, a
// project (.3mf) its first plate, as Bambu Studio's "print from SD card" does.
func (b *bambu) start(ctx context.Context, p string) error {
	if strings.HasSuffix(strings.ToLower(p), ".3mf") {
		name := strings.TrimSuffix(strings.TrimSuffix(p, ".3mf"), ".gcode")
		return b.command(ctx, "print", "project_file", map[string]any{
			"param": "Metadata/plate_1.gcode", "url": "file:///sdcard/" + p, "subtask_name": name,
			"project_id": "0", "profile_id": "0", "task_id": "0", "subtask_id": "0", "md5": "",
			"timelapse": false, "bed_type": "auto", "bed_levelling": true, "flow_cali": false, "vibration_cali": false, "layer_inspect": false,
			"use_ams": false, "ams_mapping": "",
		})
	}
	return b.command(ctx, "print", "gcode_file", map[string]any{"param": "/sdcard/" + p})
}

func (b *bambu) pause(ctx context.Context) error {
	return b.command(ctx, "print", "pause", map[string]any{"param": ""})
}

func (b *bambu) resume(ctx context.Context) error {
	return b.command(ctx, "print", "resume", map[string]any{"param": ""})
}

func (b *bambu) cancel(ctx context.Context) error {
	return b.command(ctx, "print", "stop", map[string]any{"param": ""})
}

// gcode runs the Device tab's G-code (Klipper's own commands in Marlin's words).
func (b *bambu) gcode(ctx context.Context, script string) error {
	lines, err := marlinLines(script, "Bambu Lab printers")
	if err != nil {
		return err
	}
	if len(lines) == 0 {
		return nil
	}
	if err := b.command(ctx, "print", "gcode_line", map[string]any{"param": strings.Join(lines, "\n") + "\n"}); err != nil {
		return err
	}
	b.mu.Lock()
	b.homed = homedAfter(b.homed, lines)
	b.mu.Unlock()
	return nil
}

// emergencyStop stops the print: the printer has no other way to halt from outside.
func (b *bambu) emergencyStop(ctx context.Context) error { return b.cancel(ctx) }

func (b *bambu) restart(ctx context.Context) error {
	return errors.New("Bambu Lab printers restart from their own screen.")
}

// cameras: the P1/A1 camera, as pictures. X1, H2 and P2S stream video the
// bridge can't pass on (RTSP): they show no camera.
func (b *bambu) cameras(ctx context.Context) ([]brandCamera, error) {
	b.mu.Lock()
	known, here := b.camKnown, b.camHere
	b.mu.Unlock()
	if !known {
		conn, err := net.DialTimeout("tcp", net.JoinHostPort(b.host, bambuCameraPort), 3*time.Second)
		here = err == nil
		if conn != nil {
			conn.Close()
		}
		b.mu.Lock()
		b.camKnown, b.camHere = true, here
		b.mu.Unlock()
	}
	if !here {
		return nil, nil
	}
	return []brandCamera{{Name: "Camera", Snapshot: "bambu:camera"}}, nil
}

// cameraOpen gives the camera's latest picture, from one stream shared by
// every picture, which closes when nobody asked for a while.
func (b *bambu) cameraOpen(ctx context.Context, raw string) (*http.Response, error) {
	b.mu.Lock()
	b.wanted = time.Now()
	if !b.reading {
		b.reading = true
		go b.watchCamera()
	}
	b.mu.Unlock()
	end := time.Now().Add(8 * time.Second)
	for time.Now().Before(end) {
		b.mu.Lock()
		frame, at := b.frame, b.frameAt
		b.mu.Unlock()
		if frame != nil && time.Since(at) < 5*time.Second {
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"image/jpeg"}}, Body: io.NopCloser(bytes.NewReader(frame)), ContentLength: int64(len(frame))}, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return nil, errors.New("The camera sent no picture.")
}

// watchCamera logs in to the camera (an 80-byte packet: size 0x40, type
// 0x3000, then user and access code, 32 bytes each) and keeps its pictures,
// each after a 16-byte header that starts with its size.
func (b *bambu) watchCamera() {
	defer func() {
		b.mu.Lock()
		b.reading = false
		b.mu.Unlock()
	}()
	serial, err := b.serialOf(context.Background())
	if err != nil {
		return
	}
	d := tls.Dialer{NetDialer: &net.Dialer{Timeout: 5 * time.Second}, Config: bambuTLS(serial)}
	conn, err := d.DialContext(context.Background(), "tcp", net.JoinHostPort(b.host, bambuCameraPort))
	if err != nil {
		return
	}
	defer conn.Close()
	login := make([]byte, 80)
	binary.LittleEndian.PutUint32(login[0:], 0x40)
	binary.LittleEndian.PutUint32(login[4:], 0x3000)
	copy(login[16:48], "bblp")
	copy(login[48:80], b.code)
	if _, err := conn.Write(login); err != nil {
		return
	}
	r := bufio.NewReader(conn)
	head := make([]byte, 16)
	for {
		b.mu.Lock()
		idle := time.Since(b.wanted) > 15*time.Second
		b.mu.Unlock()
		if idle {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		if _, err := io.ReadFull(r, head); err != nil {
			return
		}
		size := binary.LittleEndian.Uint32(head[0:])
		if size == 0 || size > uint32(maxFrame) {
			return
		}
		frame := make([]byte, size)
		if _, err := io.ReadFull(r, frame); err != nil {
			return
		}
		if bytes.HasPrefix(frame, []byte{0xFF, 0xD8}) {
			b.mu.Lock()
			b.frame, b.frameAt = frame, time.Now()
			b.mu.Unlock()
		}
	}
}

// discoverBambu is the search's part for Bambu Lab printers, which say
// they're there every few seconds (SSDP NOTIFY to UDP port 2021). It listens
// while the search runs, up to wait.
func discoverBambu(ctx context.Context, wait time.Duration) []found {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{Port: bambuFindPort})
	if err != nil {
		// Bambu Studio or OrcaSlicer running on this computer has the port: no search.
		return nil
	}
	defer conn.Close()
	end := time.Now().Add(wait)
	if d, ok := ctx.Deadline(); ok && d.Add(-time.Second).Before(end) {
		end = d.Add(-time.Second)
	}
	var out []found
	seen := map[string]bool{}
	buf := make([]byte, 4096)
	for time.Now().Before(end) && ctx.Err() == nil {
		_ = conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
		n, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			continue
		}
		f, ok := parseBambuNotify(buf[:n], from.IP.String())
		if !ok || seen[hostOf(f.URL)] {
			continue
		}
		seen[hostOf(f.URL)] = true
		out = append(out, f)
	}
	return out
}

// parseBambuNotify reads one printer's SSDP message: its address (Location),
// serial (USN) and name (DevName.bambu.com).
func parseBambuNotify(msg []byte, from string) (found, bool) {
	head := map[string]string{}
	for _, line := range strings.Split(string(msg), "\n") {
		if k, v, ok := strings.Cut(line, ":"); ok {
			head[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
		}
	}
	if !strings.Contains(head["nt"]+head["st"], "bambulab-com:device:3dprinter") {
		return found{}, false
	}
	ip := head["location"]
	if net.ParseIP(ip) == nil {
		ip = from
	}
	name := head["devname.bambu.com"]
	if name == "" {
		name = ip
	}
	return found{URL: "http://" + ip, Name: name, Kind: kindBambu, NeedsKey: true}, true
}

// probeBambu finds a Bambu Lab printer at an address the user typed, and
// checks its access code.
func probeBambu(ctx context.Context, address, code string) (string, string, error) {
	a := strings.TrimRight(strings.TrimSpace(address), "/")
	if !strings.Contains(a, "://") {
		a = "http://" + a
	}
	u, err := url.Parse(a)
	if err != nil || u.Hostname() == "" {
		return "", "", errNotBambu
	}
	b := newBambu(u.Hostname(), code)
	if err := b.connect(ctx); err != nil {
		if errors.Is(err, errNotBambu) {
			return "", "", errNotBambu
		}
		return "", "", err
	}
	b.mu.Lock()
	client := b.client
	b.mu.Unlock()
	client.Disconnect(0)
	return "http://" + u.Hostname(), "Bambu Lab " + b.serial, nil
}
