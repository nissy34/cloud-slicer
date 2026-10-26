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
| Arrange | `engine/src/tools_api.cpp` `arrangePlate` |
| A slice per plate | `state/store.ts` `slices`, `slicedAway` |

## How it flows

- **Plate settings**: kept in the 3MF's plate data, merged over the project's settings
  when that plate slices (as desktop's `BackgroundSlicingProcess::apply`).
- **Prime tower**: follows desktop's `reload_scene` and `estimate_wipe_tower_size`: the
  plate's filaments (mixes expanded), Orca's planned depth before slicing or the real one
  after, the minimum for the plate's height. Positions are Orca's `wipe_tower_x/y`, one
  per plate, saved with the project.
- **Clearance**: half of `extruder_clearance_radius` round each object (plus skirt), red
  where two touch, a red band where an object is too tall for its place (rod and lid
  heights from the printer preset). Slice waits; Arrange spaces by the clearance with
  tall objects last.
- **Slicing another plate**: picking a plate while one slices shows it at once; the
  slice goes on and the bar says "Plate N sliced · View".

## What it keeps

All in the project 3MF: plate settings, names, lock, tower positions, layer codes.

## Rules

- Any project edit drops every plate's slice; re-slicing a plate drops its old one first.
- Arrange all skips locked plates. Arrange is our own row packer: Orca's libnest2d stacks
  everything in wasm.
- A plate with its own settings shows a dot on its tab and an orange settings icon.

## Why

The engine loaded and saved plate settings but never applied them before #176 (a bug).
"Move plate to front" was left out on purpose. See [decisions.md](../decisions.md#plates-and-tools).

## Tests

`plate-settings.mjs`, `clearance.mjs`, `plate-menu.mjs`, `plate-switch.mjs`,
`wipe-tower.mjs`, `busy.mjs`.

## Open

- Arrange shows no real progress (one engine call).
