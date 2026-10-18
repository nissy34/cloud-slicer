# Cloud Slicer bridge

Lets the Device tab reach printers on your home network. Browsers can't talk to
a printer at `http://192.168.x.x` from a public https site (mixed content and
private-network blocking), so this small agent runs on any always-on computer
next to the printer and connects **out** to the relay. Nothing on your router
needs opening, and it only talks to the printers you add.

Needs Node.js 22 or newer; no other dependencies.

```bash
curl -fsSLo cloud-slicer-bridge.mjs https://<relay>/bridge.mjs
node cloud-slicer-bridge.mjs     # finds your printers, opens the pairing link; keep it running
```

On Windows, PowerShell's `curl` is a different command: type `curl.exe`
instead, or just open `https://<relay>/bridge.mjs` in a browser to download it.

On first run it looks for Moonraker on port 7125 across your local network,
adds every printer it finds, and opens the pairing link in your browser (it
also prints it). If it finds nothing, add the printer by its address with
`node cloud-slicer-bridge.mjs add 192.168.1.50` (`--api-key KEY` if Moonraker
wants one) and run it again. The
code is the bridge's secret: anyone holding it can control your printers.

Config lives in `~/.cloud-slicer-bridge.json` (`--config` to move it). Other
commands: `list`, `remove <name>`, `pair` (print the pairing link again).

To keep it running on Linux, a systemd user service is enough:

```ini
# ~/.config/systemd/user/cloud-slicer-bridge.service
[Service]
ExecStart=/usr/bin/node %h/cloud-slicer-bridge.mjs
Restart=always
[Install]
WantedBy=default.target
```

## How it works

Browser ⇄ relay (a Cloudflare Durable Object per bridge, `apps/device-relay`)
⇄ this agent ⇄ the printer's Moonraker websocket. Messages are Moonraker's own
JSON-RPC; the agent adds `bridge.upload_*` and `bridge.snapshot`, which it
answers itself with HTTP to the printer. Status updates are merged and sent at
most once a second, and only while a browser is watching, to stay inside the
relay's free tier.
