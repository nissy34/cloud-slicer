# Web app

The Cloud Slicer site: React 18 + TypeScript + Vite, three.js through React Three Fiber,
zustand for state, and Cloudflare Pages Functions for accounts and online projects. The
slicing engine (`../../engine`) runs in a Web Worker in the page.

## Run it

```bash
npm ci
npm run dev          # copies the engine into public/engine, then starts Vite
npm run build        # typecheck + production build into dist/
npm run pages        # dist/ + Functions + a local D1 on http://localhost:8788 (after build)
```

`npm run engine` (part of `dev` and `build`, `scripts/copy-engine.mjs`) puts what the
engine worker loads into `public/engine/`: `orca-engine.{js,wasm}` from `ENGINE_DIR`
(default `../../engine/build/engine`, which it first fills with the engine CI built for
these sources, `engine/scripts/fetch-engine.mjs`; `ENGINE_FETCH=0` skips that), the bundled presets (Snapmaker at start, every other brand in `profiles/`), desktop's settings
layout and the calibration models. The presets, layout and calibration models need the
`engine/orcaslicer` submodule checked out; without the engine binaries the page loads
without an engine.

The page must be cross-origin isolated (COOP/COEP `require-corp`) for the engine's
threads; Vite and `public/_headers` both send the headers. One consequence: a camera
image or page from another origin needs CORS or a credentialless iframe (see
`src/device/camera.ts`).

`VITE_DEVICE_RELAY_URL` points the Device tab at your own relay (default
`https://cloud-slicer-relay.nissy34.workers.dev`).

## Layout

| Path | What |
|---|---|
| `src/App.tsx`, `src/components/` | The slicer UI: top bar (Prepare, Preview, Device tabs, Project, Calibration, theme, account menus), sidebar with printer, filament and process pickers, settings panel, object list and per-object settings, 3D viewport with the object toolbar and gizmos, paint and colour mixing panels, setup wizard, convert dialog, loading screen |
| `src/state/store.ts` | The slicer store: engine status, presets and selection, overrides, the project and plates, tools, paint, mixes, undo/redo, slicing and its result |
| `src/state/projects.ts` | The open project as a document: name, saved where, unsaved changes, save and open |
| `src/state/account.ts`, `src/account/` | Who is signed in and everything saved per user (presets, settings, devices); works signed out from localStorage |
| `src/state/device.ts`, `src/device/` | The Device tab: Moonraker status and commands, cameras, links (direct and through the bridge), U1 add-on, and its screens under `ui/` |
| `src/state/loading.ts` | What the loading screen shows (engine start with download progress, project opening) |
| `src/engine/` | The engine client (`client.ts`), its message types (`protocol.ts`) and the G-code parser worker for the Preview |
| `public/engine/engine-worker.js` | The engine's Web Worker: loads the wasm, the presets and user presets, and answers the client's calls |
| `src/lib/` | Pure helpers with unit tests next to them: G-code parsing, flow variants, project settings import and conversion, colour mixing recipes, calibration tests, setup choices, thumbnails, theme |
| `functions/` | Pages Functions: `/api/auth/*` (Better Auth, Google), `/api/me`, `/api/presets`, `/api/settings`, `/api/devices`, `/api/projects` |
| `migrations/` | D1 migrations. One database serves production and every preview, so they must stay additive |
| `public/` | Static files: `_headers`, the app icon, `manifest.webmanifest` and a service worker that only makes the site installable (it caches nothing, so a new deploy's page and engine always arrive together) |
| `test/` | Browser end to end tests (Playwright) and the Device tab's mock printer |

## How the pieces talk

- The page calls the engine through `src/engine/client.ts`, which posts `{ id, method,
  args }` to the worker and gets results, progress and errors back. Everything is in
  Orca's own vocabulary: preset names, option keys, serialized values.
- The engine worker is loaded with `?v=<engine build hash>` and every file it loads
  carries the same `?v`, so a cached file from an older deploy is never mixed in.
- If the engine fails to start, the page shows the error with a Copy button (error,
  engine build, browser) for a bug report. Nothing is reported automatically: the site
  has no telemetry.
- User presets are stored as Orca user preset JSON (see "Presets" in
  [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)) and written into the engine's data
  folder before it loads presets, so the engine treats them exactly like desktop does.

## Tests

```bash
npm test                    # Vitest unit tests (src/**/*.test.ts)
npm run typecheck           # app and Functions
npm run build && npm run smoke
node test/startup-matrix.mjs
node test/presets.mjs
node test/preset-files.mjs
node test/accounts.mjs      # needs NO_PROXY=localhost,127.0.0.1 behind a proxy
node test/toolbar.mjs
node test/mixing.mjs
node test/warnings.mjs    # objects over the plate edge, slicing warnings
node test/loading.mjs
node test/cancel.mjs
node test/brands.mjs     # every printer brand, loaded per brand, can-send marks
node test/bed.mjs        # each printer's own bed shape and picture in the 3D view
node test/filament-count.mjs  # 8 filaments on an X1 Carbon and on the U1, in both engines
node test/device-smoke.mjs  # browser -> local relay -> bridge -> mock U1, and direct
```

`SMOKE_URL=https://… node test/smoke.mjs` runs the smoke test against a deployed site.
