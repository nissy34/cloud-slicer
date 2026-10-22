package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// openedByHand: the app was opened without a command (a double click on the
// download, the Start menu, Applications, or the bare command in a terminal).
// It asks for a setup code if the bridge has none yet, sets the bridge up to
// start with the computer (a newer download replaces the installed copy: that's
// how it updates by hand), then shows how it is doing. This copy is then done:
// the background copy does the work. It says false when the bridge can't start
// by itself here, so this copy keeps running instead.
func openedByHand(cfg *Config, path, site string, console bool) bool {
	if !cfg.Claimed {
		err := joinAccount(cfg, "", "")
		switch {
		case errors.As(err, new(setupCodeError)):
			if !askForCode(cfg, console) {
				return true
			}
		case err != nil:
			say(console, err.Error(), true)
			return true
		}
	}
	p := autostartPlan(currentEnv())
	installed := autostartInstalled(p)
	switch {
	case samePath(self(), p.copyTo) || (installed && !newerThanInstalled(p.copyTo)):
		if !installed {
			if _, err := installAutostart(); err != nil {
				fmt.Printf("\nThe bridge can't start by itself on this computer (%v). It runs while this stays open.\n", err)
				return false
			}
		}
	default:
		if _, err := installAutostart(); err != nil {
			fmt.Printf("\nThe bridge can't start by itself on this computer (%v). It runs while this stays open.\n", err)
			return false
		}
		if installed {
			fmt.Println("Updated the bridge that runs in the background to this version.")
		} else {
			fmt.Printf("\nThe bridge now runs in the background and starts by itself with this computer (from %s).\n", p.copyTo)
		}
	}
	if !cfg.Claimed {
		// A relay without accounts (a test or private one): pair with the link, as before.
		fmt.Printf("To remove it from this computer: %s uninstall\n", commandFor(p.copyTo))
		opened := printPairing(cfg, site, true)
		if !console {
			showMessage(appName, doneMessage(opened, pairingLink(cfg, site)), false)
		}
		return true
	}
	if console || !guiAvailable {
		printInstalled(p)
		if st, running := waitForStatus(path); running {
			fmt.Println(strings.ReplaceAll(statusText(st, true), "✓ ", ""))
		}
		return true
	}
	if joinedAs != "" {
		// Just joined with the code: the green message, until it's closed.
		if guiChoice(appName, "✓ Connected to your Cloud Slicer account as "+joinedAs+".\n\n"+startsBy(), "Open Cloud Slicer", "Close", "", false) == 0 {
			openInBrowser(deviceTab(cfg, site))
		}
		return true
	}
	statusWindow(cfg, path, site)
	return true
}

// askForCode asks for the setup code until one works; false when cancelled (nothing installed).
func askForCode(cfg *Config, console bool) bool {
	prompt := "Paste the setup code from Cloud Slicer (Printers & bridges, Add a bridge):"
	// A Windows app has no input of its own from a terminal: the command line has the code.
	if console && runtime.GOOS == "windows" {
		fmt.Println("The bridge needs a setup code from Cloud Slicer: Printers & bridges, Add a bridge. Copy the command shown there and run it.")
		return false
	}
	in := bufio.NewReader(os.Stdin)
	for {
		var code string
		var ok bool
		if console {
			fmt.Print(prompt + " ")
			line, err := in.ReadString('\n')
			code, ok = strings.TrimSpace(line), err == nil || line != ""
		} else {
			code, ok = guiAsk(appName, prompt, "Cancel")
			code = strings.TrimSpace(code)
		}
		if !ok || code == "" {
			fmt.Println("Nothing installed.")
			return false
		}
		err := joinAccount(cfg, code, "")
		if err == nil {
			return true
		}
		msg := plain(err.Error())
		if console {
			fmt.Println(err.Error())
		}
		if errors.As(err, new(setupCodeError)) {
			prompt = msg + "\n\nPaste the new setup code here:"
		} else {
			prompt = msg + "\n\nTry again, or paste another setup code:"
		}
	}
}

