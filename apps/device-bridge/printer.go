package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The bridge on the printer itself: any Klipper host with Moonraker (a Pi, an
// Armbian board, a Snapmaker U1, a Creality K1 or K2, a Sonic Pad). It runs as a
// root system service (so "Remove bridge" in the Device tab can remove the
// service too; on most of these hosts Klipper's user has root through sudo anyway), reaches Moonraker at 127.0.0.1:7125 and keeps its program and
// settings in printer_data, the one folder every Klipper host keeps (on a U1 it
// is also the only one that survives a restart). It updates itself like the
// computer apps, so it needs nothing from Moonraker and Moonraker never restarts.

const printerMarker = ".service" // in the bridge's folder: which service manager runs it

type initKind string

const (
	initSystemd initKind = "systemd" // Raspberry Pi OS, Armbian, most boards
	initProcd   initKind = "procd"   // OpenWrt: Creality K2, Sonic Pad
	initSysV    initKind = "sysv"    // Buildroot init scripts: Creality K1, Snapmaker U1
)

// printerPlan is what installing on a printer takes, without doing it.
type printerPlan struct {
	dataDir string // printer_data
	dir     string // <printer_data>/cloud-slicer-bridge: the program, its settings, its log
	exe     string
	config  string
	pairing string // <printer_data>/config/cloud-slicer-bridge-pairing.txt, readable in Mainsail and Fluidd
	kind    initKind
	files   []file
	enable  []step
	disable []step
}

type printerEnv struct {
	dataDir string
	kind    initKind
}

func printerPlanFor(e printerEnv) printerPlan {
	dir := filepath.Join(e.dataDir, service)
	p := printerPlan{
		dataDir: e.dataDir,
		dir:     dir,
		exe:     filepath.Join(dir, service),
		config:  filepath.Join(dir, "bridge.json"),
		pairing: filepath.Join(e.dataDir, "config", service+"-pairing.txt"),
		kind:    e.kind,
	}
	args := quoteArgs(p.exe, "run", "--no-browser", "--config", p.config)
	switch e.kind {
	case initSystemd:
		unit := "/etc/systemd/system/" + service + ".service"
		p.files = []file{{unit, `[Unit]
Description=Cloud Slicer bridge (lets the Device tab reach this printer)
Wants=network-online.target
After=network-online.target moonraker.service

[Service]
ExecStart=` + args + `
Restart=always
RestartSec=5
# The bridge removes itself from the Device tab with a helper that must outlive it.
KillMode=process

[Install]
WantedBy=multi-user.target
`}}
		p.enable = []step{
			{cmd: "systemctl", args: []string{"daemon-reload"}},
			{cmd: "systemctl", args: []string{"enable", service}},
			{cmd: "systemctl", args: []string{"restart", service}},
		}
		p.disable = []step{
			{cmd: "systemctl", args: []string{"disable", "--now", service}, optional: true},
		}
	case initProcd:
		script := "/etc/init.d/" + service
		p.files = []file{{script, `#!/bin/sh /etc/rc.common
# Cloud Slicer bridge (lets the Device tab reach this printer)
START=99
USE_PROCD=1

start_service() {
	procd_open_instance
	procd_set_param command ` + args + `
	procd_set_param respawn 3600 5 0
	procd_close_instance
}
`}}
		p.enable = []step{{cmd: script, args: []string{"enable"}}, {cmd: script, args: []string{"restart"}}}
		p.disable = []step{{cmd: script, args: []string{"stop"}, optional: true}, {cmd: script, args: []string{"disable"}, optional: true}}
	default:
		script := "/etc/init.d/S99" + service
		log := filepath.Join(dir, "bridge.log")
		p.files = []file{{script, `#!/bin/sh
# Cloud Slicer bridge (lets the Device tab reach this printer). Kept running by
# the loop below; the log starts over when it passes 1 MB.
PIDFILE=/var/run/` + service + `.pid
LOG=` + shellQuote(log) + `

start() {
	if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then return 0; fi
	(
		# Started from an SSH session by the installer: outlive its logout.
		trap '' HUP
		while :; do
			[ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ] && : > "$LOG"
			` + args + ` >> "$LOG" 2>&1
			sleep 5
		done
	) </dev/null >/dev/null 2>&1 &
	echo $! > "$PIDFILE"
}

stop() {
	[ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
	rm -f "$PIDFILE"
	# The bridge itself, found by its program file and never by name: the
	# installer is a program of the same name, and it is what runs this script.
	for d in /proc/[0-9]*; do
		case "$(readlink "$d/exe" 2>/dev/null)" in
			` + shellQuote(p.exe) + ` | ` + shellQuote(p.exe+" (deleted)") + `)
				[ "${d#/proc/}" != "$PPID" ] && kill "${d#/proc/}" 2>/dev/null ;;
		esac
	done
	return 0
}

case "$1" in
	start) start ;;
	stop) stop ;;
	restart) stop; sleep 1; start ;;
	*) echo "Usage: $0 {start|stop|restart}"; exit 1 ;;
esac
`}}
		p.enable = []step{{cmd: script, args: []string{"restart"}}}
		p.disable = []step{{cmd: script, args: []string{"stop"}, optional: true}}
	}
	return p
}

// removeScript is what "Remove bridge" in the Device tab runs: a shell helper,
// started on its own, that stops the service (and with it this bridge), removes
// its files and the bridge's folder.
func (p printerPlan) removeScript() string {
	var b strings.Builder
	b.WriteString("sleep 1\n")
	for _, s := range p.disable {
		b.WriteString(shellQuote(s.cmd))
		for _, a := range s.args {
			b.WriteString(" " + shellQuote(a))
		}
		b.WriteString(" >/dev/null 2>&1\n")
	}
	for _, f := range p.files {
		b.WriteString("rm -f " + shellQuote(f.path) + "\n")
	}
	if p.kind == initSystemd {
		b.WriteString("systemctl daemon-reload >/dev/null 2>&1\n")
	}
	b.WriteString("rm -f " + shellQuote(p.pairing) + "\n")
	b.WriteString("rm -rf " + shellQuote(p.dir) + "\n")
	return b.String()
}

// findPrinterData finds the Klipper host's printer_data folder (the one with a config folder).
func findPrinterData(given string) (string, error) {
	if given != "" {
		if !isDir(filepath.Join(given, "config")) {
			return "", fmt.Errorf("%s has no config folder: is it printer_data?", given)
		}
		return given, nil
	}
	var found []string
	candidates := []string{"/usr/data/printer_data"} // Creality K1 and K2
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, "printer_data"))
	}
	more, _ := filepath.Glob("/home/*/printer_data")
	candidates = append(candidates, more...)
	candidates = append(candidates, "/root/printer_data")
	seen := map[string]bool{}
	for _, c := range candidates {
		if !seen[c] && isDir(filepath.Join(c, "config")) {
			found = append(found, c)
		}
		seen[c] = true
	}
	switch len(found) {
	case 0:
		return "", errors.New("No Klipper printer here: there is no printer_data folder. Run this on the printer itself, or give the folder with --printer-data.")
	case 1:
		return found[0], nil
	}
	return "", fmt.Errorf("More than one printer_data folder here (%s): pick one with --printer-data.", strings.Join(found, ", "))
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// whichInit says how this system starts services.
func whichInit() initKind {
	if isDir("/run/systemd/system") {
		return initSystemd
	}
	if _, err := os.Stat("/sbin/procd"); err == nil {
		return initProcd
	}
	return initSysV
}

