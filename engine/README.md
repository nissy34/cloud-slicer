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
| `orcaslicer-upstream/` | Upstream OrcaSlicer v2.4.2, the second engine (proof of concept, see "Two engines" below). Never edited in place |
| `patches/` | Browser-only fixes, applied to copies of the touched files in the build tree |
| `compat/` | Stand-ins for what a browser lacks: OpenSSL MD5 (on Boost), no-op STEP/SVG import when built without OCCT, thread naming |
| `cmake/libslic3r.cmake` | Builds libslic3r from the source list in upstream's own `src/libslic3r/CMakeLists.txt` |
| `src/presets_api.cpp` | Presets: loads every bundled vendor through `PresetBundle::load_presets`, lists and selects printer / process / filament presets, resolves the full config, option metadata |
| `src/model_api.cpp` | Project: loads models and 3MF projects, plates (resized when the printer's bed changes), per-object/part filaments, transforms, preview meshes with painted colours, and saving the project as an Orca 3MF (`store_bbs_3mf`, like desktop's Save project) |
| `src/tools_api.cpp` | Prepare tools: arrange a plate, auto-orient, split to objects, cut, mirror, add and delete plates |
| `src/paint_api.cpp` | Painting colours, support and seam enforcers/blockers and fuzzy skin with Orca's TriangleSelector: `paint`, `clearPaint`, `paintOverlay` |
| `src/brim_api.cpp` | Brim ears, like desktop's Brim Ears tool: the ears in `ModelObject::brim_points`, added by hand or on the sharp corners of the first layer (the tool's own corner detection), and which ones touch the object |
| `src/layers_api.cpp` | Variable layer height: an object's `layer_height_profile` made adaptive (`layer_height_profile_adaptive`), smoothed, edited around a height (`adjust_layer_height_profile`) or reset, like desktop's layer height editing |
| `src/object_api.cpp` | The object menu (desktop's right-click menu on an object): rename, printable, center, scale to fit the plate, clone, inch/meter conversion (`ModelObject::convert_units` done in place), replace a part with an STL (`replace_volume_with_stl`) and export as STL |
| `src/volume_api.cpp` | Parts, negative parts, modifiers and support blockers/enforcers of an object: add a shape (desktop's `load_generic_subobject`) or a mesh file (`load_modifier`), rename, delete, change type, and move/rotate/scale by a matrix from the page's gizmos. `previewMesh` also returns these volumes (drawn see-through) and where each part's triangles are |
| `src/boolean_api.cpp` | Mesh boolean, like desktop's Mesh Boolean tool: union, difference or intersection of two volumes of an object with mcut (`MeshBoolean::mcut::make_boolean`); the result takes the first one's place, type, settings and filament |
| `src/text_api.cpp` | Text shapes, like desktop's Text tool: a text in a TrueType/OpenType font (Orca's `Emboss::text2vshapes` + `polygons2model`) made into a part, negative part or modifier on the object's surface facing the camera (`create_transformation_onto_surface`), or an object of its own, and remade when the text or style changes. The text and font settings stay on the volume (`text_configuration`, `emboss_shape`) so a 3MF keeps them. Fonts are files the page writes into the engine's file system |
| `src/surface_api.cpp` | Placing text and SVG shapes on their object like desktop's SurfaceDrag: `shapePlace` slides a shape to where a ray meets the object's other parts (`get_volume_transformation`, "Keep up" via `suggest_up`), turns it about its axis, lifts it off the surface (`calc_distance`), faces it to the camera, and reports where it stands. "Use surface" cuts the outlines out of the surface and gives them depth along it (EmbossJob's `cut_surface_to_its` with `cut_surface`/`cut2model`); "Per glyph" sets each letter on the surface on its own (`create_mesh_per_glyph`). Desktop's 3MF fields (`use_surface`, `per_glyph`, alignment) are kept |
| `src/svg_api.cpp` | SVG shapes, like desktop's SVG tool: an .svg file's filled and stroked paths (`NSVGUtils` `create_shape_with_ids`) made into a part, negative part or modifier placed as text is, or an object of its own; a new depth remakes it, a new width or height scales it across its face. The file stays on the volume (`emboss_shape.svg_file`) and is written into a 3MF under `3D/`, as desktop stores it |
| `src/measure_api.cpp` | The Measure tool: Orca's `Measure::Measuring` finds the point, edge, circle or plane under a ray from the page, and `Measure::get_measurement` gives the distance and angle between two. Assemble (desktop's `GLGizmoAssembly`) uses the same picks: `assembleAction` moves the second feature's part, or object, onto the first (parallel, center coincidence, flip, parallel distance, rotate around center, point onto point, with `Measure::get_assembly_action` saying which apply), or joins the two objects into one "Assembly" object, as the object list's Assemble does; picks follow the parts they are on |
| `src/simplify_api.cpp` | Simplify, like desktop's Simplify model: Orca's quadric edge collapse (`its_quadric_edge_collapse`) by detail level or decimate ratio, previewed as a triangle count, then applied (the object's paint goes, as on desktop) |
| `src/calib_api.cpp` | Calibration tests, ported from desktop's Plater: temperature, flow rate, pressure advance (line, tower, pattern: a handle cube per speed and acceleration pair, its pattern G-code made at every slice like desktop), retraction, max volumetric speed, VFA, input shaping and junction deviation. Loads the test model, returns the settings to change, and sets `Print::set_calib_params` for slicing |
| `src/mixed_api.cpp` | Colour mixing: reads and edits the project's `mixed_filament_definitions` with Orca's `MixedFilamentManager`, gives each mix its colour, remaps painted and assigned filaments when a mix or a physical filament goes away, and matches a colour |
| `src/history_api.cpp` | Undo and redo of project edits, like desktop's Ctrl+Z / Ctrl+Y: Model snapshots that share their meshes |
| `src/slice_api.cpp` | Slices one plate with a full config and exports G-code with Orca's time and filament estimates and the plate thumbnails the page renders |
| `scripts/engine-key.mjs` | The engine key: names an engine build by the Orca commit and a hash of the sources it is built from |
| `scripts/fetch-engine.mjs` | Downloads the engine CI built for this checkout's key into `build/engine`, so it needn't be built |
| `scripts/build-deps.sh` | Builds the third-party libraries for wasm into `build/deps` |
| `scripts/bundle-profiles.mjs` | Packs the presets: Snapmaker's (and Orca's filament library they inherit from) into the start-up file, every other brand into its own file, a catalog of every brand's printer models, and each printer model's bed (its shape as a small mesh file, `scripts/bed-mesh.mjs`, and its print sheet picture) |
| `scripts/extract-settings-layout.mjs` | Reads desktop's settings pages and groups out of `Tab.cpp` for the web settings panel, including the per-extruder pages, Motion ability and the filament Setting Overrides |
| `node/` | The engine under Node.js: a slicing CLI and the engine tests |

## Build

Usually you don't: `node engine/scripts/fetch-engine.mjs` downloads the engine CI built
from the same sources (see [CI and deploys](../docs/CI.md#published-engines)). Building it:

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

### Does Klipper accept the G-code?

```bash
engine/klipper-check/check.sh engine/klipper-check/u1.cfg /tmp/benchy.gcode
```

Runs Klipper in batch mode: Klipper reads the file like a print and works out every
move against a printer config, without a printer. It fails on anything Klipper would
stop on (a move outside the bed, a bad parameter) and on commands Klipper doesn't
know. `u1.cfg` stands in for the Snapmaker U1 (270 mm bed, four heads, its own
commands as empty macros); `voron.cfg` is a plain 300 mm Klipper printer. The first
run sets Klipper up in `~/.cache/klipper-check` and needs `gcc-avr` and `avr-libc`.
CI runs it on Benchy and a two-colour cube from both engines.

## How it differs from desktop

- **Threads are Web Workers.** TBB runs on Emscripten pthreads, one per core, started
  with the engine (`PTHREAD_POOL_SIZE`), with mimalloc so threads don't queue on one
  malloc lock. TBB's own scalable allocator is not linked: `src/memory.cpp` sends it to
  malloc and sets mimalloc's arena size for wasm, which keeps a big slice's memory
  close to the single-threaded engine's. A slice's cancel watcher thread stands in for
  desktop's UI thread.
- **No OpenGL**: plate thumbnails are drawn by the page and handed to the G-code export.
- **No SLA hollowing** (needs OpenVDB). FFF printing never uses it.
- **Every bundled printer is loaded**: desktop loads only the printers its setup wizard
  installed. The web app's own setup wizard decides which ones its pickers show.
- **Plates** follow desktop's plate grid: an object belongs to the plate under its centre.

## Patches

Each `patches/*.patch` is a unified diff against the submodule (`a/src/...`, `b/src/...`);
`patches/snapmaker/` and `patches/orca/` hold the ones for one engine only, applied after
the shared ones.
CMake copies the files a patch touches into `build/engine/patched-engine/`, applies every
patch there and compiles those copies instead. Only fixes the browser build needs belong
here; each patch says why at the top of its hunk.

| Patch | Why |
|---|---|
| `0001-arachne-empty-toolpath-index-wasm32` | Arachne indexes an empty toolpath vector; harmless on 64-bit, a crash on wasm32 |
| `snapmaker/0002-step-serial-occt-meshing` | OCCT meshing of STEP files without its thread pool |
| `0003-sla-hollowing-without-openvdb` | Builds SLA hollowing without OpenVDB (no interior is generated) |
| `0004-skip-thread-naming-barrier` | Thread naming holds every TBB worker on a barrier; browser threads have no names or locales to set |
| `0005-mcut-api-tasks-without-threads` | mcut (mesh boolean) runs each call on a thread it starts and waits for; a page can't start one while it waits, so the calls run in place |
| `0006-move-gcode-result-instead-of-copying` | G-code export copies every move into the caller's result at the memory peak; moves it instead, so big slices fit in a phone's browser |
| `0007-keep-only-the-last-gcode-move` | G-code processing keeps every move for desktop's preview, which the browser doesn't use; on a big print that list alone outgrew the 4 GB a page can have |
| `orca/0008-gcode-times-without-stored-moves` | Upstream's time estimate writes each move's time and "actual speed" points back into that list by position, which 0007 no longer keeps; skips those preview-only writes |

## Two engines

The same `src/` API builds against Snapmaker Orca (default) or upstream OrcaSlicer:

```bash
emcmake cmake -S engine -B engine/build/engine-orca -G Ninja -DCMAKE_BUILD_TYPE=Release -DENGINE_FLAVOR=orca
cmake --build engine/build/engine-orca
ENGINE_FLAVOR=orca node engine/scripts/bundle-profiles.mjs engine/build/profiles-orca
```

What only Snapmaker Orca has compiles only for it (`ENGINE_HAS_MIXING`: mixed filaments,
`src/mixed_api.cpp`; `ENGINE_HAS_FLOW_VARIANTS`: standard/high flow pairs), and the few
calls whose signatures differ upstream are under `#if ENGINE_UPSTREAM`. `engineInfo()`
tells the page which engine it got. `apps/web/scripts/copy-engine.mjs` puts an upstream
build (from `engine/build/engine-orca`) in `public/engine-orca/`. CI builds and tests both
engines. Each project slices with one of them (`apps/web/src/lib/engines.ts`): new projects
use the setup wizard's default (the sidebar's Slicer engine dropdown picks the other one), an open project moves to the other engine from the same dropdown (`apps/web/src/lib/engine-switch.ts`: the old engine turns each mix into its main filament with the `flatten` mixed-filament edit, drops object settings the other engine lacks and saves a 3MF; the new engine opens its model and takes the shared settings and preset stand-ins), an online project remembers its engine, and a 3MF opens with
the engine that made it (Snapmaker Orca writes Application "Snapmaker_Orca-…", OrcaSlicer an
"OrcaSlicer" entry). `?engine=orca` (or `snapmaker`) starts the page with that engine.
User presets are shared between the engines (`apps/web/src/lib/preset-engines.ts`): the settings
both engines have with the same type, from `apps/web/scripts/shared-settings.mjs`, which also
picks each engine's stand-in for the other's system presets. CI checks the file is current;
after an engine update, run it in `apps/web` and commit `src/lib/shared-settings.json`.
