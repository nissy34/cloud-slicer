package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

// browserKey is the key browsers get, derived from this bridge's secret key (the
// relay derives the same). It lets a browser reach the printers but not connect
// as this bridge, and the secret key itself never leaves this computer.
func browserKey(key string) string {
	m := hmac.New(sha256.New, []byte(key))
	m.Write([]byte("cloud-slicer browser key"))
	return base64url(m.Sum(nil))
}

// pairingCode is base64url of {r: relay, i: bridge id, k: browser key}.
func pairingCode(c *Config) string {
	// Field order matters only for looks; the site parses it as JSON.
	data, _ := json.Marshal(struct {
		R string `json:"r"`
		I string `json:"i"`
		K string `json:"k"`
	}{c.Relay, c.BridgeID, browserKey(c.Key)})
	return base64url(data)
}

func pairingLink(c *Config, site string) string {
	if site == "" {
		site = c.Site
	}
	if site == "" {
		site = defaultSite
	}
	return strings.TrimRight(site, "/") + "/#pair=" + pairingCode(c)
}

func printPairing(c *Config, site string, open bool) {
	link := pairingLink(c, site)
	fmt.Println("\nTo use your printer from Cloud Slicer, open this link in your browser:")
	fmt.Println("  " + link)
	if open {
		openInBrowser(link)
	}
	fmt.Printf("or paste this code:\n  %s\n\n", pairingCode(c))
	fmt.Println("Anyone with this code can control your printers; keep it private.")
	fmt.Println()
}

// openInBrowser opens a link in this computer's browser, if it has one (not on a headless Pi).
func openInBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", `""`, url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	// No browser here: the link is printed anyway.
	if cmd.Start() == nil {
		go func() { _ = cmd.Wait() }()
	}
}
