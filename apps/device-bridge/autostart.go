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

const runKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

// uninstallKey is where Windows' Settings, Apps, Installed apps finds the bridge (per user, no admin).
const uninstallKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`

// appNames are the names the bridge installs under. A test build (flavor
// "test", downloaded from the test relay) has names of its own, so it runs
// next to the real bridge and removing one never touches the other.
type appNames struct {
	service string // program, service and folder name
	label   string // macOS launch agent
	runName string // Windows Run entry
	app     string // the name people see
}

func namesFor(flavor string) appNames {
	n := appNames{"cloud-slicer-bridge", "io.qzz.awesomestuff.cloud-slicer-bridge", "CloudSlicerBridge", "Cloud Slicer Bridge"}
	if flavor != "" {
		n.service += "-" + flavor
		n.label += "." + flavor
		n.runName += strings.ToUpper(flavor[:1]) + flavor[1:]
		n.app += " (" + flavor + ")"
	}
	return n
}

var (
	names   = namesFor(flavor)
	service = names.service
	label   = names.label
	runName = names.runName
	appName = names.app
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
	// shortcut: the Start menu entry on Windows, which opens the status window.
	shortcut string
	// opener: on a Mac, the copy of the app in Applications that opens the status window.
	opener string
}

type planEnv struct {
	goos         string
	home         string
	localAppData string
	appData      string
	user         string
}

func currentEnv() planEnv {
	home, _ := os.UserHomeDir()
	name := os.Getenv("USER")
	if u, err := user.Current(); err == nil {
		name = u.Username
	}
	return planEnv{goos: runtime.GOOS, home: home, localAppData: os.Getenv("LOCALAPPDATA"), appData: os.Getenv("APPDATA"), user: name}
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
		dir := filepath.Join(base, appName)
		exe := filepath.Join(dir, service+".exe")
		value := fmt.Sprintf(`"%s" run --no-browser`, exe)
		roaming := e.appData
		if roaming == "" {
			roaming = filepath.Join(e.home, "AppData", "Roaming")
		}
		shortcut := filepath.Join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", appName+".lnk")
		entry := uninstallKey + `\` + runName
		set := func(name, kind, data string) step {
			return step{cmd: "reg", args: []string{"add", entry, "/v", name, "/t", kind, "/d", data, "/f"}}
		}
		// PowerShell makes the shortcut (Windows has no command for it); without one, the rest still works.
		ps := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
		link := "$s = (New-Object -ComObject WScript.Shell).CreateShortcut(" + ps(shortcut) + "); $s.TargetPath = " + ps(exe) +
			"; $s.WorkingDirectory = " + ps(dir) + "; $s.Description = 'See how the bridge is doing, or remove it'; $s.Save()"
		return plan{
			dir:    dir,
			copyTo: exe,
			enable: []step{
				{cmd: "reg", args: []string{"add", runKey, "/v", runName, "/t", "REG_SZ", "/d", value, "/f"}},
				set("DisplayName", "REG_SZ", appName),
				set("DisplayIcon", "REG_SZ", exe),
				set("DisplayVersion", "REG_SZ", version),
				set("Publisher", "REG_SZ", "Cloud Slicer"),
				set("InstallLocation", "REG_SZ", dir),
				set("UninstallString", "REG_SZ", fmt.Sprintf(`"%s" uninstall`, exe)),
				set("NoModify", "REG_DWORD", "1"),
				set("NoRepair", "REG_DWORD", "1"),
				{cmd: "powershell", args: []string{"-NoProfile", "-NonInteractive", "-Command", link}, optional: true},
			},
			disable: []step{
				{cmd: "reg", args: []string{"delete", runKey, "/v", runName, "/f"}, optional: true},
				{cmd: "reg", args: []string{"delete", entry, "/f"}, optional: true},
			},
			shortcut: shortcut,
		}
	case "darwin":
		dir := filepath.Join(e.home, "Library", "Application Support", appName)
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
			opener:  filepath.Join(e.home, "Applications", appName+".app"),
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
			// A menu entry, with the app's icon, that opens the Device tab.
			{filepath.Join(e.home, ".local", "share", "applications", service+".desktop"), `[Desktop Entry]
Type=Application
Name=` + appName + `
Comment=Open your printers in Cloud Slicer
Exec=` + quoteArgs(exe, "open") + `
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
		// Installed apps shows its size.
		if st, err := os.Stat(p.copyTo); err == nil {
			_ = runStep(step{cmd: "reg", args: []string{"add", uninstallKey + `\` + runName, "/v", "EstimatedSize", "/t", "REG_DWORD", "/d", fmt.Sprint(st.Size() / 1024), "/f"}, optional: true})
		}
		if err := startDetached(p.copyTo, "run", "--no-browser"); err != nil {
			return p, err
		}
	}
	installOpener(p)
	return p, nil
}

// bundleOf is the Mac app (.app folder) the program at path is in, or "".
func bundleOf(path string) string {
	dir := filepath.Dir(path)
	if filepath.Base(dir) != "MacOS" || filepath.Base(filepath.Dir(dir)) != "Contents" {
		return ""
	}
	if app := filepath.Dir(filepath.Dir(dir)); strings.HasSuffix(app, ".app") {
		return app
	}
	return ""
}

// installOpener puts a copy of the Mac app in Applications (the one in your home
// folder, no admin): opening it shows the status window. Only when this program is
// in a .app (a download or the install command), and not when this is that copy.
func installOpener(p plan) {
	app := bundleOf(self())
	if p.opener == "" || app == "" || samePath(app, p.opener) {
		return
	}
	_ = os.RemoveAll(p.opener)
	if err := copyDir(app, p.opener); err != nil {
		_ = os.RemoveAll(p.opener)
	}
}

// copyDir copies a folder as it is: files keep their permissions, links stay links.
func copyDir(from, to string) error {
	return filepath.Walk(from, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(from, path)
		dst := filepath.Join(to, rel)
		switch {
		case info.Mode()&os.ModeSymlink != 0:
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(target, dst)
		case info.IsDir():
			return os.MkdirAll(dst, info.Mode().Perm()|0o700)
		default:
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			return os.WriteFile(dst, data, info.Mode().Perm())
		}
	})
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

// removeFiles deletes what install wrote, the settings (printers and the bridge's
// secret key) and the installed copy.
func removeFiles(p plan, configPath string) {
	for _, f := range p.files {
		_ = os.Remove(f.path)
	}
	if p.shortcut != "" {
		_ = os.Remove(p.shortcut)
	}
	if p.opener != "" && !strings.HasPrefix(self(), p.opener+string(filepath.Separator)) {
		_ = os.RemoveAll(p.opener)
	} else if p.opener != "" {
		// Removed from that very copy (its status window): it goes just after this exits.
		_ = startDetached("/bin/sh", "-c", `sleep 2; rm -rf "$0"`, p.opener)
	}
	_ = os.Remove(configPath)
	_ = os.Remove(statusPath(configPath))
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