// plain drops the terminal's ✗ and indents, for a window.
func plain(msg string) string {
	return strings.ReplaceAll(strings.TrimPrefix(msg, "✗ "), "\n  ", "\n")
}

func say(console bool, msg string, isError bool) {
	fmt.Println(msg)
	if !console {
		showMessage(appName, msg, isError)
	}
}

func startsBy() string {
	switch runtime.GOOS {
	case "windows":
		return "It starts by itself when you sign in to Windows, with no window."
	case "darwin":
		return "It starts by itself when you log in to this Mac, with no window."
	}
	return "It starts by itself with this computer."
}

func deviceTab(cfg *Config, site string) string {
	if site == "" {
		site = cfg.Site
	}
	if site == "" {
		site = defaultSite
	}
	return strings.TrimRight(site, "/") + "/#device"
}

// statusText is the status window's message (S8).
func statusText(st bridgeStatus, running bool) string {
	var head string
	switch {
	case !running:
		head = "The bridge isn't running right now."
	case st.State == "online":
		head = "✓ Running, connected to your account"
		if len(st.Printers) > 0 {
			head += "\nPrinters: " + strings.Join(st.Printers, ", ")
		} else {
			head += "\nNo printers yet: add one in Cloud Slicer (Printers & bridges)."
		}
	case st.State == "refused" && strings.Contains(st.Reason, "turned this bridge off"):
		head = "This bridge was turned off in Cloud Slicer."
	case st.State == "refused" && st.Reason != "":
		head = st.Reason
	default:
		head = "Not connected: check the internet. It keeps trying by itself."
	}
	return head + "\n\n" + startsBy()
}

// waitForStatus reads the background bridge's status, giving one that just started a few seconds.
func waitForStatus(path string) (bridgeStatus, bool) {
	deadline := time.Now().Add(8 * time.Second)
	for {
		st, running := readStatus(path)
		if running && st.State != "offline" || time.Now().After(deadline) {
			return st, running
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// statusWindow shows how the bridge is doing (S8), with Open Cloud Slicer and Remove bridge.
func statusWindow(cfg *Config, path, site string) {
	for {
		st, running := waitForStatus(path)
		if !running && restartAutostart() {
			st, running = waitForStatus(path)
		}
		warn := !running || st.State != "online"
		switch guiChoice(appName, statusText(st, running), "Open Cloud Slicer", "Close", "Remove bridge…", warn) {
		case 0:
			openInBrowser(deviceTab(cfg, site))
			return
		case 2:
			if guiChoice(appName, "Remove the bridge from this computer? Its printers stop working in Cloud Slicer.", "Remove", "Cancel", "", true) != 0 {
				continue
			}
			left := leaveAccount(cfg)
			uninstallBridge(path)
			msg := "Removed the bridge from this computer and from your Cloud Slicer account."
			if !left {
				msg = "Removed the bridge from this computer. Remove it from Cloud Slicer too: Device tab, Printers & bridges, Remove bridge."
			}
			guiMessage(appName, msg, false)
			return
		default:
			return
		}
	}
}

var buildIn = regexp.MustCompile(`\(build (\d+) `)

// newerThanInstalled says whether this copy is a newer build than the installed one
// (or the installed one can't say), so opening an older copy never downgrades it.
func newerThanInstalled(installed string) bool {
	c := exec.Command(installed, "version")
	hideWindow(c)
	out, err := c.Output()
	if err != nil {
		return true
	}
	m := buildIn.FindStringSubmatch(string(out))
	if m == nil {
		return true
	}
	have, _ := strconv.ParseInt(m[1], 10, 64)
	return ownBuild() > have
}

// doneMessage is what someone who double-clicked the app reads once it is set up (relays without accounts).
func doneMessage(browserOpened bool, link string) string {
	text := "The bridge is running in the background. It has no window and starts by itself whenever you sign in to this computer.\n\n"
	if browserOpened {
		return text + "Cloud Slicer is opening in your browser: pick your printer there."
	}
	return text + "To pick your printer, open this link in your browser:\n" + link
}
