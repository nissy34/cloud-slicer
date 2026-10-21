// Cloud Slicer bridge: lets the Device tab reach printers on your home network.
//
// Runs on any always-on computer near the printer (a PC, Raspberry Pi, NAS),
// or on the printer's own Klipper computer. It connects OUT to the relay over
// a websocket, so nothing on your router needs opening. The relay hands it the
// browser's Moonraker messages; it passes them to the printer and sends the
// answers back. It only talks to printers you added here.
//
//	cloud-slicer-bridge                     # starts with this computer from now on (once it is in an account)
//	cloud-slicer-bridge add 192.168.1.50 [--name "My U1"] [--api-key KEY]
//	cloud-slicer-bridge list | remove <name> | pair [--open] | version
//	cloud-slicer-bridge install [--code C] | uninstall  # start with this computer, or remove it from it
//	cloud-slicer-bridge run [--no-browser]   # just run, in this terminal
//	cloud-slicer-bridge install-printer      # on a Klipper printer, as root: a service that serves it
//
// Options: --config <file> (default ~/.cloud-slicer-bridge.json),
// --relay <url>, --site <url> (where pairing links point), --code <setup code>
// (from Cloud Slicer's Add a bridge: joins that account; install and install-printer),
// --printer-data <folder> (install-printer and uninstall on a printer with more than one).
//
// One small file per system and chip, with nothing else to install:
// see build.sh. Part of Cloud Slicer (AGPL-3.0): https://github.com/nissy34/cloud-slicer
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
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
	console := useParentConsole()
	if err := run(os.Args[1:], console); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		if !console {
			showMessage("Cloud Slicer Bridge", err.Error(), true)
		}
		// The install scripts ask for a new setup code on this one.
		if errors.As(err, new(setupCodeError)) {
			os.Exit(exitSetupCode)
		}
		os.Exit(1)
	}
}

func run(argv []string, console bool) error {
	opts, rest := parseArgs(argv)
	path := opts["config"]
	if path == "" {
		path = defaultConfigPath()
	}
	// Opened by hand (a double click, or plain "cloud-slicer-bridge" in a terminal):
	// set it up to start with the computer, no questions. Services always say "run --no-browser".
	interactive := len(rest) == 0 && opts["no-browser"] == ""
	cmd := "run"
	if len(rest) > 0 {
		cmd, rest = rest[0], rest[1:]
	}
	if cmd == "version" {
		fmt.Printf("%s (build %s %s)\n", version, build, target)
		return nil
	}
	// On a printer the settings live with the program in printer_data, not in a home folder.
	if cmd == "install-printer" {
		p, cfg, err := installOnPrinter(opts["printer-data"], opts["relay"], opts["code"])
		if err != nil {
			return err
		}
		fmt.Printf("The bridge now runs on this printer (from %s) and starts with it.\n", p.dir)
		if len(cfg.Printers) > 0 {
			fmt.Printf("It serves %s.\n", cfg.Printers[0].Name)
		}
		if cfg.Claimed {
			fmt.Println("Find it in Cloud Slicer: Device tab, Printers & bridges.")
			fmt.Printf("Remove it: Remove bridge in Printers & bridges, or sudo %s uninstall\n", p.exe)
			return nil
		}
		fmt.Printf("To remove it: sudo %s uninstall, or Remove bridge in the Device tab.\n", p.exe)
		fmt.Printf("The pairing link is also in Mainsail and Fluidd, in the config folder: %s\n", filepath.Base(p.pairing))
		printPairing(cfg, opts["site"], false)
		return nil
	}
	if cmd == "uninstall" {
		if p, ok := printerInstall(opts["printer-data"]); ok {
			if os.Geteuid() != 0 {
				return errors.New("Removing the bridge from the printer needs root: run it with sudo.")
			}
			if err := uninstallFromPrinter(p, false); err != nil {
				return err
			}
			fmt.Println("Removed the bridge from this printer: its service, program, printers and pairing are gone.")
			fmt.Println("Remove it from the Device tab too (Printers & bridges).")
			return nil
		}
	}
	cfg, err := loadConfig(path, opts["relay"])
	if err != nil {
		return err
	}
	if opts["site"] != "" {
		cfg.Site = opts["site"]
	}
	ctx := context.Background()
	restarted := func(yes, no string) string {
		if restartAutostart() {
			return yes
		}
		return no
	}

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
		fmt.Printf("Added %s (%s).%s\n", name, url, restarted(" The bridge restarted to use it.", " Restart the bridge if it is running."))
		if !cfg.Claimed {
			printPairing(cfg, opts["site"], false)
		}
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
		fmt.Printf("Removed %s.%s\n", rest[0], restarted(" The bridge restarted without it.", ""))
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
	case "install":
		// It joins the account first: a setup code that doesn't work installs nothing.
		if err := joinAccount(cfg, opts["code"], ""); err != nil {
			return err
		}
		p, err := installAutostart()
		if err != nil {
			return err
		}
		if cfg.Claimed {
			printInstalled(p)
			return nil
		}
		fmt.Printf("The bridge now starts by itself with this computer (from %s), and is running.\n", p.copyTo)
		fmt.Printf("To remove it from this computer: %s uninstall\n", commandFor(p.copyTo))
		printPairing(cfg, opts["site"], opts["no-browser"] == "")
	case "uninstall":
		uninstallBridge(path)
		fmt.Println("Removed the bridge from this computer: it has stopped, no longer starts with the computer, and its printers and pairing are deleted.")
		fmt.Println("Remove its printers from the Device tab too (Printers & bridges).")
	case "run":
		if interactive {
			if done := openedByHand(cfg, opts["site"], console); done {
				return nil
			}
		}
		if !cfg.Claimed {
			printPairing(cfg, opts["site"], opts["no-browser"] == "")
		}
		log := func(m string) { fmt.Println(m) }
		// Just updated: this version has to reach the relay, or the previous one comes back.
		connected := func() {}
		installed, updates := installedPath()
		if updates {
			connected = afterUpdate(installed, log)
		}
		stop := make(chan struct{})
		b := runBridge(cfg, bridgeOptions{
			log:         log,
			find:        testFind(),
			onReplaced:  func() { close(stop) },
			uninstall:   func() { uninstallFromDeviceTab(path) },
			autoUpdate:  updates,
			onConnected: connected,
		})
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		select {
		case <-sig:
		case <-stop:
		}
		b.stop()
	default:
		return fmt.Errorf("Unknown command %s. Commands: add, remove, list, pair, run, install, uninstall, version", cmd)
	}
	return nil
}

