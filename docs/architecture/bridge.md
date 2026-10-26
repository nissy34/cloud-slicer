# Bridge

> **Read this when** you change the bridge program: install and setup codes, updates,
> uninstall, printer brands, network search, cameras, uploads or watching prints.
> **Protocol and install detail:** [apps/device-bridge/README.md](../../apps/device-bridge/README.md).
> **Related:** [relay](relay.md), [security](security.md), [device tab](device-tab.md).

## What it does

A small Go program (about 10 MB, nothing else to install) next to the printers: on an
always-on Windows, Mac, Linux or Raspberry Pi computer, or on the printer's own Klipper
computer. It connects **out** to the relay, so no router ports open, and talks to each
printer in its own protocol.

## Pieces

| Part | Where (`apps/device-bridge/`) |
|---|---|
| Start, config, commands | `main.go`, `config.go` |
| Relay connection, sessions | `relay.go`, `session.go` |
| Moonraker calls and network search | `moonraker.go` (`probeHosts`) |
| Stand-in Moonraker per brand | `translate.go`, `prusalink.go`, `octoprint.go`, `elegoo.go`, `bambu.go` |
| What a browser may ask for | `allowed.go` (Moonraker methods, per-brand `requests`) |
| Setup code, autostart, uninstall | `setup.go`, `autostart.go`, `install.sh`, `install.ps1`, `install.cmd` |
| Self-update | `update.go`, `tools/release` |
| Cameras, uploads, page cards | `camera.go`, `upload.go`, `page.go` |
| Alerts and print watching | `watch.go`, `alerts.go`, `printjob.go` |
| Status window, native dialogs | `gui.go`, `status.go`, `opened.go` |

## How it flows

**Install.** Signed in, Add a bridge makes a one-use setup code (one hour) inside one
install line per system → the bridge spends it through the relay, which asks the site
(`/api/relay/claim`) → the site saves the bridge in that account → the dialog turns green.
A bridge without a valid code never connects. After that it starts with the computer and
asks nothing; printers and their keys are added from the Device tab.

**Update.** Two minutes after start and every 6 hours it fetches `/bridge-release.json`,
checks the ed25519 signature (key only in the `BRIDGE_SIGNING_KEY` secret), size and
SHA-256, and installs when no browser is connected. The old program stays as `.old`
until the new one reaches the relay; otherwise it rolls back and skips that build.
"Update now" in Printers & bridges does it at once. Version "7.N": 7 = what it can do
(`version` in `main.go`, raised by hand when the site needs to tell old bridges apart,
for example a new message or event; the site compares it as a number), N = commits that
changed the folder. Old bridges stay in the field for up to 6 hours, or until someone
taps "Update now": a change the site depends on must keep working with them.

**Brands.** Each non-Klipper printer gets a stand-in Moonraker on 127.0.0.1 that answers
the calls the Device tab and alerts use, worked out with the printer's own API. New
printer data (Bambu's AMS) is also passed raw for the site to read.

**Search.** Every brand's probe runs in parallel per host (128 at a time, 15 s cap):
Moonraker 7125, PrusaLink 80, OctoPrint 80/5000, Elegoo by UDP broadcast, Bambu by
listening for its SSDP announcements. Other ports: add by address (the type is detected).

**Uninstall.** Removing a running bridge in the Device tab sends `bridge.uninstall`.
Removing it on its computer tells the relay (`/v1/bridges/<id>/release`), which tells
the site, which drops it from the account.

## What it keeps

`~/.cloud-slicer-bridge.json` (on a printer, in `printer_data`): id, secret key,
printers with their API keys.

## Rules

- **Pipe for data, not for control.** Raw printer data passes through; commands go
  through a per-brand allow list (`allowed.go`) that blocks host takeover (Moonraker
  `machine.*`/`access.*`, OctoPrint plugins, Bambu firmware).
- Status is merged and sent at most once a second, and only while a browser watches.
- Before adding a brand, check [decisions.md](../decisions.md#device-tab): some were
  turned down.
- A new brand touches:
  - bridge: one brand file (`<brand>.go` with its test), its kind in `translate.go`
    (`newBrand`, the kind lists in `findPrinter`, `probeKind`), a probe in `probeHosts`
    (`moonraker.go`) that runs beside the others, never after them, and `allowed.go` only
    if it needs a new call;
  - site: `KINDS` and a row in `WORKS_WITH` (`apps/web/src/device/brands.ts`), and an
    add-on in `apps/web/src/device/addons/` (registered in `index.ts`) for what it can't
    do;
  - tests: a pretend printer (a Node mock in `apps/web/test/device/` or a Go fake in
    `internal/`), a browser test `test/device-<brand>.mjs` and its step in `device.yml`;
  - docs: the bridge README, [device tab](device-tab.md), [testing](testing.md),
    [features.md](../features.md), and [decisions.md](../decisions.md).
- API keys are typed only in the Device tab, never at install.
- On a printer it runs as a root service with its files in `printer_data` and never
  restarts Moonraker.

## Why

- Go: one small program for every chip, including MIPS printers (the Node/Bun app was
  81 MB). Unsigned, to stay at $0: Windows warns, macOS installs by a Terminal line.
- Setup codes, not pairing links: a bridge belongs to an account from its first moment.
- Updates are signed so the relay or its storage can't push code to bridges.
  See [decisions.md](../decisions.md#bridge-and-relay).

## Tests

`go test ./...` (alert cases, brands, update, upload), `device-smoke.mjs`,
`device-*.mjs` per brand, Windows and Mac app checks in `device.yml`.

## Open

- On the U1 a firmware update wipes the bridge's service (accepted).
- Not tried on a real Prusa or Bambu printer.
