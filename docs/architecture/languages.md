# Languages

> **Read this when** you add or change any words the site shows, or anything about
> right-to-left. **Related:** [design system](design-system.md), [layout and phones](layout.md),
> [settings](settings.md) (setting names come from the engine).

## What it does

The site speaks English and Hebrew. It follows the browser's languages: the first one the
site speaks wins, else English. To change it by hand, the theme menu (sun/moon button in
the top bar) has a **Language** section under Light/Dark: *Match this device*, English,
עברית. There is no button of its own on purpose: most people never need it (2026-11-11).
Hebrew turns the whole page right to left.

**Setting names, tooltips and their choices stay English**, as the engine gives them
(owner's pick B, 2026-11-11). So do preset, printer and filament names, the engine's own
errors, and G-code.

## Pieces

| Part | Where |
|---|---|
| The words, one file per language, grouped by area (`topbar.prepare`) | `src/i18n/en.json`, `he.json` |
| Library set-up; English built in, another language fetched only when picked | `src/i18n/index.ts` (i18next + react-i18next) |
| TypeScript checks every `t('…')` key against `en.json` | `src/i18n/i18next.d.ts` |
| The choice: browser or picked; sets `<html lang dir>`; kept per browser and in the account | `src/lib/language.ts` |
| Start in the right direction before the app loads | the script in `index.html` |
| The picker | `components/ThemeMenu.tsx` |

## Rules

- **No words in code.** Every word a person sees goes in `en.json` and is shown with
  `const { t } = useTranslation()` then `t('area.key')`, numbers and names as blanks:
  `t('topbar.slicingWith', { name, version })` with `"Slicing with {{name}} {{version}}"`.
  Counts use i18next plurals (`files_one`, `files_other`; Hebrew also `_two`), never
  `n === 1 ? … : …`. Outside React, `i18n.t(…)` from `src/i18n`.
- A word missing from `he.json` shows in English, so a new feature can land in English
  first; add the Hebrew in the same pull request when you can.
- `src/i18n/words.test.ts` fails on a key the code asks for that English lacks, an English
  word no code uses, a Hebrew word English lacks, or a Hebrew word with different
  `{{blanks}}`.
- **Right to left:** CSS uses start/end, not left/right: `margin-inline-start`,
  `padding-inline-end`, `text-align: start`. Positions (`left:`/`right:`) are being
  moved over area by area. The 3D view, the bed, the colour gradients and G-code stay as
  they are. Error details (`pre`) stay left to right.
- Hebrew text the user types on a model (the Text tool) was right to left before this and
  is unrelated ([prepare tools](prepare-tools.md)).

## Why

Pick B (app words only, settings English) halves the work, and desktop Orca has no Hebrew
to reuse anyway (neither OrcaSlicer nor Snapmaker Orca ships one, checked 2026-11-11).
i18next is the most used translation library and handles Hebrew plurals.

## Open holes

- Most screens are still English: they move to `en.json` area by area.
- Positions (`left:`/`right:`) not yet flipped for right to left.
- More languages: add a file and a line in `LANGUAGES`; nothing else changes.
