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
| Lay on face, cut, arrange, orient, split, mirror | `ToolPanel.tsx`, `CutPanel.tsx`, cut plane in `Viewport.tsx` + `lib/cut.ts` | `tools_api.cpp` |
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
- Rotate rings, like desktop: while one is dragged it shows marks every 15° (bigger every
  45°) and the angle turned beside it, and the turn holds on a mark within 3° of it
  (`components/RotateMarks.tsx`, `lib/rotate-marks.ts`). Shift or the Snap switch still
  steps in 15°. The marks read TransformControls' own drag values, so they work for one
  object, a part and a chosen group alike.
- Move's arrows sit on top of the part (desktop draws them from its box), so the up arrow
  isn't hidden inside it; dragging it below the bed sinks the object, like the Z field.
- Filament choices are the shared Picker with colour, number and preset name, never a
  `<select>` of bare numbers. Parts and modifiers take a filament (modifiers like desktop:
  "Object" means the object's own).
- Changing a text or SVG shape's type moves it out of or into the surface only from its
  own tool (Join / Engraved, desktop's Emboss gizmo). The object list's Change type
  leaves it where it is (desktop's `change_part_type`).
- The Text tool's vertical alignment names where the text goes from its point: Top puts
  it above. Orca's stored value is the other way round (its `top` is the text's top on
  the point), so Top saves `bottom`; files stay the same as desktop's.
- The object menu uses desktop's words for copies: an "Instances" submenu with Add
  instance, Remove instance and Set number of instances… (new copies go beside the last
  one, one undo step). Copy, Cut and Paste are in the object and group menus, and Paste in
  the plate menu, because phones have no Ctrl+C / Ctrl+X / Ctrl+V. "Move to plate" (object
  and group menus) puts the copies on the same spot of another plate, or a new one, and
  shows that plate.
- Mesh boolean: the toolbar's card is desktop's (two parts). The object menu's "Mesh
  boolean" joins all the object's parts into one in a single step (greyed out with one
  part); negative parts and modifiers stay. The engine takes `b = -1` for "all the other
  parts" and applies them one after another. When mcut can't do it (an empty result, a
  difference that cut nothing, a union left side by side where the parts overlap), the
  engine refuses with desktop's "Unable to perform boolean operation on selected parts"
  and the reason it finds (a mesh with holes, one crossing itself), shown in the card and
  as a notice; desktop silently keeps the uncut part.
- Paint: the toolbar button picks what is painted and the card's title says it (no tabs in
  the card). Colour painting shows desktop's filament squares with the number inside, and
  desktop's Height range tool (every part of that object copy, from the tapped height up).
  Every kind has the Section view slider: nothing above it is drawn (a clipping plane on
  the part materials), hit (the engine's ray goes on through) or painted (TriangleSelector's
  clipping plane). Support painting has Highlight overhangs (faces whose normal points down
  past the angle, TriangleSelector's own test, drawn over the parts) and On overhangs only
  (the engine's `highlight_by_angle`).
- Long-press menus ignore clicks until a press starts on the menu, or lifting the finger
  picks an item.
- Edits that take a while show the loading screen (`busyWhile` in `store.ts`) until the
  3D view has actually redrawn.
- On a phone an open tool stacks toolbar, its card (at most half the screen) and the
  model; settings hide until Done. The toolbar stays visible even with no model.

## Cut

Like desktop's Cut (C), on Orca's own `Cut` class (`CutUtils.cpp`).

- The plane is a position and a turn (`lib/cut.ts`, the store's `cutZ` and
  `cutRotation`): it starts flat half way up and turns by X, then Y, then Z degrees
  about the bed's axes, like an instance's rotation. Its arrow (normal) is the turned
  +Z; the position is how far along the arrow from the bed under the object's middle,
  so a flat plane's position is its height. The engine's `cutObject(o, i, json)` builds
  the same plane from the same numbers and the instance's own box.
- In the 3D view, desktop's handles (`CutGrabbers` in `Viewport.tsx`): a grey ball on a
  yellow stem along the arrow moves the plane, red arrows tilt it about its own X and
  green about its Y (Shift or the snap button: 1 mm, 15°). A click on the plane flips it;
  a white line (`cutOutline`) shows where it meets the object. The panel has the
  position, Tilt X / Tilt Y, Flip plane (same plane, arrow the other way: X + 180°,
  position negated) and Reset.
- Each half: Keep (as it stands), Flip onto cut (Orca's PlaceOnCut: the cut face on
  the bed), Upside down (Orca's Flip) or Throw away; on a phone both fold into one
  Picker row. "Keep both halves as parts of one object" is Orca's KeepAsParts.
- A right-click on the object (a long press on a touch screen) sends the separate piece
  under it to the other side, like desktop's part selection: the engine's `cutPieces`
  cuts the object, splits it into its pieces and says which side each is on; the page
  draws them in their side's colour, and the cut sends `pieces` (per piece: upper?) for
  Orca's `perform_by_contour`. Moving or flipping the plane drops the choice.
- Connectors tab: the view turns to the cut face (the upper half hidden), and back when you leave it, and a click
  adds a connector there; drag one to move it, click to choose it (Ctrl + click for
  more), Del removes the chosen ones. Plug, Dowel or Snap; circle, square, hexagon or
  triangle; straight or tapered; size, depth and the gaps round them, like desktop
  (desktop's 2.5 mm starting size is 5 mm here). The engine adds each as a negative
  volume with Orca's `cut_info`, so `Cut` makes the plug on one half and the hole in
  the other; dowels print as their own objects. With connectors both halves are kept.
- Cut: Flat or Dovetail (desktop's Dovetail mode, Orca's `perform_with_groove`): a
  tongue on the lower half along the plane's Y, in a groove of the upper. Depth and
  width (desktop's start: depth (x+y+z)/60, at least 1 mm; width four depths), flap
  and groove angles, the gaps (Orca's tolerances), and Turn (the plane's Z angle)
  for the tongue's direction. The 3D view draws the surface it cuts along
  (`grooveSurface` in `lib/cut.ts`) at the gizmo, and the request sends `groove` and
  `spot` (where the gizmo is on the plane). No connectors, moved pieces or parts of
  one object with a dovetail; Cut is off while its sloping sides cross (`grooveFits`).
- Tilting turns the plane about the gizmo, like desktop: `turnPlane` keeps the gizmo's
  point and changes the position; the store's `cutSpot` is where the gizmo sits on the
  plane. While cutting, a press on the model does not move it.
- Painting is carried onto the halves (`paint_remap.hpp`); the cut faces stay unpainted.

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

- Cut has neither desktop's line cut nor connector auto-place, nor upstream Orca's several dovetails in a row. Simplify remaps painting onto the simplified mesh. No assembly view,
  Reload from disk or text styles (left out).
