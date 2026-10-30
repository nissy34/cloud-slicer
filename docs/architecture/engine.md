# Engine

> **Read this when** you change anything under `engine/`, the engine worker, or how the
> page talks to it. **Build commands and the full API file list:**
> [engine/README.md](../../engine/README.md). **Related:** [presets](presets.md),
> [preview](preview.md), [CI.md](../CI.md#published-engines).

## What it does

Slices in the browser with the same code as desktop: Orca's `libslic3r` compiled to
WebAssembly. Two engines ship, and each project picks one: Snapmaker Orca 2.4.1
(`engine/orcaslicer`, the default) or OrcaSlicer 2.4.2 (`engine/orcaslicer-upstream`).

## Pieces

| Part | Where |
|---|---|
| The two Orca sources, pinned submodules, never edited in place | `engine/orcaslicer`, `engine/orcaslicer-upstream` |
| Our API over Orca, one file per area (presets, model, slice, each tool) | `engine/src/*_api.cpp` |
| Browser-only fixes (and engine bugs that change what prints) as patch files, applied to copies at build time | `engine/patches/` (`snapmaker/`, `orca/` for one engine only) |
| Stand-ins for what a browser lacks | `engine/compat/` |
| Memory set-up (mimalloc, arena size) | `engine/src/memory.cpp` |
| Presets bundling, settings layout, bed meshes | `engine/scripts/` |
| Engine worker (loads wasm, presets, answers calls) | `apps/web/public/engine/engine-worker.js` |
| Client the page calls, message types | `apps/web/src/engine/client.ts`, `protocol.ts` |
| Which engine a project uses, switching | `apps/web/src/lib/engines.ts`, `engine-switch.ts` |
| Node CLI and engine tests | `engine/node/` |

## How it flows

```mermaid
sequenceDiagram
  participant P as Page (state/store.ts)
  participant C as client.ts
  participant W as Engine worker
  participant O as Orca (wasm, TBB threads)
  P->>C: slice(plate, presets, overrides)
  C->>W: {id, method, args}
  W->>O: sliceWithConfig
  O-->>W: progress
  W-->>P: progress
  O-->>W: G-code + estimates + warnings
  W-->>P: result (G-code blob)
  Note over P,W: Any edit sent during a slice cancels it first (Print::cancel via a watcher thread)
```

- Everything crossing the worker boundary is in Orca's own words: preset names, option
  keys, serialized values, JSON.
- Plate thumbnails: the engine has no OpenGL, so the page draws each plate and hands the
  pictures to Orca's own G-code export.
- If the engine crashes after start, a new one starts and reopens the project
  (from its 3MF, or a copy saved before slicing if it was edited).
- Files the worker loads carry `?v=<engine build hash>`, so a cached older engine is
  never mixed with a newer page.

## What it keeps

Nothing of its own between visits. The engine's file system holds the bundled presets,
the user's presets (written before presets load) and fonts for the Text tool.

## Updating an engine

Move the submodule to the new tag (replace, never add a third engine), then check:
every patch in `engine/patches/` still applies; `extract-settings-layout.mjs` still reads
desktop's pages (new settings show by themselves); `option-toggles.ts` gets the new
`ConfigManipulation.cpp` rules (diff it against the old tag); preset files still parse
(2.4.1 brought byte order marks, which `bundle-profiles.mjs` strips); and, once CI has
built the engine, `node scripts/shared-settings.mjs` in `apps/web` (new version, old list kept in
`history`). Desktop-only screens the release adds go to a pick page first. Compare how the
new release starts a print on each printer it sends to (Snapmaker Orca's device page in
`resources/web/flutter_web`, Orca's `src/slic3r/Utils/*` print hosts) with
`device/addons/print-start-reference.test.ts`, and update the reference and our start
when they differ ([send to printer](send-to-printer.md#starting-a-print)). The desktop
comparison downloads the new desktop release by itself and fails until its SHA-256 is
added to `engine/desktop-check/desktop.sh` (the error prints the line); then it must
match ([testing](testing.md#same-as-desktop-orca)).

## Rules

- Each tool is one `engine/src/<tool>_api.cpp`: JSON in, JSON out, added to the
  `add_executable` line in `engine/CMakeLists.txt`, with a Node test in
  `engine/node/engine.test.mjs` and a browser test.
- Anything Orca starts on its own thread and waits for (mcut did) hangs in a browser but
  works in Node: run it in place with a patch, and always run the browser test.
- What only one engine has compiles only for it (`ENGINE_HAS_MIXING`,
  `ENGINE_HAS_FLOW_VARIANTS`); differing calls sit under `#if ENGINE_UPSTREAM`.
- A model object's bounding box goes stale after an instance moves: call
  `invalidate_bounding_box()` before `ensure_on_bed()`.
- Never call `ModelVolume::get_extruders` for model info (it rebuilds paint and crashed
  CI); use `get_extruders_from_multi_material_painting()`.

## Why

- **Our own small API over `libslic3r`, not the Android app's glue**: it drives Orca the
  way desktop's GUI does (`PresetBundle`, `Model`, `Print`, `GCodeProcessor`), so results
  match desktop.
- **Every core, like desktop**: TBB on Emscripten threads with mimalloc. Plain malloc had
  one lock and made threads useless; mimalloc's default arenas doubled memory, so
  `memory.cpp` sends TBB's allocator to malloc and sets 128 MB arenas. Blocks of 1 MB
  and up (`new` and TBB's allocator) skip mimalloc for Emscripten's own allocator: in
  wasm an arena can't give freed space back or join it up, so big blocks left gaps and
  the engine grew until it ran out ("unreachable"); a 1.1M-triangle model opened twice
  took 3.7 GB. mimalloc's own `arena_max_object_size` pads each such block to its page
  size, so many medium objects ran out instead; Emscripten's allocator pads nothing.
- **Caches go with their meshes**: ray-cast trees (painting, text on a surface) and
  Measure's data are dropped when their mesh is, and emptying the plate drops them all
  (the undo history stays, so Delete all can be undone).
- **A wasm trap restarts the engine**: a trap inside a call (out of memory) leaves the
  engine unusable, so the worker reports it like a crash and the page starts a new engine
  and reopens the project, saying it ran out of memory.
- **Patches 0006 and 0007** keep big slices inside a phone's memory: G-code results are
  moved rather than copied, and only the last move is kept (desktop keeps every move for
  its preview; we parse the G-code instead).
- **Patch 0010** makes a slice independent of earlier ones: the support infill kept
  limits from the first support fill the engine made, which in a tab that stays open
  means the first one of the session.
- **No wasm64**: Safari lacks it, phones kill tabs below 4 GB anyway, and it is slower.
- More in [decisions.md](../decisions.md#engines).

## Tests

`engine/node/engine.test.mjs` (both engines, in CI `engine-tests`; its memory test keeps
a heavy model, repeated painting and 40 medium objects under 1.25 GB),
`engine/klipper-check/check.sh` (Klipper accepts the G-code), browser tests
`smoke.mjs`, `cancel.mjs`, `restart.mjs`, `startup-matrix.mjs`, `engines.mjs`,
`engine-switch.mjs`.

## Open

- No STEP reader in the default build (no OpenCASCADE), no SLA hollowing.
