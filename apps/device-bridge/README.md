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
  an `S99` init script elsewhere (K1, U1). It joins the account with the setup
  code before anything is installed. Nothing in Klipper or Moonraker changes, so neither restarts. It
  updates itself like the computer apps. "Remove bridge" in the Device tab
  removes the service and the folder; so does
  `curl -fsSL https://<relay>/install.sh | sh -s -- --printer --uninstall`, which
  downloads nothing: it runs the bridge already in printer_data (with sudo when needed).
  A Snapmaker U1 firmware update wipes the service: run the line again.

**Setup codes.** A bridge only connects once it has joined an account, and a
setup code is the only way in (there are no pairing links any more): `install` (and `install-printer`) sends the setup
code to the relay's `/v1/bridges/<id>/claim`, which checks it with the site, and
prints "Connected to your Cloud Slicer account as …". A code works once, for an
hour; a wrong or used one exits with status 3, and the install scripts then ask
"Paste the new setup code here:". After that the bridge keeps its own key for
good. Without a code (or with a relay it can't reach) nothing is installed.

The bridge asks nothing else. Opened by double click (the download from Add a
bridge, which has no setup code inside) it asks for the setup code in a small
window, installs itself to start with the computer and shows "Connected to your
Cloud Slicer account as …" with Open Cloud Slicer and Close. `install` does the same from a
terminal. Where it starts from: Windows, a Run entry for your user that runs it
with no window, so it stays out of the taskbar; macOS, a launch agent; Linux, a
systemd user service with lingering, so a headless Pi starts it at boot, plus a
menu entry that opens the Device tab (`open`).

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
7125 (and PrusaLink on the web port, asked at the same time) across the bridge's
local networks (Wi-Fi and cable cards before WSL, Hyper-V, Docker or VPN ones;
169.254.x.x cards skipped) and lists what answers within 15 s (and which want an
API key). A search that runs out of time answers `more: true`, and asking again
within a minute carries on with the addresses it didn't reach; `bridge.add_printer` adds the ones you pick, or any address and
port you type, with its API key, after checking Moonraker answers there;
`bridge.remove_printer` forgets one; `bridge.uninstall` (Printers & bridges,
Remove bridge) makes the running bridge remove itself from its computer, as the
`uninstall` command does, and exit. From a terminal, `cloud-slicer-bridge add
192.168.1.50 [--api-key KEY]` does the same; a bridge running in the background
restarts by itself to use it. Only signed-in browsers of the account it joined
reach its printers.

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
when a bridge is behind, and each bridge's version and date, e.g. "Version 6.50 ·
from 22 Oct, 17:16 · up to date". The 6 is `version` in `main.go` (what the bridge
can do, raised by hand when the site relies on something new); the 50 counts the
commits that changed this folder (CI counts them on GitHub, `CHANGE` in
`build.sh`); the date is the build number (the commit's time). It is safe because:

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
commands: `list`, `remove <name>`, `open` (the Device tab in the browser), `version`.

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

## Printers that aren't Klipper

Prusa printers (PrusaLink), OctoPrint, the Elegoo Centauri Carbon and Bambu Lab printers reach the Device tab through a **stand-in**
(`translate.go`): for each one the bridge runs a small Moonraker of its own on
127.0.0.1 that answers the calls the Device tab and print alerts use, and works them
out with the printer's own API (`prusalink.go`: digest login as `maker` with the
PrusaLink password, `/api/v1/status`, `/api/v1/job`, `/api/v1/files`). Everything else
(sessions, uploads, file pictures, alert watches) talks to the stand-in like to any
Moonraker, so another brand is one more file like `prusalink.go`. The stand-in asks the
printer every 2 seconds, only while a browser or an alert watch is connected. Calls the
printer can't do (G-code, emergency stop, firmware restart) answer with a plain-words
error, and `printer.info` carries `brand`, so the Device tab leaves those controls
out. A printer's `kind` in the settings says which it is (`prusalink`; none for
Moonraker). The network search knows PrusaLink by its login challenge (realm
"Printer API") on port 80; adding by address tries Moonraker first, then PrusaLink
(`add <address> --kind prusalink` to say which).

OctoPrint (`octoprint.go`, kind `octoprint`) is the second brand: its API key in
`X-Api-Key`, status from `/api/printer` and `/api/job`, files in its `local` storage.
A brand may do more than the basics through optional interfaces in `translate.go`:
`commander` (G-code, emergency stop, and "restart", which for OctoPrint connects it to
the printer again), `camerer` (its cameras, served on the stand-in at
`/camera/<n>/snapshot|stream`, since the bridge only fetches cameras from the printer's
own host) and `follower` (the printer's replies for the console, from OctoPrint's push
socket `/sockjs/websocket`). The Klipper commands the Device tab sends are put in
Marlin's words (`SET_HEATER_TEMPERATURE` to `M104`/`M140`/`M141`, the jog's saved state
to `G90`/`M82`); other Klipper-only commands are refused in plain words. OctoPrint
doesn't say what is homed or where the head is, so the stand-in remembers homing it
sent and asks `M114` after a move (that answer stays out of the console). The search
knows OctoPrint by its login page on port 80 or 5000.

