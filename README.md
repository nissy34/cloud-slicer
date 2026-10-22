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
- **Every printer brand the engine ships** (55 in Snapmaker Orca, 63 in OrcaSlicer, with
  their filaments and processes), with a first-run setup wizard (like Orca's) to pick the
  printers and filaments you have: search, pictures, and a "Direct print" mark on the
  printers this app can send prints to (Klipper ones); for the others you download the
  G-code. Snapmaker's presets load at start and another brand's only once you pick one
  of its printers, so the page starts as fast as with Snapmaker alone. The 3D view shows the
  selected printer's own bed like desktop: the brand's bed shape under the plate and its
  print sheet picture (the Snapmaker U1's, a Bambu Lab sheet, Prusa's...) over the printable
  area, with desktop's grid, the bed's exclusion areas and the X/Y/Z arrows at the origin;
  a printer without one gets the plain plate.
- **Process settings in desktop's own pages and groups**, with per-object settings and a
  Standard flow / High flow switch for options that hold one value per nozzle flow
  variant (the U1). Like desktop, settings that don't apply grey out or hide (support
  settings with support off, ironing settings with ironing off), and a change that makes a
  combination desktop rejects (spiral vase with more than one wall, extrusion fuzzy skin
  without Arachne...) fixes itself or asks how to fix it. A search box above the pages finds
  any setting by name across every page, Advanced ones included.
- **Your own presets**, saved as Orca user presets (a diff over a system preset), with
  printer and filament settings windows like desktop's preset editors (with its Extruder 1 to 4
  pages, one per tool head, Motion ability with the machine limits, and the filament's Setting
  Overrides, where a filament can use its own retraction and z-hop values or the printer's), and preset files
  in and out (desktop Orca's preset JSON, `.orca_printer`, `.orca_filament`, zip). One preset
  works in both engines: settings both have (605, listed in `apps/web/src/lib/shared-settings.json`)
  stay the same in both, while G-code, Snapmaker's high flow values and settings only one engine
  has are kept per engine, each on its own base preset (`apps/web/src/lib/preset-engines.ts`).
- **Two engines, chosen per project**: Snapmaker Orca or OrcaSlicer 2.4.2. The Slicer engine
  dropdown above the printer switches an open project to the other engine, like desktop's
  printer change: when something would be lost, a pop-up first lists just that (each colour mix
  and the filament it becomes, high flow values you changed, settings the other engine lacks, a
  process with no match of its layer height); model, plates, positions and painting stay
  (`apps/web/src/lib/engine-switch.ts`).
- **3MF print settings import**: a project's own settings come in on top of your presets.
  A 3MF made for a printer you don't have (for example a Bambu project) can be converted
  onto one of yours: the print settings its author changed carry over, the ones left at
  the old printer's defaults and the printer's own settings (speeds, accelerations,
  jerk) come from your printer, and filaments are matched by material.
- **Filaments per project** follow the file, like desktop: as many as the file has or you
  add, in both engines. On the U1 you pick a head for each filament when you send the print
  (`apps/web/src/lib/filament-limit.ts`).
- **Prepare tools**: move, rotate, scale (exact fields like desktop's: position X, Y and Z, where a
  Z below the bed sinks the object into it; rotation; scale in percent or size in mm, all three
  axes together while "Scale evenly" is on; the same fields for a part inside its object), lay on face, cut, measure (distances and angles
  between faces, edges, circles and corners), variable layer height (adaptive, smooth,
  or by hand on the layer height chart), arrange, auto-orient, split,
  mirror, simplify (offered by itself when the plate to slice has too many triangles to slice comfortably), plates, brim ears (by hand or on the corners), undo and redo, desktop's editing keys (Del deletes the
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
- **Flushing volumes** for printers with one nozzle and several filaments (Bambu AMS, Prusa
  MMU, Creality CFS...), like desktop's window: how much each filament change purges, per
  pair of filaments, worked out from their colours by each engine's own formula (again for a
  filament whenever it or its colour changes), with the multiplier, Re-calculate, and where
  the purge goes (prime tower, infill, support, per object into objects). Printers with a
  head per filament (the U1) never purge, so they don't show it and say why.
