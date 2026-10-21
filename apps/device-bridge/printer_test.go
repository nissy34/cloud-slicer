package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPrinterPlanSystemd(t *testing.T) {
	p := printerPlanFor(printerEnv{dataDir: "/home/pi/printer_data", kind: initSystemd})
	if p.exe != "/home/pi/printer_data/cloud-slicer-bridge/cloud-slicer-bridge" || p.config != "/home/pi/printer_data/cloud-slicer-bridge/bridge.json" {
		t.Fatalf("paths: %s %s", p.exe, p.config)
	}
	if p.pairing != "/home/pi/printer_data/config/cloud-slicer-bridge-pairing.txt" {
		t.Fatal(p.pairing)
	}
	unit := p.files[0]
	if unit.path != "/etc/systemd/system/cloud-slicer-bridge.service" {
		t.Fatal(unit.path)
	}
	for _, want := range []string{
		"ExecStart=" + p.exe + " run --no-browser --config " + p.config,
		"Restart=always",
		"KillMode=process", // the Device tab's removal helper must outlive the bridge
		"After=network-online.target moonraker.service",
		"WantedBy=multi-user.target",
	} {
		if !strings.Contains(unit.content, want) {
			t.Errorf("unit lacks %q:\n%s", want, unit.content)
		}
	}
	if got := p.enable[len(p.enable)-1]; got.cmd != "systemctl" || strings.Join(got.args, " ") != "restart cloud-slicer-bridge" {
		t.Fatalf("last enable step: %v", got)
	}
}

func TestPrinterPlanInitScriptsAreValidShell(t *testing.T) {
	for _, kind := range []initKind{initSysV, initProcd} {
		p := printerPlanFor(printerEnv{dataDir: "/home/lava/printer data", kind: kind})
		script := filepath.Join(t.TempDir(), "script")
		content := p.files[0].content
		if kind == initProcd {
			// rc.common supplies the rest; check only that the file parses.
			content = strings.Replace(content, "#!/bin/sh /etc/rc.common", "#!/bin/sh", 1)
		}
		if err := os.WriteFile(script, []byte(content), 0o755); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("sh", "-n", script).CombinedOutput(); err != nil {
			t.Fatalf("%s script doesn't parse: %v\n%s\n%s", kind, err, out, content)
		}
		if !strings.Contains(content, `"/home/lava/printer data/cloud-slicer-bridge/cloud-slicer-bridge" run --no-browser --config`) {
			t.Errorf("%s: program path with a space not quoted:\n%s", kind, content)
		}
		if out, err := exec.Command("sh", "-n", "-c", p.removeScript()).CombinedOutput(); err != nil {
			t.Fatalf("%s remove script doesn't parse: %v %s", kind, err, out)
		}
	}
	sysv := printerPlanFor(printerEnv{dataDir: "/home/lava/printer_data", kind: initSysV})
	if !strings.Contains(sysv.files[0].content, "trap '' HUP") {
		t.Error("the init script's loop must survive the SSH logout of the install")
	}
	if sysv.files[0].path != "/etc/init.d/S99cloud-slicer-bridge" {
		t.Fatal(sysv.files[0].path)
	}
	procd := printerPlanFor(printerEnv{dataDir: "/usr/data/printer_data", kind: initProcd})
	if procd.files[0].path != "/etc/init.d/cloud-slicer-bridge" || !strings.Contains(procd.files[0].content, "procd_set_param respawn") {
		t.Fatal(procd.files[0])
	}
}

func TestPrinterRemoveScriptRemovesEverything(t *testing.T) {
	p := printerPlanFor(printerEnv{dataDir: "/home/pi/printer_data", kind: initSystemd})
	s := p.removeScript()
	for _, want := range []string{"systemctl disable --now cloud-slicer-bridge", "rm -f /etc/systemd/system/cloud-slicer-bridge.service", "systemctl daemon-reload", "rm -f /home/pi/printer_data/config/cloud-slicer-bridge-pairing.txt", "rm -rf /home/pi/printer_data/cloud-slicer-bridge"} {
		if !strings.Contains(s, want) {
			t.Errorf("remove script lacks %q:\n%s", want, s)
		}
	}
	if strings.Contains(s, "rm -rf /home/pi/printer_data\n") {
		t.Fatal("must never remove printer_data itself")
	}
}

func TestFindPrinterData(t *testing.T) {
	dir := t.TempDir()
	if _, err := findPrinterData(dir); err == nil {
		t.Fatal("a folder without config is not printer_data")
	}
	_ = os.Mkdir(filepath.Join(dir, "config"), 0o755)
	if got, err := findPrinterData(dir); err != nil || got != dir {
		t.Fatalf("%s %v", got, err)
	}
}

func TestShellQuote(t *testing.T) {
	for in, want := range map[string]string{"plain/path": "plain/path", "a b": "'a b'", "it's": `'it'\''s'`, "": "''"} {
		if got := shellQuote(in); got != want {
			t.Errorf("shellQuote(%q) = %s, want %s", in, got, want)
		}
	}
}

// The installer downloads a program with the bridge's own name and runs the init
// script's restart from it: stopping must end the installed bridge only, never
// every process of that name (that killed the installer on a Snapmaker U1).
func TestPrinterInitScriptStopsOnlyTheInstalledBridge(t *testing.T) {
	if _, err := os.Stat("/proc/self/exe"); err != nil {
		t.Skip("needs /proc")
	}
	sleep, err := exec.LookPath("sleep")
	if err != nil {
		t.Skip("no sleep")
	}
	tmp := t.TempDir()
	p := printerPlanFor(printerEnv{dataDir: filepath.Join(tmp, "printer data"), kind: initSysV})
	installer := filepath.Join(tmp, "download", service)
	for _, path := range []string{p.exe, installer} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := copyFile(sleep, path); err != nil {
			t.Fatal(err)
		}
		os.Chmod(path, 0o755)
	}
	start := func(path string) *exec.Cmd {
		c := exec.Command(path, "30")
		if err := c.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Process.Kill() })
		return c
	}
	bridge, other := start(p.exe), start(installer)
	done, otherDone := make(chan struct{}), make(chan struct{})
	go func() { bridge.Wait(); close(done) }()
	go func() { other.Wait(); close(otherDone) }()

	script := filepath.Join(tmp, "S99")
	content := strings.Replace(p.files[0].content, "/var/run/", tmp+"/", 1)
	if err := os.WriteFile(script, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("sh", script, "stop").CombinedOutput(); err != nil {
		t.Fatalf("stop: %v %s", err, out)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("the installed bridge is still running")
	}
	select {
	case <-otherDone:
		t.Fatal("stop killed another program with the bridge's name (the installer)")
	case <-time.After(300 * time.Millisecond):
	}
}
