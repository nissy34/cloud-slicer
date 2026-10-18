# Architecture and design

How Cloud Slicer is put together, the decisions behind it, and what is still to come.
This file is the design record for the repository; the per-part READMEs hold the
commands.

## Goals and constraints

- **A full slicer like desktop Orca, in the browser.** Everything Snapmaker Orca 2.4.0
  can slice should slice here with the same result, including Bambu 3MF projects and
  colour mixing (mixed filaments).
- **Slicing runs in the browser only**, on desktops and phones. There is no server-side
  slicing: a phone slices fine in the browser, so the planned "cloud slicing" and a
  separate mobile UI were dropped in favour of one responsive UI.
- **$0 a month.** Hosting is Cloudflare's free tier only: Pages (site and Functions),
  D1 (accounts), R2 (projects, bridge downloads) and Workers with Durable Objects
  (the device relay).
- **Snapmaker printers first.** Only Snapmaker's presets are bundled for now.
- **Don't reinvent the wheel.** Call Orca's own code for presets, settings, 3MF and
  slicing; use well-known libraries (Better Auth for sign-in) instead of hand-rolled code.
- **No telemetry**, no automatic error reporting. Errors are shown with a Copy button.
- **Open source**, AGPL-3.0 like the engine.

## The pieces

```
 browser (https://slicer.awesomestuff.qzz.io)
 ├─ page: React UI, zustand stores, three.js views
 │   ├─ engine worker: Snapmaker Orca libslic3r in wasm (engine/)
 │   └─ G-code parser worker (Preview)
 ├─ Pages Functions /api/*  ── D1 (accounts, presets, settings, devices, project index)
 │                           └─ R2 cloud-slicer-projects (project 3MFs, thumbnails)
 └─ Device tab ── direct https ──────────────────────────────▶ printer's Moonraker
              └─ wss ── relay Worker + Durable Object ── wss ── bridge ── LAN ─▶ Moonraker
                         (apps/device-relay)                    (apps/device-bridge)
```

## Engine

`engine/` builds upstream Snapmaker Orca's `libslic3r` (the `engine/orcaslicer`
submodule, v2.4.0, never edited in place) to WebAssembly with Emscripten, with a small
embind API (`engine/src/*_api.cpp`) that drives it the way desktop's GUI does:
`PresetBundle` for presets, `Model` and Orca's 3MF reader and writer for projects,
`Print` for slicing, `GCodeProcessor` for estimates, `TriangleSelector` for paint,
`MixedFilamentManager` for colour mixes, the Plater's calibration setups for calibration
tests.

- Browser-only fixes are small patch files in `engine/patches/`, applied to copies of
  the touched files at build time, each with its reason. Android-app patches from the
  U1 fork are not used.
- TBB's parallel loops run serially for now (`engine/compat/tbb_serial`): slices are
  correct but use one core. The serial loops have a cancellation point, so the page can
  stop a running slice.
- No STEP reader in the default build (no OpenCASCADE), no SLA hollowing (no OpenVDB).
- Plate thumbnails: the wasm engine has no OpenGL, so the page renders each plate the
  way desktop does and the engine's own G-code export embeds the pictures.

Details and build commands: [engine/README.md](../engine/README.md).

## Web app