- **Colour mixing**: Snapmaker Orca's mixed filaments, virtual filaments made of two or
  more physical ones, usable anywhere a filament is.
- **Filaments from the printer**: "From printer" in the Filament section loads what is in
  a U1's tool heads (material, brand, colour) into the project, like desktop's Sync
  filament: match each project filament to the closest loaded one, or replace the list.
- **Calibration tests** from desktop's Calibration menu: temperature, flow rate, pressure
  advance (tower, lines or pattern, with direct drive / Bowden ranges and the pattern's
  speed and acceleration lists), retraction, max volumetric speed, VFA, input shaping,
  junction deviation.
- **Slicing you can stop**: Cancel next to the progress bar, and a change while slicing
  (settings, filaments, presets, the model) stops the slice and drops its result, like desktop.
- **Preview** of the sliced toolpaths layer by layer, coloured like desktop's view types: line type, filament,
  speed, layer height, line width, flow, layer time (also on a log scale), fan speed and temperature, with
  the scale in the colour key. Tap a line type in the key to hide or show it. The Filament view lists each
  filament's grams, metres and cost (prime tower included) and the number of filament changes.
  Desktop's layer slider items: a pause, a filament change, custom G-code or the printer's custom
  template at the start of a layer (+ beside the slider, or a right click or long press on it),
  shown as markers on the slider and kept per plate in the project and its 3MF.
- **Warnings like desktop's**: an object over the plate's edge or above the printer's height
  shows darker past the edge and has to be moved before slicing; after a slice its
  warnings (empty layers, G-code paths of two objects running into each other, objects
  that need support, risky settings, toolpaths outside the plate or above the printer)
  are listed under the result, and toolpaths outside the build volume can't be downloaded
  or sent, as on desktop.
- **Camera views** in the corner of the 3D views: Fit all, and desktop's Iso, Top, Bottom,
  Front, Back, Left and Right (keys 0 to 6, Z fits all). On a phone two fingers always zoom
  and turn the camera, even when they land on the model; one finger on a model moves it.
- **Projects**: save as an Orca 3MF that reopens here or in desktop Orca; online in your
  account when signed in, downloaded when signed out. Signed in, **AutoSave** works like
  Word's: new work is kept as an unsaved draft, the first Save names it, then every change
  is saved on its own (a switch turns it off). Open the app on another device and a
  **Continue** card picks up where you left off; one device edits a project at a time,
  the other shows it view only with "Edit here instead".
- **Share to Cloud Slicer** on Android (installed app): share a model from another app
  and it opens here, or is added to the project you have open.
- **Sign in with Google** to keep presets, setup choices, printers and projects on every
  device. Signed out, everything is kept in the browser and merged in at sign-in.
- **Device tab** for Moonraker (Klipper) printers: cameras, temperatures, motion, files,
  upload and print, skipping objects mid-print, plus Snapmaker U1 extras (tool heads, filament sync, the U1 print
  dialog, the U1's error codes in Snapmaker's own words). Printers on a home network are reached through a small bridge app.
- **Light and dark theme**, a layout that works on phones (an open tool stacks the toolbar, its options and the model, with the settings hidden until Done), and installable as an app
  (PWA) on Android.

How it is built, and why: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

| Path | What |
|---|---|
| `engine/` | The engine: Snapmaker Orca's libslic3r in WebAssembly with an embind API, its build, patches, and a Node CLI and tests. See [engine/README.md](engine/README.md) |
| `engine/orcaslicer/` | Submodule: upstream Snapmaker Orca, pinned to v2.4.0 |
| `engine/orcaslicer-upstream/` | Submodule: OrcaSlicer, pinned to v2.4.2, the second engine (engine/README.md, "Two engines") |
| `apps/web/` | The web app (React + TypeScript + Vite) and its Cloudflare Pages Functions. See [apps/web/README.md](apps/web/README.md) |
| `apps/device-bridge/` | The bridge that lets the Device tab reach printers on a home network: one small Go program per system and chip, and the Mac/Linux installer. See [apps/device-bridge/README.md](apps/device-bridge/README.md) |
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

## Admin page and limits

