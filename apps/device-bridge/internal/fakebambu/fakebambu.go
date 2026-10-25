// Package fakebambu is a pretend Bambu Lab printer for tests, as far as the
// bridge uses one (bambu.go): MQTT over TLS with its status and commands, FTPS
// for files, the P1/A1 camera, and SSDP to say it's there. Its certificate
// comes from its own certificate authority, with the serial as its name, like
// a real printer's from Bambu Lab's. It never prints anything.
package fakebambu

import (
	"bufio"
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"math/big"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	Serial = "01P00A000000001"
	Code   = "12345678"
)

// Printer is one pretend printer, on 127.0.0.1.
type Printer struct {
	CAPEM []byte
	// MQTT, FTP and camera ports.
	MQTT, FTP, Camera string

	cert tls.Certificate
	lns  []net.Listener

	mu       sync.Mutex
	files    map[string][]byte
	report   map[string]any
	commands []map[string]any
	clients  map[*mqttConn]bool
	// Refuse: a command name the printer refuses, as without Developer Mode.
	refuse string
}

// Start starts a printer with one file on it, idle.
func Start() (*Printer, error) {
	p := &Printer{
		files:   map[string][]byte{"benchy.gcode": []byte("G28\n")},
		clients: map[*mqttConn]bool{},
		report: map[string]any{
			"command": "push_status", "gcode_state": "IDLE", "mc_percent": 0, "mc_remaining_time": 0,
			"nozzle_temper": 25.0, "nozzle_target_temper": 0.0, "bed_temper": 26.0, "bed_target_temper": 0.0, "chamber_temper": 24.0,
			"cooling_fan_speed": "0", "big_fan1_speed": "0", "big_fan2_speed": "0", "spd_mag": 100, "spd_lvl": 2,
			"layer_num": 0, "total_layer_num": 0, "gcode_file": "", "subtask_name": "", "print_error": 0, "gcode_start_time": "0",
			// One AMS: white PLA, an empty slot, red PLA, black PETG; nothing on the outside spool.
			"ams": map[string]any{"ams_exist_bits": "1", "tray_exist_bits": "d", "tray_now": "255", "ams": []any{
				map[string]any{"id": "0", "humidity": "4", "temp": "24.0", "tray": []any{
					tray("0", "PLA", "FFFFFFFF", "PLA Basic", "GFA00"),
					map[string]any{"id": "1"},
					tray("2", "PLA", "C12E1FFF", "PLA Matte", "GFA01"),
					tray("3", "PETG", "000000FF", "PETG HF", "GFG02"),
				}},
			}},
			"vt_tray": map[string]any{"id": "254", "tray_type": "", "tray_color": "00000000"},
		},
	}
	if err := p.makeCert(); err != nil {
		return nil, err
	}
	for i, serve := range []func(net.Conn){p.serveMQTT, p.serveFTP, p.serveCamera} {
		ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{p.cert}})
		if err != nil {
			p.Close()
			return nil, err
		}
		p.lns = append(p.lns, ln)
		port := strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
		switch i {
		case 0:
			p.MQTT = port
		case 1:
			p.FTP = port
		case 2:
			p.Camera = port
		}
		go func() {
			for {
				c, err := ln.Accept()
				if err != nil {
					return
				}
				go serve(c)
			}
		}()
	}
	return p, nil
}

// Close turns the printer off: it stops listening and drops every connection.
func (p *Printer) Close() {
	for _, ln := range p.lns {
		ln.Close()
	}
	p.mu.Lock()
	for c := range p.clients {
		c.c.Close()
	}
	p.mu.Unlock()
}

func (p *Printer) makeCert() error {
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Pretend BBL CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		return err
	}
	caCert, _ := x509.ParseCertificate(caDER)
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: Serial}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, leaf, caCert, &key.PublicKey, caKey)
	if err != nil {
		return err
	}
	p.cert = tls.Certificate{Certificate: [][]byte{der, caDER}, PrivateKey: key}
	p.CAPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	return nil
}

// Files are the files on the printer, by name.
func (p *Printer) Files() map[string][]byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := map[string][]byte{}
	for k, v := range p.files {
		out[k] = v
	}
	return out
}

func tray(id, typ, colour, name, idx string) map[string]any {
	return map[string]any{"id": id, "tray_type": typ, "tray_color": colour, "tray_sub_brands": name, "tray_info_idx": idx,
		"nozzle_temp_min": "190", "nozzle_temp_max": "240", "remain": 80}
}

