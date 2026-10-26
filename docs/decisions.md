# Decisions

What was chosen, what was turned down, and why, newest last in each section. Read the
section for the area you are changing before proposing something listed here as turned
down. Add a line with the date when a new choice is made.

## Working rules

- **Sketch first.** UI changes are agreed on a sketch or pick page before building;
  screenshots only of what was agreed (2026-10-20).
- **Well-known libraries and Orca's own code** over our own versions (2026-10-18, after
  hand-written sign-in).
- **Derive rules from engine metadata**, never one rule per setting (2026-10-23).
- **Generic over printer-specific**: no code for one printer when a general rule works
  (e.g. filament sensors by name, not a U1 flag; every plate type on every printer).
- **No telemetry, no automatic error reports.** An engine-error reporter was built and
  removed (2026-10-18); errors show with a Copy button.
- **No backward compatibility** for bridges or saved data nobody uses yet (2026-10-20).
- **No jargon in the UI**; hints say "tap" on touch screens; phone layout never scrolls
  sideways and keeps the toolbar visible.
- **Never add or remove a site feature without asking.**

## Engines

- Engine = upstream Snapmaker Orca 2.4.0, not the U1 Android fork (2.3.3 plus Android-only
  patches); browser fixes as patch files (2026-10-17).
- Slicing only in the browser; server slicing and a separate phone UI dropped once phones
  sliced fine (2026-10-18).
- Second engine, OrcaSlicer 2.4.2, chosen per project, not per user (2026-10-20).
- Turned down as third engines: PrusaSlicer, Bambu Studio.
- wasm64: not now (no Safari, phones kill tabs below 4 GB, slower; 2026-10-20).
- OrcaSlicer 2.5: proposed to wait for its beta and then replace 2.4.2. Its colour mixing
  is incompatible with Snapmaker's. Not decided.
- Colour mixing from Snapmaker Orca is required; Android-only mixing extras dropped.
- More than four colours on the U1 through manual swap pauses: turned down (2026-10-18);
  colour mixing or more filaments per head instead.

## Presets and settings

- System presets read-only; user presets as Orca's `inherits` + changes (2026-10-17).
- Brands load only when needed; Snapmaker first (2026-10-20).
- One user preset works in both engines: shared values plus a per-engine part
  ("option B", 2026-10-20).
- Printer and filament settings in pop-up windows, like desktop (picked over tabs).
- Every plate type on every printer; each printer starts on its own default (2026-10-24).
- Post-processing scripts removed (a browser can't run programs); file names from the
  preset's Filename format with `{plate_number}` (2026-10-23).
- Typed values: red line under the box plus the "mm or %" question (2026-10-23).

## Projects and autosave

- Online projects in R2 + D1, limits 50 MB / 200 MB / 200 projects / 8 GB site (2026-10-18).
- Convert keeps only settings the author changed (`different_settings_to_system`);
  comparing against Bambu presets was turned down (2026-10-19).
- Another slicer's G-code kept as desktop does, with a fallback question (2026-10-21).
- AutoSave like Word, one device edits at a time, no polling (2026-10-21).
- One draft per device, at most 3 (2026-10-22). "Discard only if not open elsewhere"
  turned down: no presence without polling.
- Continue offers the project last open in this browser first (2026-10-23).

## Plates and tools

- Per-plate settings, lock and flat plate icons like desktop; "Move plate to front" left
  out (2026-10-25).
- By-object clearance as desktop, one value per printer (2026-10-25).
- Arrange is a row packer (libnest2d stacks everything in wasm).
- Phones ask to simplify models over 1M triangles before drawing; Convert asked before the
  first draw on every device (2026-10-26). Simplify keeps the primary button even for
  painted models.
- Left out: assembly view, Reload from disk, text styles.

## Accounts and limits

- Cloudflare free tier only; Google sign-in only via Better Auth (GitHub sign-in dropped
  as too much setup, 2026-10-18).
- Signed-out use works and merges at sign-in (2026-10-18).
- Admin page for owners; storage per person, 3 bridges, 2 cameras; signed-out bridge use
  off by default (2026-10-20).
- Relay ticket key made once, copied to the relay by every live deploy (2026-10-22).

## Device tab

- Generic Klipper screen plus add-ons blended into the same cards (2026-10-18).
- Snapmaker's cloud turned down (closed, per-user certificates, against its terms);
  OctoEverywhere built then shelved (needs a paid plan) (2026-10-18).
- Brands: Prusa, OctoPrint, Elegoo Centauri Carbon (2026-10-22), Bambu Lab (2026-10-25).
  Turned down (2026-10-22): stock Creality and Anycubic (private, undocumented messages
  that change between firmware versions; their Klipper route, Creality's root option or
  Rinkhals, already works); old Snapmaker (J1, A-series, Artisan: older, few users) and
  Flashforge Adventurer 5M (medium work; its Klipper Mod already works); Prusa Connect
  (no public API for outside apps, PrusaLink is used instead). Bambu Lab was turned down
  then too and added later, so ask before building one of these.
- Arrange mode with sizes and camera cards (2026-10-22); layout per printer instead of one
  for all (2026-10-25). Same camera in two cards: parked.
- Printer pages as a Device tab card, not a pop-up (2026-10-22).
- Alerts: choices stay per device; a new device starts from the last saved (2026-10-22).
  Titles plain, no hints (2026-10-26).
- Phone: Prepare, Preview and Device as tabs at the bottom (2026-10-26).
- Pop-ups: one window style and one message card style; phone windows centred, not
  bottom sheets; no closing on an outside tap (2026-10-22).

## Bridge and relay

- A bridge because a public https page can't reach a home printer (2026-10-17).
- Go rewrite, also on the printer as a service; self-update instead of Moonraker's update
  manager; signed builds, signing key kept (2026-10-20/21).
- Setup codes in one install line; the word is "setup code", never "token" (2026-10-21).
- Test relay: one shared, by PR label, no reset (2026-10-21).
- Cameras: WebRTC straight from the bridge, relay pictures as fallback; Cloudflare TURN
  not used (2026-10-21).
- Uploads: zipped, direct link, then the relay (2026-10-23): 8 MiB pieces one at a time,
  "several pieces in flight" turned down as too complicated. Changed 2026-10-25 after a
  bar stuck at 0 % on a VPN: 256 KiB pieces streamed, at most 8 MiB unanswered; an open
  camera link carries the upload. Turned down: plain HTTP upload, a same-name check.
- Relay on its own domain; the old `workers.dev` address stays for good (2026-10-22).
- Bridge builds published only when bridge files change (2026-10-22).
- "A/P1": raw brand data passes beside the Klipper objects and the site reads it; the
  bridge keeps translation for alerts, the allow lists and one message a second. Full
  pipe without allow lists turned down (2026-10-25).
- Search only the usual ports; extra ports turned down (2026-10-22).

## Print history

- Stored in the account; bridge watches every printer ("sturdy"); tag line in every sent
  or downloaded G-code (2026-10-25).
- Print id inside the tag (2026-10-26). Three tables (files, sends, prints) judged too
  much for now.

## Hosting and CI

- Repository public so Actions minutes are free (2026-10-18).
- Previews share production's D1 and R2; migrations only add.
- CI round two: no `--with-deps`, early preview, path skips, split slow suites
  (2026-10-22). Real-Klipper tests nightly and on demand, not on every PR (2026-10-22).
- Engine cache misses retry with a random wait rather than fetching from the release
  first (2026-10-23).

## Not built

Snapmaker cloud, HTTP
upload through the relay, plate "Move to front", time per line type, recent projects on
an empty plate (#85 on hold), painting through Simplify, wasm64.
