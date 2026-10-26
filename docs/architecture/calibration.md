# Calibration

> **Read this when** you change the Calibration menu or its tests. **Related:**
> [engine](engine.md).

## What it does

Desktop's Calibration menu: temperature, flow rate, pressure advance (tower, lines or
pattern), retraction, max volumetric speed, VFA, input shaping, junction deviation.

## Pieces

| Part | Where |
|---|---|
| The tests, ported from desktop's Plater | `engine/src/calib_api.cpp` |
| Test models | `engine/calib/` (copied to `public/engine/` by `copy-engine.mjs`) |
| Dialog and choices | `components/CalibrationDialog.tsx`, `lib/calibration.ts` |

## How it flows

Pick a test → the engine loads its model and returns the settings to change → the slice
sets `Print::set_calib_params`. Pressure advance pattern makes its pattern G-code at
every slice, like desktop.

## Tests

`calibration.mjs` (in the CI presets suite); unit test `calibration.test.ts`.
