package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Printer is one printer this bridge serves.
type Printer struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	URL    string `json:"url"`
	APIKey string `json:"apiKey"`
	// Kind: "" for Klipper with Moonraker, else the brand the bridge stands in for (translate.go), like "prusalink".
	Kind string `json:"kind,omitempty"`

	// shown: the printer's own address, when URL is its stand-in's (for messages).
	shown string
}

// Config is the bridge's settings file: its identity (id and secret key), the
// relay and site it belongs to, and its printers.
type Config struct {
	BridgeID string `json:"bridgeId"`
	Key      string `json:"key"`
	Relay    string `json:"relay"`
	Site     string `json:"site,omitempty"`
	// Claimed: the bridge spent a setup code and belongs to a Cloud Slicer account.
	Claimed  bool      `json:"claimed,omitempty"`
	Printers []Printer `json:"printers"`

	path string
	mu   sync.Mutex
}

func randomID(n int, enc func([]byte) string) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return enc(b)
}

func base64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func newPrinterID() string { return randomID(4, hex.EncodeToString) }

// movedRelays: the relays' first addresses and where they live now. Bridges
// set up before the move switch over on their next start (the old addresses
// still answer, so nothing breaks in between).
var movedRelays = map[string]string{
	"https://cloud-slicer-relay.nissy34.workers.dev":      "https://cloud-slicer-relay.awesomestuff.qzz.io",
	"https://cloud-slicer-relay-test.nissy34.workers.dev": "https://cloud-slicer-relay-test.awesomestuff.qzz.io",
}

// loadConfig reads the settings file, making a new bridge id and secret key on first run.
func loadConfig(path, relay string) (*Config, error) {
	cfg := &Config{path: path}
	data, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, errors.New("the settings file " + path + " is damaged: " + err.Error())
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	fresh := cfg.BridgeID == ""
	if fresh {
		cfg.BridgeID = randomID(12, base64url)
		cfg.Key = randomID(24, base64url)
	}
	switch {
	case relay != "":
		cfg.Relay = relay
	case cfg.Relay == "":
		cfg.Relay = defaultRelay
	}
	cfg.Relay = strings.TrimRight(cfg.Relay, "/")
	moved := false
	if to, ok := movedRelays[cfg.Relay]; ok {
		cfg.Relay, moved = to, true
	}
	if cfg.Printers == nil {
		cfg.Printers = []Printer{}
	}
	if fresh || moved {
		if err := cfg.save(); err != nil {
			return nil, err
		}
	}
	return cfg, nil
}

// save writes the settings, readable only by this user (they hold the secret key
// and the printers' API keys). Write then rename, so a crash never leaves half a file.
func (c *Config) save() error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	tmp := c.path + ".new"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.path)
}

// printerList is the id and name of each printer, as the relay shows them to browsers.
func (c *Config) printerList() []map[string]string {
	c.mu.Lock()
	defer c.mu.Unlock()
	list := make([]map[string]string, 0, len(c.Printers))
	for _, p := range c.Printers {
		list = append(list, map[string]string{"id": p.ID, "name": p.Name})
	}
	return list
}

func (c *Config) printer(id string) (Printer, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, p := range c.Printers {
		if p.ID == id {
			return p, true
		}
	}
	return Printer{}, false
}

// upsert adds a printer, or updates the name, key and kind of one already at that address.
func (c *Config) upsert(name, url, apiKey, kind string) Printer {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, p := range c.Printers {
		if p.URL == url {
			c.Printers[i].Name, c.Printers[i].APIKey, c.Printers[i].Kind = name, apiKey, kind
			return c.Printers[i]
		}
	}
	p := Printer{ID: newPrinterID(), Name: name, URL: url, APIKey: apiKey, Kind: kind}
	c.Printers = append(c.Printers, p)
	return p
}

// remove forgets a printer by id (or also by name, from the command line); it says whether there was one.
func (c *Config) remove(id string, byName bool) (Printer, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, p := range c.Printers {
		if p.ID == id || (byName && p.Name == id) {
			c.Printers = append(c.Printers[:i:i], c.Printers[i+1:]...)
			return p, true
		}
	}
	return Printer{}, false
}

func defaultConfigPath() string {
	if p := os.Getenv("CLOUD_SLICER_BRIDGE_CONFIG"); p != "" {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, "."+service+".json")
}
