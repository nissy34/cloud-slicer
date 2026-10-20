// Cloud Slicer bridge: lets the Device tab reach printers on your home network.
//
// Runs on any always-on computer near the printer (a PC, Raspberry Pi, NAS),
// or on the printer's own Klipper computer. It connects OUT to the relay over
// a websocket, so nothing on your router needs opening. The relay hands it the
// browser's Moonraker messages; it passes them to the printer and sends the
// answers back. It only talks to printers you added here.
//
//	cloud-slicer-bridge                     # pairs and keeps running
//	cloud-slicer-bridge add 192.168.1.50 [--name "My U1"] [--api-key KEY]
//	cloud-slicer-bridge list | remove <name> | pair [--open] | version
//
// Options: --config <file> (default ~/.cloud-slicer-bridge.json),
// --relay <url>, --site <url> (where pairing links point).
//
// One small file per system and chip, with nothing else to install:
// see build.sh. Part of Cloud Slicer (AGPL-3.0): https://github.com/nissy34/cloud-slicer
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

// version is what the bridge reports to the Device tab; it compares it as a number.
// The Node.js bridge is version 5.
const version = "6"

// Set at build time (-ldflags -X) to the relay and site the bridge belongs to.
var (
	defaultRelay = "https://cloud-slicer-relay.nissy34.workers.dev"
	defaultSite  = "https://slicer.awesomestuff.qzz.io"
)

// parseArgs splits "--name value" options from the command and its arguments.
// An option with no value after it is true.
func parseArgs(argv []string) (map[string]string, []string) {
	opts := map[string]string{}
	var rest []string
	for i := 0; i < len(argv); i++ {
		a := argv[i]
		switch {
		case strings.HasPrefix(a, "--"):
			k := a[2:]
			if i+1 < len(argv) && !strings.HasPrefix(argv[i+1], "--") {
				opts[k] = argv[i+1]
				i++
			} else {
				opts[k] = "true"
			}
		case strings.HasPrefix(a, "-psn_"): // older macOS adds -psn_… to apps opened from Finder
		default:
			rest = append(rest, a)
		}
	}
	return opts, rest
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run(argv []string) error {
	opts, rest := parseArgs(argv)
	path := opts["config"]
	if path == "" {
		path = defaultConfigPath()
	}
	cmd := "run"
	if len(rest) > 0 {
		cmd, rest = rest[0], rest[1:]
	}
	if cmd == "version" {
		fmt.Println(version)
		return nil
	}
	cfg, err := loadConfig(path, opts["relay"])
	if err != nil {
		return err
	}
	if opts["site"] != "" {
		cfg.Site = opts["site"]
	}
	ctx := context.Background()

	switch cmd {
	case "add":
		if len(rest) == 0 {
			return errors.New("Usage: add <address> [--name NAME] [--api-key KEY]")
		}
		apiKey := opts["api-key"]
		url, info, err := probeAddress(ctx, rest[0], apiKey)
		if err != nil {
			return err
		}
		name := opts["name"]
		if name == "" {
			name, _ = info["hostname"].(string)
		}
		if name == "" {
			name = rest[0]
		}
		cfg.upsert(name, url, apiKey)
		if err := cfg.save(); err != nil {
			return err
		}
		fmt.Printf("Added %s (%s). Restart the bridge if it is running.\n", name, url)
		printPairing(cfg, opts["site"], false)
	case "remove":
		if len(rest) == 0 {
			return errors.New("Usage: remove <name>")
		}
		if _, ok := cfg.remove(rest[0], true); !ok {
			fmt.Printf("No printer called %s.\n", rest[0])
			return nil
		}
		if err := cfg.save(); err != nil {
			return err
		}
		fmt.Printf("Removed %s.\n", rest[0])
	case "list":
		for _, p := range cfg.Printers {
			key := ""
			if p.APIKey != "" {
				key = "  (API key)"
			}
			fmt.Printf("%s  %s  %s%s\n", p.ID, p.Name, p.URL, key)
		}
		if len(cfg.Printers) == 0 {
			fmt.Println("No printers yet. Add one: cloud-slicer-bridge add <address>")
		}
	case "pair":
		printPairing(cfg, opts["site"], opts["open"] == "true")
	case "run":
		printPairing(cfg, opts["site"], opts["no-browser"] == "" && isTerminal())
		done := make(chan struct{})
		b := runBridge(cfg, bridgeOptions{
			log:        func(m string) { fmt.Println(m) },
			onReplaced: func() { close(done) },
		})
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		select {
		case <-sig:
		case <-done:
		}
		b.stop()
	default:
		return fmt.Errorf("Unknown command %s. Commands: add, remove, list, pair, run, version", cmd)
	}
	return nil
}

// isTerminal says whether this was started from a terminal (not a service), so opening a browser makes sense.
func isTerminal() bool {
	fi, err := os.Stdin.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}
