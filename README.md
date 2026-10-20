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
- **Your own presets**, saved as Orca user presets (a diff over a system preset), with
  printer and filament settings windows like desktop's preset editors, and preset files
  in and out (desktop Orca's preset JSON, `.orca_printer`, `.orca_filament`, zip).
- **3MF print settings import**: a project's own settings come in on top of your presets.
  A 3MF made for a printer you don't have (for example a Bambu project) can be converted
  onto one of yours: the print settings its author changed carry over, the ones left at
  the old printer's defaults and the printer's own settings (speeds, accelerations,
  jerk) come from your printer, and filaments are matched by material.
- **Prepare tools**: move, rotate, scale (exact fields like desktop's: position X, Y and Z, where a
  Z below the bed sinks the object into it; rotation; scale in percent or size in mm, all three
  axes together while "Scale evenly" is on; the same fields for a part inside its object), lay on face, cut, measure (distances and angles
  between faces, edges, circles and corners), variable layer height (adaptive, smooth,
  or by hand on the layer height chart), arrange, auto-orient, split,
  mirror, simplify (offered by itself when a model has too many triangles to slice comfortably), plates, brim ears (by hand or on the corners), undo and redo, desktop's editing keys (Del deletes the
  picked copy or part, Ctrl+C / Ctrl+V copy and paste an object, Ctrl+K clones it, + and - add or
  remove a copy, also Add copy / Remove copy in the object list and object menu),
  painting (colours, support and seam enforcers/blockers, fuzzy skin), desktop's plate
  menu (right click or long press the plate or the space around it: add a primitive
  shape, text, an SVG, one of Orca's handy models or a model file, and on the plate
  arrange, auto orient, delete all, delete plate and rename plate, the name then shown
  on the plate; Show labels or Ctrl+E puts each object's name over it), and desktop's
  object menu (right click or long press an object, or ⋯ in the object list: clone,
  center, rename, printable, change filament, scale to fit, unit conversion, replace
  with STL, export as STL), and parts, negative parts, modifiers and support
  blockers/enforcers added to an object (shapes or a mesh file), shown see-through,
  moved with the gizmos, with their own settings, mesh boolean (union, difference or
  intersection of two of an object's parts), and text shapes (desktop's Text tool: raised,
  engraved or a modifier on the object's surface facing you, or an object of its own;
  edited live with built-in Noto fonts and Hebrew fonts (Rubik, Heebo, Frank Ruhl Libre, Noto Sans Hebrew), a font file (kept in the browser), or the computer's fonts in Chrome/Edge on a computer; Hebrew is laid out right to left (desktop prints it backwards), and the tool says which letters a font lacks;
  following a curved surface or set letter by letter, aligned left/centre/right and
  top/middle/bottom, slid over the object by dragging it (one finger on a phone), turned
  with its ring or a Rotation field, lifted off the surface, faced to the camera, and kept
  in the 3MF), and SVG shapes (desktop's SVG tool: an .svg file's paths as a raised,
  engraved or modifier shape on the object, or an object of its own when you open or drop an
  .svg file, with its depth and size changeable, following the surface, slid and turned like
  text, and the file kept in the 3MF), and Assemble
  (desktop's Assemble tool: pick a face on each of two parts and turn one parallel to the
  other, put it face on face middle on middle, flip it, set the distance between them or
  turn it about the face; or pick two points and move one onto the other; two objects are
  joined into one first, as only parts can leave the bed).
- **Prime tower on the plate**: when a plate prints with more than one filament the tower
  stands on the Prepare plate at the size Orca will print it, and you drag it where you
  want it, per plate, like desktop.
- **Colour mixing**: Snapmaker Orca's mixed filaments, virtual filaments made of two or
  more physical ones, usable anywhere a filament is.
- **Filaments from the printer**: "From printer" in the Filament section loads what is in
  a U1's tool heads (material, brand, colour) into the project, like desktop's Sync
  filament: match each project filament to the closest loaded one, or replace the list.
- **Calibration tests** from desktop's Calibration menu: temperature, flow rate, pressure
  advance, retraction, max volumetric speed, VFA, input shaping, junction deviation.
- **Slicing you can stop**: Cancel next to the progress bar, and a change while slicing
  (settings, filaments, presets, the model) stops the slice and drops its result, like desktop.
- **Preview** of the sliced toolpaths by feature or filament, layer by layer, and desktop's
  layer slider items: a pause, a filament change, custom G-code or the printer's custom
  template at the start of a layer (+ beside the slider, or a right click or long press on
  it), shown as markers on the slider and kept per plate in the project and its 3MF.
- **Camera views** in the corner of the 3D views: Fit all, and desktop's Iso, Top, Bottom,
  Front, Back, Left and Right (keys 0 to 6, Z fits all). On a phone two fingers always zoom
  and turn the camera, even when they land on the model; one finger on a model moves it.
- **Projects**: save as an Orca 3MF that reopens here or in desktop Orca; online in your
  account when signed in, downloaded when signed out.
- **Sign in with Google** to keep presets, setup choices, printers and projects on every
  device. Signed out, everything is kept in the browser and merged in at sign-in.
- **Device tab** for Moonraker (Klipper) printers: cameras, temperatures, motion, files,
  upload and print, plus Snapmaker U1 extras (tool heads, filament sync, the U1 print
  dialog). Printers on a home network are reached through a small bridge app.
- **Light and dark theme**, a layout that works on phones (an open tool stacks the toolbar, its options and the model, with the settings hidden until Done), and installable as an app
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

## Get the engine

You usually don't need to build it. CI builds the engine for every change to it and
publishes it, so this downloads the one built from your checkout's engine sources in
seconds (and fetches the `engine/orcaslicer` submodule if it's missing):

```bash
node engine/scripts/fetch-engine.mjs         # -> engine/build/engine/orca-engine.{js,wasm}
```

`npm run dev` and `npm run build` in `apps/web` run it for you. It only ever downloads an
engine built from exactly the same sources (Orca commit, `engine/src`, patches, CMake
files, build script; see `engine/scripts/engine-key.mjs`). If you changed any of those,
CI hasn't built that engine yet: push and wait for CI's engine job, or build it yourself.

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

Building the engine takes about 40 minutes the first time. More in [engine/README.md](engine/README.md).

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

## Preset files

Each preset picker's ⋯ menu exports the preset as desktop Orca's preset JSON, exports all
your presets as a zip that desktop's Import Configs reads, and imports `.json`,
`.orca_printer`, `.orca_filament` and `.zip` files. The engine reads them with Orca's own
loader. A preset must be based on a system preset the app ships: a printer preset for a
printer we don't have is refused, and a filament or process made for another printer can
be put on one of ours (keeping its material or model settings). Process settings are in the
sidebar; printer and filament (per slot) settings open in their own window from the ✎
beside their picker, like desktop's preset editors, with Save to preset, Save as new
preset and Save to project (changes kept only in the project 3MF).

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
Bridges are saved on their own, apart from their printers: the Device tab's
Printers & bridges window lists each bridge with its printers, removes either on
its own, adds printers to a saved bridge with no pairing again, and removing a
running bridge makes it uninstall itself from its computer.
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
| `test/preset-files.mjs` | Printer and filament settings windows, preset export and import |
| `test/accounts.mjs` | Sign-in, sessions, synced presets/settings/printers, online projects (Pages Functions + local D1, mock Google) |
| `test/toolbar.mjs` | The object toolbar: add a model, variable layer height, simplify, brim ears, lay on face, measure, the object menu, parts and modifiers, mesh boolean, text and SVG shapes, assemble, fits a phone |
| `test/mixing.mjs` | Make a colour mix, slice, the G-code alternates between both tools |
| `test/wipe-tower.mjs` | A two-filament plate shows the prime tower; drag it, and the slice prints it there |
| `test/view-touch.mjs` | Phone 3D view: pinching on a model that fills the screen zooms out instead of moving it; Fit all and the views menu |
| `test/loading.mjs` | The loading screen while the engine starts and a project opens |
| `test/cancel.mjs` | Cancel stops the slice in the engine, and a change while slicing drops its result |
| `test/restart.mjs` | After an engine crash (mid-slice or after), the engine restarts and reopens the project |
| `test/heavy.mjs` | A model with over a million triangles offers Simplify, which brings it to about half a million |
| `test/device-smoke.mjs` | Device tab through relay and bridge to a mock U1, and direct to a mock Klipper printer |

CI never talks to a real printer: printer tests use a mock Moonraker. How CI runs all of
this, its caches and deploys: [docs/CI.md](docs/CI.md).

## Licence

AGPL-3.0, the same as the Orca engine it is built on. If you run a modified copy as a
service, you must offer its source to its users.

The built-in text fonts (Noto Sans, Noto Serif and Noto Sans Mono, from the
`@expo-google-fonts` packages) are under the SIL Open Font License 1.1.
