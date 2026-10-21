package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeRelay serves a signed release of the given downloads, as CI publishes them.
func fakeRelay(t *testing.T, build int64, files map[string][]byte, priv ed25519.PrivateKey, tamper func(*release)) *httptest.Server {
	t.Helper()
	r := release{Build: build, Apps: map[string]releaseFile{}}
	for name, data := range files {
		sum := sha256.Sum256(data)
		sha := hex.EncodeToString(sum[:])
		r.Apps[name] = releaseFile{Size: int64(len(data)), SHA256: sha, Sig: base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, signedText(name, build, sha)))}
	}
	if tamper != nil {
		tamper(&r)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/bridge-release.json" {
			_ = json.NewEncoder(w).Encode(r)
			return
		}
		if data, ok := files[strings.TrimPrefix(req.URL.Path, "/download/")]; ok {
			_, _ = w.Write(data)
			return
		}
		http.NotFound(w, req)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testKey(t *testing.T) (string, ed25519.PrivateKey) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(pub), priv
}

func TestFetchUpdateInstallsOnlyNewerSignedBuilds(t *testing.T) {
	key, priv := testKey(t)
	program := []byte("new bridge program")
	ctx := context.Background()

	srv := fakeRelay(t, 200, map[string][]byte{"linux-arm64": program}, priv, nil)
	got, b, err := fetchUpdate(ctx, srv.URL, "linux-arm64", 100, 0, key)
	if err != nil || b != 200 || !bytes.Equal(got, program) {
		t.Fatalf("newer signed build: %q %d %v", got, b, err)
	}
	if _, _, err := fetchUpdate(ctx, srv.URL, "linux-arm64", 200, 0, key); !errors.Is(err, errUpToDate) {
		t.Fatalf("same build should be up to date, got %v", err)
	}
	if _, _, err := fetchUpdate(ctx, srv.URL, "linux-arm64", 100, 200, key); !errors.Is(err, errUpToDate) {
		t.Fatalf("a build that failed here before should be skipped, got %v", err)
	}
	if _, _, err := fetchUpdate(ctx, srv.URL, "linux-x64", 100, 0, key); err == nil {
		t.Fatal("no build for this chip should be an error")
	}
	other, _ := testKey(t)
	if _, _, err := fetchUpdate(ctx, srv.URL, "linux-arm64", 100, 0, other); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("signed with another key must be refused, got %v", err)
	}
	if _, _, err := fetchUpdate(ctx, srv.URL, "linux-arm64", 100, 0, ""); err == nil {
		t.Fatal("a bridge without a key must never update")
	}
}

func TestFetchUpdateRefusesTamperedReleases(t *testing.T) {
	key, priv := testKey(t)
	ctx := context.Background()
	program := []byte("new bridge program")
	cases := map[string]func(*release){
		// The relay swaps in another file and its hash: the signature no longer matches.
		"other file": func(r *release) {
			f := r.Apps["linux-arm64"]
			sum := sha256.Sum256([]byte("evil"))
			f.SHA256, f.Size = hex.EncodeToString(sum[:]), 4
			r.Apps["linux-arm64"] = f
		},
		// An x64 signature can't be passed off as the arm64 build.
		"other chip": func(r *release) { r.Apps["linux-arm64"] = r.Apps["linux-x64"] },
		// An old signed build can't be replayed as a newer one.
		"replayed build": func(r *release) { r.Build = 300 },
		// The release says one size, the download has another.
		"wrong size": func(r *release) {
			f := r.Apps["linux-arm64"]
			f.Size++
			r.Apps["linux-arm64"] = f
		},
	}
	for name, tamper := range cases {
		srv := fakeRelay(t, 200, map[string][]byte{"linux-arm64": program, "linux-x64": []byte("x64 program")}, priv, tamper)
		if _, _, err := fetchUpdate(ctx, srv.URL, "linux-arm64", 100, 0, key); err == nil || errors.Is(err, errUpToDate) {
			t.Errorf("%s: should be refused, got %v", name, err)
		}
	}
}

func TestFetchUpdateTakesTheProgramOutOfTheMacZip(t *testing.T) {
	key, priv := testKey(t)
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	w, _ := z.Create("Cloud Slicer Bridge.app/Contents/Info.plist")
	_, _ = w.Write([]byte("<plist/>"))
	w, _ = z.Create("Cloud Slicer Bridge.app/Contents/MacOS/cloud-slicer-bridge")
	_, _ = w.Write([]byte("mac program"))
	_ = z.Close()
	srv := fakeRelay(t, 200, map[string][]byte{"mac-arm64": buf.Bytes()}, priv, nil)
	got, _, err := fetchUpdate(context.Background(), srv.URL, "mac-arm64", 100, 0, key)
	if err != nil || string(got) != "mac program" {
		t.Fatalf("got %q %v", got, err)
	}
}

func TestSwapInKeepsTheOldProgramUntilTheNewOneWorks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cloud-slicer-bridge")
	if err := os.WriteFile(path, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := swapIn(path, []byte("new"), 200); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); string(b) != "new" {
		t.Fatalf("program is %q", b)
	}
	if b, _ := os.ReadFile(path + ".old"); string(b) != "old" {
		t.Fatalf("old copy is %q", b)
	}
	var restarted []string
	restartInto = func(p string) { restarted = append(restarted, p) }
	defer func() { restartInto = restartIntoProcess }()

	// Reached the relay: the old copy and the note go.
	connected := afterUpdate(path, func(string) {})
	connected()
	for i := 0; i < 50 && fileExists(path+".old"); i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if fileExists(path+".old") || fileExists(path+".update") {
		t.Fatal("after reaching the relay the old copy and the note should be gone")
	}

	// Started twice without reaching the relay: the old program comes back and the build is skipped.
	_ = os.WriteFile(path, []byte("old"), 0o755)
	if err := swapIn(path, []byte("broken"), 300); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(path+".update", []byte("300 2"), 0o644)
	afterUpdate(path, func(string) {})
	if b, _ := os.ReadFile(path); string(b) != "old" {
		t.Fatalf("after a failed update the program is %q", b)
	}
	if skipped(path) != 300 || len(restarted) != 1 {
		t.Fatalf("skip %d, restarts %v", skipped(path), restarted)
	}
	if fileExists(path + ".update") {
		t.Fatal("the note should be gone after going back")
	}
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func TestBuildNumbers(t *testing.T) {
	if ownBuild() != 0 {
		t.Fatalf("a test build has no build number, got %d", ownBuild())
	}
	if _, ok := installedPath(); ok {
		t.Fatal("a program without a target, build or key must never update itself")
	}
	if got := string(signedText("linux-x64", 5, "ab")); got != fmt.Sprintf("cloud-slicer-bridge %s %d %s", "linux-x64", 5, "ab") {
		t.Fatal(got)
	}
}