// Last is the whole body of the last command named cmd ("project_file"), or nil.
func (p *Printer) Last(cmd string) map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i := len(p.commands) - 1; i >= 0; i-- {
		for _, v := range p.commands[i] {
			if body, _ := v.(map[string]any); body["command"] == cmd {
				return body
			}
		}
	}
	return nil
}

// Commands are the commands the printer got ("print.pause", "print.gcode_line: G28", ...).
func (p *Printer) Commands() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []string
	for _, c := range p.commands {
		for typ, v := range c {
			body, _ := v.(map[string]any)
			s := typ + "." + fmt.Sprint(body["command"])
			if param, _ := body["param"].(string); param != "" {
				s += ": " + strings.TrimSpace(param)
			}
			out = append(out, s)
		}
	}
	return out
}

// Report is the printer's whole status now.
func (p *Printer) Report() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := map[string]any{}
	for k, v := range p.report {
		out[k] = v
	}
	return out
}

// Set changes fields of the printer's report and sends them, as the printer
// sends only what changed (an error turning up, say).
func (p *Printer) Set(fields map[string]any) {
	p.mu.Lock()
	for k, v := range fields {
		p.report[k] = v
	}
	p.mu.Unlock()
	diff := map[string]any{"command": "push_status"}
	for k, v := range fields {
		diff[k] = v
	}
	p.broadcast(map[string]any{"print": diff})
}

// Refuse makes the printer refuse a command, as without Developer Mode.
func (p *Printer) Refuse(cmd string) {
	p.mu.Lock()
	p.refuse = cmd
	p.mu.Unlock()
}

// Notify is what the printer says on the network every few seconds (SSDP).
func Notify(ip, name string) []byte {
	return []byte("NOTIFY * HTTP/1.1\r\nHOST: 239.255.255.250:1990\r\nServer: Buildroot/2018.02-rc3 UPnP/1.0 ssdpd/1.8\r\nLocation: " + ip +
		"\r\nNT: urn:bambulab-com:device:3dprinter:1\r\nUSN: " + Serial + "\r\nCache-Control: max-age=1800\r\nDevModel.bambu.com: C12\r\nDevName.bambu.com: " + name +
		"\r\nDevSignal.bambu.com: -45\r\nDevConnect.bambu.com: lan\r\nDevBind.bambu.com: free\r\n\r\n")
}

// --- MQTT (3.1.1, the little of it the bridge uses) ---

type mqttConn struct {
	c  net.Conn
	mu sync.Mutex
}

func (m *mqttConn) send(typ byte, body []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	head := []byte{typ}
	n := len(body)
	for {
		b := byte(n % 128)
		n /= 128
		if n > 0 {
			b |= 128
		}
		head = append(head, b)
		if n == 0 {
			break
		}
	}
	_, _ = m.c.Write(append(head, body...))
}

func mqttString(b []byte) (string, []byte) {
	if len(b) < 2 {
		return "", nil
	}
	n := int(binary.BigEndian.Uint16(b))
	if len(b) < 2+n {
		return "", nil
	}
	return string(b[2 : 2+n]), b[2+n:]
}

func (p *Printer) publish(m *mqttConn, payload any) {
	data, _ := json.Marshal(payload)
	topic := "device/" + Serial + "/report"
	body := binary.BigEndian.AppendUint16(nil, uint16(len(topic)))
	body = append(append(body, topic...), data...)
	m.send(0x30, body)
}

func (p *Printer) broadcast(payload any) {
	p.mu.Lock()
	clients := make([]*mqttConn, 0, len(p.clients))
	for c := range p.clients {
		clients = append(clients, c)
	}
	p.mu.Unlock()
	for _, c := range clients {
		p.publish(c, payload)
	}
}

