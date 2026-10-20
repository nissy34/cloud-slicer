package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	service = "cloud-slicer-bridge"
	label   = "io.qzz.awesomestuff.cloud-slicer-bridge"
	runKey  = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
	runName = "CloudSlicerBridge"
)

//go:embed icons/icon.png
var iconPNG []byte

type file struct{ path, content string }

type step struct {
	cmd      string
	args     []string
	optional bool
}

// plan is what starting with the computer takes on one system, without doing
// it: where the program is copied to, the files to write and the commands to
// run. Windows: a Run entry for the user (no admin; the app has no window, so
// nothing shows in the taskbar). macOS: a launch agent. Linux: a systemd user
// service, plus lingering so it starts at boot without a sign-in (a headless Pi).
type plan struct {
	dir     string
	copyTo  string
	files   []file
	icon    string // Linux: where the menu entry's icon goes
	link    string // Linux: ~/.local/bin/cloud-slicer-bridge, for typing the command later
	enable  []step
	restart []step
	disable []step
	// marker is a file that exists while the bridge starts with the computer (none on Windows).
	marker string
}

type planEnv struct {
	goos         string
	home         string
	localAppData string
	user         string
}

func currentEnv() planEnv {
	home, _ := os.UserHomeDir()
	name := os.Getenv("USER")
	if u, err := user.Current(); err == nil {
		name = u.Username
	}
	return planEnv{goos: runtime.GOOS, home: home, localAppData: os.Getenv("LOCALAPPDATA"), user: name}
}

// quoteArgs joins a command line for a systemd unit or a desktop entry, quoting what has spaces.
func quoteArgs(args ...string) string {
	out := make([]string, len(args))
	for i, a := range args {
		if strings.ContainsAny(a, " \t") {
			a = `"` + a + `"`
		}
		out[i] = a
	}
	return strings.Join(out, " ")
}

func xmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func autostartPlan(e planEnv) plan {
	switch e.goos {
	case "windows":
		base := e.localAppData
		if base == "" {
			base = filepath.Join(e.home, "AppData", "Local")
		}
		dir := filepath.Join(base, "Cloud Slicer Bridge")
		exe := filepath.Join(dir, service+".exe")
		value := fmt.Sprintf(`"%s" run --no-browser`, exe)
		return plan{
			dir:     dir,
			copyTo:  exe,
			enable:  []step{{cmd: "reg", args: []string{"add", runKey, "/v", runName, "/t", "REG_SZ", "/d", value, "/f"}}},
			disable: []step{{cmd: "reg", args: []string{"delete", runKey, "/v", runName, "/f"}, optional: true}},
		}
	case "darwin":
		dir := filepath.Join(e.home, "Library", "Application Support", "Cloud Slicer Bridge")
		exe := filepath.Join(dir, service)
		plist := filepath.Join(e.home, "Library", "LaunchAgents", label+".plist")
		log := xmlEscape(filepath.Join(e.home, "Library", "Logs", service+".log"))
		content := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>` + label + `</string>
  <key>ProgramArguments</key>
  <array><string>` + xmlEscape(exe) + `</string><string>run</string><string>--no-browser</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>` + log + `</string>
  <key>StandardErrorPath</key><string>` + log + `</string>
</dict>
</plist>
`
		uid := fmt.Sprint(os.Getuid())
		target := "gui/" + uid + "/" + label
		return plan{
			dir:     dir,
			copyTo:  exe,
			files:   []file{{plist, content}},
			enable:  []step{{cmd: "launchctl", args: []string{"bootout", target}, optional: true}, {cmd: "launchctl", args: []string{"bootstrap", "gui/" + uid, plist}}},
			restart: []step{{cmd: "launchctl", args: []string{"kickstart", "-k", target}}},
			disable: []step{{cmd: "launchctl", args: []string{"bootout", target}, optional: true}},
			marker:  plist,
		}
	}
	dir := filepath.Join(e.home, ".local", "share", service)
	exe := filepath.Join(dir, service)
	unit := filepath.Join(e.home, ".config", "systemd", "user", service+".service")
	icon := filepath.Join(dir, "icon.png")
	return plan{
		dir:    dir,
		copyTo: exe,
		files: []file{
			{unit, `[Unit]
Description=Cloud Slicer bridge (lets the Device tab reach printers on this network)
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=` + quoteArgs(exe, "run", "--no-browser") + `
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`},
			// A menu entry, with the app's icon, that opens the pairing link.
			{filepath.Join(e.home, ".local", "share", "applications", service+".desktop"), `[Desktop Entry]
Type=Application
Name=Cloud Slicer Bridge
Comment=Open the link that pairs this bridge with Cloud Slicer
Exec=` + quoteArgs(exe, "pair", "--open") + `
Icon=` + icon + `
Terminal=false
Categories=Utility;
`},
		},
		icon: icon,
		link: filepath.Join(e.home, ".local", "bin", service),
		enable: []step{
			{cmd: "systemctl", args: []string{"--user", "daemon-reload"}},
			{cmd: "systemctl", args: []string{"--user", "enable", service}},
			{cmd: "systemctl", args: []string{"--user", "restart", service}},
			// Without lingering a user service only runs while that user is signed in.
			{cmd: "loginctl", args: []string{"enable-linger", e.user}, optional: true},
		},
		restart: []step{{cmd: "systemctl", args: []string{"--user", "restart", service}}},
		disable: []step{{cmd: "systemctl", args: []string{"--user", "disable", "--now", service}, optional: true}},
		marker:  unit,
	}
}

func runStep(s step) error {
	var stderr bytes.Buffer
	c := exec.Command(s.cmd, s.args...)
	c.Stderr = &stderr
	hideWindow(c)
	if err := c.Run(); err != nil && !s.optional {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("%s %s failed: %s", s.cmd, strings.Join(s.args, " "), msg)
	}
	return nil
}

func runSteps(steps []step) error {
	for _, s := range steps {
		if err := runStep(s); err != nil {
			return err
		}
	}
	return nil
}

func optional(steps []step) {
	for _, s := range steps {
		s.optional = true
		_ = runStep(s)
	}
}

// autostartInstalled says whether this computer already starts the bridge by itself.
func autostartInstalled(p plan) bool {
	if p.marker != "" {
		_, err := os.Stat(p.marker)
		return err == nil
	}
	return runStep(step{cmd: "reg", args: []string{"query", runKey, "/v", runName}}) == nil
}

// copyFile copies then renames: replacing a program that is running fails on Linux, renaming over it doesn't.
func copyFile(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(to+".new", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	if err := dst.Close(); err != nil {
		return err
	}
	_ = os.Remove(to)
	return os.Rename(to+".new", to)
}

func self() string {
	exe, err := os.Executable()
	if err != nil {
		return os.Args[0]
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		return real
	}
	return exe
}

// installAutostart copies this program somewhere stable, registers it to start with the computer, and starts it now.
func installAutostart() (plan, error) {
	p := autostartPlan(currentEnv())
	if err := os.MkdirAll(p.dir, 0o755); err != nil {
		return p, err
	}
	if !samePath(self(), p.copyTo) {
		// An older copy may be running (Windows locks running programs): stop it first.
		optional(p.disable)
		stopOtherCopies(p.copyTo)
		if err := copyFile(self(), p.copyTo); err != nil {
			return p, err
		}
	}
	for _, f := range p.files {
		if err := os.MkdirAll(filepath.Dir(f.path), 0o755); err != nil {
			return p, err
		}
		if err := os.WriteFile(f.path, []byte(f.content), 0o644); err != nil {
			return p, err
		}
	}
	if p.icon != "" {
		_ = os.WriteFile(p.icon, iconPNG, 0o644)
	}
	if p.link != "" {
		_ = os.MkdirAll(filepath.Dir(p.link), 0o755)
		_ = os.Remove(p.link)
		_ = os.Symlink(p.copyTo, p.link)
	}
	if err := runSteps(p.enable); err != nil {
		if runtime.GOOS == "linux" {
			return p, fmt.Errorf("%v\nThis computer can't start the bridge by itself (no systemd user services). Run it yourself instead: %s run", err, p.copyTo)
		}
		return p, err
	}
	if runtime.GOOS == "windows" {
		if err := startDetached(p.copyTo, "run", "--no-browser"); err != nil {
			return p, err
		}
	}
	return p, nil
}

// restartAutostart restarts the background bridge, if there is one, so it picks up changed printers. It says whether it did.
func restartAutostart() bool {
	p := autostartPlan(currentEnv())
	if !autostartInstalled(p) {
		return false
	}
	if runtime.GOOS == "windows" {
		stopOtherCopies(p.copyTo)
		return startDetached(p.copyTo, "run", "--no-browser") == nil
	}
	return runSteps(p.restart) == nil
}

// removeFiles deletes what install wrote, the settings (printers and the pairing secret,
// so old pairing links stop working) and the installed copy.
func removeFiles(p plan, configPath string) {
	for _, f := range p.files {
		_ = os.Remove(f.path)
	}
	_ = os.Remove(configPath)
	if p.link != "" {
		if target, err := os.Readlink(p.link); err == nil && strings.HasPrefix(target, p.dir) {
			_ = os.Remove(p.link)
		}
	}
	if err := os.RemoveAll(p.dir); err != nil && runtime.GOOS == "windows" {
		// Windows can't delete the program that is running this: delete it just after this exits.
		_ = deleteAfterExit(p.dir)
	}
}

// uninstallBridge removes the bridge from this computer: stops it, stops it starting
// with the computer, and deletes its copy and its settings.
func uninstallBridge(configPath string) plan {
	p := autostartPlan(currentEnv())
	optional(p.disable)
	stopOtherCopies(p.copyTo)
	removeFiles(p, configPath)
	if runtime.GOOS == "linux" {
		_ = runStep(step{cmd: "systemctl", args: []string{"--user", "daemon-reload"}, optional: true})
	}
	return p
}

// selfUninstall runs when the Device tab removed this bridge: delete everything first,
// then stop starting with the computer, which on a Mac and Linux also stops this very
// process (launchd and systemd keep it running otherwise), and exit.
func selfUninstall(configPath string) {
	p := autostartPlan(currentEnv())
	if !autostartInstalled(p) {
		_ = os.Remove(configPath)
		os.Exit(0)
	}
	if runtime.GOOS == "windows" {
		optional(p.disable)
	}
	removeFiles(p, configPath)
	if runtime.GOOS == "linux" {
		_ = runStep(step{cmd: "systemctl", args: []string{"--user", "daemon-reload"}, optional: true})
	}
	optional(p.disable)
	// Give the service manager a moment; it stops this process itself.
	time.Sleep(500 * time.Millisecond)
	os.Exit(0)
}

func samePath(a, b string) bool {
	ca, errA := filepath.Abs(a)
	cb, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return a == b
	}
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(ca, cb)
	}
	return ca == cb
}