`apps/web/` is React + TypeScript + Vite. The UI follows desktop Orca's structure
(Prepare, Preview and Device tabs; printer, filament and process pickers; settings in
desktop's pages and groups, extracted from `Tab.cpp` by
`engine/scripts/extract-settings-layout.mjs`; Orca's own toolbar icons) but is its own
code, not the Android app's. One layout serves desktops and phones.

State lives in zustand stores: the slicer (`state/store.ts`), the open project
(`state/projects.ts`), the account (`state/account.ts`), the Device tab
(`state/device.ts`) and the loading screen (`state/loading.ts`). The engine runs in a
Web Worker because slicing blocks for seconds and Emscripten's threads need
`Atomics.wait`; that needs cross-origin isolation (COOP/COEP), which the site always
sends. Cancel stops a running slice, and so does any change to settings, filaments,
presets or the model while it runs (its result is dropped, like desktop); engine edits
sent during a slice cancel it first instead of queueing behind it. After slicing, the
page switches to Preview; G-code is parsed in its own worker
and drawn as beads by feature or by filament.

The site is installable as an app (web manifest and a service worker that caches
nothing on purpose, so a deploy's page and engine never get out of step).

## Presets

- **System presets**: `engine/scripts/bundle-profiles.mjs` packs Snapmaker's vendor
  presets, plus Orca's filament library they inherit from, into one `profiles.json`. The
  worker writes them into the engine's data folder and the engine loads them with
  `PresetBundle::load_presets`, exactly like desktop. Every bundled printer is loaded;
  the setup wizard decides which ones the pickers show.
- **Setup wizard**: like Orca's first-run wizard, it asks which printers and filaments
  you have. The choice is an account setting (`setup`): kept in the browser signed out,
  in the account signed in, and merged (lists unioned) at sign-in. "Manage" next to the
  printer picker opens it again.
- **User presets** are Orca user presets: a JSON file per preset with `name`,
  `inherits` (the system preset, one level, as Orca allows), `from: "User"`,
  `version: "1.0.0"` (Orca skips a user preset without a parseable version) and only the
  options that differ from the parent. They are written to
  `<dataDir>/user/default/{machine,filament,process}/<name>.json` before the engine
  loads presets, so they behave like desktop's. The ⋯ menu on each picker saves,
  renames and deletes them; they sync with the account.
- **Flow variants**: Snapmaker Orca 2.4 keeps many speed, acceleration, jerk and
  filament options as one value per nozzle flow variant (standard, high flow), e.g.
  `initial_layer_speed = "50,50"`, while 2.2 files hold one value. The settings panel
  has desktop's Standard flow / High flow switch and edits one variant at a time
  (`src/lib/flow-variants.ts`); importing older files aligns their values to both.
- **Per-object settings** come from desktop's "Add settings" categories and are stored
  on the object, like desktop.

## Projects and 3MF import

- **Opening a 3MF** loads geometry, plates, per-part filaments and paint through Orca's
  own reader, and brings the file's own print settings (`project_settings.config`) in as
  overrides on top of the selected presets, like desktop's project presets. Opening a
  3MF over loaded objects asks whether to open it as the project or add its objects.
- **Converting**: when a 3MF was made for a printer you don't have (a Bambu project, for
  example), a dialog offers to put it onto one of your installed printers. Only
  model settings carry over (walls, infill, supports, seams...); printer-specific ones
  (machine speeds, accelerations, jerk) come from the target printer, and filaments are
  matched by material and kind (Matte, Silk, HF, Translucent). A sliced-only `.gcode.3mf`
  is explained instead of opened.
- **Saving**: projects are Orca 3MF files written by the engine (`store_bbs_3mf`), so
  they reopen in desktop Orca. Signed out, Save downloads the file. Signed in, they go to
  online projects: the 3MF and a PNG thumbnail in R2 under a new key for each save,
  indexed in the D1 `projects` table. Limits: 50 MB per project, 200 MB and 200 projects
  per user, 8 GB for the site (R2's free tier is 10 GB). Each save carries the version it
  started from; a save over a newer one asks whether to overwrite or save a copy.

## Colour mixing

Snapmaker Orca's mixed filaments: virtual filaments made of two or more physical ones,
numbered after them (5, 6... on a four-filament U1), usable for objects, parts and
paint. The list is Orca's own project option `mixed_filament_definitions`, which
`Print::apply` reads when slicing; the store keeps it as the project's mixes, outside
the settings overrides. `engine/src/mixed_api.cpp` wraps `MixedFilamentManager` for
adding, editing and deleting rows, their blended colours, remapping painted and
assigned filaments when a row or a physical filament goes away, and the "Match a
colour" search. The Add Mix dialog's modes follow desktop's `MixedFilamentDialog`
(`src/lib/mixing.ts`).

## Accounts

Google sign-in only, with Better Auth on Pages Functions and D1. Every deploy, branch
previews included, signs in through `AUTH_ORIGIN` (https://slicer.awesomestuff.qzz.io)
with Better Auth's oAuthProxy plugin, so one Google OAuth client serves them all. Per
user the account stores presets, settings by key (setup choices, theme...), devices
(printers with their connection details; API keys encrypted with AES-GCM using
`ACCOUNT_ENC_KEY`) and projects. The same client calls work signed out against
localStorage, and that data is merged into the account at the next sign-in. Production
and previews share one D1 database, so migrations must stay additive.

## Device tab

Built in two layers that the user sees as one screen:

1. **Generic Klipper/Moonraker** (`src/device/status.ts`, `commands.ts`, `camera.ts`):
   status, temperatures, motion, console, files (paged, with Moonraker's metadata and
   thumbnails), upload, start/pause/resume/cancel, and cameras from Moonraker's webcam
   list (MJPEG, WebRTC, the camera's own player page, or snapshots as the fallback),
   several at once, picked per printer. Works for any Moonraker printer.
2. **Per-printer add-ons** (`src/device/addons/`). The U1 add-on adds tool heads (sync
   filaments, load and unload, edit each head's filament, park and pick up,
   nozzle size and type), the U1 print dialog (tool mapping, auto levelling and the
   other print preferences) and the top cover's purifier. Commands come from Snapmaker's
   `u1-klipper`.

Sliced G-code goes to the Device tab's print dialog (`useDevice.getState().requestSend`).
"Upload only" sends the file; "Upload and print" also starts it. The app never starts a print by
itself, and tests only print on a mock printer.

Moonraker is reached one of two ways (`src/device/link/`):

- **Direct**, for a printer with a public https address (for example through Tailscale
  Serve or Funnel). The tab shows the `cors_domains` lines Moonraker needs.
- **Through a bridge**, for a printer on a home network, which a public https page
  can't reach (mixed content, private-network blocking, no route in). The bridge
  (`apps/device-bridge`) runs on any always-on computer near the printer and connects
  out to the relay (`apps/device-relay`, a Worker with one hibernating Durable Object
  per bridge), so no router ports are opened. Messages are Moonraker's own JSON-RPC,
  plus a few `bridge.*` calls the bridge answers itself (uploads, snapshots, discovery,
  adding and removing printers). Status is merged and sent at most once a second, and
  only while a browser is watching, to stay inside the free tier.

Bridge design choices:

- One-file apps built with `bun build --compile` for Windows, macOS, Linux and
  Raspberry Pi, served by the relay from R2 (`cloud-slicer-bridge`), plus `bridge.mjs`
  for anything with Node.js 22. They are unsigned to stay at $0, so macOS uses a
  one-line Terminal installer and Windows shows its "protected your PC" warning.
- The bridge window asks nothing. It starts with the computer and opens a pairing link;
  printers and their API keys are added from the Device tab, which can search the
  bridge's network for Moonraker.
- Pairing links carry a browser key (HMAC of the bridge's secret), never the secret;
  the relay stores only hashes, rate-limits connects and deploys from main only.

What each part can see and what is still open:
[apps/device-relay/SECURITY.md](../apps/device-relay/SECURITY.md). Snapmaker's own cloud
was ruled out (closed service with per-user device certificates, against its terms).

## Hosting and deploys

- Site and Functions: Cloudflare Pages project `cloud-slicer`, production on
  https://slicer.awesomestuff.qzz.io from `main`, a preview for every other branch at
  `<branch>.cloud-slicer.pages.dev`. Links shown to users always use the site's own
  origin or https://slicer.awesomestuff.qzz.io.
- Relay: Worker `cloud-slicer-relay`, deployed from `main` by `device.yml`.
- CI layout, caches and secrets: [CI.md](CI.md).

## Upcoming

In review, not on `main` yet:

- Preset files: import and export Orca preset files, and edit printer and filament
  settings, not only process settings (PR #31).
- The app icon on the bridge apps, the Windows bridge without a taskbar window, and
  per-system help when a bridge is offline (PR #34).

Later:

- Remaining desktop parity tools.
- Real worker threads in the engine instead of serial TBB.
- A choice of engine per user (Snapmaker Orca or upstream OrcaSlicer), after a study of
  what differs between them and what the app would change per engine.
- Device relay hardening: key rotation, end-to-end encryption (see SECURITY.md).
