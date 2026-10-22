package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
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

// searchBudget is how long a network search may take: the site gives up on
// bridge.discover after 20 s, so the bridge answers with what it found by then.
var searchBudget = 15 * time.Second

// The ports a search asks: Moonraker's and the web port (PrusaLink). Tests change them.
var moonrakerPort, webPort = "7125", "80"

// unfinished is a network search that ran out of time: the addresses it didn't
// ask yet and what it found so far. The next search (the site asks again by
// itself) carries on from there instead of starting over.
var unfinished struct {
	sync.Mutex
	left  []string
	found []found
	at    time.Time
}

// searchLeft says whether the last search ran out of time with addresses still to ask.
func searchLeft() bool {
	unfinished.Lock()
	defer unfinished.Unlock()
	return len(unfinished.left) > 0
}

// discover finds every Moonraker (and PrusaLink, OctoPrint, Elegoo) on this
// computer's local networks (each /24). A search that runs out of
// time carries on where it stopped the next time it's asked, within a minute.
func discover(ctx context.Context, log func(string)) []found {
	hosts := searchHosts()
	unfinished.Lock()
	var before []found
	if len(unfinished.left) > 0 && time.Since(unfinished.at) < time.Minute {
		hosts, before = unfinished.left, unfinished.found
	}
	unfinished.Unlock()
	log(fmt.Sprintf("Looking for printers on your network (%d addresses)...", len(hosts)))
	ctx, cancel := context.WithTimeout(ctx, searchBudget)
	defer cancel()
	// Elegoo printers answer one question to the whole network, meanwhile.
	elegoos := make(chan []found, 1)
	go func() { elegoos <- discoverElegoo(ctx) }()
	got, left := probeHosts(ctx, hosts)
	all := withElegoos(append(append([]found{}, before...), got...), <-elegoos)
	unfinished.Lock()
	unfinished.left, unfinished.found, unfinished.at = left, nil, time.Now()
	if len(left) > 0 {
		unfinished.found = all
	}
	unfinished.Unlock()
	return all
}

// searchHosts lists every address of this computer's local networks: 127.0.0.1,
// then each card's /24, Wi-Fi and cable cards before the ones WSL, Hyper-V,
// Docker, virtual machines or VPNs made. 169.254.x.x is a card with no network
// behind it: skipped.
func searchHosts() []string {
	hosts := []string{"127.0.0.1"}
	seen := map[string]bool{"127.0.0.1": true}
	ifaces, _ := net.Interfaces()
	sort.SliceStable(ifaces, func(i, j int) bool { return !virtualCard(ifaces[i].Name) && virtualCard(ifaces[j].Name) })
	for _, ifc := range ifaces {
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok || ipnet.IP.IsLoopback() {
				continue
			}
			ip4 := ipnet.IP.To4()
			if ip4 == nil || ip4.IsLinkLocalUnicast() {
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
	}
	return hosts
}

// virtualCard says whether a network card's name looks like one a program made
// (WSL, Hyper-V, Docker, VirtualBox, VMware, VPNs) rather than Wi-Fi or a cable.
func virtualCard(name string) bool {
	n := strings.ToLower(name)
	for _, w := range []string{"vethernet", "wsl", "hyper-v", "docker", "veth", "br-", "virbr", "vmnet", "vmware", "virtualbox", "vbox", "utun", "tun", "tap", "wg", "tailscale", "zerotier", "vpn"} {
		if strings.Contains(n, w) {
			return true
		}
	}
	return false
}

// withElegoos adds the Elegoo printers found, in place of anything else the
// same address answered as (their web page isn't a printer API).
func withElegoos(list, elegoos []found) []found {
	if len(elegoos) == 0 {
		return list
	}
	ips := map[string]bool{}
	for _, f := range elegoos {
		ips[hostOf(f.URL)] = true
	}
	out := []found{}
	for _, f := range list {
		if !ips[hostOf(f.URL)] {
			out = append(out, f)
		}
	}
	return append(out, elegoos...)
}

func hostOf(raw string) string {
	if u, err := url.Parse(raw); err == nil {
		return u.Hostname()
	}
	return raw
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
	list, _ := probeHosts(ctx, hosts)
	return ownPrinter(list, shortHost())
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

// probeHosts asks each host, many at once, whether a printer answers: Moonraker
// on port 7125, PrusaLink and OctoPrint on the web port, all at the same time. Hosts not
// asked before ctx ends come back in left, so the answer comes back in time.
func probeHosts(ctx context.Context, hosts []string) (list []found, left []string) {
	queue := make(chan string, len(hosts))
	for _, h := range hosts {
		queue <- h
	}
	close(queue)
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	var mu sync.Mutex
	var out []found
	add := func(f found) {
		mu.Lock()
		out = append(out, f)
		mu.Unlock()
	}
	var wg sync.WaitGroup
	for w := 0; w < 128; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for h := range queue {
				if ctx.Err() != nil {
					mu.Lock()
					left = append(left, h)
					mu.Unlock()
					continue
				}
				// Each kind at the same time: a Prusa printer answers PrusaLink on
				// its web port, OctoPrint answers there or on 5000.
				var all sync.WaitGroup
				var mine sync.Mutex
				answered := false
				for _, probe := range []func(context.Context, *http.Client, string) (found, bool){probeMoonrakerHost, probePrusaHost, probeOctoHost} {
					all.Add(1)
					go func() {
						defer all.Done()
						if f, ok := probe(ctx, client, h); ok {
							mine.Lock()
							answered = true
							mine.Unlock()
							add(f)
						}
					}()
				}
				all.Wait()
				if ctx.Err() != nil && !answered {
					// Cut short: it may not have answered in time, ask it next time.
					mu.Lock()
					left = append(left, h)
					mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
	return out, left
}

// probeMoonrakerHost says whether Moonraker answers on a host's port 7125.
func probeMoonrakerHost(ctx context.Context, client *http.Client, h string) (found, bool) {
	url := "http://" + h + ":" + moonrakerPort
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/printer/info", nil)
	if err != nil {
		return found{}, false
	}
	res, err := client.Do(req)
	if err != nil {
		return found{}, false // nothing there
	}
	defer res.Body.Close()
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
		return found{}, false
	}
	return f, true
}

// probePrusaHost says whether PrusaLink answers on a host's web port: its
// version without a login, or its own login challenge (realm "Printer API").
func probePrusaHost(ctx context.Context, client *http.Client, h string) (found, bool) {
	url := "http://" + h
	if webPort != "80" {
		url += ":" + webPort
	}
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