The Elegoo Centauri Carbon (`elegoo.go`, kind `elegoo`) speaks SDCP v3: JSON over a
websocket on port 3030 (`/websocket`), with no login. The search sends `M99999` over
UDP to port 3000 for the whole network and each printer answers with its name and
mainboard ID, which every request names. Status comes as pushes every 2 seconds
(command 512) or on asking (0); files are listed (258) and deleted (259); prints start
(128), pause (129), stop (130) and resume (131). Only those commands are ever sent:
the printer is said to crash on ones it doesn't know. Uploads go to
`http://<printer>/uploadFile/upload` in 1 MB parts, each with the whole file's MD5, so
the stand-in keeps the file on disk while it sends it. The camera (an MJPEG stream on
port 3031, with few connections) is read once and shared: pictures come from its
latest frame, and the stream closes 15 seconds after nobody asks. It takes no G-code.
Tests move its ports with `CLOUD_SLICER_ELEGOO_PORTS="ws,find,camera"`.

Bambu Lab printers (`bambu.go`, kind `bambu`) are reached the way Bambu Studio
reaches them in LAN mode: MQTT over TLS on port 8883 (user `bblp`, the printer's LAN
access code as password; topics `device/<serial>/report` and `.../request`), files
over FTPS (implicit TLS, port 990, same login) and, on P1 and A1, the camera on
port 6000 (an 80-byte login, then JPEG pictures each after a 16-byte header; X1, H2
and P2S stream RTSP video, which the bridge doesn't pass on). The serial is the name
on the printer's certificate, so an address and the access code are all it takes; the
certificate must come from Bambu Lab's CA (`bambu_ca.pem`, from OpenBambuAPI). The
printer sends its whole status after `pushall`, then only what changed, which the
stand-in merges. Plain G-code prints with `gcode_file` (`/sdcard/<name>`), a `.3mf`
project with `project_file` (its first plate); pause, resume and stop are the printer's
own commands; G-code goes as `gcode_line`, in Marlin's words like OctoPrint's (the
printer sends no replies for the console), and emergency stop stops the print. Since
Bambu's 2025 firmware a printer takes prints and G-code from other programs only with
**LAN Only mode and Developer Mode** on; without them it still reports its status and
answers commands with `"result": "fail"`, whose reason the stand-in passes on with
how to fix it. Commands are never signed (no key of Bambu's is used). The search
listens for the SSDP messages printers send to UDP port 2021 every few seconds (when a
slicer on the same computer holds that port, the search can't hear them: add by
address). Sources: [OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI). Tests use
a pretend printer (`internal/fakebambu`, and `tools/mock-bambu` for the browser test
`apps/web/test/device-bambu.mjs`), move its ports with
`CLOUD_SLICER_BAMBU_PORTS="mqtt,ftp,camera,find"` and trust its certificate with
`CLOUD_SLICER_BAMBU_CA=<pem file>`. Not yet tried on a real Bambu printer.

## How it works

Browser ⇄ relay (a Cloudflare Durable Object per bridge, `apps/device-relay`)
⇄ this agent ⇄ the printer's Moonraker websocket. Messages are Moonraker's own
JSON-RPC; the agent adds `bridge.upload_*` and `bridge.snapshot`, which it
answers itself with HTTP to the printer. Status updates are merged and sent at
most once a second, and only while a browser is watching, to stay inside the
relay's free tier.

**Uploads** (`upload.go`): the page zips the G-code (it shrinks 4 to 5 times)
and starts with `bridge.upload_start`, which carries a WebRTC offer. When the
direct link connects, the bytes go over data channel "upload" and never cross
the relay; on the same network that runs at home-network speed. When it
doesn't (a network that blocks direct links), the page asks
`bridge.upload_resume` where to carry on and sends 8 MiB pieces over the relay
as binary messages (`bridge.upload_piece`), each waiting for the bridge's
answer. Either way the bridge unzips as the bytes arrive and streams them into
Moonraker, holding at most one piece in memory. A relay from before binary
messages gets base64 pieces of 512 KiB (`bridge.upload_chunk`). Cancel in the
Send window calls `bridge.upload_cancel`, which stops the request to Moonraker
(even once every byte is here), so the printer keeps nothing.

**Cameras** (`camera.go`): the page sends a WebRTC offer as `bridge.camera_open`
and the camera then comes straight from this computer to the browser, never over
the relay. A camera with its own live H.264 video (camera-streamer, MediaMTX,
go2rtc, and the paxx12 U1 firmware at `/webcam/webrtc`) is forwarded packet for
packet, without re-encoding; any other camera is sent as pictures over a data
channel, up to 15 a second. Both sides find each other with a public STUN server,
so it usually works away from home too; where a network blocks direct links the
page falls back to `bridge.snapshot`, one picture a second over the relay.
Camera addresses Moonraker lists as paths (`/webcam/...`) are opened the way
Fluidd and Mainsail open them: on the printer's web server first, then on
Moonraker's port, with the printer's API key (a web server login in front of a
camera checks the same key).

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
