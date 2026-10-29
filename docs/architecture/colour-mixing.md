# Colour mixing and flushing volumes

> **Read this when** you change colour mixes (mixed filaments), Match a colour, or the
> flushing volumes window. **Related:** [engine](engine.md),
> [plates](plates.md) (prime tower uses the mixed filaments).

## What it does

- **Colour mixing**: Snapmaker Orca's mixed filaments, virtual filaments made of two or
  more physical ones, numbered after them (5, 6… on a four-filament U1), usable for
  objects, parts and paint. Snapmaker Orca engine only.
- **Flushing volumes**: for printers with one nozzle and several filaments (Bambu AMS,
  Prusa MMU, Creality CFS): how much each filament change purges, per pair, worked out
  from their colours by each engine's own formula.

## Pieces

| Part | Where |
|---|---|
| Mix list, editing, remapping, Match a colour | `engine/src/mixed_api.cpp` (Orca's `MixedFilamentManager`) |
| Add Mix dialog modes (desktop's `MixedFilamentDialog`); each part of a mix is picked with the shared filament Picker (numbered square, preset name) | `lib/mixing.ts`, `components/ColorMixing.tsx` |
| Flush table, multiplier, where the purge goes | `engine/src/flush_api.cpp`, `lib/flush.ts`, `components/FlushVolumes.tsx` |

## How it flows

The mix list is Orca's own project option `mixed_filament_definitions`, which
`Print::apply` reads when slicing. The store keeps it as the project's mixes, outside the
settings overrides, and it is saved in the 3MF. When a mix or a physical filament goes
away, the engine remaps painted and assigned filaments.

Flush values: `presetsSelect` returns the table, recalculated for a filament whenever it
or its colour changes; a printer change resets the table and multiplier.

## Rules

- Flushing volumes show only for single-nozzle multi-material printers (or Bambu) with
  more than one filament. The U1 has a head per filament and never purges; its page says why.
- The engine's default multiplier is 0.3, so the window shows 0.3× the raw table.
- A mix counts as the filaments it mixes for the prime tower, so an object printed with a
  mix alone gets one. Snapmaker Orca's own slice counted it as one filament and dropped
  the tower; `patches/snapmaker/0009` fixes that.
- Switching a project to OrcaSlicer turns each mix into the filament it uses most
  (`flatten`), after saying so.

## Why

Snapmaker's colour mixing is required in the web app; Android-only mixing extras were
dropped. OrcaSlicer 2.5's own mixing works differently and isn't compatible.
See [decisions.md](../decisions.md#engines).

## Tests

`mixing.mjs` (the G-code alternates between both tools), `flush.mjs`,
`engine-switch.mjs`; unit tests `mixing.test.ts`, `flush.test.ts`.

## Open

- Colour from a photo: picks pending.
