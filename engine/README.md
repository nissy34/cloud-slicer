# Engine

Snapmaker Orca's `libslic3r` (upstream [Snapmaker/OrcaSlicer](https://github.com/Snapmaker/OrcaSlicer)
v2.4.0, the `orcaslicer/` submodule) compiled to WebAssembly with Emscripten, plus a small
embind API that drives it the way desktop Snapmaker Orca does. Everything the desktop
slicer can slice (STL, OBJ, AMF, 3MF projects including Bambu Studio files with painted
colours, per-part filaments, multi-plate projects, mixed filaments) goes through the
same engine code.

## Layout

| Path | What |
|---|---|
| `orcaslicer/` | Submodule pinned to the v2.4.0 tag. Never edited in place |
| `patches/` | Browser-only fixes, applied to copies of the touched files in the build tree |
| `compat/` | Stand-ins for what a browser lacks: OpenSSL MD5 (on Boost), serial TBB `parallel_*` (with a cancellation point, so the page can cancel a slice), no-op STEP/SVG import when built without OCCT, thread naming |
| `cmake/libslic3r.cmake` | Builds libslic3r from the source list in upstream's own `src/libslic3r/CMakeLists.txt` |
| `src/presets_api.cpp` | Presets: loads every bundled vendor through `PresetBundle::load_presets`, lists and selects printer / process / filament presets, resolves the full config, option metadata |
| `src/model_api.cpp` | Project: loads models and 3MF projects, plates (resized when the printer's bed changes), per-object/part filaments, transforms, preview meshes with painted colours |
| `src/tools_api.cpp` | Prepare tools: arrange a plate, auto-orient, split to objects, cut, mirror, add and delete plates |
| `src/paint_api.cpp` | Painting colours, support and seam enforcers/blockers and fuzzy skin with Orca's TriangleSelector: `paint`, `clearPaint`, `paintOverlay` |
| `src/calib_api.cpp` | Calibration tests, ported from desktop's Plater: temperature, flow rate, pressure advance (line, tower), retraction, max volumetric speed, VFA, input shaping and junction deviation. Loads the test model, returns the settings to change, and sets `Print::set_calib_params` for slicing |
| `src/slice_api.cpp` | Slices one plate with a full config and exports G-code with Orca's time and filament estimates |
| `scripts/build-deps.sh` | Builds the third-party libraries for wasm into `build/deps` |
| `scripts/bundle-profiles.mjs` | Packs the Snapmaker presets (and Orca's filament library they inherit from) into one JSON file |
| `scripts/extract-settings-layout.mjs` | Reads desktop's settings pages and groups out of `Tab.cpp` for the web settings panel |
| `node/` | The engine under Node.js: a slicing CLI and the engine tests |

## Build

```bash
git submodule update --init engine/orcaslicer
source emsdk/emsdk_env.sh                    # Emscripten 6.0.12
engine/scripts/build-deps.sh                 # once; about 40 min on 4 cores
emcmake cmake -S engine -B engine/build/engine -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build/engine            # -> engine/build/engine/orca-engine.{js,wasm}
node engine/scripts/bundle-profiles.mjs engine/build/profiles
```

`-DENGINE_WITH_STEP=ON` adds STEP import (needs the OCCT dep); `-DENGINE_WASM_DEBUG=ON`
adds runtime assertions and symbol names.

## Use it from Node

```bash
node engine/node/slice.mjs fixtures/3DBenchy.stl /tmp/benchy.gcode
node engine/node/slice.mjs model.3mf out.gcode --plate 1 --filament "Snapmaker PLA Basic @U1" --filament "Snapmaker PETG @U1"
node engine/node/slice.mjs --list            # compatible processes and filaments for the printer
node --test engine/node/engine.test.mjs      # engine tests
```

`--set key=value` overrides any Orca option, with Orca's own key names.

## How it differs from desktop

- **Single-threaded for now.** TBB's `parallel_for` family runs serially (`compat/tbb_serial`).
  Slices are correct but use one core; real worker threads are a later step.
- **No SLA hollowing** (needs OpenVDB). FFF printing never uses it.
- **Every bundled printer counts as installed**, so no setup wizard is needed.
- **Plates** follow desktop's plate grid: an object belongs to the plate under its centre.

## Patches

Each `patches/*.patch` is a unified diff against the submodule (`a/src/...`, `b/src/...`).
CMake copies the files a patch touches into `build/engine/patched-engine/`, applies every
patch there and compiles those copies instead. Only fixes the browser build needs belong
here; each patch says why at the top of its hunk.

| Patch | Why |
|---|---|
| `0001-arachne-empty-toolpath-index-wasm32` | Arachne indexes an empty toolpath vector; harmless on 64-bit, a crash on wasm32 |
| `0002-step-serial-occt-meshing` | OCCT meshing of STEP files without its thread pool |
| `0003-sla-hollowing-without-openvdb` | Builds SLA hollowing without OpenVDB (no interior is generated) |
| `0004-serial-tbb-skip-thread-naming-barrier` | Thread naming waits on a barrier for TBB workers that serial TBB never starts |
