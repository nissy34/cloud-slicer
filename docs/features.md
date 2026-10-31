# Features

Everything the site does, in the words a user would use. How each part is built and
why: [README.md](README.md) (the docs map) and [architecture/](architecture/).

## At a glance

- **Slices like desktop Snapmaker Orca 2.4.1**, because it is the same engine: STL, OBJ,
  AMF and 3MF projects, Bambu Studio 3MF files with painted colours, per-part filaments,
  multi-plate projects. Plate thumbnails go into the G-code, like desktop. Each plate keeps
  its own slice: pick another plate while one slices (it shows at once and the slice goes on,
  then "Plate N sliced · View"), and Preview has the plate tabs too.
- **Every printer brand the engine ships** (55 in Snapmaker Orca, 63 in OrcaSlicer, with
  their filaments and processes), with a first-run setup wizard (like Orca's) to pick the
  printers and filaments you have, then a tabbed Printers and filaments window to change them: search, pictures, and a "Direct print" mark on the
  printers this app can send prints to (Klipper ones, Prusa through PrusaLink, the Elegoo Centauri Carbon and Bambu Lab); for the others you download the
  G-code. Snapmaker's presets load at start and another brand's only once you pick one
  of its printers, so the page starts as fast as with Snapmaker alone. The 3D view shows the
  selected printer's own bed like desktop: the brand's bed shape under the plate and its
  print sheet picture (the Snapmaker U1's, a Bambu Lab sheet, Prusa's...) over the printable
  area, with desktop's grid, the bed's exclusion areas and the X/Y/Z arrows at the origin;
  a printer without one gets the plain plate.
- **Process settings in desktop's own pages and groups**, with per-object settings and a
  Standard flow / High flow switch for options that hold one value per nozzle flow
  variant (the U1). Like desktop, settings that don't apply grey out or hide (support
  settings with support off, ironing settings with ironing off), and a change that makes a
  combination desktop rejects (spiral vase with more than one wall, extrusion fuzzy skin
  without Arachne...) fixes itself or asks how to fix it. A search box above the pages finds
  any setting by name across every page, Advanced ones included. Typed numbers are
  checked like desktop, from the engine's own limits for each setting (no rule per
  setting, `apps/web/src/lib/option-check.ts`): a wrong one ("0.7$", a % where the
  setting takes none) is refused, one out of range is set to the nearest allowed value,
  a red line under the box says so, and a big "mm or %" value asks which one was meant.
