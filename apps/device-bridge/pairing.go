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

func printPairing(c *Config, site string, open bool) bool {
	link := pairingLink(c, site)
	fmt.Println("\nTo use your printer from Cloud Slicer, open this link in your browser:")
	fmt.Println("  " + link)
	opened := open && openInBrowser(link)
	fmt.Printf("or paste this code:\n  %s\n\n", pairingCode(c))
	fmt.Println("Anyone with this code can control your printers; keep it private.")
	fmt.Println()
	return opened
}

// browserCommand is the program that opens a link in the default browser. On
// Windows that is rundll32, not "cmd /c start": Go quotes arguments the C way
// (an empty "" title becomes \"\"), cmd doesn't read that, and Windows then
// tried to open a file called "\\" instead of the link. rundll32 gets the link
// as it is, and a link (no spaces or quotes) is never quoted.
func browserCommand(goos, url string) (string, []string) {
	switch goos {
	case "windows":
		return "rundll32", []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		return "open", []string{url}
	default:
		return "xdg-open", []string{url}
	}
}

// openInBrowser opens a link in this computer's browser, if it has one (not on a
// headless Pi). It says whether it could.
func openInBrowser(url string) bool {
	name, args := browserCommand(runtime.GOOS, url)
	cmd := exec.Command(name, args...)
	// No browser here: the link is printed anyway.
	if cmd.Start() != nil {
		return false
	}
	go func() { _ = cmd.Wait() }()
	return true
}