The site's owner (the Google emails in the `OWNER_EMAILS` repository secret) gets
**Admin: people and limits** in the account menu. It lists every account (joined, last
seen, storage used, projects, presets, printers, bridges) with **Block** / **Unblock** and
**Delete** (removes the account, presets, printers, projects and their files),
has an **Invite only** switch with an email list, sets **online project storage** per
person (a site default plus per-person overrides; "Presets only" turns online projects
off while presets and printers still save), and shows the site's use against
Cloudflare's free limits. Nothing changes for people who are allowed. Changes on the page
show at once and save in the background ("Saving…", then "Saved" beside the title); a
change the server refuses goes back, with the reason.

- Blocking and the user list are Better Auth's admin plugin: a blocked person is signed
  out everywhere and refused at sign-in. Invite only is a Better Auth database hook on
  new accounts and new sessions; turning it on keeps everyone who already has an account.
- The bridge relay only lets in browsers of signed-in, allowed accounts. The site gives
  the browser a ticket for each bridge (a short-lived JWT signed with `RELAY_TICKET_KEY`;
  the relay has only the public key) and renews it by itself. Each account can use 3
  bridges and watch 2 cameras at a time through a bridge. Blocking someone drops their
  relay connections at once. The first account to use a bridge owns it; a bridge that no
  signed-in browser opens within 7 days of its first connection is turned away, and so is
  a bridge whose owner is blocked. Bridges set up before this keep working: their 7 days
  start at their next connection, and opening the Device tab once while signed in ties
  them to the account. Signed out, bridge printers show a Sign in button; printers
  reached directly need no account. The Admin switch **Signed-out people can use bridges**
(off by default, never while invite only) gives signed-out browsers a ticket too, with one
camera at a time; they have no account, so they can't be blocked, and turning the switch
off disconnects them at once. The Admin page's **Bridges** list shows every bridge in use
and who uses it: **Turn off** closes a bridge for everyone and refuses its bridge app until
it is turned on again. Each person can also be set to "Bridges: not allowed".
- Usage: storage, accounts and bridges come from D1. Today's request counts (site and
  relay, database rows) need a read-only Cloudflare token: create one from the "Read
  analytics and logs" template and add it as the repository secret
  `CLOUDFLARE_ANALYTICS_TOKEN`.

Setup, once: add your Google email as the repository secret `OWNER_EMAILS` (several:
comma separated). CI copies it to Pages and creates the relay ticket key pair.

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

