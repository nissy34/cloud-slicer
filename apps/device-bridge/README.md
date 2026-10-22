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
  curl -fsSL "https://<relay>/install.sh?code=<setup code>" | sh
  ```
  Windows has the same as `irm "https://<relay>/install.ps1?code=<setup code>" | iex`
  in PowerShell, or `install.cmd` in Command Prompt. The Device tab's Add a bridge
  shows these with the account's one-use setup code filled in (`--code` on the
  command line).

- **On the printer itself** (any Klipper printer with Moonraker: a Pi, an
  Armbian board, a Snapmaker U1, a Creality K1 or K2, a Sonic Pad), over SSH:
  ```bash
  curl -fsSL "https://<relay>/install.sh?code=<setup code>" | sh -s -- --printer
  ```
  It finds `printer_data`, puts the program and its settings in
  `printer_data/cloud-slicer-bridge/` (on a U1 that's the folder that survives
  restarts), adds the printer's own Moonraker (127.0.0.1:7125), and runs it as
  a root service: systemd on Pi OS and Armbian, procd on OpenWrt (K2, Sonic Pad),
  an `S99` init script elsewhere (K1, U1). With a setup code it joins the account
  at once; on a relay without accounts it prints the pairing link and saves it as
  `config/cloud-slicer-bridge-pairing.txt`, which Mainsail and Fluidd show. Nothing in Klipper or Moonraker changes, so neither restarts. It
  updates itself like the computer apps. "Remove bridge" in the Device tab
  removes the service and the folder; so does
  `curl -fsSL https://<relay>/install.sh | sh -s -- --printer --uninstall`, which
  downloads nothing: it runs the bridge already in printer_data (with sudo when needed).
  A Snapmaker U1 firmware update wipes the service: run the line again.

**Setup codes.** On a relay with accounts (the real one) a bridge only connects
once it has joined an account: `install` (and `install-printer`) sends the setup
code to the relay's `/v1/bridges/<id>/claim`, which checks it with the site, and
prints "Connected to your Cloud Slicer account as …". A code works once, for an
hour; a wrong or used one exits with status 3, and the install scripts then ask
"Paste the new setup code here:". After that the bridge keeps its own key for
good. On a relay without accounts (local tests) it pairs with a link as below.

The bridge asks nothing else. Opened by double click (the download from Add a
bridge, which has no setup code inside) it asks for the setup code in a small
window, installs itself to start with the computer and shows "Connected to your
Cloud Slicer account as …" with Open Cloud Slicer and Close (a relay without
accounts opens the pairing link instead). `install` does the same from a
terminal. Where it starts from: Windows, a Run entry for your user that runs it
with no window, so it stays out of the taskbar; macOS, a launch agent; Linux, a
systemd user service with lingering, so a headless Pi starts it at boot, plus a
menu entry that opens the pairing link.

Opening it again (Windows: Start menu, Cloud Slicer Bridge; macOS: Cloud Slicer
Bridge in your Applications folder) shows how the bridge running in the
background is doing: connected with its printers, not connected (no internet),
or turned off in Cloud Slicer. The background bridge writes this to a small
status file next to its settings (`<config>.status`) every minute (`status.go`,
`opened.go`). It never replaces a newer installed bridge with an older download.
The window has Open Cloud Slicer (the Device tab) and Remove bridge….

`uninstall` (also Remove bridge… there, and Windows' Settings, Apps, Installed
apps, Cloud Slicer Bridge, Uninstall, which needs no admin rights) stops the
bridge, stops it starting with the computer, deletes it with its printers, and
takes it out of the account: it sends its own key to the relay's
`/v1/bridges/<id>/release`, which forgets the bridge, tells open Device tabs
(close code 4410) and asks the site to remove it from the account
(`/api/relay/release`, proven by the bridge's browser key).

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
in `~/.local/bin`).

## Updates

The bridge set up to start with its computer updates itself: 2 minutes after it
starts and then every 6 hours it asks the relay for the newest release
(`/bridge-release.json`), and installs a newer one when no browser is
connected, so an upload is never cut off (a print keeps going either way: it
runs on Klipper). Printers & bridges in the Device tab also shows "Update now"
when a bridge is behind. It is safe because:

- **Signed.** CI signs every build with an ed25519 key that exists only in the
  repo secret `BRIDGE_SIGNING_KEY`; the bridge has the public half built in and
  installs only files whose signature matches, for its own chip and a newer
  build (`update.go`, `tools/release`). The relay and its download store can't
  push code to bridges. Without the secret, builds carry no key and never
  update themselves.
- **Checked.** Exact size and SHA-256 before anything changes on disk.
- **Tested first.** CI publishes the release only after the new relay is
  deployed and passed its live end-to-end check, and only from main.
- **Rollback.** The old program stays beside the new one (`.old`) until the new
  one has reached the relay. If it hasn't within 2 minutes, or it was started
  twice without getting there, the old one comes back and that build is skipped.

Setting it up again the same way (a newly downloaded app opened while an older
one runs in the background) also replaces it.

A new key, on any computer with Node.js; paste the output into the repo secret
`BRIDGE_SIGNING_KEY` (Settings, Secrets and variables, Actions):

```bash
node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({format:'jwk'}).d)"
```

Config lives in `~/.cloud-slicer-bridge.json` (`--config` to move it). Other
commands: `list`, `remove <name>`, `pair` (print the pairing link again; `--open` opens it),
`version`.

## Building

It's one Go program (`*.go`, Go 1.24, no cgo) with nothing else to install,
about 10 MB per system and chip. `./build.sh` builds `dist/linux-x64`,
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
relay's free tier.

**Cameras** (`camera.go`): the page sends a WebRTC offer as `bridge.camera_open`
and the camera then comes straight from this computer to the browser, never over
the relay. A camera with its own live H.264 video (camera-streamer, MediaMTX,
go2rtc, and the paxx12 U1 firmware at `/webcam/webrtc`) is forwarded packet for
packet, without re-encoding; any other camera is sent as pictures over a data
channel, up to 15 a second. Both sides find each other with a public STUN server,
so it usually works away from home too; where a network blocks direct links the
page falls back to `bridge.snapshot`, one picture a second over the relay.

**Print alerts** (`alerts.go`, `watch.go`): when the relay says someone wants
alerts from a printer (`{ctl:"alerts"}`), the bridge keeps its own Moonraker
websocket to that printer, with every browser closed, and checks each change
against the alert rules (the same as the browser's, `apps/web/src/device/alerts.ts`,
tested with `testdata/alert-cases.json`). When something happens it sends one
small `{ctl:"alert"}` to the relay, with where the print stands (`details`:
progress, layers, time printed and left, filament used and the file's totals from
its metadata, which head or sensor ran out; `detailsFrom`, tested with
`testdata/alert-details-cases.json`), the U1's current errors on problem alerts
(`exceptions`, from `server.exception.query`), and a frame from the printer's
first camera on the key alerts. Nothing else leaves the home network; with no alerts wanted, no
watch runs. What each part can see and what's protected:
[../device-relay/SECURITY.md](../device-relay/SECURITY.md).
