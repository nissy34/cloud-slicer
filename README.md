# Cloud Slicer

A full slicer in the browser, built on the Snapmaker Orca engine compiled to WebAssembly.
Slicing runs in your browser tab, on a desktop or a phone; the cloud keeps your account,
printers, filament and process presets, and projects, and relays your printer for the
Device tab.

Live at **https://slicer.awesomestuff.qzz.io**. Free to use, open source (AGPL-3.0), and
hosted on Cloudflare's free tier.

## What it does

- **Slices like desktop Snapmaker Orca 2.4**, in the browser, on a computer or a phone:
  STL, OBJ, AMF and 3MF projects, Bambu Studio files with painted colours, multi-plate
  projects. A second engine, OrcaSlicer 2.4.2, can be picked per project.
- **Every printer brand the engine ships**, with a first-run setup wizard, desktop's
  settings pages, your own presets and preset files in and out.
- **Desktop's Prepare tools**: move, cut, measure, simplify, mesh boolean, text and SVG,
  painting, assemble, variable layer height, brim ears, plates with their own settings,
  colour mixing, calibration tests.
- **Preview** coloured like desktop's views, with pauses and filament changes per layer.
- **Projects** saved as Orca 3MF files: online with AutoSave when signed in (Google),
  downloaded when not.
- **Device tab** for Klipper printers, Prusa (PrusaLink), OctoPrint, the Elegoo Centauri
  Carbon and Bambu Lab printers: cameras, temperatures, files, send and print, print
  alerts on your phone, and which plates were printed. Printers at home are reached
  through a small bridge app.
- **Installable** on Android, light and dark theme, phone layout with tabs at the bottom.

Every feature in detail: [docs/features.md](docs/features.md). How it is built and why:
[docs/README.md](docs/README.md) (start here; it says which page to read).

## Layout

| Path | What |
|---|---|
| `engine/` | The engine: Snapmaker Orca's libslic3r in WebAssembly with an embind API, its build, patches, and a Node CLI and tests. See [engine/README.md](engine/README.md) |
| `engine/orcaslicer/` | Submodule: upstream Snapmaker Orca, pinned to v2.4.0 |
| `engine/orcaslicer-upstream/` | Submodule: OrcaSlicer, pinned to v2.4.2, the second engine (engine/README.md, "Two engines") |
| `apps/web/` | The web app (React + TypeScript + Vite) and its Cloudflare Pages Functions. See [apps/web/README.md](apps/web/README.md) |
| `apps/device-bridge/` | The bridge that lets the Device tab reach printers on a home network: one small Go program per system and chip, and the Mac/Linux installer. See [apps/device-bridge/README.md](apps/device-bridge/README.md) |
| `apps/device-relay/` | The relay Worker between browsers and bridges. See [apps/device-relay/README.md](apps/device-relay/README.md) and [SECURITY.md](apps/device-relay/SECURITY.md) |
| `packages/printer/` | Printer helpers ported from the Android app (Moonraker client, filament library, G-code summary, tool remap). The site doesn't use them; only CI runs their tests |
| `fixtures/` | Small test models and G-code |
| `docs/` | [Docs map](docs/README.md): [architecture](docs/ARCHITECTURE.md), one page per feature, [decisions](docs/decisions.md), [features](docs/features.md), [CI](docs/CI.md) |

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

## Tests

```bash
(cd apps/web && npm test)                # web app unit tests (Vitest)
(cd apps/device-bridge && go test ./...) # bridge unit tests
node --test engine/node/engine.test.mjs  # engine tests
(cd packages/printer && npm test)        # printer helper tests
```

Browser end-to-end tests and the pretend printers: [docs/architecture/testing.md](docs/architecture/testing.md).
How CI runs them, its caches and deploys: [docs/CI.md](docs/CI.md).

## Licence

AGPL-3.0, the same as the Orca engine it is built on. If you run a modified copy as a
service, you must offer its source to its users.

The built-in text fonts (Noto Sans, Noto Serif and Noto Sans Mono, from the
`@expo-google-fonts` packages) are under the SIL Open Font License 1.1.