// installedOnPrinter is the plan of the bridge installed on this printer, when
// this program is it (its folder has the marker).
func installedOnPrinter() (printerPlan, bool) {
	dir := filepath.Dir(self())
	kind, err := os.ReadFile(filepath.Join(dir, printerMarker))
	if err != nil {
		return printerPlan{}, false
	}
	dataDir := filepath.Dir(dir)
	return printerPlanFor(printerEnv{dataDir: dataDir, kind: initKind(strings.TrimSpace(string(kind)))}), true
}

// printerInstall finds the bridge installed on this printer: this program, or
// the one in printer_data (for "sudo cloud-slicer-bridge uninstall" typed anywhere).
func printerInstall(given string) (printerPlan, bool) {
	if p, ok := installedOnPrinter(); ok {
		return p, true
	}
	dataDir, err := findPrinterData(given)
	if err != nil {
		return printerPlan{}, false
	}
	kind, err := os.ReadFile(filepath.Join(dataDir, service, printerMarker))
	if err != nil {
		return printerPlan{}, false
	}
	return printerPlanFor(printerEnv{dataDir: dataDir, kind: initKind(strings.TrimSpace(string(kind)))}), true
}

// installOnPrinter copies this program into printer_data, adds the printer's own
// Moonraker, sets up the service and starts it. It needs root (for the service).
func installOnPrinter(given, relay string) (printerPlan, *Config, error) {
	dataDir, err := findPrinterData(given)
	if err != nil {
		return printerPlan{}, nil, err
	}
	_, uid, gid := ownerOf(dataDir)
	p := printerPlanFor(printerEnv{dataDir: dataDir, kind: whichInit()})
	if os.Geteuid() != 0 {
		return p, nil, errors.New("Installing on the printer needs root: run it with sudo (the install line does this for you).")
	}
	if err := os.MkdirAll(p.dir, 0o755); err != nil {
		return p, nil, err
	}
	// An older copy keeps running until the restart below; copying renames over it.
	if !samePath(self(), p.exe) {
		if err := copyFile(self(), p.exe); err != nil {
			return p, nil, err
		}
	}
	cfg, err := loadConfig(p.config, relay)
	if err != nil {
		return p, nil, err
	}
	// The printer it runs on, unless it is there already.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if url, info, err := probeAddress(ctx, "127.0.0.1:7125", ""); err == nil {
		host, _ := info["hostname"].(string)
		if host == "" {
			host = shortHost()
		}
		known := false
		for _, x := range cfg.Printers {
			known = known || x.URL == url
		}
		if !known {
			cfg.upsert(host, url, "")
		}
	} else {
		var pe *probeError
		if errors.As(err, &pe) && pe.needsKey {
			// Moonraker locked with an API key (the Snapmaker U1 is): not needed here.
			fmt.Println("This printer's Moonraker asks for an API key. That's fine: once the bridge is paired, add the printer in the Device tab and type the key there.")
		} else {
			fmt.Println("Moonraker didn't answer at 127.0.0.1:7125 (" + err.Error() + "). Add the printer from the Device tab once the bridge is paired.")
		}
	}
	if err := cfg.save(); err != nil {
		return p, nil, err
	}
	for _, f := range p.files {
		mode := os.FileMode(0o644)
		if strings.HasPrefix(f.path, "/etc/init.d/") {
			mode = 0o755
		}
		if err := os.WriteFile(f.path, []byte(f.content), mode); err != nil {
			return p, nil, err
		}
	}
	if err := os.WriteFile(filepath.Join(p.dir, printerMarker), []byte(string(p.kind)+"\n"), 0o644); err != nil {
		return p, nil, err
	}
	link := pairingLink(cfg, "")
	_ = os.WriteFile(p.pairing, []byte("To use this printer from Cloud Slicer, open this link on your phone or computer:\n\n"+link+
		"\n\nAnyone with this link can control the printer; keep it private. Removing the bridge from the Device tab deletes this file.\n"), 0o600)
	// Moonraker runs as printer_data's owner: it shows the file in Mainsail and Fluidd.
	_ = os.Chown(p.pairing, uid, gid)
	if err := runSteps(p.enable); err != nil {
		return p, cfg, err
	}
	return p, cfg, nil
}

// uninstallFromPrinter stops the service and removes everything install wrote.
// Run from the bridge itself (the Device tab), the helper outlives it.
func uninstallFromPrinter(p printerPlan, detached bool) error {
	if detached {
		return startDetached("sh", "-c", p.removeScript())
	}
	return runStep(step{cmd: "sh", args: []string{"-c", strings.Replace(p.removeScript(), "sleep 1\n", "", 1)}})
}

// shellQuote quotes s for sh.
func shellQuote(s string) string {
	if s != "" && !strings.ContainsAny(s, " \t\n'\"\\$`;&|<>()*?[]#~{}!") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
