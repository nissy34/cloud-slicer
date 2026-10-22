package main

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

// digestTransport logs in with HTTP digest authentication (RFC 7616, MD5 with
// qop=auth), the way Prusa printers protect PrusaLink. It answers the
// printer's challenge and keeps the nonce for the next requests, so most
// requests go through in one round trip. Request bodies must be replayable
// (GetBody set, as http.NewRequest does for byte and string readers) or sent
// after a first request has already learnt the nonce.
type digestTransport struct {
	user, password string
	next           http.RoundTripper

	mu     sync.Mutex
	params map[string]string // the last challenge
	count  int               // nc: requests sent with this nonce
}

func (t *digestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	next := t.next
	if next == nil {
		next = http.DefaultTransport
	}
	first := req.Clone(req.Context())
	if h := t.header(req.Method, req.URL.RequestURI()); h != "" {
		first.Header.Set("Authorization", h)
	}
	res, err := next.RoundTrip(first)
	if err != nil || res.StatusCode != http.StatusUnauthorized {
		return res, err
	}
	challenge := res.Header.Get("WWW-Authenticate")
	if !strings.HasPrefix(strings.ToLower(challenge), "digest ") {
		return res, nil
	}
	if req.Body != nil && req.GetBody == nil {
		// The body went with the first try and can't be sent again.
		return res, nil
	}
	t.learn(challenge)
	h := t.header(req.Method, req.URL.RequestURI())
	if h == "" {
		return res, nil
	}
	_, _ = io.Copy(io.Discard, res.Body)
	res.Body.Close()
	again := req.Clone(req.Context())
	if req.GetBody != nil {
		body, err := req.GetBody()
		if err != nil {
			return nil, err
		}
		again.Body = body
	}
	again.Header.Set("Authorization", h)
	return next.RoundTrip(again)
}

// learn keeps a new challenge's realm, nonce and options.
func (t *digestTransport) learn(challenge string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.params = parseChallenge(challenge)
	t.count = 0
}

func (t *digestTransport) header(method, uri string) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	p := t.params
	if p == nil || p["nonce"] == "" {
		return ""
	}
	t.count++
	nc := fmt.Sprintf("%08x", t.count)
	cnonce := randomID(8, hex.EncodeToString)
	ha1 := md5hex(t.user + ":" + p["realm"] + ":" + t.password)
	ha2 := md5hex(method + ":" + uri)
	qop := ""
	for _, q := range strings.Split(p["qop"], ",") {
		if strings.TrimSpace(q) == "auth" {
			qop = "auth"
		}
	}
	var response string
	if qop != "" {
		response = md5hex(ha1 + ":" + p["nonce"] + ":" + nc + ":" + cnonce + ":" + qop + ":" + ha2)
	} else {
		response = md5hex(ha1 + ":" + p["nonce"] + ":" + ha2)
	}
	h := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s"`, t.user, p["realm"], p["nonce"], uri, response)
	if p["opaque"] != "" {
		h += fmt.Sprintf(`, opaque="%s"`, p["opaque"])
	}
	if qop != "" {
		h += fmt.Sprintf(`, qop=%s, nc=%s, cnonce="%s"`, qop, nc, cnonce)
	}
	if p["algorithm"] != "" {
		h += ", algorithm=" + p["algorithm"]
	}
	return h
}

func md5hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

// parseChallenge reads `Digest realm="x", nonce="y", qop="auth"` into its parts.
func parseChallenge(h string) map[string]string {
	out := map[string]string{}
	h = strings.TrimSpace(h)
	if i := strings.IndexByte(h, ' '); i >= 0 {
		h = h[i+1:]
	}
	for len(h) > 0 {
		h = strings.TrimLeft(h, " ,")
		eq := strings.IndexByte(h, '=')
		if eq < 0 {
			break
		}
		key := strings.ToLower(strings.TrimSpace(h[:eq]))
		h = h[eq+1:]
		var val string
		if strings.HasPrefix(h, `"`) {
			end := strings.IndexByte(h[1:], '"')
			if end < 0 {
				val, h = h[1:], ""
			} else {
				val, h = h[1:end+1], h[end+2:]
			}
		} else {
			end := strings.IndexByte(h, ',')
			if end < 0 {
				val, h = h, ""
			} else {
				val, h = h[:end], h[end:]
			}
		}
		out[key] = strings.TrimSpace(val)
	}
	return out
}
