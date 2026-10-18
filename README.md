# Cloud Slicer

A full slicer in the browser, built on the Snapmaker Orca engine compiled to WebAssembly.
Slicing runs in your browser tab, on a desktop or a phone; the cloud keeps your account,
printers, filament and process presets, and projects, and relays your printer for the
Device tab.

Live at **https://slicer.awesomestuff.qzz.io**. Free to use, open source (AGPL-3.0), and
hosted on Cloudflare's free tier.

## What it does

- **Slices like desktop Snapmaker Orca 2.4.0**, because it is the same engine: STL, OBJ,
  AMF and 3MF projects, Bambu Studio 3MF files with painted colours, per-part filaments,
  multi-plate projects. Plate thumbnails go into the G-code, like desktop.
- **Snapmaker printer, filament and process presets** bundled from the engine, with a
  first-run setup wizard (like Orca's) to pick the printers and filaments you have.
- **Process settings in desktop's own pages and groups**, with per-object settings and a
  Standard flow / High flow switch for options that hold one value per nozzle flow
  variant (the U1).
- **Your own presets**, saved as Orca user presets (a diff over a system preset).
- **3MF print settings import**: a project's own settings come in on top of your presets.
  A 3MF made for a printer you don't have (for example a Bambu project) can be converted
  onto one of yours: its print settings carry over, the printer's own settings
  (speeds, accelerations, jerk) come from your printer, and filaments are matched by
  material.
- **Prepare tools**: move, rotate, scale, lay on face, cut, arrange, auto-orient, split,
  mirror, plates, undo and redo, and painting (colours, support and seam
  enforcers/blockers, fuzzy skin).
- **Colour mixing**: Snapmaker Orca's mixed filaments, virtual filaments made of two or
  more physical ones, usable anywhere a filament is.
- **Calibration tests** from desktop's Calibration menu: temperature, flow rate, pressure
  advance, retraction, max volumetric speed, VFA, input shaping, junction deviation.
- **Preview** of the sliced toolpaths by feature or filament, layer by layer.
- **Projects**: save as an Orca 3MF that reopens here or in desktop Orca; online in your
  account when signed in, downloaded when signed out.
- **Sign in with Google** to keep presets, setup choices, printers and projects on every
  device. Signed out, everything is kept in the browser and merged in at sign-in.
- **Device tab** for Moonraker (Klipper) printers: cameras, temperatures, motion, files,
  upload and print, plus Snapmaker U1 extras (tool heads, filament sync, the U1 print
  dialog). Printers on a home network are reached through a small bridge app.
- **Light and dark theme**, a layout that works on phones, and installable as an app
  (PWA) on Android.

How it is built, and why: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

| Path | What |
|---|---|
| `engine/` | The engine: Snapmaker Orca's libslic3r in WebAssembly with an embind API, its build, patches, and a Node CLI and tests. See [engine/README.md](engine/README.md) |
| `engine/orcaslicer/` | Submodule: upstream Snapmaker Orca, pinned to v2.4.0 |
| `apps/web/` | The web app (React + TypeScript + Vite) and its Cloudflare Pages Functions. See [apps/web/README.md](apps/web/README.md) |
| `apps/device-bridge/` | The bridge that lets the Device tab reach printers on a home network: `bridge.mjs`, its one-file apps and the Mac/Linux installer. See [apps/device-bridge/README.md](apps/device-bridge/README.md) |
| `apps/device-relay/` | The relay Worker between browsers and bridges. See [apps/device-relay/README.md](apps/device-relay/README.md) and [SECURITY.md](apps/device-relay/SECURITY.md) |
| `packages/printer/` | Printer drivers for the Device tab: Moonraker client, filament library and sync, G-code summary, tool remap, and a mock Moonraker for tests |
| `fixtures/` | Small test models and G-code |
| `docs/` | [Architecture and design](docs/ARCHITECTURE.md), [CI and deploys](docs/CI.md) |

## Build the engine

```bash
git submodule update --init engine/orcaslicer
git clone https://github.com/emscripten-core/emsdk && emsdk/emsdk install 6.0.12 && emsdk/emsdk activate 6.0.12
source emsdk/emsdk_env.sh
engine/scripts/build-deps.sh                 # once; ~40 min on 4 cores
emcmake cmake -S engine -B engine/build/engine -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build/engine            # -> engine/build/engine/orca-engine.{js,wasm}
node engine/scripts/bundle-profiles.mjs engine/build/profiles
node engine/node/slice.mjs fixtures/3DBenchy.stl /tmp/benchy.gcode
```

Building the engine takes a while the first time. To work on the web app only, you can
take a built engine from CI instead: the `web-site` artifact of a recent CI run (kept 7
days) holds the built site with the engine under `engine/`; point `ENGINE_DIR` at a folder
holding `orca-engine.js` and `orca-engine.wasm` when running `npm run dev`. More in [engine/README.md](engine/README.md).

## Run the web app

```bash
cd apps/web
npm ci
npm run dev        # copies the engine build into public/engine, then starts Vite
```

The page needs cross-origin isolation (COOP/COEP) for the engine's threads; the dev server
and `public/_headers` (Cloudflare Pages) both send it. Accounts and online projects need
the Pages Functions: `npm run build && npm run pages` serves the site, the Functions and
a local D1 on http://localhost:8788. See [apps/web/README.md](apps/web/README.md).

## Accounts

Sign-in with Google uses [Better Auth](https://better-auth.com) on Cloudflare Pages
Functions (`apps/web/functions/`) with a D1 database (`apps/web/migrations/`). Each
user's printer, filament and process presets, setup choices, theme, and printers with
their connection details (API keys encrypted at rest) are stored per account. Signed
out, the same data is kept in the browser and merged into the account at sign-in.
Every deploy signs in through one host (`AUTH_ORIGIN` in `apps/web/wrangler.toml`,
https://slicer.awesomestuff.qzz.io) with Better Auth's oAuthProxy plugin, so branch
previews work with one Google OAuth client.

## Projects

The Project menu in the top bar (New, Open, Projects, Save, Save as, Download 3MF) saves
the open project as an Orca 3MF project, written by the engine with Orca's own
`store_bbs_3mf` (like desktop's Save project): plates, objects, part settings, paint,
colour mixes and the full print, filament and printer settings, so it reopens here or in
desktop Orca. Signed out, Save downloads the file. Signed in, Save keeps it in the
account's online projects: the 3MF and a thumbnail in R2 (`PROJECTS` bucket), indexed in
D1 (`projects` table). Limits keep R2 inside its free 10 GB: 50 MB per project, 200 MB
and 200 projects per user, 8 GB for the whole site. Saves carry the version they started
from, so a save from a second device asks before overwriting.

Setup, once: give the Cloudflare token "D1: Edit", create a Google OAuth client
(Web application) with redirect URI `https://slicer.awesomestuff.qzz.io/api/auth/callback/google`,
and add its id and secret as repository secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
For online projects, turn on R2 in the Cloudflare dashboard (free up to 10 GB) and give the
token "Workers R2 Storage: Edit"; without it the site works and online projects say they
aren't set up. CI creates the database and the R2 bucket, applies migrations, copies the
secrets to Pages and generates `BETTER_AUTH_SECRET` and `ACCOUNT_ENC_KEY` once.

## Device tab

The Device tab controls Moonraker (Klipper) printers: cameras (all of Moonraker's
webcams, several at once), temperatures, motion, the console, files, upload and print,
plus Snapmaker U1 extras (tool heads, filament sync, the U1 print dialog with tool
mapping). A printer with a public https address is reached directly (the tab shows the
`cors_domains` lines Moonraker needs, and a Tailscale hint). A printer on a home network
is reached through a small **bridge** on any always-on computer near it, which connects
out to the **relay** (a Cloudflare Worker with one Durable Object per bridge), so no
router ports are opened:

    browser ⇄ relay (apps/device-relay) ⇄ bridge (apps/device-bridge) ⇄ printer's Moonraker

Setting up a home printer, from the Device tab's "Add a printer":

| System | How |
|---|---|
| Windows | Download the app and open it ("Windows protected your PC": More info, then Run anyway) |
| macOS, Linux, Raspberry Pi (64-bit) | `curl -fsSL https://cloud-slicer-relay.nissy34.workers.dev/install.sh \| sh` in Terminal |
| Anything with Node.js 22+ | Download `cloud-slicer-bridge.mjs` and run `node cloud-slicer-bridge.mjs` |

The bridge asks nothing: it starts with the computer (Windows and macOS at login,
Linux at boot) and opens a pairing link, and the Device tab then searches the
bridge's network for Moonraker printers and adds the ones you pick, with their API
keys, or any address you type. API keys are only ever entered in the Device tab.
Pairing links carry a browser key derived from the bridge's secret; the relay stores
only hashes and rate-limits connects. The apps are unsigned (signing costs money),
which is why Windows warns and why macOS uses the Terminal command. More in
[apps/device-bridge/README.md](apps/device-bridge/README.md) and
[apps/device-relay/SECURITY.md](apps/device-relay/SECURITY.md).

## Tests

```bash
(cd packages/printer && npm test)        # printer driver unit tests + mock Moonraker
(cd apps/device-bridge && npm test)      # bridge unit tests
(cd apps/web && npm test)                # web app unit tests (Vitest)
node --test engine/node/engine.test.mjs  # engine: presets, STL, painted Bambu 3MF, dual-colour 3MF
```

Browser end to end tests (Playwright's Chromium) run against the built site
(`cd apps/web && npm run build` first):

| Test | Checks |
|---|---|
| `npm run smoke` (`test/smoke.mjs`) | Open Benchy, slice, download the G-code and check it is a real U1 print file |
| `test/startup-matrix.mjs` | The engine starts under other time zones, languages, CPU counts and in stable Chrome |
| `test/presets.mjs` | Save, find, rename and delete your own presets |
| `test/accounts.mjs` | Sign-in, sessions, synced presets/settings/printers, online projects (Pages Functions + local D1, mock Google) |
| `test/toolbar.mjs` | The object toolbar: add a model, lay on face, fits a phone |
| `test/mixing.mjs` | Make a colour mix, slice, the G-code alternates between both tools |
| `test/loading.mjs` | The loading screen while the engine starts and a project opens |
| `test/device-smoke.mjs` | Device tab through relay and bridge to a mock U1, and direct to a mock Klipper printer |

CI never talks to a real printer: printer tests use a mock Moonraker. How CI runs all of
this, its caches and deploys: [docs/CI.md](docs/CI.md).

## Licence

AGPL-3.0, the same as the Orca engine it is built on. If you run a modified copy as a
service, you must offer its source to its users.
