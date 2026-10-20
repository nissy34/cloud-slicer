# Cloud Slicer bridge

Lets the Device tab reach printers on your home network. Browsers can't talk to
a printer at `http://192.168.x.x` from a public https site (mixed content and
private-network blocking), so this small agent runs on any always-on computer
next to the printer and connects **out** to the relay. Nothing on your router
needs opening, and it only talks to the printers you add.

## Getting it

The Device tab's "Add a printer" dialog offers the right one for each system:

- **Windows**: a one-file app. Open it with a double click; nothing else
  needs installing. It isn't signed yet, so Windows shows "Windows protected
  your PC" (More info, then Run anyway).
- **macOS, Linux, Raspberry Pi (64 and 32-bit), Armbian boards and MIPS
  boxes like the Creality K1**: one command in Terminal, which
  downloads the app and starts the bridge with the computer. On a Mac this also avoids Gatekeeper's "could not verify" block,
  which only applies to apps a browser downloaded. (The Mac app is also
  offered as a zip; downloaded that way, macOS blocks it until you click Open
  Anyway in System Settings, Privacy & Security.)
  ```bash
  curl -fsSL https://<relay>/install.sh | sh
  ```

The bridge asks nothing. Opened by double click it sets itself up to start
with the computer and opens the pairing link in your browser (it also prints
it); `install` does the same from a terminal, and `uninstall` stops the bridge
and removes it from the computer, with its printers and pairing (Windows: a
Run entry for your user that runs it with no window, so it stays out of the
taskbar; macOS: a launch agent; Linux: a systemd
user service with lingering, so a headless Pi starts it at boot, plus a menu
entry that opens the pairing link). The downloaded Mac app is
`Cloud Slicer Bridge.app`: opened from Finder it shows no window, sets itself
up and opens the pairing link.

Printers are found and added in the Device tab's Add a printer dialog, which
asks the bridge over the relay: `bridge.discover` looks for Moonraker on port
7125 across the bridge's local networks and lists what answers (and which want
an API key); `bridge.add_printer` adds the ones you pick, or any address and
port you type, with its API key, after checking Moonraker answers there;
`bridge.remove_printer` forgets one; `bridge.uninstall` (Printers & bridges,
Remove bridge) makes the running bridge remove itself from its computer, as the
`uninstall` command does, and exit. From a terminal, `cloud-slicer-bridge add
192.168.1.50 [--api-key KEY]` does the same; a bridge running in the background
restarts by itself to use it. The pairing link is the bridge's key: anyone
holding it can control your printers.

Where things go once set up: Windows `%LOCALAPPDATA%\Cloud Slicer Bridge\`,
macOS `~/Library/Application Support/Cloud Slicer Bridge/` (log in
`~/Library/Logs/cloud-slicer-bridge.log`), Linux `~/.local/share/cloud-slicer-bridge/`
(`journalctl --user -u cloud-slicer-bridge` for the log, and the command linked
in `~/.local/bin`). To update, set it up again the same way: a newly downloaded
app opened while an older one runs in the background replaces it.

Config lives in `~/.cloud-slicer-bridge.json` (`--config` to move it). Other
commands: `list`, `remove <name>`, `pair` (print the pairing link again; `--open` opens it),
`version`.

## Building

It's one Go program (`*.go`, Go 1.24, no cgo) with nothing else to install,
about 6 to 7 MB per system and chip. `./build.sh` builds `dist/linux-x64`,
`dist/linux-arm64` (64-bit Pi OS, Armbian, the Snapmaker U1), `dist/linux-armv7`
(32-bit Pi OS, Sonic Pad), `dist/linux-mipsle` (Creality K1, soft float) and
`dist/windows-x64` (with its icon and name, and no window); `./build.sh mac`
builds the two zipped `Cloud Slicer Bridge.app`s (signed ad hoc when run on a
Mac). The icons are in `icons/`. CI builds the Mac apps on a macOS runner and
checks the Windows app on a Windows runner, and uploads them all to the relay's
R2 bucket on every push to main. Tests: `go test ./...`; the Device tab's end
to end tests (`apps/web/test/device-smoke.mjs`, `relay-live.mjs`) run the real
program too.

The bridge passes on only the Moonraker calls the Device tab uses
(`allowed.go`) and deletes files only in the G-code folder. Uploads stream
straight into Moonraker instead of going through a temp folder, which on a
printer is often in memory.

## How it works

Browser ⇄ relay (a Cloudflare Durable Object per bridge, `apps/device-relay`)
⇄ this agent ⇄ the printer's Moonraker websocket. Messages are Moonraker's own
JSON-RPC; the agent adds `bridge.upload_*` and `bridge.snapshot`, which it
answers itself with HTTP to the printer. Status updates are merged and sent at
most once a second, and only while a browser is watching, to stay inside the
relay's free tier. What each part can see and what's protected:
[../device-relay/SECURITY.md](../device-relay/SECURITY.md).