func (p *Printer) serveMQTT(c net.Conn) {
	defer c.Close()
	m := &mqttConn{c: c}
	r := bufio.NewReader(c)
	defer func() {
		p.mu.Lock()
		delete(p.clients, m)
		p.mu.Unlock()
	}()
	for {
		typ, err := r.ReadByte()
		if err != nil {
			return
		}
		n, mul := 0, 1
		for {
			b, err := r.ReadByte()
			if err != nil {
				return
			}
			n += int(b&127) * mul
			mul *= 128
			if b&128 == 0 {
				break
			}
		}
		body := make([]byte, n)
		if _, err := io.ReadFull(r, body); err != nil {
			return
		}
		switch typ >> 4 {
		case 1: // CONNECT
			_, rest := mqttString(body) // "MQTT"
			if len(rest) < 4 {
				return
			}
			flags := rest[1]
			rest = rest[4:]
			_, rest = mqttString(rest) // client id
			user, pass := "", ""
			if flags&0x80 != 0 {
				user, rest = mqttString(rest)
			}
			if flags&0x40 != 0 {
				pass, _ = mqttString(rest)
			}
			if user != "bblp" || pass != Code {
				m.send(0x20, []byte{0, 5}) // not authorised
				return
			}
			m.send(0x20, []byte{0, 0})
		case 8: // SUBSCRIBE
			id := body[:2]
			topic, _ := mqttString(body[2:])
			code := byte(0)
			if topic != "device/"+Serial+"/report" {
				code = 0x80
			}
			m.send(0x90, append(append([]byte{}, id...), code))
			if code == 0 {
				p.mu.Lock()
				p.clients[m] = true
				p.mu.Unlock()
			}
		case 3: // PUBLISH
			qos := (typ >> 1) & 3
			topic, rest := mqttString(body)
			if qos > 0 {
				m.send(0x40, rest[:2])
				rest = rest[2:]
			}
			if topic == "device/"+Serial+"/request" {
				p.request(m, rest)
			}
		case 12: // PINGREQ
			m.send(0xD0, nil)
		case 14: // DISCONNECT
			return
		}
	}
}

func (p *Printer) request(m *mqttConn, data []byte) {
	var msg map[string]map[string]any
	if json.Unmarshal(data, &msg) != nil {
		return
	}
	for typ, body := range msg {
		cmd, _ := body["command"].(string)
		switch {
		case typ == "pushing" && cmd == "pushall":
			p.mu.Lock()
			full := map[string]any{}
			for k, v := range p.report {
				full[k] = v
			}
			p.mu.Unlock()
			p.publish(m, map[string]any{"print": full})
			continue
		case typ == "info" && cmd == "get_version":
			p.publish(m, map[string]any{"info": map[string]any{"command": "get_version", "sequence_id": body["sequence_id"],
				"module": []any{map[string]any{"name": "ota", "sw_ver": "01.08.02.00"}, map[string]any{"name": "mc", "sw_ver": "00.00.30.00"}}}})
			continue
		}
		p.mu.Lock()
		p.commands = append(p.commands, map[string]any{typ: body})
		refused := p.refuse == cmd
		p.mu.Unlock()
		reply := map[string]any{"command": cmd, "sequence_id": body["sequence_id"], "result": "success"}
		if refused {
			reply["result"], reply["reason"] = "fail", "verify failed"
			p.publish(m, map[string]any{typ: reply})
			continue
		}
		change := map[string]any{}
		param, _ := body["param"].(string)
		switch cmd {
		case "gcode_file", "project_file":
			file := strings.TrimPrefix(param, "/sdcard/")
			if cmd == "project_file" {
				url, _ := body["url"].(string)
				file = strings.TrimPrefix(url, "file:///sdcard/")
			}
			p.mu.Lock()
			_, ok := p.files[file]
			p.mu.Unlock()
			if !ok {
				reply["result"], reply["reason"] = "fail", "file not found"
				break
			}
			change = map[string]any{"gcode_state": "RUNNING", "gcode_file": "/sdcard/" + file, "subtask_name": strings.TrimSuffix(strings.TrimSuffix(file, ".3mf"), ".gcode"),
				"mc_percent": 12, "mc_remaining_time": 42, "layer_num": 3, "total_layer_num": 120, "nozzle_target_temper": 220.0, "bed_target_temper": 55.0,
				"gcode_start_time": strconv.FormatInt(time.Now().Add(-5*time.Minute).Unix(), 10)}
		case "pause":
			change = map[string]any{"gcode_state": "PAUSE"}
		case "resume":
			change = map[string]any{"gcode_state": "RUNNING"}
		case "stop":
			change = map[string]any{"gcode_state": "FAILED"}
		case "gcode_line":
			for _, line := range strings.Split(param, "\n") {
				f := strings.Fields(line)
				if len(f) == 2 && strings.HasPrefix(f[1], "S") && (f[0] == "M140" || f[0] == "M104") {
					v, _ := strconv.ParseFloat(f[1][1:], 64)
					if f[0] == "M140" {
						change["bed_target_temper"] = v
					} else {
						change["nozzle_target_temper"] = v
					}
				}
			}
		}
		p.publish(m, map[string]any{typ: reply})
		if len(change) > 0 {
			p.mu.Lock()
			for k, v := range change {
				p.report[k] = v
			}
			p.mu.Unlock()
			// Like a P1: only what changed.
			change["command"] = "push_status"
			p.broadcast(map[string]any{"print": change})
		}
	}
}

