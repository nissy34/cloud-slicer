package main

import (
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

// upload streams one G-code file from the browser into Moonraker as its chunks
// arrive. Nothing is kept on this computer: on a printer the temp folder is
// often in memory, and a whole file there could starve Klipper.
//
// The browser zips the file (gzip) when that helps. Its bytes come over a
// direct WebRTC link when one connects (bridge.upload_start with an offer),
// else over the relay one piece at a time: raw bytes (bridge.upload_piece) or,
// through an older relay, base64 (bridge.upload_chunk).
type upload struct {
	name string
	// size is the file's own size: Moonraker's Content-Length.
	size int64
	// wire is how many bytes the browser sends: the zipped size when zipped.
	wire     int64
	received int64
	w        *io.PipeWriter
	done     chan uploadResult
	mu       sync.Mutex
	// direct is the upload's own WebRTC link while it may still send pieces.
	direct *webrtc.PeerConnection
	// cancel stops the request to Moonraker, even once every byte has arrived here.
	cancel context.CancelFunc
	// finished: the printer's answer, waited for once however many ask (the
	// direct link and, when it stalled after the last byte, the relay).
	finished sync.Once
	result   any
	err      error
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

// uploadParams is bridge.upload_start's: the file's name and size, how many
// bytes will come (the zipped size when zipped), and an offer for a direct link.
type uploadParams struct {
	Path   string  `json:"path"`
	Size   float64 `json:"size"`
	Wire   float64 `json:"wire"`
	Zipped bool    `json:"zipped"`
	SDP    string  `json:"sdp"`
}

// gunzip unzips lazily: gzip.NewReader reads the header at once, and the
// first bytes only arrive once the upload has started.
type gunzip struct {
	r io.Reader
	z *gzip.Reader
}

func (g *gunzip) Read(p []byte) (int, error) {
	if g.z == nil {
		z, err := gzip.NewReader(g.r)
		if err != nil {
			return 0, errors.New("the zipped file is damaged")
		}
		g.z = z
	}
	return g.z.Read(p)
}

// uploadBegin answers the older bridge.upload_begin: the file as it is, in base64 chunks.
func (s *Session) uploadBegin(path string, size int64) (any, error) {
	return s.uploadStart(uploadParams{Path: path, Size: float64(size)})
}

// uploadStart opens an upload, and a direct link for its bytes when the browser offers one.
func (s *Session) uploadStart(p uploadParams) (any, error) {
	path, size, wire := p.Path, int64(p.Size), int64(p.Wire)
	if path == "" {
		path = "print.gcode"
	}
	if !p.Zipped {
		wire = size
	}
	if size <= 0 || wire <= 0 {
		return nil, errors.New("The upload has no size: reload the Device tab.")
	}
	if size > maxUpload || wire > maxUpload {
		return nil, errors.New("That file is too big to send.")
	}
	s.mu.Lock()
	if len(s.uploads) >= maxUploads {
		s.mu.Unlock()
		return nil, errors.New("Another upload is still going: wait for it to finish.")
	}
	id := randomID(8, func(b []byte) string { return fmt.Sprintf("%x", b) })
	r, w := io.Pipe()
	ctx, cancel := context.WithCancel(s.ctx)
	up := &upload{name: path, size: size, wire: wire, w: w, done: make(chan uploadResult, 1), cancel: cancel}
	s.uploads[id] = up
	s.mu.Unlock()

	var file io.Reader = r
	if p.Zipped {
		file = &gunzip{r: r}
	}
	boundary := randomID(16, func(b []byte) string { return fmt.Sprintf("%x", b) })
	head, tail := multipartParts(boundary, path)
	// Content-Length is the unzipped size: Go's client refuses a body that
	// unzips to more or less, so a damaged or oversized zip can't reach the printer.
	body := io.MultiReader(strings.NewReader(head), file, strings.NewReader(tail))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.printer.URL+"/server/files/upload", body)
	if err != nil {
		cancel()
		s.forget(id)
		return nil, err
	}
	req.ContentLength = int64(len(head)) + size + int64(len(tail))
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	s.keyFor(req)
	go func() {
		defer cancel()
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
			msg := fmt.Sprintf("The printer refused the file (HTTP %d).", res.StatusCode)
			if why := strings.TrimSuffix(strings.TrimSpace(out.Error.Message), "."); why != "" {
				msg = fmt.Sprintf("The printer refused the file: %s (HTTP %d).", why, res.StatusCode)
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
	// stream: pieces over the relay may come without waiting for each answer.
	answer := map[string]any{"uploadId": id, "stream": true}
	if p.SDP != "" {
		// No direct link is no failure: the bytes come over the relay instead.
		if sdp, err := s.uploadDirect(id, up, p.SDP); err == nil {
			answer["sdp"] = sdp
		}
	}
	return answer, nil
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

// uploadChunk answers bridge.upload_chunk: a piece in base64, through an older relay.
func (s *Session) uploadChunk(id string, offset int64, data string) (any, error) {
	buf, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return nil, errors.New("Upload chunk is not base64")
	}
	return s.uploadPiece(id, offset, buf)
}

// uploadPiece writes one piece that came over the relay; it must follow the last.
func (s *Session) uploadPiece(id string, offset int64, buf []byte) (any, error) {
	up, err := s.getUpload(id)
	if err != nil {
		return nil, err
	}
	up.mu.Lock()
	defer up.mu.Unlock()
	if up.direct != nil {
		return nil, errors.New("This upload is going over the direct link.")
	}
	if offset != up.received {
		return nil, errors.New("Upload chunk out of order")
	}
	if err := up.write(buf); err != nil {
		s.forget(id)
		return nil, err
	}
	return map[string]any{"received": up.received}, nil
}

// write passes bytes on to Moonraker; up.mu is held.
func (up *upload) write(buf []byte) error {
	if up.received+int64(len(buf)) > up.wire {
		up.w.CloseWithError(errors.New("upload too long"))
		return errors.New("Upload is longer than its size")
	}
	if _, err := up.w.Write(buf); err != nil {
		return up.failure(err)
	}
	up.received += int64(len(buf))
	return nil
}

// uploadResume answers bridge.upload_resume: the direct link didn't connect or
// dropped, so it is closed and the browser carries on over the relay from
// what arrived.
func (s *Session) uploadResume(id string) (any, error) {
	up, err := s.getUpload(id)
	if err != nil {
		return nil, err
	}
	up.mu.Lock()
	pc := up.direct
	up.direct = nil
	received := up.received
	up.mu.Unlock()
	if pc != nil {
		go pc.Close()
	}
	s.debug(fmt.Sprintf("Upload %s: over the relay from byte %d", up.name, received))
	return map[string]any{"received": received}, nil
}

// uploadCancel answers bridge.upload_cancel: the browser stopped the upload.
// Moonraker gets an incomplete file and keeps nothing.
func (s *Session) uploadCancel(id string) (any, error) {
	up, err := s.getUpload(id)
	if err != nil {
		// Already finished or gone: nothing to stop.
		return map[string]any{"ok": true}, nil
	}
	s.forget(id)
	up.abort(errors.New("upload cancelled"))
	s.debug(fmt.Sprintf("Upload %s: cancelled", up.name))
	return map[string]any{"ok": true}, nil
}

func (s *Session) uploadEnd(id string) (any, error) {
	up, err := s.getUpload(id)
	if err != nil {
		return nil, err
	}
	// Kept until the printer answers, so Cancel can still stop it.
	defer s.forget(id)
	return up.finish()
}

// finish waits for Moonraker once every byte has arrived.
func (up *upload) finish() (any, error) {
	up.finished.Do(func() { up.result, up.err = up.waitPrinter() })
	return up.result, up.err
}

func (up *upload) waitPrinter() (any, error) {
	up.mu.Lock()
	short := up.received != up.wire
	received, wire := up.received, up.wire
	up.mu.Unlock()
	if short {
		up.abort(errors.New("upload ended early"))
		return nil, fmt.Errorf("The upload stopped after %d of %d bytes.", received, wire)
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

// abort stops the upload: Moonraker gets an incomplete body and keeps nothing.
func (up *upload) abort(err error) {
	// First: a write waiting on Moonraker holds up.mu until this frees it.
	up.w.CloseWithError(err)
	// And the request itself, which may already have every byte.
	up.cancel()
	up.mu.Lock()
	pc := up.direct
	up.direct = nil
	up.mu.Unlock()
	if pc != nil {
		go pc.Close()
	}
}

// uploadDirect answers the browser's offer with a link for this upload's
// bytes: binary messages on data channel "upload", in order. When the last
// byte is in, the bridge answers on the channel with text {path} or {error}.
func (s *Session) uploadDirect(id string, up *upload, sdp string) (string, error) {
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		return "", err
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		_ = pc.Close()
		return "", err
	}
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		if dc.Label() != "upload" {
			return
		}
		answer := func(v map[string]any) {
			out, _ := json.Marshal(v)
			_ = dc.SendText(string(out))
		}
		dc.OnMessage(func(m webrtc.DataChannelMessage) {
			if m.IsString {
				return
			}
			up.mu.Lock()
			if up.direct != pc {
				// Resumed over the relay (or ended): this link no longer writes.
				up.mu.Unlock()
				return
			}
			err := up.write(m.Data)
			last := err == nil && up.received == up.wire
			if err != nil || last {
				up.direct = nil
			}
			up.mu.Unlock()
			if err != nil {
				s.forget(id)
				answer(map[string]any{"error": err.Error()})
				return
			}
			if !last {
				return
			}
			s.debug(fmt.Sprintf("Upload %s: %d bytes over the direct link", up.name, up.received))
			go func() {
				// Kept until the printer answers, so Cancel can still stop it.
				defer s.forget(id)
				res, err := up.finish()
				if err != nil {
					answer(map[string]any{"error": err.Error()})
				} else {
					answer(res.(map[string]any))
				}
				// Let the answer leave before the link closes.
				time.Sleep(time.Second)
				_ = pc.Close()
			}()
		})
	})
	connected := make(chan struct{})
	var once sync.Once
	pc.OnConnectionStateChange(func(st webrtc.PeerConnectionState) {
		if st == webrtc.PeerConnectionStateConnected {
			once.Do(func() { close(connected) })
		}
	})
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		_ = pc.Close()
		return "", err
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		_ = pc.Close()
		return "", err
	}
	select {
	case <-gathered:
	case <-time.After(3 * time.Second):
	case <-s.ctx.Done():
		_ = pc.Close()
		return "", s.ctx.Err()
	}
	up.mu.Lock()
	up.direct = pc
	up.mu.Unlock()
	// A link that never connects only holds the upload until the browser resumes over the relay.
	go func() {
		ctx, cancel := context.WithTimeout(s.ctx, connectTimeout)
		defer cancel()
		select {
		case <-connected:
		case <-ctx.Done():
			up.mu.Lock()
			if up.direct == pc {
				up.direct = nil
			}
			up.mu.Unlock()
			_ = pc.Close()
		}
	}()
	return pc.LocalDescription().SDP, nil
}

// pieceHeader is the JSON at the front of a binary upload piece from the browser:
// 4 bytes (big-endian) with its length, the header, then the piece's bytes.
type pieceHeader struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params struct {
		UploadID string  `json:"uploadId"`
		Offset   float64 `json:"offset"`
	} `json:"params"`
}

// fromBrowserBinary takes a binary message from the browser: only upload pieces come as bytes.
func (s *Session) fromBrowserBinary(data []byte) {
	if len(data) < 4 {
		return
	}
	n := binary.BigEndian.Uint32(data)
	if uint64(n) > uint64(len(data)-4) {
		return
	}
	var h pieceHeader
	if json.Unmarshal(data[4:4+n], &h) != nil || h.Method != "bridge.upload_piece" {
		return
	}
	piece := data[4+n:]
	s.takePiece(func() {
		result, err := s.uploadPiece(h.Params.UploadID, int64(h.Params.Offset), piece)
		s.reply(h.ID, result, err)
	})
}

// takePiece runs upload pieces one after another, in the order they came:
// the browser streams them without waiting for each answer, and each must
// follow the last. The browser keeps at most 8 MiB unanswered, so the queue
// never fills and the relay's reader never waits here.
func (s *Session) takePiece(f func()) {
	s.piecesOnce.Do(func() {
		s.pieces = make(chan func(), 64)
		go func() {
			for {
				select {
				case f := <-s.pieces:
					f()
				case <-s.ctx.Done():
					return
				}
			}
		}()
	})
	select {
	case s.pieces <- f:
	case <-s.ctx.Done():
	}
}
