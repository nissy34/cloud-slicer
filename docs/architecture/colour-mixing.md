# Colour mixing and flushing volumes

> **Read this when** you change colour mixes (mixed filaments), Match a colour, or the
> flushing volumes window. **Related:** [engine](engine.md),
> [plates](plates.md) (prime tower uses the mixed filaments).

## What it does

- **Colour mixing**: mixed filaments, virtual filaments made of two or more physical
  ones, numbered after them (5, 6… on a four-filament U1), usable for objects, parts and
  paint. Both engines: Snapmaker Orca's own, and OrcaSlicer 2.5's (Ratio, Match and
  Gradient; it has no Cycle, so the Add Mix window leaves it out: `engineInfo.mixModes`).
- **Flushing volumes**: for printers with one nozzle and several filaments (Bambu AMS,
  Prusa MMU, Creality CFS): how much each filament change purges, per pair, worked out
  from their colours by each engine's own formula.

## Pieces

| Part | Where |
|---|---|
| Mix list, editing, remapping, Match a colour | `engine/src/mixed_api.cpp` (Snapmaker's `MixedFilamentManager`; OrcaSlicer 2.5's mixed slots under `#if ENGINE_UPSTREAM`) |
| OrcaSlicer 2.5 mixes as filament slots, and back | `fullConfigWithMixes` (called by `presetsFullConfig`), `splitMixedSlots` (called by `fileConfigJson`) |
| Add Mix dialog modes (desktop's `MixedFilamentDialog`); each part of a mix is picked with the shared filament Picker (numbered square, preset name) | `lib/mixing.ts`, `components/ColorMixing.tsx` |
| Mixing recommendations under the dialog (desktop's `build_swatch_grid`): Ratio offers each pair at 50:50, or with three rows each triple of the first six filaments (even, then each one at 50%); Match both, minus repeats and those under its Min share; Gradient each pair both ways; Cycle none. Colours from the engine's FilamentMixer (`mixedBlend`), unmixable materials left out (the engine's `draftCompatible`, pair by pair) | `lib/mixing.ts` (`mixSuggestions`), `components/MixSuggestions.tsx` |
| Ratio with three filaments: desktop's triangle (`build_tri_picker`), first row on top, plain RGB fill, each share held at 10–90% | `lib/mixing.ts` (`triangleWeights`), `components/MixTriangle.tsx` |
| Flush table, multiplier, where the purge goes | `engine/src/flush_api.cpp`, `lib/flush.ts`, `components/FlushVolumes.tsx` |

## How it flows

The store keeps the project's mixes as `mixed_filament_definitions`, outside the
settings overrides, and hands it to the engine with them. When a mix or a physical
filament goes away, the engine remaps painted and assigned filaments.

- **Snapmaker Orca**: that string is Snapmaker's own project option, which `Print::apply`
  reads when slicing and the 3MF saves.
- **OrcaSlicer 2.5**: a mix is a filament slot of its own after the physical ones
  (`filament_is_mixed`, `filament_mixed_components`, `_sublayer_ratios`, `_gradient*`).
  The string is a JSON list of those slots. `presetsFullConfig` adds them to the bundle
  the way desktop's Add Mixed Filament does (the slot takes its first filament's preset,
  its colour is the blend), so slicing, the prime tower and the saved 3MF see what desktop
  2.5 would; opening a desktop 2.5 3MF takes its mixed slots back out of every
  per-filament list (`splitMixedSlots`). Gradients print only with the Quality setting
  "Mixed color sublayer" on, which the Gradient tab says. Deleting a mix drops its slot;
  deleting a filament drops the mixes that use it.

Flush values: `presetsSelect` returns the table, recalculated for a filament whenever it
or its colour changes; a printer change resets the table and multiplier.

## Rules

- Flushing volumes show only for single-nozzle multi-material printers (or Bambu) with
  more than one filament. The U1 has a head per filament and never purges; its page says why.
- The engine's default multiplier is 0.3, so the window shows 0.3× the raw table.
- A mix counts as the filaments it mixes for the prime tower, so an object printed with a
  mix alone gets one. Snapmaker Orca's own slice counted it as one filament and dropped
  the tower; `patches/snapmaker/0009` fixes that.
- Switching a project to the other engine turns each mix into the filament it uses most
  (`flatten`), after saying so: the two keep mixes differently.

## Why

Snapmaker's colour mixing is required in the web app; Android-only mixing extras were
dropped. OrcaSlicer 2.5's mixing works differently, so each engine keeps its own, behind
one panel. Not yet on OrcaSlicer: desktop 2.5's gradient curve editor and per-part
gradients (a project that has them keeps them).
See [decisions.md](../decisions.md#engines).

## Tests

`mixing.mjs`, also with `MIX_ENGINE=orca` (the G-code alternates between both tools;
recommendations per mode and tapping one; dragging the triangle), `flush.mjs`,
engine tests `colour mixing: …` (both engines, plus OrcaSlicer's gradient),
`engine-switch.mjs`; unit tests `mixing.test.ts`, `flush.test.ts`.

## Open

- Colour from a photo: picks pending.
