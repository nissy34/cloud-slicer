# Languages

> **Read this when** you add or change any words the site shows, or anything about
> right-to-left. **Related:** [design system](design-system.md), [layout and phones](layout.md),
> [settings](settings.md) (setting names come from the engine).

## What it does

The site speaks English and Hebrew. It always starts in English; the browser's language is
never used to guess (owner's call, 2026-11-11). To change it, the account menu (the top bar's
Sign in or name button, signed in or not) ends with a **Language** row above Privacy · Terms:
English, עברית. There is no button of its own on purpose: most people
never need it; inside the theme menu read as odd (2026-11-11).
Hebrew turns the whole page right to left.

**Setting names, tooltips and their choices stay English**, as the engine gives them
(owner's pick B, 2026-11-11). So do preset, printer and filament names, the engine's own
errors, and G-code.

## Pieces

| Part | Where |
|---|---|
| The words: one file per area and language, `en/<area>.json` holding `{ "<area>": { … } }`, used as `t('<area>.<word>')` | `src/i18n/en/`, `src/i18n/he/` |
| Library set-up; English built in, another language fetched only when picked | `src/i18n/index.ts` (i18next + react-i18next) |
| The choice (English unless picked); sets `<html lang dir>`; kept per browser and in the account | `src/lib/language.ts` |
| Start in the right direction before the app loads | the script in `index.html` |
| The picker, and taking the account's choice | `account/AccountMenu.tsx` (`Legal`, `AccountMenu`) |
| Every word file by name: English built in (`en.ts`), Hebrew as one download (`he.ts`). Named, not `import.meta.glob`, so Node and Pages Functions can bundle them; `words.test.ts` checks none is missing | `src/i18n/en.ts`, `src/i18n/he.ts` |
| Device words shared with the relay (no i18next there: it speaks English) | `device/say.ts`, plugged into i18n by `state/device.ts` |
| The AI app add-on (`apps/mcp`) runs the site's printer code in Node: it gets i18next with English only, so its answers are in English | `src/i18n/index.ts` |

## Rules

- **No words in code.** Every word a person sees goes in its area's file in `en/` and is shown with
  `const { t } = useTranslation()` then `t('area.key')`, numbers and names as blanks:
  `t('topbar.slicingWith', { name, version })` with `"Slicing with {{name}} {{version}}"`.
  Counts use i18next plurals (`files_one`, `files_other`; Hebrew also `_two`), never
  `n === 1 ? … : …`. Outside React, `i18n.t(…)` from `src/i18n`.
- A word missing from `he/` shows in English, so a new feature can land in English
  first; add the Hebrew in the same pull request when you can.
- `src/i18n/words.test.ts` fails on a file holding another area's words, a key the code asks for (or keeps in a table) that English lacks, an English
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

- Alerts the relay pushes to a phone, and error text from the server or Google, stay
  English: they are made where the reader's language isn't known.
- Undo names and notices are made in the language of the moment; switching language
  leaves earlier ones in the old language.
- Operating system button names quoted in the bridge steps stay English.
- More languages: add a folder, a `<lang>.ts` like `he.ts` (listing every file) and a line in `LANGUAGES`.
