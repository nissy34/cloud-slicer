package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// upload streams one G-code file from the browser into Moonraker as its chunks
// arrive. Nothing is kept on this computer: on a printer the temp folder is
// often in memory, and a whole file there could starve Klipper.
type upload struct {
	size     int64
	received int64
	w        *io.PipeWriter
	done     chan uploadResult
	mu       sync.Mutex
}

type uploadResult struct {
	path string
	err  error
}

// multipartParts are the form around the file's bytes, as Moonraker's upload wants it.
// Building them by hand gives an exact Content-Length, so the body can stream.
func multipartParts(boundary, name string) (head, tail string) {
	quoted := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\r", "", "\n", "").Replace(name)
	head = "--" + boundary + "\r\n" +
		"Content-Disposition: form-data; name=\"root\"\r\n\r\n" +
		"gcodes\r\n" +
		"--" + boundary + "\r\n" +
		"Content-Disposition: form-data; name=\"file\"; filename=\"" + quoted + "\"\r\n" +
		"Content-Type: application/octet-stream\r\n\r\n"
	tail = "\r\n--" + boundary + "--\r\n"
	return head, tail
}

func (s *Session) uploadBegin(path string, size int64) (any, error) {
	if path == "" {
		path = "print.gcode"
	}
	if size <= 0 {
		return nil, errors.New("The upload has no size: reload the Device tab.")
	}
	if size > maxUpload {
		return nil, errors.New("That file is too big to send.")
	}
	s.mu.Lock()
	if len(s.uploads) >= maxUploads {
		s.mu.Unlock()
		return nil, errors.New("Another upload is still going: wait for it to finish.")
	}
	id := randomID(8, func(b []byte) string { return fmt.Sprintf("%x", b) })
	r, w := io.Pipe()
	up := &upload{size: size, w: w, done: make(chan uploadResult, 1)}
	s.uploads[id] = up
	s.mu.Unlock()

	boundary := randomID(16, func(b []byte) string { return fmt.Sprintf("%x", b) })
	head, tail := multipartParts(boundary, path)
	body := io.MultiReader(strings.NewReader(head), r, strings.NewReader(tail))
	req, err := http.NewRequestWithContext(s.ctx, http.MethodPost, s.printer.URL+"/server/files/upload", body)
	if err != nil {
		return nil, err
	}
	req.ContentLength = int64(len(head)) + size + int64(len(tail))
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	s.keyFor(req)
	go func() {
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			r.CloseWithError(err)
			up.done <- uploadResult{err: fmt.Errorf("Upload failed: %v", err)}
			return
		}
		defer res.Body.Close()
		var out struct {
			Result struct {
				Item struct {
					Path string `json:"path"`
				} `json:"item"`
			} `json:"result"`
			Item struct {
				Path string `json:"path"`
			} `json:"item"`
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&out)
		if res.StatusCode >= 300 {
			msg := out.Error.Message
			if msg == "" {
				msg = fmt.Sprintf("Upload failed: HTTP %d", res.StatusCode)
			}
			// Moonraker answered early: stop whoever is still writing chunks.
			r.CloseWithError(errors.New(msg))
			up.done <- uploadResult{err: errors.New(msg)}
			return
		}
		p := out.Result.Item.Path
		if p == "" {
			p = out.Item.Path
		}
		if p == "" {
			p = path
		}
		up.done <- uploadResult{path: p}
	}()
	return map[string]any{"uploadId": id}, nil
}

func (s *Session) getUpload(id string) (*upload, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	up := s.uploads[id]
	if up == nil {
		return nil, errors.New("Unknown upload")
	}
	return up, nil
}

func (s *Session) uploadChunk(id string, offset int64, data string) (any, error) {
	up, err := s.getUpload(id)
	if err != nil {
		return nil, err
	}
	buf, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return nil, errors.New("Upload chunk is not base64")
	}
	up.mu.Lock()
	defer up.mu.Unlock()
	if offset != up.received {
		return nil, errors.New("Upload chunk out of order")
	}
	if up.received+int64(len(buf)) > up.size {
		return nil, errors.New("Upload is longer than its size")
	}
	if _, err := up.w.Write(buf); err != nil {
		s.forget(id)
		return nil, up.failure(err)
	}
	up.received += int64(len(buf))
	return map[string]any{"received": up.received}, nil
}

func (s *Session) uploadEnd(id string) (any, error) {
	up, err := s.getUpload(id)
	if err != nil {
		return nil, err
	}
	s.forget(id)
	up.mu.Lock()
	short := up.received != up.size
	up.mu.Unlock()
	if short {
		up.abort(errors.New("upload ended early"))
		return nil, fmt.Errorf("The upload stopped after %d of %d bytes.", up.received, up.size)
	}
	_ = up.w.Close()
	select {
	case res := <-up.done:
		if res.err != nil {
			return nil, res.err
		}
		return map[string]any{"path": res.path}, nil
	case <-time.After(5 * time.Minute):
		return nil, errors.New("The printer did not confirm the upload.")
	case <-s.ctx.Done():
		return nil, errors.New("The browser went away.")
	}
}

func (s *Session) forget(id string) {
	s.mu.Lock()
	delete(s.uploads, id)
	s.mu.Unlock()
}

// failure is Moonraker's own reason when it stopped the upload, else the write error.
func (up *upload) failure(err error) error {
	select {
	case res := <-up.done:
		if res.err != nil {
			return res.err
		}
	case <-time.After(2 * time.Second):
	}
	return err
}

func (up *upload) abort(err error) { up.w.CloseWithError(err) }