// --- FTPS (implicit; passive mode, the few commands the bridge sends) ---

func (p *Printer) serveFTP(c net.Conn) {
	defer c.Close()
	r := bufio.NewReader(c)
	say := func(s string) { _, _ = io.WriteString(c, s+"\r\n") }
	say("220 Welcome to pretend Bambu FTP")
	var pasv net.Listener
	defer func() {
		if pasv != nil {
			pasv.Close()
		}
	}()
	user, loggedIn := "", false
	data := func() (net.Conn, error) {
		if pasv == nil {
			return nil, errors.New("no PASV")
		}
		d, err := pasv.Accept()
		pasv.Close()
		pasv = nil
		return d, err
	}
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		cmd, arg, _ := strings.Cut(line, " ")
		cmd = strings.ToUpper(cmd)
		if !loggedIn && cmd != "USER" && cmd != "PASS" && cmd != "QUIT" && cmd != "FEAT" {
			say("530 Please login with USER and PASS.")
			continue
		}
		switch cmd {
		case "USER":
			user = arg
			say("331 Please specify the password.")
		case "PASS":
			if user == "bblp" && arg == Code {
				loggedIn = true
				say("230 Login successful.")
			} else {
				say("530 Login incorrect.")
			}
		case "FEAT":
			say("211-Features:\r\n PASV\r\n PBSZ\r\n PROT\r\n211 End")
		case "TYPE", "PBSZ", "PROT":
			say("200 OK.")
		case "PASV":
			ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{p.cert}})
			if err != nil {
				say("425 Can't open data connection.")
				continue
			}
			pasv = ln
			port := ln.Addr().(*net.TCPAddr).Port
			say(fmt.Sprintf("227 Entering Passive Mode (127,0,0,1,%d,%d).", port/256, port%256))
		case "LIST":
			d, err := data()
			if err != nil {
				say("425 Use PASV first.")
				continue
			}
			say("150 Here comes the directory listing.")
			p.mu.Lock()
			names := make([]string, 0, len(p.files))
			for n := range p.files {
				names = append(names, n)
			}
			sort.Strings(names)
			for _, n := range names {
				fmt.Fprintf(d, "-rw-r--r--    1 0        0        %8d Oct 24 12:00 %s\r\n", len(p.files[n]), n)
			}
			p.mu.Unlock()
			d.Close()
			say("226 Directory send OK.")
		case "STOR":
			d, err := data()
			if err != nil {
				say("425 Use PASV first.")
				continue
			}
			say("150 Ok to send data.")
			body, err := io.ReadAll(d)
			d.Close()
			if err != nil {
				say("426 Failure reading network stream.")
				continue
			}
			p.mu.Lock()
			p.files[strings.TrimPrefix(arg, "/")] = body
			p.mu.Unlock()
			say("226 Transfer complete.")
		case "DELE":
			p.mu.Lock()
			_, ok := p.files[strings.TrimPrefix(arg, "/")]
			delete(p.files, strings.TrimPrefix(arg, "/"))
			p.mu.Unlock()
			if ok {
				say("250 Delete operation successful.")
			} else {
				say("550 Delete operation failed.")
			}
		case "QUIT":
			say("221 Goodbye.")
			return
		default:
			say("502 Command not implemented.")
		}
	}
}

// --- the P1/A1 camera ---

// Picture is the one picture the camera sends, over and over: a small gradient.
var Picture = func() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 320, 180))
	for y := 0; y < 180; y++ {
		for x := 0; x < 320; x++ {
			img.Set(x, y, color.RGBA{uint8(40 + x/4), uint8(90 + y/3), 160, 255})
		}
	}
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}()

func (p *Printer) serveCamera(c net.Conn) {
	defer c.Close()
	login := make([]byte, 80)
	if _, err := io.ReadFull(c, login); err != nil {
		return
	}
	if binary.LittleEndian.Uint32(login) != 0x40 || binary.LittleEndian.Uint32(login[4:]) != 0x3000 ||
		strings.TrimRight(string(login[16:48]), "\x00") != "bblp" || strings.TrimRight(string(login[48:80]), "\x00") != Code {
		return
	}
	for {
		head := make([]byte, 16)
		binary.LittleEndian.PutUint32(head, uint32(len(Picture)))
		binary.LittleEndian.PutUint32(head[8:], 1)
		if _, err := c.Write(append(head, Picture...)); err != nil {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}