- **Your own presets**, saved as Orca user presets (a diff over a system preset), with
  printer and filament settings windows like desktop's preset editors (with its Extruder 1 to 4
  pages, one per tool head, Motion ability with the machine limits, and the filament's Setting
  Overrides, where a filament can use its own retraction and z-hop values or the printer's), and preset files
  in and out (desktop Orca's preset JSON, `.orca_printer`, `.orca_filament`, zip). One preset
  works in both engines: settings both have (605, listed in `apps/web/src/lib/shared-settings.json`)
  stay the same in both, while G-code, Snapmaker's high flow values and settings only one engine
  has are kept per engine, each on its own base preset (`apps/web/src/lib/preset-engines.ts`).
- **Two engines, chosen per project**: Snapmaker Orca 2.4.1 or OrcaSlicer 2.5. The Slicer engine
  picker above the printer names both engines with their versions in small grey words (read from
  each engine's `version.inc` at build time; phones too, where the top bar has no room for the engine
  tag), as do the setup wizard's engine cards, and switches an open project to the other engine, like desktop's
  printer change: when something would be lost, a pop-up first lists just that (each colour mix
  and the filament it becomes, high flow values you changed, settings the other engine lacks, a
  process with no match of its layer height); model, plates, positions and painting stay
  (`apps/web/src/lib/engine-switch.ts`).
- **3MF print settings import**: a project's own settings come in on top of your presets.
  A 3MF made for a printer you don't have (for example a Bambu project) can be converted
  onto one of yours: the print settings its author changed carry over, the ones left at
  the old printer's defaults and the printer's own settings (speeds, accelerations,
  jerk) come from your printer, and filaments are matched by material.
- **Filaments per project** follow the file, like desktop: as many as the file has or you
  add, in both engines. On the U1 you pick a head for each filament when you send the print
  (`apps/web/src/lib/filament-limit.ts`).
- **Prepare tools**: move, rotate, scale (exact fields like desktop's: position X, Y and Z, where a
  Z below the bed sinks the object into it; rotation; scale in percent or size in mm, all three
  axes together while "Scale evenly" is on; the same fields for a part inside its object), lay on face, cut, measure (distances and angles
  between faces, edges, circles and corners), variable layer height (adaptive, smooth,
  or by hand on the layer height chart), arrange, auto-orient, split,
  mirror, simplify (offered by itself when the plate to slice has too many triangles to slice comfortably; a phone or tablet asks before drawing such a model, since drawing it can take more memory than the phone allows), plates, brim ears (by hand or on the corners), undo and redo, desktop's editing keys (Del deletes the
  picked copy or part, Ctrl+C / Ctrl+V copy and paste an object, Ctrl+K clones it, + and - add or
  remove a copy, also Add copy / Remove copy in the object list and object menu; arrow keys move
  the picked objects 10 mm and Page Up / Page Down turn them 45°),
  choosing several models like desktop (Ctrl+click or Shift+click, Ctrl+A or Select all in the
  plate menu, a Shift+drag rectangle that takes what it touches, Alt+drag to take out, Esc to let
  go, Ctrl/Shift+click in the object list; on a phone "Choose several" in the long-press menu,
  then taps and a one-finger drag rectangle): move, rotate and scale work on all of them about
  their middle, and their own menu (right click or long press a chosen one) assembles them into
  one object with each part where it stood (also on the chosen bar; with two chosen the Assemble
  tool picks only on those two), changes filament,
  clones, copies (Ctrl+V pastes them as a block), centres, arranges only them, auto-orients,
  toggles Printable, exports them as one STL or deletes them,
  painting (colours, support and seam enforcers/blockers, fuzzy skin), desktop's plate
  menu (right click or long press the plate or the space around it: add a primitive
  shape, text, an SVG, one of Orca's handy models or a model file, and on the plate
  arrange, auto orient, delete all, delete plate and rename plate, the name then shown
  on the plate; Show labels or Ctrl+E puts each object's name over it), and desktop's
  object menu (right click or long press an object, or ⋯ in the object list: clone,
  center, rename, printable, change filament, scale to fit, unit conversion, replace
  with STL, export as STL), and parts, negative parts, modifiers and support
  blockers/enforcers added to an object (shapes or a mesh file), shown see-through,
  moved with the gizmos, with their own settings, mesh boolean (union, difference or
  intersection of two of an object's parts), and text shapes (desktop's Text tool: raised,
  engraved or a modifier on the object's surface facing you, or an object of its own;
  edited live with built-in Noto fonts and Hebrew fonts (Rubik, Heebo, Frank Ruhl Libre, Noto Sans Hebrew), a font file (kept in the browser), or the computer's fonts in Chrome/Edge on a computer; Hebrew is laid out right to left (desktop prints it backwards), and the tool says which letters a font lacks;
  following a curved surface or set letter by letter, aligned left/centre/right and
  top/middle/bottom, slid over the object by dragging it (one finger on a phone), turned
  with its ring or a Rotation field, lifted off the surface, faced to the camera, and kept
  in the 3MF), and SVG shapes (desktop's SVG tool: an .svg file's paths as a raised,
  engraved or modifier shape on the object, or an object of its own when you open or drop an
  .svg file, with its depth and size changeable, following the surface, slid and turned like
  text, and the file kept in the 3MF), and Assemble
  (desktop's Assemble tool: pick a face on each of two parts and turn one parallel to the
  other, put it face on face middle on middle, flip it, set the distance between them or
  turn it about the face; or pick two points and move one onto the other; two objects are
  joined into one first, as only parts can leave the bed).
- **Plate icons** lying on the bed beside the shown plate, where desktop draws them: delete
  plate, auto orient, arrange this plate and plate settings (orange when the plate has its
  own) past the back right corner; the plate's number past the front right corner; its name
  past the back left corner with a pencil to rename it.
- **Plate settings** like desktop's window (plate menu, the plate's icon, or the button
  beside the shown plate's tab): a plate's own plate type, print sequence (by layer or by object), spiral
  vase and first layer / other layers filament order instead of the project's, saved in the
  3MF and used when that plate slices (also those desktop and Bambu Studio projects bring).
  A dot on a plate's tab says it has its own; the sidebar's matching setting says which
  value the shown plate uses.
- **Tool head clearance when printing object by object**, like desktop: each object on a
  plate printing By object gets a dashed outline for the room the tool head needs (half
  the printer preset's extruder clearance radius round it), red where two touch and a red
  band where an object is too tall for its place in the order (the rod and lid heights
  from the printer preset), with its print order number. The outlines follow a drag.
  A message names the objects and the printer's values, Slice waits, and Arrange spaces the
  objects by the clearance with tall ones last in their row.
- **Prime tower on the plate**: when a plate prints with more than one filament the tower
  stands on the Prepare plate at the size Orca will print it, and you drag it where you
  want it, per plate, like desktop.
- **Flushing volumes** for printers with one nozzle and several filaments (Bambu AMS, Prusa
  MMU, Creality CFS...), like desktop's window: how much each filament change purges, per
  pair of filaments, worked out from their colours by each engine's own formula (again for a
  filament whenever it or its colour changes), with the multiplier, Re-calculate, and where
  the purge goes (prime tower, infill, support, per object into objects). Printers with a
  head per filament (the U1) never purge, so they don't show it and say why.
- **Colour mixing**: Snapmaker Orca's mixed filaments, virtual filaments made of two or
  more physical ones, usable anywhere a filament is.
- **Filaments from the printer**: "From printer" in the Filament section loads what is in
  a U1's tool heads or a Bambu Lab AMS (material, brand, colour) into the project, like
  desktop's Sync filament: match each project filament to the closest loaded one, or
  replace the list. While the printer is connected, each Filament list also starts with
  its loaded filaments (like desktop's "AMS filaments"); picking one sets the preset and
  the colour.
- **Calibration tests** from desktop's Calibration menu: temperature, flow rate, pressure
  advance (tower, lines or pattern, with direct drive / Bowden ranges and the pattern's
  speed and acceleration lists), retraction, max volumetric speed, VFA, input shaping,
  junction deviation.
- **Slicing you can stop**: Cancel next to the progress bar, and a change while slicing
  (settings, filaments, presets, the model) stops the slice and drops its result, like desktop.
- **Preview** of the sliced toolpaths layer by layer, coloured like desktop's view types: line type, filament,
  speed, layer height, line width, flow, layer time (also on a log scale), fan speed and temperature, with
  the scale in the colour key. Tap a line type in the key to hide or show it. The Filament view lists each
  filament's grams, metres and cost (prime tower included) and the number of filament changes.
  Desktop's layer slider items: a pause, a filament change, custom G-code or the printer's custom
  template at the start of a layer (+ beside the slider, or a right click or long press on it),
  shown as markers on the slider and kept per plate in the project and its 3MF.
- **Warnings like desktop's**: an object over the plate's edge or above the printer's height
  shows darker past the edge and has to be moved before slicing; after a slice its
  warnings (empty layers, G-code paths of two objects running into each other, objects
  that need support, risky settings, toolpaths outside the plate or above the printer)
  are listed under the result, and toolpaths outside the build volume can't be downloaded
  or sent, as on desktop.
- **Camera views** in the corner of the 3D views: Fit all, and desktop's Iso, Top, Bottom,
  Front, Back, Left and Right (keys 0 to 6, Z fits all). On a phone two fingers always zoom
  and turn the camera, even when they land on the model; one finger on a model moves it.
- **Projects**: save as an Orca 3MF that reopens here or in desktop Orca; online in your
  account when signed in, downloaded when signed out. Signed in, **AutoSave** works like
  Word's: new work is kept as an unsaved draft, the first Save names it, then every change
  is saved on its own (a switch turns it off). Open the app on another device and a
  **Continue** card picks up where you left off; one device edits a project at a time,
  the other shows it view only with "Edit here instead".
- **Share to Cloud Slicer** on Android (installed app): share a model from another app
  and it opens here, or is added to the project you have open.
- **Sign in with Google** to keep presets, setup choices, printers and projects on every
  device. Signed out, everything is kept in the browser and merged in at sign-in.
- **Device tab** for Moonraker (Klipper) printers: cameras, temperatures, motion, files,
  upload and print, skipping objects mid-print, and for Prusa printers through PrusaLink
  (status, files, upload, print, pause and cancel) and printers run by OctoPrint (all of the
  above, plus Move, temperatures, the console and its cameras), the Elegoo Centauri Carbon
  (status, files, upload, print, pause, resume, cancel and its camera) and Bambu Lab printers
  (all of that plus Move and temperatures, with LAN Only mode and Developer Mode on; camera on
  P1 and A1; filament sync from the AMS, and the print dialog picks an AMS slot for each
  filament; its errors in Bambu's own words), plus Snapmaker U1 extras (tool heads, filament sync, the U1 print
  dialog, the U1's error codes in Snapmaker's own words). Printers on a home network are reached through a small bridge app.
- **Light and dark theme**, a layout that works on phones (Prepare, Preview and Device as tabs at the bottom, the Device tab showing the print's progress; an open tool stacks the toolbar, its options and the model, with the settings hidden until Done), and installable as an app
  (PWA) on Android.

## Accounts, presets and projects in detail

### Accounts

Sign-in with Google uses [Better Auth](https://better-auth.com) on Cloudflare Pages
Functions (`apps/web/functions/`) with a D1 database (`apps/web/migrations/`). Each
user's printer, filament and process presets, setup choices, theme, and printers with
their connection details (API keys encrypted at rest) are stored per account. Signed
out, the same data is kept in the browser and merged into the account at sign-in.
Every deploy signs in through one host (`AUTH_ORIGIN` in `apps/web/wrangler.toml`,
https://slicer.awesomestuff.qzz.io) with Better Auth's oAuthProxy plugin, so branch
previews work with one Google OAuth client.

### Admin page and limits

The site's owner (the Google emails in the `OWNER_EMAILS` repository secret) gets
**Admin: people and limits** in the account menu. It lists every account (joined, last
seen, storage used, projects, presets, printers, bridges) with **Block** / **Unblock** and
**Delete** (removes the account, presets, printers, projects and their files),
has an **Invite only** switch with an email list, sets **online project storage** per
person (a site default plus per-person overrides; "Presets only" turns online projects
off while presets and printers still save), and shows the site's use against
Cloudflare's free limits. Nothing changes for people who are allowed. Changes on the page
show at once and save in the background ("Saving…", then "Saved" beside the title); a
change the server refuses goes back, with the reason.

- Blocking and the user list are Better Auth's admin plugin: a blocked person is signed
  out everywhere and refused at sign-in. Invite only is a Better Auth database hook on
  new accounts and new sessions; turning it on keeps everyone who already has an account.
- The bridge relay only lets in browsers of signed-in, allowed accounts. The site gives
  the browser a ticket for each bridge (a short-lived JWT signed with `RELAY_TICKET_KEY`;
  the relay has only the public key) and renews it by itself. Each account can use 3
  bridges and watch 2 cameras at a time through a bridge. Blocking someone drops their
  relay connections at once. A bridge joins an account with a one-use setup code (Add a
  bridge) and that account owns it; a bridge without one, or whose owner is blocked, is
  turned away. Signed out, bridge printers show a Sign in button; printers reached
  directly need no account. The Admin page's **Bridges** list shows every bridge in use
and who uses it: **Turn off** closes a bridge for everyone and refuses its bridge app until
it is turned on again. Each person can also be set to "Bridges: not allowed".
- Usage: storage, accounts and bridges come from D1. Today's request counts (site and
  relay, database rows) need a read-only Cloudflare token: create one from the "Read
  analytics and logs" template and add it as the repository secret
  `CLOUDFLARE_ANALYTICS_TOKEN`.

### Preset files

Each preset picker's ⋯ menu exports the preset as desktop Orca's preset JSON, exports all
your presets as a zip that desktop's Import Configs reads, and imports `.json`,
`.orca_printer`, `.orca_filament` and `.zip` files. The engine reads them with Orca's own
loader. A preset must be based on a system preset the app ships: a printer preset for a
printer we don't have is refused, and a filament or process made for another printer can
be put on one of ours (keeping its material or model settings). Process settings are in the
sidebar; printer and filament (per slot) settings open in their own window from the ✎
beside their picker, like desktop's preset editors, with Save to preset, Save as new
preset and Save to project (changes kept only in the project 3MF).

Downloaded and sent G-code is named from the process preset's **Filename format**, as on
desktop. The shipped presets put the plate in it (`{input_filename_base}_plate_{plate_number}_…`,
added by `engine/scripts/plate-file-names.mjs`), so `Flexi_Hamster_plate_01_PLA_4h31m12s.gcode`;
desktop's `{plate_number}`, `{plate_name}`, `{print_time}` and any setting (`{filament_type[0]}`)
work. Desktop's **Post-processing Scripts** run a program on the computer, which a browser
can't, so that box isn't shown.

### Projects

The Project menu in the top bar (New, Open, Projects, Save, Save a copy, AutoSave, Download 3MF) saves
the open project as an Orca 3MF project, written by the engine with Orca's own
`store_bbs_3mf` (like desktop's Save project): plates, objects, part settings, paint,
colour mixes and the full print, filament and printer settings, so it reopens here or in
desktop Orca. Signed out, Save downloads the file. Signed in, Save keeps it in the
account's online projects: the 3MF and a thumbnail in R2 (`PROJECTS` bucket), indexed in
D1 (`projects` table). Limits keep R2 inside its free 10 GB: 200 MB
(changeable on the Admin page) and 200 projects per user, one project as big as that storage up to 95 MB, 8 GB for the whole site. Saves carry the version they started
from, so a save from a second device asks before overwriting.

AutoSave (signed in, on by default, the switch is a user setting): a new project is a
draft in the account (`projects.draft = 1`). Each device keeps one draft (a new one replaces
that device's old one, at most 3 per person, oldest go first), so Discard on the Continue
card never takes another device's open work with it: that device says so, keeps what it
shows and saves it as a new draft. Drafts don't count toward the 200 projects but do count
toward storage. Leaving it asks Save / Don't
save / Cancel; the first Save names it and turns it into a project. After that each change
is saved once things are quiet for 5 s, at most every 30 s (every 3 min for projects of
5 MB or more, since each save uploads the whole 3MF), and when the tab is hidden; the
thumbnail goes up at most every 10 min. Each save names the browser it came from
(`projects.device`, a random id kept in the browser, and `device_name`, like "phone").
A save from another device than the last one is refused (409 `elsewhere`) until that device
takes the project over (`POST /api/projects/<id>/device`, "Edit here instead"); the other
tab notices when it is focused again (no polling) and goes view only, offering "Save mine as
a copy" when it had unsaved changes. On opening the app with nothing loaded, the Continue card
offers the saved project that was open in this browser when it was left (its id is kept in
the browser until a new project, a draft or another file replaces it), else the draft, else
the newest project changed on another device in the last day.
Share to Cloud Slicer is the manifest's `share_target`: `public/sw.js` keeps the shared files
in the Cache API and opens `/?shared=1`, which opens them (`src/lib/share-target.ts`).

Setting these up: [architecture/accounts.md](architecture/accounts.md#setup-once).

## Device tab in detail

The Device tab controls Moonraker (Klipper) printers: cameras (all of Moonraker's
webcams, several at once), temperatures, motion, the console (with Fluidd-style
**Filters** chips: temperature reports, timelapse, print progress and plain "ok" lines hidden by
default, plus your own "hide lines containing…" words; saved per computer), files, upload and print,
skipping objects during a print ("Skip objects…" on the Print card: a top-down map of
the object outlines plus a list, sending Klipper's `EXCLUDE_OBJECT`; it needs the
G-code's object labels, which `engine/scripts/klipper-labels.mjs` turns on in every
Klipper printer's system process presets),
plus Snapmaker U1 extras (tool heads, filament sync, the U1 print dialog with tool
mapping, and the U1's errors on the Print card with their code and Snapmaker's own
title and advice; `apps/web/scripts/u1-errors.mjs` rebuilds that list from Snapmaker
Orca's device page). **Prusa printers** (MK4/MK4S, Core One, XL, Mini, MK3 with
PrusaLink) work through the bridge too: it finds them on the network by PrusaLink's
login, takes the PrusaLink password, and stands in for Moonraker so the same cards
show their temperatures, print, files with pictures, upload, print, pause and cancel.
PrusaLink takes no G-code, so their screen has no Move, Console, camera (Prusa's camera
only reaches Prusa Connect), temperature setting or emergency stop (`addons/prusa.ts`,
`apps/device-bridge/translate.go` and `prusalink.go`). **Printers run by OctoPrint**
(OctoPi beside an Ender, a Prusa MK3 or others) work the same way with an OctoPrint API key
(Settings, Application Keys): the bridge finds OctoPrint by its login page on port 80 or
5000, and since OctoPrint takes G-code they keep Move, temperatures and the Console (its
replies come from OctoPrint's push socket), with the few Klipper commands the screen sends
put in Marlin's words; their cameras come from OctoPrint's settings, and "Connect again"
replaces "Restart firmware" (`addons/octoprint.ts`, `apps/device-bridge/octoprint.go`;
tested against the real OctoPrint's virtual printer, `apps/web/test/device/printers/octoprint`).
**The Elegoo Centauri Carbon** needs nothing turned on and no password: the bridge finds it
by asking the whole network, as Elegoo's own apps do, and speaks Elegoo's local protocol
(SDCP). It shows status, the chamber, files, upload, print, pause, resume, cancel and its
camera; like PrusaLink it takes no G-code, so moving the head and setting temperatures stay
on the printer (`addons/elegoo.ts`, `apps/device-bridge/elegoo.go`; tested against a
pretend Elegoo, `apps/web/test/device/mock-elegoo.mjs`). The Centauri Carbon 2 speaks
another protocol and isn't covered yet.
**Bambu Lab printers** (X1, P1, P2S, A1, H2) take the LAN access code from the printer's
screen; the bridge hears them announce themselves on the network, as Bambu Studio does,
and talks to them the same local way (MQTT, FTPS). To take prints and G-code from
anything but Bambu's own apps, a printer needs **LAN Only mode and Developer Mode** on
(Bambu's cloud and the Handy app stop working while they are); the add-printer dialog
says so, and without them the printer still shows its status and the Device tab shows
the printer's refusal of anything else. They show status, the chamber (X1, H2), files,
upload, print, pause, resume, cancel, Move, temperatures and the console (the printer
sends no replies), and the camera on P1 and A1 (X1, H2 and P2S send video only Bambu's
apps play). Like the desktop slicer, the site makes a **.gcode.3mf** for a Bambu printer
(Download and Send), since only such a file says which filament goes where: the print
dialog then picks an AMS slot (or the outside spool) for each filament, same type only,
closest colour first, and asks for bed levelling, flow calibration and time-lapse, the
way Bambu Studio's Send does. "From printer" in the Filament section reads the AMS.
Both come from the printer's own report, which the bridge passes on as it is; the
print command is the site's own (`addons/bambu.ts`, `device/slots.ts`,
`apps/device-bridge/bambu.go`; tested against a pretend printer,
`apps/device-bridge/internal/fakebambu`; not yet tried on a real one). Nothing
of Bambu's is used to sign commands. Printers of other brands that report no slots
(Prusa XL and INDX, Klipper printers with a filament changer) print filament n from
their slot n. Its errors (the stopped print's error and its health messages, "HMS")
show on the Print card and in alerts in Bambu's own words with the code Bambu's apps
show; `apps/web/scripts/bambu-errors.mjs` rebuilds that list from the one OrcaSlicer
ships (`resources/hms`, the newer printer families; most codes mean the same on every
Bambu printer, and one it doesn't know shows its code and says to check the screen).
The add-printer dialog's "Which
printers work?" lists the printers the Device tab reaches. The cards can be arranged: **Arrange cards** at the top right of the tab (it turns into **Done arranging** while you arrange) moves
cards by their grip into 2 or 3 columns or across the top or bottom, hides them, makes
them half width (two side by side) and sets the camera size; tapping a card's title folds
it. Folding a camera or page card is also how it is turned off: nothing streams or loads while
it is folded. **Add a camera card** makes another camera card; each camera card's Choose picks which
cameras it shows (a camera is in one card; the rest stay in the main Cameras card), and each
keeps the usual one-big-and-small-ones camera layout. Phones keep their own one-column order. Each printer has its own layout (its cards, camera
cards and page cards), saved in the account (`device-layout.<printer id>` setting,
`apps/web/src/device/layout.ts`), so it follows you to every device; a new printer starts
from the standard layout, "Back to default" brings it back for the printer shown, and removing
a printer removes its layout. A printer with a public https address is reached directly (the tab shows the
`cors_domains` lines Moonraker needs, and a Tailscale hint). A printer on a home network
is reached through a small **bridge** on any always-on computer near it, which connects
out to the **relay** (a Cloudflare Worker with one Durable Object per bridge), so no
router ports are opened:

    browser ⇄ relay (apps/device-relay) ⇄ bridge (apps/device-bridge) ⇄ printer's Moonraker

Cameras skip the relay: the bridge sends them straight to the browser over WebRTC (the
camera's own live video when it has some, like the paxx12 U1 firmware or camera-streamer,
otherwise up to 15 pictures a second). Only on a network that blocks direct links does
the camera fall back to one picture a second through the relay, with a note saying so.

Setting up a home printer, signed in, from the Device tab's "Add a bridge" (or Add a
printer): the dialog makes a one-use **setup code** (good for one hour) and shows one
command that carries it:

| System | How |
|---|---|
| Windows | `irm "<relay>/install.ps1?code=<code>" \| iex` in PowerShell, or the `install.cmd` line in Command Prompt |
| macOS, Linux, Raspberry Pi (64 and 32-bit), Creality K1 (MIPS) | `curl -fsSL "<relay>/install.sh?code=<code>" \| sh` in Terminal |
| On the printer itself (any Klipper printer) | the same line with `sh -s -- --printer`, over SSH |
| Or download it (Windows, Mac) | open the app; it asks for the setup code shown next to the download |

The bridge spends the code as it installs and joins that account at once (a bridge
without a valid code never connects; an expired code makes the command ask for a new
one). It starts with the computer (Windows and macOS at login, Linux at boot), the
dialog turns green by itself, and the Device tab then searches the
bridge's network for Moonraker, PrusaLink, OctoPrint, Elegoo and Bambu Lab printers and adds the ones you pick, with their API
keys, PrusaLink passwords or access codes, or any address you type. API keys are only ever entered in the Device tab.
Bridges are saved on their own, apart from their printers: the Device tab's
Printers & bridges window (the last choice in the printer list; it is also where printers are added and edited) lists each bridge with its printers, removes either on
its own, adds printers to a saved bridge with no pairing again, and removing a
running bridge makes it uninstall itself from its computer. The other way works too:
on Windows the bridge is in the Start menu and in Settings, Apps, Installed apps
(Uninstall), on a Mac in Applications; opening it shows whether it is connected and
which printers it serves, with Remove bridge…, and removing it there also takes it
out of the account.
The account keeps a browser key derived from the bridge's secret; the relay stores
only hashes and rate-limits connects. Using a bridge needs a signed-in account (see
Admin page and limits). The apps are unsigned (signing costs money),
which is why Windows warns and why macOS uses the Terminal command. More in
[apps/device-bridge/README.md](../apps/device-bridge/README.md) and
[apps/device-relay/SECURITY.md](../apps/device-relay/SECURITY.md).

**Trying relay and bridge changes before they merge**: add the label `use test relay`
to the pull request. Its relay goes to a separate test relay, its bridges to that relay's
downloads, and every branch preview of the site sets up new bridges there, shown with a
**Test** tag. A test bridge ("Cloud Slicer Bridge (test)") installs next to your everyday
bridge without touching it, and only ever updates from the test relay; remove it with
Remove bridge or the uninstall line the preview shows. The live relay only changes on main.

**Print alerts** (the Device tab's Alerts card): "Send alerts to this phone" turns them
on for one printer on one device, with a switch per moment. Problems (failed or
cancelled, paused or filament ran out, printer error) and Finished are on to begin
with; print started, first and third layer, progress at chosen percentages, almost done
(10 minutes left), still printing every few hours, resumed and bed cooled down are
there to turn on, and "Alert me after layer N" is also in the Print dialog (it lasts
until that print ends; there it also turns alerts on, and refuses a layer past the
print's last one). Each device keeps its own choices (a phone may want more than the
computer on the desk); a device that turns alerts on starts from the choices saved last
on any device of the account (kept as the account setting `alerts.last`), without
"after layer N". For a printer through a bridge, the bridge watches the
print itself (any Klipper printer: Moonraker's print state, layers, bed temperature
and filament sensors), so alerts come with the browser closed: it sends each event
to the relay, which sends a Web Push message (encrypted for the browser, signed with
the relay's VAPID key) through the browser's own push service, with a camera
picture on the key alerts. A printer reached directly can only alert while a tab is
open; the page runs the same rules itself. "The bridge goes offline" (off to begin
with) comes from the relay after 10 minutes without the bridge. iPhone and iPad need
Cloud Slicer on the Home Screen first (iOS 16.4 or later) and show no picture.
Each alert also says where the print stands: progress and layer ("47% · layer 120
of 250"), time left with the time it should finish in the phone's own time zone,
filament used so far against the file's total (grams when the slicer wrote the
weight, else metres), and, when it stops, how long it ran and what it used. A
filament pause names the head that ran out (U1) or the sensor; an error carries the
printer's own message, on the U1 Snapmaker's error title, description and code.
Tapping an alert opens the Device tab on its printer. The rules are in
`apps/web/src/device/alerts.ts` and `apps/device-bridge/alerts.go`, tested against
the same cases (`apps/device-bridge/testdata/alert-cases.json`, and
`alert-details-cases.json` for what an alert says about the print); the words are
in `apps/web/src/device/alert-text.ts`.
