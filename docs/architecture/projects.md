# Projects

> **Read this when** you change opening or saving 3MF files, importing another slicer's
> project, converting a project to another printer, switching engines, or online
> projects. **Related:** [autosave](autosave.md), [print history](print-history.md),
> [data](data.md).

## What it does

Opens models and 3MF projects (Bambu Studio's included) through Orca's own reader, brings
a project's own settings in, offers to convert a project made for a printer you don't
have, and saves Orca 3MF projects that reopen in desktop Orca: downloaded when signed out,
into the person's own Google Drive when signed in. Cloud Slicer keeps no project files of
its own: only the list entry and its small picture.

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
| Project files in the person's Google Drive | `functions/_lib/drive.ts` (`/api/drive/token`, check, rename, delete), `src/account/drive.ts` (upload in pieces, download, which files are still there) |
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

**Google Drive.** Sign-in asks Google for `drive.file` (the app sees only the files it
made; Google needs no security review for it) with `access_type=offline`, so a refresh key
is kept (encrypted, like the sign-in keys); `/api/me` says `drive: true` once it's granted.
Someone who unticks Drive on Google's screen, or signed in before, saves as a download only:
no draft, no AutoSave, and Online projects is grayed out in the Project menu
(`savesOnline` in `state/projects.ts`) until they press "Connect Google Drive" in the
account menu (Better Auth's `link-social` on the same account). The owner can also turn
online projects off for one person (Admin page; `/api/me` says `projects: false`).

**Save (signed in).** Engine writes the 3MF → the page gets a one-hour key from
`POST /api/drive/token` → uploads the 3MF straight to the "Cloud Slicer" folder in their
Drive (AutoSave's drafts go in "Cloud Slicer/Drafts"), a resumable upload in 4 MB pieces
that shows how far it got for a big project (8 MB or more: "Saving… 12 of 40 MB" on a Save, "Saving… N%" by the name for AutoSave) and carries on from what Google has after a
dropped connection → `PUT /api/projects/<id>?drive=<file id>&baseVersion=…` with no body.
The server checks the file with the person's key (size, MD5, zip signature) and points the
row at `drive:<file id>`; every save is a new file and the one before is deleted, so a save
that loses a race never replaces the newer one, and a refused save deletes the file it just
uploaded. A save over a newer version gets 409 and asks: overwrite, or save a copy. So does
a save over a file that was changed in Drive since (its MD5 differs from the one kept at
the last save; code `changed-in-drive`, "Changed in your Google Drive"). The list picture
(256 px WebP, about 15 KB; PNG where the browser can't make WebP) goes in the row with
`PUT /api/projects/<id>/thumbnail`.

**While a save runs.** A Save, Save a copy or Download 3MF the person asked for sets
`busy` and `saving` from the press (also while an AutoSave still running finishes first and
while the names are checked) until it is done. Meanwhile a card at the bottom says
"Saving…" (with "12 of 40 MB" for a big project; "Preparing the 3MF…" for a download) with a spinner, a spinner sits by the
project name on every screen size (AutoSave's own saves show it too), and the Project menu
greys out Save, Save a copy and Download 3MF with a row saying why. The card gives way to
"Saved “name” to your projects" or the error. Editing stays possible; what changes after
the press goes in the next save.

**Open.** The page downloads the 3MF straight from Drive with its key (nothing passes
through us). The loading card's bar fills from 0 to the project's size: Drive often sends
the file compressed with no length, so the size kept in the list entry is the total
(`downloadTotal`); only when neither is known does the bar move without filling. A file deleted in Drive (or emptied from Drive's bin) shows "Not in your
Google Drive" on its card in the Online projects window: one Google call per list
(`filesInDrive`) finds which files are still there; Remove takes it off the list. Rename
renames the file in Drive too; Delete deletes it. What is kept is told in plain words on
`/privacy` and `/terms`.

**Online projects window.** Tapping a project's picture or name opens it; its ⋯ menu holds
Open, Rename… and Delete…. Rename and Delete each ask in their own small window, whose
button shows a spinner ("Renaming…", "Deleting…") with every button locked until the
server answers; a failure stays in that window with a Copy button and changes nothing.
While the open project is saved or asked about before another opens, that card shows
"Opening…". Search (every typed word, any case), Sort (newest, oldest, name, biggest) and
Cards or List sit at the top and stay put while the projects scroll; Sort and the view are
remembered per browser. The footer says where projects are kept and how many of the 200
there are. While the list loads
the window shows the app's loading card (components/PrintLoader.tsx) with a moving bar, and
a long name takes two lines on a card and shows in full in List.

## What it keeps

D1 `projects` (name, size, `file_key` = `drive:<file id>`, `drive_md5`, the picture in
`thumb`/`thumb_type`, version, engine, draft, device, plates). The 3MF itself is in the
person's Google Drive. 200 projects per person (drafts not counted) is a safety guard only, so rows can't pile up
forever; the UI shows just the count, never "of 200" (each project costs the site one D1
row and a ~15 KB picture). The file uses the person's own Google storage, which the Online
projects footer, account menu and privacy page say.
A project can be as big as their Drive has room for. Deleting an account leaves its
projects in the person's Drive.

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
  selection comes back from the browser; the project itself comes back from the copy kept
  in the browser, through AutoSave, or by opening it again.

## Why

- Orca's own reader and writer, so files round-trip with desktop.
- Convert copies only what the author changed: copying everything (as other converters
  do) carries the old printer's defaults, such as Bambu's 0.2 mm first layer.
- A new Drive file per save avoids half-written files being read, and a lost race never
  replaces the newer save.
- Project files in the person's own Drive, not ours: no storage cost, no size cap, and the
  files stay theirs. See [decisions.md](../decisions.md#projects-and-autosave).

## Tests

`accounts.mjs` (online projects, conflicts, Drive: a mock Google Drive the page and the
server both reach; runs Pages Functions with a local D1, see [accounts](accounts.md#tests)),
`account/drive.test.ts` (upload in pieces, resume after a drop), `convert.mjs`, `foreign-gcode.mjs`,
`engine-switch.mjs`, `engines.mjs`; unit tests `project-import.test.ts`, `projects.test.ts`.

## Open

- Not offered on purpose: opening a 3MF the app didn't make from Drive (Google's file
  picker), since `drive.file` can't see it.
- Recent projects on an empty plate (#85) is on hold.
