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
- **macOS, Linux and Raspberry Pi (64-bit)**: one command in Terminal, which
  downloads the app, finds your printers and starts the bridge with the
  computer. On a Mac this also avoids Gatekeeper's "could not verify" block,
  which only applies to apps a browser downloaded. (The Mac app is also
  offered as a zip; downloaded that way, macOS blocks it until you click Open
  Anyway in System Settings, Privacy & Security.)
  ```bash
  curl -fsSL https://<relay>/install.sh | sh
  ```
- **Anything else with Node.js 22 or newer**: the script itself.
  ```bash
  curl -fsSLo cloud-slicer-bridge.mjs https://<relay>/bridge.mjs
  node cloud-slicer-bridge.mjs
  ```
  On Windows, PowerShell's `curl` is a different command: type `curl.exe`, or
  open `https://<relay>/bridge.mjs` in a browser.

On first run it looks for Moonraker on port 7125 across your local network,
adds every printer it finds, and opens the pairing link in your browser (it
also prints it). Opened by double click, it then asks whether to start by
itself with the computer; `install` and `uninstall` do the same from a
terminal (Windows: a Run entry for your user, minimised; macOS: a launch agent;
Linux: a systemd user service with lingering, so a headless Pi starts it at
boot). If it finds nothing, add the printer by its address with
`cloud-slicer-bridge add 192.168.1.50` (`--api-key KEY` if Moonraker wants
one); a bridge running in the background restarts by itself to use it. The
pairing link is the bridge's key: anyone holding it can control your printers.

Config lives in `~/.cloud-slicer-bridge.json` (`--config` to move it). Other
commands: `list`, `remove <name>`, `pair` (print the pairing link again),
`version`.

The apps are `bridge.mjs` built with `bun build --compile` (`build-apps.sh`);
CI uploads them to the relay's R2 bucket on every push to main.

## How it works

Browser ⇄ relay (a Cloudflare Durable Object per bridge, `apps/device-relay`)
⇄ this agent ⇄ the printer's Moonraker websocket. Messages are Moonraker's own
JSON-RPC; the agent adds `bridge.upload_*` and `bridge.snapshot`, which it
answers itself with HTTP to the printer. Status updates are merged and sent at
most once a second, and only while a browser is watching, to stay inside the
relay's free tier.
