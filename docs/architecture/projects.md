# Projects

> **Read this when** you change opening or saving 3MF files, importing another slicer's
> project, converting a project to another printer, switching engines, or online
> projects. **Related:** [autosave](autosave.md), [print history](print-history.md),
> [data](data.md).

## What it does

Opens models and 3MF projects (Bambu Studio's included) through Orca's own reader, brings
a project's own settings in, offers to convert a project made for a printer you don't
have, and saves Orca 3MF projects that reopen in desktop Orca: downloaded when signed out,
online when signed in.

## Pieces

| Part | Where |
|---|---|
| Open: models, 3MF, the Convert and "open or add" questions | `state/store.ts` `openFiles`, `lib/project-import.ts`, `components/ConvertDialog.tsx`, `OpenModel.tsx` |
| Which engine made a 3MF | `lib/engines.ts` (`3D/3dmodel.model` Application entry) |
| Another slicer's start/end G-code that our engine can't fill in | `components/GcodeFallbackDialog.tsx`, `lib/gcode-errors.ts` |
| Engine switch for an open project | `lib/engine-switch.ts`, `components/EngineSection.tsx`, `EngineSwitchDialog.tsx` |
| The open project as a document | `state/projects.ts`, `lib/projects.ts`, `components/ProjectMenu.tsx`, `OpenProjectDialog.tsx` |
| Online projects API | `functions/_lib/projects.ts` (`/api/projects`) |
| Writing the 3MF | engine `saveProject` (Orca's `store_bbs_3mf`) |

## How it flows

**Open.** The engine reads the file → the page asks Convert (before the first draw, see
[prepare tools](prepare-tools.md#big-models)) → the file's `project_settings.config`
comes in as overrides on the selected presets → plates, per-part filaments, paint and
mixes are drawn. Opening a 3MF over loaded objects asks: open as the project, or add its
objects.

**Convert.** Only model settings carry over (walls, infill, supports, seams) and only
those the author changed, read from the project's `different_settings_to_system`; files
without that list keep every model setting that differs. Printer settings come from the
target printer; filaments are matched by material and kind (Matte, Silk, HF, Translucent).

**Save (signed in).** Engine writes the 3MF → `PUT /api/projects/<id>` with
`baseVersion` → R2 under a new key, D1 row updated → thumbnail PNG separately. A save
over a newer version gets 409 and asks: overwrite, or save a copy.

## What it keeps

D1 `projects` (name, size, keys, version, engine, draft, device, plates), R2 3MF and
thumbnail. Limits: 50 MB per project, 200 MB and 200 projects per person (storage set per
person on the Admin page), 8 GB for the whole site (R2's free tier is 10 GB).

## Rules

- A project written by another slicer keeps its own start, end and filament-change G-code,
  as desktop does. If the engine can't fill it in, a pop-up asks to use the engine's own
  for the printer; the answer is saved with the project.
- An online project remembers its engine; a 3MF opens with the engine that made it.
- A sliced-only `.gcode.3mf` is explained, not opened.
- Changed settings and colour mixes belong to the project. After a reload, the preset
  selection comes back from the browser; the project itself comes back through AutoSave
  (signed in) or by opening it again.

## Why

- Orca's own reader and writer, so files round-trip with desktop.
- Convert copies only what the author changed: copying everything (as other converters
  do) carries the old printer's defaults, such as Bambu's 0.2 mm first layer.
- A new R2 key per save avoids half-written files being read.
  See [decisions.md](../decisions.md#projects-and-autosave).

## Tests

`accounts.mjs` (online projects, conflicts), `convert.mjs`, `foreign-gcode.mjs`,
`engine-switch.mjs`, `engines.mjs`; unit tests `project-import.test.ts`, `projects.test.ts`.

## Open

- Recent projects on an empty plate (#85) is on hold.
