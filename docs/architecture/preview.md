# Preview

> **Read this when** you change the Preview tab: drawing toolpaths, colour views, the
> colour key and statistics, the layer slider and its pauses and filament changes, or
> slicing warnings. **Related:** [engine](engine.md), [plates](plates.md).

## What it does

Draws the sliced toolpaths layer by layer, coloured like desktop's view types (line
type, filament, speed, height, width, flow, layer time, fan, temperature), lists grams,
metres and cost per filament, and lets you add a pause, filament change or custom G-code
at a layer. Before a plate is sliced (or while it slices) it shows the plate's models
see-through in their filaments' colours, as desktop does, with a line saying it isn't
sliced yet and a Slice plate button.

## Pieces

| Part | Where |
|---|---|
| Reading G-code into segments (own worker) | `src/engine/gcode-worker.ts`, `lib/gcode.ts` |
| Colour scales | `lib/preview-colours.ts` |
| Drawing (beads, shader hides line types) | `components/Preview.tsx` |
| Layer slider items | `components/LayerCodes.tsx`, `lib/layerCodes.ts`, engine `plateAction` `layerCodes` |
| Warnings after a slice, objects outside the plate | `lib/outside.ts`, `components/ActionBar.tsx` |

## How it flows

Slice result (G-code blob) → G-code worker (progress shown as "Reading the G-code") →
segments with feature, filament and values → drawn as beads. Speed, flow and layer time
are worked out from the G-code (layer times scaled to Orca's estimate); grams and cost
come from the statistics Orca writes at the end of the file. The engine's own
`warnings` are listed under the result.

## Rules

- The G-code worker streams the file in pieces (`gcodeReader`), never one string: past
  ~512 MB (a 216 mm cube with gyroid infill is ~780 MB) `Blob.text()` gives an empty
  string or fails, which drew an empty Preview with no error.
- Toolpaths reach the GPU packed (`PreviewGcode` in `lib/gcode.ts`): segment s runs from
  corner s to corner s + 1, so a path shares its corners (16-bit steps across the print's
  box), with width and height as 16-bit 0.1 µm steps, the line type, and RGB bytes. A gap
  segment (height 0, not drawn) joins one path to the next. 14 bytes a segment instead
  of 36: a 216 mm gyroid cube (27.8M segments) takes ~390 MB instead of ~1 GB.
  Tried and dropped: joining nearly-straight segments (Orca already simplifies curves to
  ~0.05 mm, so it joined almost none) and a one-byte colour read from a palette in the
  vertex shader (a third slower to draw).
- When the G-code can't be read, or the browser takes the 3D view away (WebGL context
  lost, most often a huge print needing more graphics memory than the page gets), the
  Preview says so with the error and a Copy button instead of staying blank.
- Both 3D views redraw only on demand (`frameloop="demand"`), never continuously.
- Beads stay at least 1.5 px wide, or thin first-layer lines vanish.
- The loading card over the Preview has no blur: a blur over a WebGL canvas made big
  files several times slower.
- Toolpaths outside the build volume can't be downloaded or sent, as on desktop.
- Layer codes are kept per plate in the project.
- Unsliced plate: the models come from the same preview mesh Prepare draws (only the shown
  plate), see-through with no depth writes. The line's Slice button is hidden on a phone,
  where the Slice bar sits right under the 3D view. An empty plate, or no project, still
  says so in words with a "Go to Prepare" button.

## Why

Parsing the G-code ourselves lets the engine drop its own move list (patch 0007), which
is what keeps big prints inside a phone's memory ([engine](engine.md#why)).

## Tests

`preview-views.mjs`, `layer-codes.mjs`, `warnings.mjs`, `plate-switch.mjs` (unsliced plate); unit tests `gcode.test.ts`,
`preview-colours.test.ts`, `layerCodes.test.ts`.

## Open

- Time per line type isn't shown (unscheduled).
