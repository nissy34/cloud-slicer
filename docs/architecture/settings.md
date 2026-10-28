# Settings

> **Read this when** you change the settings panel, a setting's field, per-object
> settings, flow variants or input checks. **Related:** [presets](presets.md),
> [plates](plates.md) (per-plate settings).

## What it does

Process settings in desktop's own pages and groups, printer and filament settings in
their own windows, per-object and per-part settings, desktop's greying and hiding rules,
a search box, and checks on every typed value.

## Pieces

| Part | Where |
|---|---|
| Desktop's pages and groups, read from `Tab.cpp` | `engine/scripts/extract-settings-layout.mjs`, `lib/settings-pages.ts` |
| Greying, hiding, fix-it questions (desktop's `ConfigManipulation`) | `lib/option-toggles.ts`, `components/SettingsPrompt.tsx` |
| Checks on typed values from the engine's limits | `lib/option-check.ts` |
| Standard flow / High flow values | `lib/flow-variants.ts`, `components/FlowVariantSwitch.tsx` |
| Per-object and per-part settings | `lib/object-settings.ts`, `components/ObjectSettings.tsx`, `SettingPicker.tsx` |
| One field | `components/OptionField.tsx` |
| Printer and filament windows | `components/PresetSettingsDialog.tsx`, `lib/slot-values.ts` |

## How it flows

The engine sends each option's metadata (type, min, max, side text, enum values, `scope`
region/object, `flow`). The page draws desktop's layout from it, the store keeps the
user's changes as overrides on top of the selected presets, and the slice takes presets +
overrides + the project's own values.

## What it keeps

Changes belong to the project (overrides in the 3MF), unless saved to a preset. Printer
and filament windows offer Save to preset, Save as new preset, Save to project.

## Rules

- **No per-setting rules.** Everything comes from the engine's option metadata or desktop's
  own code ported as is.
- A typed value: invalid is refused and the old one kept, out of range is set to the
  nearest allowed value with a red line saying so, a comma is a decimal point, a big
  "mm or %" value asks which was meant.
- Flow variants: Snapmaker Orca 2.4 keeps many speed and acceleration options as one value
  per nozzle flow (`"50,50"`); the switch edits one at a time; older single-value files
  are aligned to both.
- Support filaments: picking the support or interface filament asks desktop's questions
  (`supportFilamentChecks` in `option-toggles.ts`), each engine its own: Snapmaker Orca
  2.4.1 warns about PLA under PETG (or PETG under PLA) as the base and offers the settings
  that separate them at the interface; OrcaSlicer offers its support-material settings.
  The model's filaments come from every plate, mixes counted as their filaments
  (`physicalFilaments`). A Snapmaker plate printing PLA and PETG shows desktop's notice
  under the plate, with Snapmaker's guide (`usesPlaAndPetg`, `ActionBar.tsx`).
- Modes like desktop, as one small Simple · Advanced · Expert chooser (`SettingsLevelChips`) beside the
  Process settings heading and above the search in the preset windows. Expert is Advanced plus desktop's Developer mode
  preference: it also shows the settings the engine marks `develop`, in the pages and in search.
  The choice is kept with the account (`settingsLevel`) and is the same everywhere. It switches at once; the
  account save (about a second) follows behind.
- Settings a browser can't honour are greyed with "Not available in the browser"
  (`GREYED_IN_BROWSER`) or hidden (`NOT_IN_BROWSER`, e.g. post-processing scripts).
- Zustand selectors in components must not return new arrays or objects (endless
  re-render); select plain values.

## Why

Desktop parity and "derive rules from engine metadata" are standing rules
([decisions.md](../decisions.md#presets-and-settings)). Printer and filament settings are
pop-up windows like desktop (picked over tabs).

## Tests

`settings.mjs`, `support-filaments.mjs`, `settings-pages.mjs`, `transform-fields.mjs`, `warnings.mjs`; unit tests
`option-check.test.ts`, `option-toggles.test.ts`, `flow-variants.test.ts`,
`object-settings.test.ts`.

## Open

- Desktop's "Extruders" count box isn't there.
