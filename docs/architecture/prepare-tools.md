# Prepare tools

> **Read this when** you add or change a Prepare tool (move, cut, measure, simplify,
> boolean, text, SVG, paint, assemble, brim ears, variable layer height, object menu),
> keyboard shortcuts, multi-select, or how big models open. **The user-facing list:**
> [README](../../README.md). **Related:** [engine](engine.md), [plates](plates.md).

## What it does

Desktop Orca's Prepare tools, one by one, each backed by Orca's own code.

## Pieces

| Tool | Page | Engine |
|---|---|---|
| Move, rotate, scale, exact fields, keys | `components/Toolbar.tsx`, `ToolPanel.tsx`, `lib/transform.ts` | `model_api.cpp`, `volume_api.cpp` |
| Lay on face, cut, arrange, orient, split, mirror | `ToolPanel.tsx` | `tools_api.cpp` |
| Measure, Assemble | `MeasureOverlay.tsx`, `AssemblePanel.tsx`, `lib/measure.ts` | `measure_api.cpp` |
| Variable layer height | `LayersPanel.tsx`, `lib/layers.ts` | `layers_api.cpp` |
| Brim ears | `BrimEars.tsx`, `lib/brim.ts` | `brim_api.cpp` |
| Simplify | `SimplifyPanel.tsx`, `SimplifyFirstDialog.tsx`, `lib/simplify.ts` | `simplify_api.cpp` |
| Parts, modifiers, mesh boolean | `ObjectList.tsx`, `BooleanPanel.tsx`, `lib/volumes.ts`, `boolean.ts` | `volume_api.cpp`, `boolean_api.cpp` |
| Text, SVG | `TextPanel.tsx`, `SvgPanel.tsx`, `lib/fonts.ts`, `state/fonts.ts` | `text_api.cpp`, `svg_api.cpp`, `surface_api.cpp` |
| Paint (colour, supports, seams, fuzzy skin) | `PaintPanel.tsx` | `paint_api.cpp` |
| Object menu, plate menu, multi-select | `ObjectMenu.tsx`, `GroupMenu.tsx`, `ChooseBar.tsx`, `lib/objectMenu.ts`, `lib/group.ts` | `object_api.cpp` |
| Undo, redo | store | `history_api.cpp` |

## Rules

- One engine file per tool, JSON in and out ([engine rules](engine.md#rules)); a browser
  check in `test/toolbar.mjs`.
- Parallel tool PRs collide in the same places: `engine/CMakeLists.txt`
  `add_executable`, the `Tool` union and `setTool` resets in `store.ts`, `client.ts`
  edits, worker methods, `ToolPanel` hints. Keep both sides; grep for conflict markers
  after merging.
- Volume gizmos send a world-space change; the engine applies it in the instance's frame.
- Long-press menus ignore clicks until a press starts on the menu, or lifting the finger
  picks an item.
- Edits that take a while show the loading screen (`busyWhile` in `store.ts`) until the
  3D view has actually redrawn.
- On a phone an open tool stacks toolbar, its card (at most half the screen) and the
  model; settings hide until Done. The toolbar stays visible even with no model.

## Big models

Over 1M triangles on a plate slows slicing and can crash a phone's tab.

- Any device: the action bar offers Simplify (to about 500k per plate).
- Phones and tablets: before the model is drawn, a question offers Simplify / Open as is /
  Cancel ("Don't ask again" kept in `cloud-slicer:ask-simplify:v1`). Painted models keep
  their painting.
- Convert is asked before the first draw on every device, so the model isn't drawn twice.
- Only the shown plate is drawn.

## Why

- Each tool follows its desktop counterpart's code; arrange is the one hand-written
  exception (libnest2d breaks in wasm).
- Text uses Noto fonts from npm (`@expo-google-fonts`) and Hebrew fonts, laid out right to
  left (desktop prints Hebrew backwards).
  See [decisions.md](../decisions.md#plates-and-tools).

## Tests

`toolbar.mjs` (split in CI: `TOOLBAR_PART=assemble`), `transform-fields.mjs`,
`multi-select.mjs`, `view-touch.mjs`, `heavy.mjs`, `busy.mjs`, `layout-fixes.mjs`.

## Open

- Cut is horizontal only, no connectors. Simplify remaps painting onto the simplified mesh. No assembly view,
  Reload from disk or text styles (left out).
