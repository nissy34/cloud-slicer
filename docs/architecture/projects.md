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
| The Online projects window (search, sort, Cards/List, Rename and Delete windows) | `components/ProjectMenu.tsx` (`ProjectsDialog`), `lib/projects.ts` (`findProjects`), `styles/project-menu.css` |
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

**Online projects window.** Tapping a project's picture or name opens it; its ⋯ menu holds
Open, Rename… and Delete…. Rename and Delete each ask in their own small window, whose
button shows a spinner ("Renaming…", "Deleting…") with every button locked until the
server answers; a failure stays in that window with a Copy button and changes nothing.
While the open project is saved or asked about before another opens, that card shows
"Opening…". Search (every typed word, any case), Sort (newest, oldest, name, biggest) and
Cards or List sit at the top and stay put while the projects scroll; Sort and the view are
remembered per browser. The storage line sits in the window's footer.

## What it keeps

D1 `projects` (name, size, keys, version, engine, draft, device, plates), R2 3MF and
thumbnail. Limits: 200 MB and 200 projects per person (storage set per person on the Admin
page); one project can use all of it, up to 95 MB (Cloudflare's free plan takes uploads
up to 100 MB, and the 3MF streams straight to R2 so a Worker's 128 MB memory isn't the
limit); 8 GB for the whole site (R2's free tier is 10 GB).

## Rules

- A project written by another slicer keeps its own start, end and filament-change G-code,
  as desktop does. If the engine can't fill it in, a pop-up asks to use the engine's own
  for the printer; the answer is saved with the project.
- An online project remembers its engine; a 3MF opens with the engine that made it.
- `version` goes up on every save and on Rename; a save from another tab or device
  against an older version gets a conflict. Things stored beside the project without
  changing the file (thumbnail, print history) must **not** raise it, or the device
  editing the project hits a conflict on its next AutoSave.
- Something that belongs to the project but needn't travel with the file goes in a D1
  column beside it (as `project_prints` does), not in the 3MF.
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

`accounts.mjs` (online projects, conflicts; runs Pages Functions with a local D1, see [accounts](accounts.md#tests)), `convert.mjs`, `foreign-gcode.mjs`,
`engine-switch.mjs`, `engines.mjs`; unit tests `project-import.test.ts`, `projects.test.ts`.

## Open

- Recent projects on an empty plate (#85) is on hold.
