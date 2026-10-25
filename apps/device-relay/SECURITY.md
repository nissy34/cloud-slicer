# Device relay and bridge: security

How the Device tab reaches a printer on a home network, what each part can see,
and what is and isn't protected. First reviewed 2026-10-18; updated as fixes
landed (PRs #13, #16, #25, #29).

## How it works

| Piece | Runs where | Job |
|---|---|---|
| Device tab | Your browser | Speaks Moonraker's own JSON-RPC over one websocket to the relay |
| Relay (`apps/device-relay`) | Cloudflare Worker + one Durable Object per bridge | Copies messages between a bridge's browser sockets and its agent socket |
| Bridge (`apps/device-bridge`) | An always-on computer on your network | Connects **out** to the relay, opens Moonraker websockets to the printer for each browser, answers `bridge.snapshot` / `bridge.upload_*` itself |
| Printer | Your network | Moonraker; never exposed to the internet, no router port opened |

Bridge updates: the installed bridge updates itself only to a build signed with
an ed25519 key that exists only as a GitHub Actions secret (`BRIDGE_SIGNING_KEY`).
The public half is built into the bridge, and each signature covers the download
name, the build number and the file's SHA-256. Whoever controls the relay, its R2
bucket or the Cloudflare token can't push code to bridges, or roll them back to
an older build. Details: [../device-bridge/README.md](../device-bridge/README.md#updates).

Pairing:

1. On first run the bridge makes a random **bridge id** (96 bits) and **secret
   key** (192 bits), saved in `~/.cloud-slicer-bridge.json` (mode 0600 outside
   Windows) with the printers and their Moonraker API keys.
2. With accounts (the real relay) it first joins an account with a **setup code**:
   8 characters (40 bits) made in the signed-in Device tab, stored by the site only
   as a SHA-256, good once and for one hour, and rate-limited per IP at the relay.
   The relay sends it to the site, which spends it, saves the bridge and its browser
   key in that account and answers with a short signed claim; only then does the
   relay store `sha256(secret)`, `sha256(browser key)` and the owner, and only then
   may the agent connect. An id already joined can't be taken with another key.
   Without accounts (local tests) the first agent to use an id claims it.
3. The pairing link (relays without accounts) carries the relay URL, the id and the **browser key**,
   `HMAC-SHA256(secret, "cloud-slicer browser key")`, never the secret. It sits in
   the URL fragment, so it isn't sent to the site's server, and the app clears it
   from the address bar.
4. Browsers connect with the browser key. A browser key can't connect as the
   agent, and the secret can't connect as a browser.
5. The browser keeps the pairing in the account store: localStorage when signed
   out, D1 encrypted with AES-256-GCM (bound to user and record) when signed in.

## Who can see what

- **The printer's Moonraker API key** stays on the bridge computer: never in the
  pairing link, never stored by the relay or the site, only sent to the printer.
  When a printer is added from the Device tab, the key typed there passes once
  through the relay (TLS) to the bridge, which keeps it; it never comes back.
  The bridge passes on only the Moonraker calls the Device tab uses, so a
  pairing-link holder can't read or replace it, add Moonraker users, set the
  sudo password, run system updates or touch the config folder (`access.*`,
  `machine.*` and file moves are refused; deletes stay in the G-code folder).
- **The relay** (the Cloudflare account, and Cloudflare) sees all traffic in
  plain text: commands, status, camera frames, uploaded G-code, and the keys on
  each connect. It stores only the two key hashes and printer names.
- **The browser**, and every device the account syncs to, holds the browser key.
- **The bridge computer** holds the secret, the browser key's source, and the
  printers' API keys.
- **Print alerts**: the relay keeps each browser's push address and alert
  choices and time zone, and sees each alert (file name, progress, layer, time,
  filament, the printer's error) and its camera picture
  while passing them on; it logs none of it. The push services (Google, Apple,
  Mozilla, Microsoft) see only that a message arrived: its content is encrypted
  for the browser. A picture can be fetched by anyone holding its random link
  for a day, then R2 deletes it.
- **Print history**: the bridge reads the first 16 KB of each file that starts
  printing, on the home network, and sends only its `cloud_slicer_print` line
  (project id, plate, a hash) with the file name, state and times. The relay
  passes that to the site with the bridge's browser key as proof; it keeps the
  browser key with the agent's open socket (not in storage) for that, and logs
  nothing. The site only takes it for the account that saved the bridge with that
  key, and only for that account's own projects.

## Threat model

Assets: control of the printer (heaters, motion, start/stop prints, files, firmware restart), camera images, G-code, the Moonraker API key, and the relay's free-tier quota.

Attackers considered: someone on the internet with nothing, someone who got a pairing code (screenshot, chat paste, a synced device, an XSS on the site), the relay operator, someone with write access to the repo, and someone on your LAN.

## Protected

- **Guessing**: 192-bit secret, 96-bit id; brute force isn't feasible.
- **No inbound ports**: the bridge only dials out.
- **Pairing link vs. bridge**: a link holder can control the printers but can't
  connect as the bridge, so can't read other browsers' traffic or fake status.
- **Key storage**: the relay keeps hashes; D1 keeps keys encrypted.
- **Cross-site use**: auth is by key, not cookies, so no CSRF/CSWSH.
- **Reach**: the bridge only talks to printers it found or was given;
  `bridge.snapshot` only fetches from the printer's own host. A link holder can
  add a printer by address (`bridge.add_printer`), but the bridge keeps it only
  if Moonraker answers `/printer/info` there.
- **Abuse**: per client IP, at most 60 websocket connects and 5 new bridge ids a
  minute (Workers rate limiting), so the free tier can't be exhausted cheaply.
- **Accounts**: with tickets on, only signed-in, allowed accounts get in, and a
  pairing link alone is no longer enough. Blocking an account drops its
  connections at once; each account can use 3 bridges and watch 2 cameras at a
  time. Tickets are ES256 JWTs; the relay holds only the public key.
- **Deploys**: the live relay deploys from main only, never from a PR. PRs (labelled
  `use test relay`) and the Device workflow run on any other branch deploy only to the
  separate test relay (`cloud-slicer-relay-test`, own bucket, own rate limits, own push
  key); CI checks the Worker and bucket names before deploying. Test bridges update only
  from the test relay, so a PR's bridge never reaches anyone's everyday bridge.

## Still open

1. **A leaked pairing link is printer control until you reset.** There is no
   rotate command; to cut off old links, delete `~/.cloud-slicer-bridge.json`,
   set the bridge up again and re-pair your browsers.
2. **The relay can read and change all traffic.** Fine while you run it yourself;
   end-to-end encryption between browser and bridge would fix it.
3. **Keys in the websocket URL query** can show up in Worker logs if those are
   turned on.
4. **Signed-out storage and no CSP**: an XSS on the site could read pairing keys
   from localStorage.
5. **Bridge resource limits**: uploads have no size cap on the bridge computer.
6. **Adding printers from the Device tab** lets a pairing-link holder make the
   bridge send a `GET /printer/info` to any address on its network, and keep
   one that answers like Moonraker. That is a small LAN probe on top of the
   printer control the link already gives.
7. **Unsigned apps, trust on first use**: the bridge apps and `install.sh` come
   from the relay; whoever controls the relay and its R2 bucket controls the
   code that runs. They aren't code-signed (signing costs money), so Windows and
   macOS can't vouch for them.

Options, roughly in order of value: key rotation (`bridge rotate`), end-to-end
encryption, moving the key to `Sec-WebSocket-Protocol`, a CSP and an upload cap.
