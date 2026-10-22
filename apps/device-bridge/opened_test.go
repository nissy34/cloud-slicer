package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWindowsInstallAddsAnInstalledAppsEntryAndAStartMenuShortcut(t *testing.T) {
	p := autostartPlan(planEnv{goos: "windows", home: `C:\Users\n`, localAppData: `C:\Users\n\AppData\Local`, appData: `C:\Users\n\AppData\Roaming`})
	values := map[string]string{}
	for _, s := range p.enable {
		if s.cmd == "reg" && s.args[1] == uninstallKey+`\`+runName {
			values[s.args[3]] = s.args[7]
		}
	}
	if values["DisplayName"] != appName || values["Publisher"] != "Cloud Slicer" || values["NoModify"] != "1" {
		t.Fatalf("Installed apps entry %v", values)
	}
	// Its Uninstall button runs the bridge's own uninstall, which needs no admin rights (HKCU).
	if values["UninstallString"] != `"`+p.copyTo+`" uninstall` || !strings.HasPrefix(uninstallKey, `HKCU\`) {
		t.Fatalf("uninstall %q under %s", values["UninstallString"], uninstallKey)
	}
	if p.shortcut != filepath.Join(`C:\Users\n\AppData\Roaming`, "Microsoft", "Windows", "Start Menu", "Programs", appName+".lnk") {
		t.Fatalf("shortcut %s", p.shortcut)
	}
	last := p.enable[len(p.enable)-1]
	if last.cmd != "powershell" || !last.optional || !strings.Contains(last.args[len(last.args)-1], p.shortcut) {
		t.Fatalf("shortcut step %v", last)
	}
	removed := false
	for _, s := range p.disable {
		removed = removed || (s.cmd == "reg" && s.args[0] == "delete" && s.args[1] == uninstallKey+`\`+runName)
	}
	if !removed {
		t.Fatalf("uninstall leaves the Installed apps entry: %v", p.disable)
	}
}

func TestMacInstallPutsTheAppInApplications(t *testing.T) {
	if p := autostartPlan(planEnv{goos: "darwin", home: "/Users/n"}); p.opener != "/Users/n/Applications/"+appName+".app" {
		t.Fatalf("opener %s", p.opener)
	}
}

func TestStatusFileSaysHowTheBridgeIsDoing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bridge.json")
	cfg := &Config{path: path, Printers: []Printer{{ID: "1", Name: "My U1", URL: "http://10.0.0.1"}}}
	if _, ok := readStatus(path); ok {
		t.Fatal("status with no file")
	}
	w := newStatusWriter(cfg, path)
	w.set("online", "")
	st, ok := readStatus(path)
	if !ok || st.State != "online" || len(st.Printers) != 1 || st.Printers[0] != "My U1" {
		t.Fatalf("status %+v %v", st, ok)
	}
	// A bridge that stopped leaves an old file: not running.
	st.At = time.Now().Add(-5 * time.Minute).Unix()
	data, _ := json.Marshal(st)
	_ = os.WriteFile(statusPath(path), data, 0o600)
	if _, ok := readStatus(path); ok {
		t.Fatal("an old status file counts as running")
	}
}

func TestStatusTextInPlainWords(t *testing.T) {
	cases := []struct {
		st      bridgeStatus
		running bool
		want    string
	}{
		{bridgeStatus{State: "online", Printers: []string{"My U1", "Ender"}}, true, "✓ Running, connected to your account\nPrinters: My U1, Ender"},
		{bridgeStatus{State: "online"}, true, "No printers yet"},
		{bridgeStatus{State: "offline"}, true, "Not connected: check the internet"},
		{bridgeStatus{State: "refused", Reason: "Someone turned this bridge off in Cloud Slicer."}, true, "This bridge was turned off in Cloud Slicer."},
		{bridgeStatus{State: "online"}, false, "The bridge isn't running right now."},
	}
	for _, c := range cases {
		if got := statusText(c.st, c.running); !strings.HasPrefix(got, c.want) && !strings.Contains(got, c.want) {
			t.Errorf("%+v: %q", c.st, got)
		}
		if strings.Contains(strings.ToLower(statusText(c.st, c.running)), "token") {
			t.Errorf("says token")
		}
	}
	if got := plain("✗ That setup code expired.\n  Get a new one."); got != "That setup code expired.\nGet a new one." {
		t.Fatalf("plain %q", got)
	}
}

func TestOpeningTheAppNeverReplacesANewerBridge(t *testing.T) {
	if n, ok := buildOf("6 (build 1761091200 windows-x64)\n"); !ok || n != 1761091200 {
		t.Fatalf("build %d %v", n, ok)
	}
	if n, ok := buildOf("6 (build 42 mac-arm64 test)"); !ok || n != 42 {
		t.Fatalf("test build %d %v", n, ok)
	}
	if _, ok := buildOf("something else"); ok {
		t.Fatal("parsed nonsense")
	}
}

func TestRemovingTheBridgeTellsTheRelayWithItsOwnKey(t *testing.T) {
	var got map[string]string
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"ok":true,"account":true}`))
	}))
	defer srv.Close()
	cfg := &Config{Relay: srv.URL, BridgeID: "abc123", Key: "secret-secret-secret", Claimed: true}
	if !leaveAccount(cfg) || path != "/v1/bridges/abc123/release" || got["key"] != cfg.Key {
		t.Fatalf("release %s %v", path, got)
	}
	// Not in an account: nothing to tell.
	cfg.Claimed, path = false, ""
	if leaveAccount(cfg) || path != "" {
		t.Fatal("told the relay about a bridge in no account")
	}
}
