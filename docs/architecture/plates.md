# Plates

> **Read this when** you change plates: per-plate settings, lock, the plate icons and
> menu, by-object clearance, the prime tower, arrange, or slicing one plate while
> viewing another. **Related:** [prepare tools](prepare-tools.md),
> [print history](print-history.md) (printed marks on plate tabs).

## What it does

Desktop's plates: each plate its own settings (plate type, print sequence, spiral vase,
filament order), lock, icons lying on the bed, the tool-head clearance outlines when
printing object by object, a draggable prime tower, and a slice kept per plate.

## Pieces

| Part | Where |
|---|---|
| Plate settings window and rules | `components/PlateSettingsDialog.tsx`, `lib/plate-settings.ts` |
| Icons on the bed, plate menu | `components/PlateIcons.tsx`, `PlateMenu.tsx`, `lib/plateMenu.ts` |
| Engine: add, delete, rename, lock, copy/paste, shapes | `engine/src/plate_api.cpp` (`plateAction`) |
| Clearance outlines and checks | `lib/clearance.ts`, `components/Clearance.tsx` |
| Prime tower size and place | `engine/src/wipe_tower_api.cpp`, `lib/wipe-tower.ts`, `components/WipeTower.tsx` |
| Arrange and its options pop-up | `engine/src/tools_api.cpp` `arrangePlate`, `components/ArrangeOptions.tsx`, `lib/arrange.ts` |
| A slice per plate | `state/store.ts` `slices`, `slicedAway` |

## How it flows

- **Which plate an object is on**: as desktop's `PartPlateList::notify_instance_update`
  (engine `Project::printedOn`): the plate under its centre, else the first plate it
  overlaps. One partly over the edge stays the plate's and blocks Slice (desktop's
  "laid over the plate boundaries" message, `lib/outside.ts`). One totally off every
  plate is on desktop's unprintable plate: never sliced, but still drawn, darker, on the
  nearest plate (`Project::plateOf`, `loose` in the project info), so it can be picked
  and moved back. Slice, the prime tower, clearance and print history count only the
  printed objects (`printedObjects`).
- **Plate settings**: kept in the 3MF's plate data, merged over the project's settings
  when that plate slices (as desktop's `BackgroundSlicingProcess::apply`).
- **Prime tower**: follows desktop's `reload_scene` and `estimate_wipe_tower_size`: the
  plate's filaments (mixes expanded, so a plate printed with one mix gets a tower; the
  slice counts the same way since `patches/snapmaker/0009`); before slicing, Snapmaker Orca 2.4.1 sizes it from
  the prime volume and filament count (a rib tower is square), OrcaSlicer 2.5 with its own
  `estimate_wipe_tower_footprint`; after slicing, the real depth (never
  under the minimum for the plate's height). Positions are Orca's `wipe_tower_x/y`, one
  per plate, saved with the project; a new plate's tower starts at the left, halfway down.
  A tower too close to the bed edge is pulled in by its planned size, both for the view
  and the slice; after slicing it stays drawn there (not moved back by the smaller real
  depth), so Prepare shows where it printed. OrcaSlicer 2.5 also does what desktop 2.5's
  `estimate_wipe_tower_polygon` does with a tower saved far off the plate (a smaller
  printer, another project): it is placed again 15 mm in, at the clear spot nearest where
  it was (objects and their brims kept clear); the page saves the new spot and shows
  desktop's notice, a warning when no spot is clear and it stands on an object.
- **Clearance**: half of `extruder_clearance_radius` round each object (plus skirt), red
  where two touch, a red band where an object is too tall for its place (rod and lid
  heights from the printer preset). Slice waits; Arrange spaces by the clearance with
  tall objects last.
- **Arrange options**: the toolbar's Arrange button opens desktop's pop-up
  (`GLCanvas3D::_render_arrange_menu`): Spacing (slider 0 to 100 mm and a box that takes
  any value; 0 means auto, which is 6 mm here), Auto rotate for arrangement, Allow
  multiple materials on same plate, Align to Y axis (greyed while Auto rotate is on, as
  desktop), then Arrange (all plates) and Reset. Defaults are desktop's
  `ArrangeSettings`; Align to Y axis follows the printer (on for `printer_structure` i3)
  until chosen. They are kept in this browser (`localStorage`, like desktop's app
  config, not in the project) and every Arrange uses them: A, Shift+A, the plate icon
  and menu, Clone with Arrange. The engine gets `{rotate, alignY, multiMaterial}`:
  Auto rotate turns each object to Orca's `MinAreaBoundigBox` angle, long side across
  (libnest2d starts from the same angle); Align to Y axis is Orca's own
  `update_selected_items_axis_align`; with multiple materials off, objects whose
  filaments aren't a subset of each other's go onto plates of their own (desktop's
  rule in `AutoArranger`). Printing object by object, the gap is never under the
  clearance. On a phone the pop-up closes after Arrange so the plate is in sight;
  desktop keeps it open, like Orca.
- **Slicing another plate**: picking a plate while one slices shows it at once; the
  slice goes on and the bar says "Plate N sliced · View".

## What it keeps

All in the project 3MF: plate settings, names, lock, tower positions, layer codes.

## Rules

- Any project edit drops every plate's slice; re-slicing a plate drops its old one first.
- Arrange all skips locked plates. Arrange is our own row packer: Orca's libnest2d stacks
  everything in wasm. So the options act on rows: Auto rotate picks one turn per object
  (desktop also tries 45° steps while packing), and "Avoid extrusion calibration region"
  (Bambu lidar printers only) is left out.
- Move to plate (object and group menus) keeps each copy's plate-local offset, so it lands
  on the same spot of the other plate; the engine's `transform` with `plate` does it, no
  plate API of its own.
- A plate with its own settings shows a dot on its tab and an orange settings icon.

## Why

The engine loaded and saved plate settings but never applied them before #176 (a bug).
"Move plate to front" was left out on purpose. See [decisions.md](../decisions.md#plates-and-tools).

## Tests

`plate-settings.mjs`, `clearance.mjs`, `plate-menu.mjs`, `plate-switch.mjs`,
`wipe-tower.mjs`, `busy.mjs`, `arrange-options.mjs`; `lib/arrange.test.ts`; engine test
"arrange options from desktop's Arrange pop-up".

## Open

- Arrange shows no real progress (one engine call).
