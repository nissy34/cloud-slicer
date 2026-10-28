# Presets

> **Read this when** you change system or user presets, the setup wizard, preset files,
> printer beds or the printer catalog. **Related:** [settings](settings.md),
> [accounts](accounts.md), [engine](engine.md).

## What it does

Printer, filament and process presets exactly as desktop Orca has them: the brands' own
system presets, the user's own presets saved as a difference from one, a first-run
wizard to pick the printers and filaments you own (then a tabbed Manage window to change
them), and preset files in and out.

## Pieces

| Part | Where |
|---|---|
| Bundling every brand, per engine | `engine/scripts/bundle-profiles.mjs` → `profiles.json`, `profiles/<brand>.json`, `profiles/catalog.json`, `profiles/beds/` |
| Loading brands only when needed | `loadVendors` in `src/state/store.ts`, worker method `vendors` |
| Catalog, Direct print marks | `src/lib/printer-catalog.ts` |
| Setup wizard, the Manage window, and their saved choice | `components/SetupWizard.tsx` (`Wizard`, `Manage`), `lib/setup.ts` |
| User presets: save, rename, delete | `account/PresetMenu.tsx`, `account/preset-save.ts`, `account/preset-diff.ts` |
| One preset in both engines | `lib/preset-engines.ts`, `lib/shared-settings.json` (from `scripts/shared-settings.mjs`) |
| Preset files in and out | `lib/preset-files.ts`, engine `presetExport` / `presetImportParse` |
| Printer beds | `engine/scripts/bed-mesh.mjs`, `components/Bed.tsx`, `lib/bed.ts` |

## How it flows

1. Start-up loads Snapmaker's presets (and Orca's filament library they inherit from)
   plus the catalog (about 10 KB compressed).
2. Brands the user's printers need (wizard choice, selected printer, user printers' bases)
   are fetched, written into the engine's data folder, and `PresetBundle::load_presets`
   runs again, like desktop.
3. User presets are written to `<dataDir>/user/default/{machine,filament,process}/` before
   loading, so Orca treats them as its own.
4. Only the selected printer's bed files are fetched (a U1 about 5 KB).

## What it keeps

- **User presets**: D1 `presets` (signed in) or browser storage (signed out), merged at
  sign-in. Each is Orca's user preset JSON: `name`, `inherits` (one level), `from: "User"`,
  `version: "1.0.0"`, only the changed options; `engines` holds per-engine parts.
- **Setup choice**: account setting `setup` (`printers`, `filaments`, `printersIn`,
  `filamentsIn`, default engine), lists unioned at sign-in.

## Rules

- A user preset without a parseable `version` is skipped by Orca: always write one.
- `bundle-profiles` strips `default_materials` from printer models: once any loaded model
  names some, Orca shows only those filaments for every printer.
- A preset file must sit on a system preset we ship: printers we don't have are refused;
  filaments and processes from other printers are moved onto one of ours.
- Settings both engines have with the same type (listed in `shared-settings.json`, CI
  checks it is current) stay equal in both; G-code, high-flow values and one-engine
  settings are kept per engine on that engine's base preset.
- Every plate type is offered on every printer; a printer starts on its own default
  (U1: Textured PEI).
- The step-by-step wizard is only for setup: it opens by itself until finished once.
  After that, Manage and the pickers' last rows ("Add or remove printers…", "Add or
  remove filaments…", under a line in the site's own Picker list, which also groups
  printers by brand and marks the ones with direct print) open **Printers and filaments**: tabs Printers (your printers as
  chips with ✕ above the full list), Filaments and Default engine, one Save for all
  tabs, and Cancel or ✕ asks before throwing changes away. No Connect tab: the Device
  tab adds printer connections. Saving keeps the open project's printer, even one you
  removed. Before setup is done, those entries open the wizard from its first page.
- The sidebar's filament list is grouped like Snapmaker Orca 2.4.1's filament menu
  (`lib/filament-order.ts`, a port of `FilamentSort.cpp`): "My presets" first, then a
  heading per brand (`filament_vendor`, else the name's first word), Snapmaker first and
  Generic second, the rest by name. Snapmaker's filaments follow the order in its
  `filament/filament_allow_list.json` (`sections.filament_order`), which the engine
  worker passes along; brands and engines without one sort by name (`test/filament-list.mjs`).
- The wizard ticks nothing on a first visit; "Direct print" marks Klipper printers
  (through `inherits`), Prusa, Elegoo Centauri Carbon and Bambu Lab.

## Why

- Loading every brand at start would add 0.7 to 1.3 MB of downloads and memory; per-brand
  files keep start-up as fast as Snapmaker alone.
- One preset, two engines (option B of the shared-presets study, 2026-10-20) rather than
  copying presets between engines.
- Beds come from Snapmaker Orca's resources first (its U1 sheet is thin; upstream's is a
  13 mm block). See [decisions.md](../decisions.md#presets-and-settings).

## Tests

`presets.mjs`, `shared-presets.mjs`, `preset-files.mjs`, `brands.mjs`, `bed.mjs`,
`first-run.mjs`, `filament-count.mjs`; unit tests beside each `lib/` file.

## Open

- A preset switch carries unsaved changes over silently (unscheduled).
