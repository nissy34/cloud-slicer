# Cloud Slicer

A full slicer in the browser, built on the Snapmaker Orca engine compiled to WebAssembly.
Slicing runs in your browser tab; the cloud keeps your account, printers, filament and
process profiles, and projects, and relays your printer for the Device tab.

Status: **phase 1–2** (engine API, desktop slicer). See the [plan](https://claude.ai/code/artifact/3bf2b10a-0e98-4fd8-9794-fc5c2fe41336)
for the architecture and roadmap.

## Layout

| Path | What |
|---|---|
| `engine/` | The engine: Snapmaker Orca's libslic3r in WebAssembly with an embind API, its build, patches, and a Node CLI and tests. See [engine/README.md](engine/README.md) |
| `engine/orcaslicer/` | Submodule: upstream Snapmaker Orca, pinned to v2.4.0 |
| `apps/web/` | The web app (React + TypeScript + Vite) |
| `packages/printer/` | Printer drivers for the Device tab: Moonraker client, filament library and sync, G-code summary, tool remap, and a mock Moonraker for tests |
| `fixtures/` | Small test models and G-code |

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

## Run the web app

```bash
cd apps/web
npm ci
npm run dev        # copies the engine build into public/engine, then starts Vite
```

The page needs cross-origin isolation (COOP/COEP) for the engine's threads; the dev server
and `public/_headers` (Cloudflare Pages) both send it.

## Tests

```bash
(cd packages/printer && npm test)    # printer driver unit tests + mock Moonraker
(cd apps/web && npm test)            # web app unit tests
(cd apps/web && npm run smoke)       # browser end to end: load Benchy, slice, check G-code
node --test engine/node/engine.test.mjs   # engine: presets, STL, painted Bambu 3MF, dual-colour 3MF
```

CI (`.github/workflows/ci.yml`) builds the engine, runs all of the above, and deploys the
site to Cloudflare Pages when the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
secrets are set. CI never talks to a real printer.

## Licence

AGPL-3.0, the same as the Orca engine it is built on. If you run a modified copy as a
service, you must offer its source to its users.
