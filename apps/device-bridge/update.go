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
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Set at build time (build.sh, -ldflags -X): which download this program is
// (linux-arm64, mac-x64, ...) and when it was built (the commit's Unix time).
// A program without them never updates itself.
var (
	target = ""
	build  = "0"
)

// updateKey is the public half of the key CI signs bridge releases with
// (base64url, ed25519). A release that isn't signed with it is never installed,
// so whoever runs the relay or its download store can't push code to bridges.
var updateKey = ""

// restartInto replaces this process with the program at path (tests stub it).
var restartInto = restartIntoProcess

const (
	updateEvery   = 6 * time.Hour
	updateFirst   = 2 * time.Minute
	updateBusy    = 10 * time.Minute
	updateTimeout = 2 * time.Minute // the new copy has this long to reach the relay, or the old one comes back
)

// release is what the relay serves at /bridge-release.json: the newest build and,
// per download, its size, SHA-256 and signature.
type release struct {
	Build int64                  `json:"build"`
	Apps  map[string]releaseFile `json:"apps"`
}

type releaseFile struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Sig    string `json:"sig"`
}

// signedText is what a release signature covers: the download, the build and the
// file's hash, so a signature can't be reused for another chip or an older build.
func signedText(name string, build int64, sha string) []byte {
	return []byte(fmt.Sprintf("cloud-slicer-bridge %s %d %s", name, build, sha))
}

func ownBuild() int64 {
	n, _ := strconv.ParseInt(build, 10, 64)
	return n
}

// pick checks a release against this program: newer, for this download, signed
// with key. It says what to fetch, or why there's nothing to do.
func pick(r release, name string, have int64, key string) (releaseFile, error) {
	if r.Build <= have {
		return releaseFile{}, errUpToDate
	}
	f, ok := r.Apps[name]
	if !ok {
		return releaseFile{}, fmt.Errorf("the new version has no %s build", name)
	}
	pub, err := base64.RawURLEncoding.DecodeString(key)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return releaseFile{}, errors.New("this bridge has no key to check updates with")
	}
	sig, err := base64.RawURLEncoding.DecodeString(f.Sig)
	if err != nil || !ed25519.Verify(pub, signedText(name, r.Build, strings.ToLower(f.SHA256)), sig) {
		return releaseFile{}, errors.New("the new version's signature doesn't match: not installing it")
	}
	if f.Size <= 0 || f.Size > 64<<20 {
		return releaseFile{}, errors.New("the new version's size is wrong")
	}
	return f, nil
}

var errUpToDate = errors.New("up to date")

// checked returns the downloaded file if it is exactly what the release says.
func checked(data []byte, f releaseFile) error {
	if int64(len(data)) != f.Size {
		return fmt.Errorf("download is %d bytes, expected %d", len(data), f.Size)
	}
	sum := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), f.SHA256) {
		return errors.New("download doesn't match its checksum")
	}
	return nil
}

