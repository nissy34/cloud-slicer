package main

import (
	"context"
	"net"
	"testing"
	"time"
)

// silent listens on a free port and never answers, like a busy or blocked host.
func silent(t *testing.T) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			t.Cleanup(func() { c.Close() })
		}
	}()
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	return port
}

// A host that answers neither port costs one wait, not one per port: asking
// the two one after the other pushed the search past the site's 20 s.
func TestProbeHostsAsksBothPortsAtOnce(t *testing.T) {
	oldM, oldW := moonrakerPort, webPort
	t.Cleanup(func() { moonrakerPort, webPort = oldM, oldW })
	moonrakerPort, webPort = silent(t), silent(t)
	start := time.Now()
	probeHosts(context.Background(), []string{"127.0.0.1"})
	if took := time.Since(start); took > 2500*time.Millisecond {
		t.Fatalf("one silent host took %s, want about one 1.5 s wait", took)
	}
}

// The search answers with what it found by its deadline.
func TestProbeHostsStopsAtDeadline(t *testing.T) {
	oldM, oldW := moonrakerPort, webPort
	t.Cleanup(func() { moonrakerPort, webPort = oldM, oldW })
	moonrakerPort, webPort = silent(t), silent(t)
	hosts := make([]string, 2000)
	for i := range hosts {
		hosts[i] = "127.0.0.1"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, left := probeHosts(ctx, hosts)
	if len(left) == 0 {
		t.Fatal("hosts not asked in time should come back to ask next time")
	}
	if took := time.Since(start); took > time.Second {
		t.Fatalf("search took %s, want it to stop at its deadline", took)
	}
}

// A search that ran out of time carries on with the addresses it didn't ask
// and keeps what it found so far.
func TestDiscoverCarriesOn(t *testing.T) {
	oldM, oldW, oldB := moonrakerPort, webPort, searchBudget
	t.Cleanup(func() {
		moonrakerPort, webPort, searchBudget = oldM, oldW, oldB
		unfinished.Lock()
		unfinished.left, unfinished.found = nil, nil
		unfinished.Unlock()
	})
	moonrakerPort, webPort, searchBudget = silent(t), silent(t), 200*time.Millisecond
	unfinished.Lock()
	unfinished.left = []string{"127.0.0.1", "127.0.0.1"}
	unfinished.found = []found{{URL: "http://10.0.0.1:7125", Name: "lava"}}
	unfinished.at = time.Now()
	unfinished.Unlock()
	list := discover(context.Background(), func(string) {})
	if len(list) != 1 || list[0].Name != "lava" {
		t.Fatalf("lost what the search found before: %+v", list)
	}
	if !searchLeft() {
		t.Fatal("silent hosts cut short should be asked next time")
	}
}