// openedByHand sets the bridge up to start with the computer and opens the pairing
// link, then this copy is done: the background copy does the work. A newly
// downloaded app opened while an older one is installed replaces it (that's how
// it updates). It says false when the bridge can't start by itself here, so this
// copy keeps running instead.
func openedByHand(cfg *Config, site string, console bool) bool {
	if err := joinAccount(cfg, "", ""); err != nil {
		// Opened by hand without a setup code: say where to get one, and set nothing up.
		msg := err.Error() + "\n\nCopy the command shown there and run it."
		fmt.Println(msg)
		if !console {
			showMessage("Cloud Slicer Bridge", msg, false)
		}
		return true
	}
	p := autostartPlan(currentEnv())
	updating := autostartInstalled(p)
	if updating && samePath(self(), p.copyTo) {
		fmt.Println("The bridge already runs in the background and starts with this computer.")
	} else if _, err := installAutostart(); err != nil {
		fmt.Printf("\nThe bridge can't start by itself on this computer (%v). It runs while this stays open.\n", err)
		return false
	} else if updating {
		fmt.Println("Updated the bridge that runs in the background to this version.")
	} else {
		fmt.Printf("\nThe bridge now runs in the background and starts by itself with this computer (from %s).\n", p.copyTo)
	}
	if cfg.Claimed {
		printInstalled(p)
		if !console {
			showMessage("Cloud Slicer Bridge", "The bridge is running and is in your Cloud Slicer account. It starts by itself whenever you sign in, with no window.\n\nFind it in Cloud Slicer: Device tab, Printers & bridges.", false)
		}
		return true
	}
	fmt.Printf("To remove it from this computer: %s uninstall\n", commandFor(p.copyTo))
	opened := printPairing(cfg, site, true)
	if !console {
		showMessage("Cloud Slicer Bridge", doneMessage(opened, pairingLink(cfg, site)), false)
	}
	return true
}

// doneMessage is what someone who double-clicked the app reads once it is set up.
func doneMessage(browserOpened bool, link string) string {
	text := "The bridge is running in the background. It has no window and starts by itself whenever you sign in to this computer.\n\n"
	if browserOpened {
		return text + "Cloud Slicer is opening in your browser: pick your printer there."
	}
	return text + "To pick your printer, open this link in your browser:\n" + link
}

// printInstalled says what the install did, once the bridge is in an account.
func printInstalled(p plan) {
	fmt.Printf("Installed in %s\n", filepath.Dir(p.copyTo))
	switch runtime.GOOS {
	case "windows":
		fmt.Println("It starts by itself whenever you sign in to Windows, with no window.")
	case "darwin":
		fmt.Println("It starts by itself whenever you log in to this Mac, with no window.")
	default:
		fmt.Println("It starts by itself with this computer, in the background.")
	}
	fmt.Println("Find it in Cloud Slicer: Device tab, Printers & bridges.")
	fmt.Printf("Remove it: Remove bridge in Printers & bridges, or %s uninstall\n", commandFor(p.copyTo))
}

// commandFor is how to run the installed bridge again, for messages. On Windows
// "cmd /c call" makes the same line work in PowerShell and in Command Prompt.
func commandFor(path string) string {
	if runtime.GOOS == "windows" {
		return `cmd /c call "` + path + `"`
	}
	if strings.ContainsAny(path, " ") {
		return `"` + path + `"`
	}
	return path
}

// uninstallFromDeviceTab removes the bridge when the Device tab asks, then exits.
func uninstallFromDeviceTab(configPath string) {
	// Tests check the request without uninstalling anything.
	if marker := os.Getenv("CLOUD_SLICER_BRIDGE_TEST_UNINSTALL"); marker != "" {
		_ = os.WriteFile(marker, []byte("uninstall"), 0o644)
		os.Exit(0)
	}
	if p, ok := installedOnPrinter(); ok {
		// The helper stops the service, which stops this bridge too.
		_ = uninstallFromPrinter(p, true)
		select {}
	}
	selfUninstall(configPath)
}

// testFind lets tests pretend what a network search finds: the JSON list in the
// file CLOUD_SLICER_BRIDGE_TEST_FIND names, read on each search. Nil means search for real.
func testFind() func(context.Context) []found {
	path := os.Getenv("CLOUD_SLICER_BRIDGE_TEST_FIND")
	if path == "" {
		return nil
	}
	return func(context.Context) []found {
		var list []found
		if data, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(data, &list)
		}
		return list
	}
}