The Project menu in the top bar (New, Open, Projects, Save, Save a copy, AutoSave, Download 3MF) saves
the open project as an Orca 3MF project, written by the engine with Orca's own
`store_bbs_3mf` (like desktop's Save project): plates, objects, part settings, paint,
colour mixes and the full print, filament and printer settings, so it reopens here or in
desktop Orca. Signed out, Save downloads the file. Signed in, Save keeps it in the
account's online projects: the 3MF and a thumbnail in R2 (`PROJECTS` bucket), indexed in
D1 (`projects` table). Limits keep R2 inside its free 10 GB: 50 MB per project, 200 MB
(changeable on the Admin page) and 200 projects per user, 8 GB for the whole site. Saves carry the version they started
from, so a save from a second device asks before overwriting.

AutoSave (signed in, on by default, the switch is a user setting): a new project is one
draft in the account (`projects.draft = 1`, a new draft replaces the old one, drafts don't
count toward the 200 projects but do count toward storage). Leaving it asks Save / Don't
save / Cancel; the first Save names it and turns it into a project. After that each change
is saved once things are quiet for 5 s, at most every 30 s (every 3 min for projects of
5 MB or more, since each save uploads the whole 3MF), and when the tab is hidden; the
thumbnail goes up at most every 10 min. Each save names the browser it came from
(`projects.device`, a random id kept in the browser, and `device_name`, like "phone").
A save from another device than the last one is refused (409 `elsewhere`) until that device
takes the project over (`POST /api/projects/<id>/device`, "Edit here instead"); the other
tab notices when it is focused again (no polling) and goes view only, offering "Save mine as
a copy" when it had unsaved changes. On opening the app with nothing loaded, the Continue card
offers the draft, or the newest project changed on another device in the last day.
Share to Cloud Slicer is the manifest's `share_target`: `public/sw.js` keeps the shared files
in the Cache API and opens `/?shared=1`, which opens them (`src/lib/share-target.ts`).

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
skipping objects during a print ("Skip objects…" on the Print card: a top-down map of
the object outlines plus a list, sending Klipper's `EXCLUDE_OBJECT`; it needs the
G-code's object labels, which `engine/scripts/klipper-labels.mjs` turns on in every
Klipper printer's system process presets),
plus Snapmaker U1 extras (tool heads, filament sync, the U1 print dialog with tool
mapping, and the U1's errors on the Print card with their code and Snapmaker's own
title and advice; `apps/web/scripts/u1-errors.mjs` rebuilds that list from Snapmaker
Orca's device page). A printer with a public https address is reached directly (the tab shows the
`cors_domains` lines Moonraker needs, and a Tailscale hint). A printer on a home network
is reached through a small **bridge** on any always-on computer near it, which connects
out to the **relay** (a Cloudflare Worker with one Durable Object per bridge), so no
router ports are opened:

    browser ⇄ relay (apps/device-relay) ⇄ bridge (apps/device-bridge) ⇄ printer's Moonraker

Cameras skip the relay: the bridge sends them straight to the browser over WebRTC (the
camera's own live video when it has some, like the paxx12 U1 firmware or camera-streamer,
otherwise up to 15 pictures a second). Only on a network that blocks direct links does
the camera fall back to one picture a second through the relay, with a note saying so.

Setting up a home printer, signed in, from the Device tab's "Add a bridge" (or Add a
printer): the dialog makes a one-use **setup code** (good for one hour) and shows one
command that carries it:

| System | How |
|---|---|
| Windows | `irm "<relay>/install.ps1?code=<code>" \| iex` in PowerShell, or the `install.cmd` line in Command Prompt |
| macOS, Linux, Raspberry Pi (64 and 32-bit), Creality K1 (MIPS) | `curl -fsSL "<relay>/install.sh?code=<code>" \| sh` in Terminal |
| On the printer itself (any Klipper printer) | the same line with `sh -s -- --printer`, over SSH |

The bridge spends the code as it installs and joins that account at once (a bridge
without a valid code never connects; an expired code makes the command ask for a new
one). It starts with the computer (Windows and macOS at login, Linux at boot), the
dialog turns green by itself, and the Device tab then searches the
bridge's network for Moonraker printers and adds the ones you pick, with their API
keys, or any address you type. API keys are only ever entered in the Device tab.
Bridges are saved on their own, apart from their printers: the Device tab's
Printers & bridges window lists each bridge with its printers, removes either on
its own, adds printers to a saved bridge with no pairing again, and removing a
running bridge makes it uninstall itself from its computer.
The account keeps a browser key derived from the bridge's secret; the relay stores
only hashes and rate-limits connects. Using a bridge needs a signed-in account (see
Admin page and limits). The apps are unsigned (signing costs money),
which is why Windows warns and why macOS uses the Terminal command. More in
[apps/device-bridge/README.md](apps/device-bridge/README.md) and
[apps/device-relay/SECURITY.md](apps/device-relay/SECURITY.md).

**Trying relay and bridge changes before they merge**: add the label `use test relay`
to the pull request. Its relay goes to a separate test relay, its bridges to that relay's
downloads, and every branch preview of the site sets up new bridges there, shown with a
**Test** tag. A test bridge ("Cloud Slicer Bridge (test)") installs next to your everyday
bridge without touching it, and only ever updates from the test relay; remove it with
Remove bridge or the uninstall line the preview shows. The live relay only changes on main.

**Print alerts** (the Device tab's Alerts card): "Send alerts to this phone" turns them
on for one printer on one device, with a switch per moment. Problems (failed or
cancelled, paused or filament ran out, printer error) and Finished are on to begin
with; print started, first and third layer, progress at chosen percentages, almost done
(10 minutes left), still printing every few hours, resumed and bed cooled down are
there to turn on, and "Alert me after layer N" is also in the Print dialog (it lasts
until that print ends; there it also turns alerts on, and refuses a layer past the
print's last one). For a printer through a bridge, the bridge watches the
print itself (any Klipper printer: Moonraker's print state, layers, bed temperature
and filament sensors), so alerts come with the browser closed: it sends each event
to the relay, which sends a Web Push message (encrypted for the browser, signed with
the relay's VAPID key) through the browser's own push service, with a camera
picture on the key alerts. A printer reached directly can only alert while a tab is
open; the page runs the same rules itself. "The bridge goes offline" (off to begin
with) comes from the relay after 10 minutes without the bridge. iPhone and iPad need
Cloud Slicer on the Home Screen first (iOS 16.4 or later) and show no picture.
Each alert also says where the print stands: progress and layer ("47% · layer 120
of 250"), time left with the time it should finish in the phone's own time zone,
filament used so far against the file's total (grams when the slicer wrote the
weight, else metres), and, when it stops, how long it ran and what it used. A
filament pause names the head that ran out (U1) or the sensor; an error carries the
printer's own message, on the U1 Snapmaker's error title, description and code.
Tapping an alert opens the Device tab on its printer. The rules are in
`apps/web/src/device/alerts.ts` and `apps/device-bridge/alerts.go`, tested against
the same cases (`apps/device-bridge/testdata/alert-cases.json`, and
`alert-details-cases.json` for what an alert says about the print); the words are
in `apps/web/src/device/alert-text.ts`.

## Tests

```bash
(cd packages/printer && npm test)        # printer driver unit tests + mock Moonraker
(cd apps/device-bridge && go test ./...) # bridge unit tests
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
| `test/shared-presets.mjs` | A preset saved in Snapmaker Orca shows in OrcaSlicer and back, each engine on its own base |
| `test/preset-files.mjs` | Printer and filament settings windows, preset export and import |
| `test/accounts.mjs` | Sign-in, sessions, synced presets/settings/printers, online projects, AutoSave drafts, Continue on another device, view only, Share to Cloud Slicer (Pages Functions + local D1, mock Google) |
| `test/toolbar.mjs` | The object toolbar: add a model, variable layer height, simplify, brim ears, lay on face, measure, the object menu, parts and modifiers, mesh boolean, text and SVG shapes, assemble, fits a phone |
| `test/layout-fixes.mjs` | Prepare's layout and dialogs: long object and project names shorten with "…", the Paint card fits, closing the Text tool takes back an unchanged new text, preset menus name presets as their dropdowns and open upward near the bottom, Online projects closes with Esc or a click outside, unsaved changes ask in the app's own dialog, the phone's buttons after slicing fit one row |
| `test/mixing.mjs` | Make a colour mix, slice, the G-code alternates between both tools |
| `test/bed.mjs` | A Bambu Lab A1, the U1 and a Prusa MK4 each show their own bed shape and picture, fetched only for that printer, in both engines |
| `test/wipe-tower.mjs` | A two-filament plate shows the prime tower; drag it, and the slice prints it there |
| `test/view-touch.mjs` | Phone 3D view: pinching on a model that fills the screen zooms out instead of moving it; Fit all and the views menu |
| `test/loading.mjs` | The loading screen while the engine starts and a project opens |
| `test/preview-views.mjs` | The Preview's colour key: grams and filament changes match the G-code, every view draws its scale, a tapped line type hides and comes back, and on a phone the key sits above the model |
| `test/cancel.mjs` | Cancel stops the slice in the engine, and a change while slicing drops its result |
| `test/restart.mjs` | After an engine crash (mid-slice or after), the engine restarts and reopens the project |
| `test/heavy.mjs` | A model with over a million triangles offers Simplify, which brings it to about half a million |
| `test/device-smoke.mjs` | Device tab through relay and bridge to a mock U1, and direct to a mock Klipper printer |
| `test/device-alerts.mjs` | Print alerts: the Alerts card's defaults, a test alert, layer N from the Print dialog, a whole mock print pushed through bridge and relay to a pretend push service (decrypted), the open page alerting for a direct printer, a tapped alert opening its printer, the iPhone Home Screen note |

CI never talks to a real printer: printer tests use a mock Moonraker. How CI runs all of
this, its caches and deploys: [docs/CI.md](docs/CI.md).

## Licence

AGPL-3.0, the same as the Orca engine it is built on. If you run a modified copy as a
service, you must offer its source to its users.

The built-in text fonts (Noto Sans, Noto Serif and Noto Sans Mono, from the
`@expo-google-fonts` packages) are under the SIL Open Font License 1.1.
