package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

var hasPort = regexp.MustCompile(`:\d+$`)

// candidateURLs turns "192.168.1.50" into Moonraker base URLs, most likely first.
func candidateURLs(address string) []string {
	a := strings.TrimRight(strings.TrimSpace(address), "/")
	lower := strings.ToLower(a)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return []string{a}
	}
	if hasPort.MatchString(a) {
		return []string{"http://" + a}
	}
	return []string{"http://" + a + ":7125", "http://" + a}
}

type probeError struct {
	msg      string
	needsKey bool
}

func (e *probeError) Error() string { return e.msg }

// probe asks Moonraker at url for printer.info.
func probe(ctx context.Context, url, apiKey string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/printer/info", nil)
	if err != nil {
		return nil, err
	}
	if apiKey != "" {
		req.Header.Set("X-Api-Key", apiKey)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		msg := "Moonraker wants an API key (add --api-key KEY)"
		if apiKey != "" {
			msg = "Moonraker did not accept that API key"
		}
		return nil, &probeError{msg, true}
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	var body struct {
		Result map[string]any `json:"result"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body.Result == nil {
		body.Result = map[string]any{}
	}
	return body.Result, nil
}

// probeAddress finds Moonraker at an address the user typed (with or without a port or http://).
func probeAddress(ctx context.Context, address, apiKey string) (string, map[string]any, error) {
	var last error
	for _, url := range candidateURLs(address) {
		info, err := probe(ctx, url, apiKey)
		if err == nil {
			return url, info, nil
		}
		last = err
		var pe *probeError
		if errors.As(err, &pe) && pe.needsKey {
			break
		}
	}
	pe := &probeError{msg: fmt.Sprintf("No Moonraker answered at %s: %v", address, last)}
	var inner *probeError
	if errors.As(last, &inner) {
		pe.needsKey = inner.needsKey
	}
	return "", nil, pe
}

type found struct {
	URL      string `json:"url"`
	Name     string `json:"name"`
	NeedsKey bool   `json:"needsKey"`
	// Kind: "" for Moonraker, else the kind the bridge stands in for (Printer.Kind).
	Kind string `json:"kind,omitempty"`
}

// discover finds every Moonraker answering on port 7125 on this computer's local networks (each /24).
func discover(ctx context.Context, log func(string)) []found {
	hosts := []string{"127.0.0.1"}
	seen := map[string]bool{"127.0.0.1": true}
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() {
			continue
		}
		ip4 := ipnet.IP.To4()
		if ip4 == nil {
			continue
		}
		for i := 1; i < 255; i++ {
			h := fmt.Sprintf("%d.%d.%d.%d", ip4[0], ip4[1], ip4[2], i)
			if !seen[h] {
				seen[h] = true
				hosts = append(hosts, h)
			}
		}
	}
	log(fmt.Sprintf("Looking for printers on your network (%d addresses)...", len(hosts)))
	return probeHosts(ctx, hosts)
}

// discoverOwn finds the Moonraker of the printer this bridge runs on. It answers
// on 127.0.0.1 and on each of the printer's own network addresses, so asking
// all of them would list one printer several times: it gives one.
func discoverOwn(ctx context.Context, log func(string)) []found {
	hosts := []string{"127.0.0.1"}
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			hosts = append(hosts, ipnet.IP.To4().String())
		}
	}
	log("Looking for this printer's Moonraker...")
	return ownPrinter(probeHosts(ctx, hosts), shortHost())
}

// ownPrinter picks the one entry for this printer: one that answers without a
// key if any (127.0.0.1 first: it never changes), else 127.0.0.1.
func ownPrinter(list []found, host string) []found {
	if len(list) == 0 {
		return nil
	}
	loopback := "http://127.0.0.1:7125"
	score := func(f found) int {
		s := 0
		if !f.NeedsKey {
			s += 2
		}
		if f.URL == loopback {
			s++
		}
		return s
	}
	best := list[0]
	for _, f := range list[1:] {
		if score(f) > score(best) {
			best = f
		}
	}
	if net.ParseIP(best.Name) != nil && host != "" {
		best.Name = host
	}
	return []found{best}
}

// probeHosts asks Moonraker's port on each host at once.
func probeHosts(ctx context.Context, hosts []string) []found {
	queue := make(chan string, len(hosts))
	for _, h := range hosts {
		queue <- h
	}
	close(queue)
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	var mu sync.Mutex
	var out []found
	var wg sync.WaitGroup
	for w := 0; w < 64; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for h := range queue {
				// A Prusa printer answers PrusaLink on its web port instead.
				if f, ok := probePrusaHost(ctx, client, h); ok {
					mu.Lock()
					out = append(out, f)
					mu.Unlock()
				}
				url := "http://" + h + ":7125"
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/printer/info", nil)
				if err != nil {
					continue
				}
				res, err := client.Do(req)
				if err != nil {
					continue // nothing there
				}
				f := found{URL: url, Name: h}
				switch {
				case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
					f.NeedsKey = true
				case res.StatusCode == http.StatusOK:
					var body struct {
						Result struct {
							Hostname string `json:"hostname"`
						} `json:"result"`
					}
					if json.NewDecoder(res.Body).Decode(&body) == nil && body.Result.Hostname != "" {
						f.Name = body.Result.Hostname
					}
				default:
					res.Body.Close()
					continue
				}
				res.Body.Close()
				mu.Lock()
				out = append(out, f)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return out
}

// probePrusaHost says whether PrusaLink answers on a host's web port: its
// version without a login, or its own login challenge (realm "Printer API").
func probePrusaHost(ctx context.Context, client *http.Client, h string) (found, bool) {
	url := "http://" + h
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/version", nil)
	if err != nil {
		return found{}, false
	}
	res, err := client.Do(req)
	if err != nil {
		return found{}, false
	}
	defer res.Body.Close()
	f := found{URL: url, Name: h, Kind: kindPrusaLink}
	switch res.StatusCode {
	case http.StatusUnauthorized:
		if !isPrusaChallenge(res.Header.Get("WWW-Authenticate")) {
			return found{}, false
		}
		f.NeedsKey = true
		return f, true
	case http.StatusOK:
		var v struct {
			Text     string `json:"text"`
			Hostname string `json:"hostname"`
		}
		if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&v) != nil || !strings.Contains(strings.ToLower(v.Text), "prusa") {
			return found{}, false
		}
		if v.Hostname != "" {
			f.Name = v.Hostname
		}
		return f, true
	}
	return found{}, false
}