// programFrom takes the program out of a download: the Mac apps come as a zipped .app.
func programFrom(name string, data []byte) ([]byte, error) {
	if !strings.HasPrefix(name, "mac-") {
		return data, nil
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	for _, f := range z.File {
		if strings.HasSuffix(f.Name, ".app/Contents/MacOS/cloud-slicer-bridge") {
			r, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer r.Close()
			return io.ReadAll(io.LimitReader(r, 64<<20))
		}
	}
	return nil, errors.New("the Mac download has no program in it")
}

// installedPath is the program to replace: this one, but only when it is the
// copy set up to start with the computer (a copy opened by hand is left alone).
func installedPath() (string, bool) {
	if target == "" || ownBuild() == 0 || updateKey == "" {
		return "", false
	}
	p := autostartPlan(currentEnv())
	if !autostartInstalled(p) || !samePath(self(), p.copyTo) {
		return "", false
	}
	return p.copyTo, true
}

// autoUpdate checks for a new version a little after start and then every few
// hours, and installs it when no browser is connected (so no upload is cut off).
func (b *Bridge) autoUpdate() {
	if _, ok := installedPath(); !ok {
		return
	}
	wait := updateFirst
	for {
		select {
		case <-b.ctx.Done():
			return
		case <-time.After(wait):
		}
		b.mu.Lock()
		busy := len(b.sessions) > 0
		b.mu.Unlock()
		if busy {
			wait = updateBusy
			continue
		}
		wait = updateEvery
		u, err := b.prepareUpdate()
		if err == nil {
			err = b.applyUpdate(u)
		}
		if err != nil && !errors.Is(err, errUpToDate) {
			b.opts.log("Update: " + err.Error())
		}
	}
}

// pendingUpdate is a downloaded and checked new version, ready to swap in.
type pendingUpdate struct {
	path    string
	program []byte
	build   int64
}

// prepareUpdate fetches and checks a newer version, if there is one.
func (b *Bridge) prepareUpdate() (pendingUpdate, error) {
	path, ok := installedPath()
	if !ok {
		return pendingUpdate{}, errors.New("This bridge wasn't set up to start with its computer, so it can't update itself: download it again.")
	}
	ctx, cancel := context.WithTimeout(b.ctx, 5*time.Minute)
	defer cancel()
	program, newBuild, err := fetchUpdate(ctx, b.cfg.Relay, target, ownBuild(), skipped(path), updateKey)
	return pendingUpdate{path, program, newBuild}, err
}

// fetchUpdate asks the relay for its newest release and, if it is newer than
// have (and isn't the one that failed here, skip), downloads and checks the
// program for this download name. Nothing is written anywhere.
func fetchUpdate(ctx context.Context, relay, name string, have, skip int64, key string) ([]byte, int64, error) {
	relay = strings.TrimRight(relay, "/")
	var r release
	if err := getJSON(ctx, relay+"/bridge-release.json", &r); err != nil {
		return nil, 0, fmt.Errorf("couldn't check for updates: %w", err)
	}
	if r.Build == skip {
		return nil, 0, errUpToDate // this build was tried here and didn't work
	}
	f, err := pick(r, name, have, key)
	if err != nil {
		return nil, 0, err
	}
	data, err := getBytes(ctx, relay+"/download/"+name, f.Size)
	if err != nil {
		return nil, 0, fmt.Errorf("couldn't download the update: %w", err)
	}
	if err := checked(data, f); err != nil {
		return nil, 0, err
	}
	program, err := programFrom(name, data)
	if err != nil {
		return nil, 0, err
	}
	return program, r.Build, nil
}

// applyUpdate swaps the new version in and restarts into it; it returns only on failure.
func (b *Bridge) applyUpdate(u pendingUpdate) error {
	if err := swapIn(u.path, u.program, u.build); err != nil {
		return err
	}
	b.opts.log(fmt.Sprintf("Updated to build %d; restarting.", u.build))
	b.stop()
	restartInto(u.path)
	return nil
}

// swapIn puts the new program in place and keeps the old one beside it
// (<path>.old) with a note (<path>.update) until the new one has proved it works.
func swapIn(path string, program []byte, newBuild int64) error {
	tmp := path + ".new"
	if err := os.WriteFile(tmp, program, 0o755); err != nil {
		return err
	}
	_ = os.Remove(path + ".old")
	// A running program can be renamed (Windows too), just not overwritten in place.
	if err := os.Rename(path, path+".old"); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Rename(path+".old", path)
		return err
	}
	return os.WriteFile(path+".update", []byte(fmt.Sprintf("%d 0", newBuild)), 0o644)
}

// afterUpdate runs as a freshly updated bridge starts. Started twice without
// reaching the relay, it puts the old program back and restarts into that.
// Otherwise it returns a function to call once the relay has been reached, and
// gives up on this version if that hasn't happened within updateTimeout.
func afterUpdate(path string, log func(string)) func() {
	note := path + ".update"
	data, err := os.ReadFile(note)
	if err != nil {
		return func() {}
	}
	var newBuild, starts int64
	fmt.Sscan(string(data), &newBuild, &starts)
	if starts >= 2 {
		rollBack(path, newBuild, log)
		return func() {}
	}
	_ = os.WriteFile(note, []byte(fmt.Sprintf("%d %d", newBuild, starts+1)), 0o644)
	ok := make(chan struct{})
	go func() {
		select {
		case <-ok:
			_ = os.Remove(note)
			// On Windows the old program may still be exiting.
			for i := 0; i < 10 && os.Remove(path+".old") != nil; i++ {
				time.Sleep(time.Second)
			}
		case <-time.After(updateTimeout):
			rollBack(path, newBuild, log)
		}
	}()
	once := false
	return func() {
		if !once {
			once = true
			close(ok)
		}
	}
}

// rollBack puts the previous program back, notes the failed build so it isn't
// tried again (<path>.skip), and restarts into the previous program.
func rollBack(path string, bad int64, log func(string)) {
	_ = os.Remove(path + ".update")
	if _, err := os.Stat(path + ".old"); err != nil {
		return
	}
	log("The updated bridge couldn't reach the relay: going back to the previous version.")
	_ = os.WriteFile(path+".skip", []byte(strconv.FormatInt(bad, 10)), 0o644)
	_ = os.Remove(path + ".bad")
	if os.Rename(path, path+".bad") == nil && os.Rename(path+".old", path) == nil {
		restartInto(path)
	}
}

// skipped is the build that failed here before (0 if none).
func skipped(path string) int64 {
	data, _ := os.ReadFile(path + ".skip")
	n, _ := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	return n
}

func getJSON(ctx context.Context, url string, v any) error {
	data, err := getBytes(ctx, url, 1<<20)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

// getBytes downloads at most limit bytes (one more is an error).
func getBytes(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s answered %d", url, res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("download is too big")
	}
	return data, nil
}
