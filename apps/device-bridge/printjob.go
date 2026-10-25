package main

// Print history (apps/web/src/lib/prints.ts): the bridge tells the account when
// a print starts and how it ends, on every printer it serves, so a plate counts
// as printed with every browser closed and however the print was started (the
// Send window, the printer's screen, a file downloaded and copied over). With
// each it passes the file's cloud_slicer_print line as it is, read from the
// head of the file on the printer: the site works out which project and plate
// it was. A file without one is matched by its name on the site.

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// headBytes: how much of a file is read for its tag (Orca's header block comes first; the tag right after it).
const headBytes = 16 << 10

// printTagPrefix starts the line the site puts in every G-code it sends or downloads.
const printTagPrefix = "; cloud_slicer_print = "

// jobWatcher sees a printer's print state change and says when a print started or ended.
type jobWatcher struct {
	seen  bool
	state string
	file  string
	// late: the last end was already there when the watch began (the bridge
	// restarted, or lost the printer for a while): it may be the end of a print
	// it saw start, or of an older one; the site decides.
	late bool
}

var jobRunning = map[string]bool{"printing": true, "paused": true}

// update takes the printer's state now and says "printing" when a print
// started (or was going on when the watch began), its end state ("complete",
// "cancelled", "error") when it ended, or "".
func (j *jobWatcher) update(state, file string) string {
	was, wasFile, seen := j.state, j.file, j.seen
	j.seen, j.state, j.file, j.late = true, state, file, false
	switch {
	case file == "":
		if seen && jobRunning[was] && wasFile != "" {
			// The file was taken away mid-print (Klipper's SDCARD_RESET_FILE): it didn't finish.
			j.file = wasFile
			return "cancelled"
		}
		return ""
	case jobRunning[state]:
		if !seen || !jobRunning[was] || wasFile != file {
			return "printing"
		}
	case state == "complete" || state == "cancelled" || state == "error":
		if !seen {
			j.late = true
			return state
		}
		if jobRunning[was] && wasFile == file {
			return state
		}
	case state == "standby":
		if seen && jobRunning[was] && wasFile == file {
			return "cancelled"
		}
	}
	return ""
}

func (j *jobWatcher) reset() { *j = jobWatcher{} }

// printTagIn is the cloud_slicer_print line in the head of a G-code, as it is, or "".
func printTagIn(head []byte) string {
	sc := bufio.NewScanner(bytes.NewReader(head))
	sc.Buffer(make([]byte, 0, 4096), headBytes)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(line, printTagPrefix) && len(line) <= 200 {
			return line
		}
	}
	return ""
}

// headReader is a brand that can read the start of a file on its printer.
type headReader interface {
	head(ctx context.Context, path string, n int) ([]byte, error)
}

// fileHead reads the first headBytes of a G-code on the printer (Moonraker's
// own, or through the brand's API), or says why it can't.
func fileHead(ctx context.Context, p Printer, file string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if p.Kind != "" {
		standIns.mu.Lock()
		s := standIns.m[p.ID]
		standIns.mu.Unlock()
		if s == nil {
			return nil, errors.New("no stand-in")
		}
		h, ok := s.b.(headReader)
		if !ok {
			return nil, errors.New("this kind of printer can't give a file's start")
		}
		return h.head(ctx, file, headBytes)
	}
	return rangeGet(ctx, http.DefaultClient, strings.TrimRight(p.URL, "/")+"/server/files/gcodes/"+escapePath(file), p.APIKey, headBytes)
}

// rangeGet reads the first n bytes at raw (asking for only those; a server that sends all is cut off).
func rangeGet(ctx context.Context, client *http.Client, raw, apiKey string, n int) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Range", "bytes=0-"+strconv.Itoa(n-1))
	if apiKey != "" {
		req.Header.Set("X-Api-Key", apiKey)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusPartialContent {
		return nil, errors.New(res.Status)
	}
	return io.ReadAll(io.LimitReader(res.Body, int64(n)))
}
