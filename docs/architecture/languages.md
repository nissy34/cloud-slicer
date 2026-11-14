# Languages

> **Read this when** you add or change any words the site shows, or anything about
> right-to-left. **Related:** [design system](design-system.md), [layout and phones](layout.md),
> [settings](settings.md) (setting names come from the engine).

## What it does

The site speaks English, Hebrew, and the 22 other languages desktop OrcaSlicer ships
(Català, Čeština, Deutsch, Español, Euskara, Français, Magyar, Italiano, 日本語, 한국어,
Lietuvių, Nederlands, Polski, Português (Brasil), Русский, Svenska, ไทย, Türkçe, Українська,
Tiếng Việt, 简体中文, 繁體中文). It always starts in English; the browser's language is
never used to guess (owner's call, 2026-11-11). To change it, the account menu (the top bar's
Sign in or name button, signed in or not) ends with a **Language** line above Privacy · Terms:
it shows the current language, and a tap opens the list in place, inside the menu (a list
floating over the menu would close it). There is no button of its own on purpose: most people
never need it; inside the theme menu read as odd (2026-11-11).
Hebrew turns the whole page right to left.

The site's own words in the 22 Orca languages are a machine draft (2026-11-14), like the
Hebrew was; people who speak them can correct the files.

**Setting names, tooltips, units, their choices and the settings pages' titles** come from
the engine in English. In the 22 Orca languages the site shows desktop Orca's own
translation of them (`settings/<lang>.json`, taken from Orca's `.po` files), so a setting
reads exactly as on desktop; a setting Orca hasn't translated stays English. In Hebrew they
stay English (owner's pick B, 2026-11-11: desktop has no Hebrew). Settings search matches
both the English and the translated name. Preset, printer and filament names, the engine's
own errors, and G-code stay as they are in every language.

## Pieces

| Part | Where |
|---|---|
| The words: one file per area and language, `en/<area>.json` holding `{ "<area>": { … } }`, used as `t('<area>.<word>')` | `src/i18n/en/`, `src/i18n/he/`, `src/i18n/de/`, … |
| Desktop Orca's setting names per language, keyed by their English words, shown with `settingText()` | `src/i18n/settings/<lang>.json`, written by `scripts/setting-words.mjs` from the engine submodules' `localization/i18n` (upstream first, Snapmaker's for settings only it has); run it again after an engine update |
| Library set-up and the list of languages (`LANGUAGES`); English built in, another language (its words and setting names) fetched only when picked | `src/i18n/index.ts` (i18next + react-i18next) |
| The choice (English unless picked); sets `<html lang dir>`; kept per browser and in the account | `src/lib/language.ts` |
| Start in the right direction before the app loads | the script in `index.html` |
| The picker, and taking the account's choice | `account/AccountMenu.tsx` (`Legal`, `AccountMenu`) |
| Every word file by name: English built in (`en.ts`), each other language as one download (`he.ts`, `de.ts`, …). Named, not `import.meta.glob`, so Node and Pages Functions can bundle them; written by `scripts/word-lists.mjs`, which also counts the words each language still lacks; `words.test.ts` checks none is missing | `src/i18n/<lang>.ts` |
| Device words shared with the relay (no i18next there: it speaks English) | `device/say.ts`, plugged into i18n by `state/device.ts` |
| The AI app add-on (`apps/mcp`) runs the site's printer code in Node: it gets i18next with English only, so its answers are in English | `src/i18n/index.ts` |

## Rules

- **No words in code.** Every word a person sees goes in its area's file in `en/` and is shown with
  `const { t } = useTranslation()` then `t('area.key')`, numbers and names as blanks:
  `t('topbar.slicingWith', { name, version })` with `"Slicing with {{name}} {{version}}"`.
  Counts use i18next plurals (`files_one`, `files_other`; Hebrew also `_two`), never
  `n === 1 ? … : …`. Outside React, `i18n.t(…)` from `src/i18n`. Russian, Polish, Czech,
  Ukrainian and Lithuanian also have `_few` and `_many`; Japanese, Korean, Chinese, Thai and
  Vietnamese only `_other`.
- A setting's words from the engine (label, tooltip, sidetext, enum labels, page and group
  titles) go through `settingText(…)` from `src/i18n` where they are shown; keep the
  English for logic (`project-import.ts` matches page names).
- A word missing from another language shows in English, so a new feature can land in
  English first; add the translations in the same pull request when you can
  (`node scripts/word-lists.mjs --list` names what each language lacks).
- `src/i18n/words.test.ts` fails on a file holding another area's words, a key the code asks for (or keeps in a table) that English lacks, an English
  word no code uses, a translated word English lacks, is empty, or has different
  `{{blanks}}` or `<b>` tags, a language without its folder and list, or an Orca language
  without its setting names.
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

For the Orca languages the setting names are free: the engine's English labels are the
very `msgid`s of desktop's `.po` files, so the site looks them up instead of translating
3,000 settings again, and they match desktop word for word (2026-11-14). The `.po` files
are read with `gettext-parser`, the usual JavaScript `.po` reader. Each language is about
0.5 MB of setting words and 0.2 MB of site words, fetched only when picked.

## Open holes

- Alerts the relay pushes to a phone, and error text from the server or Google, stay
  English: they are made where the reader's language isn't known.
- Undo names and notices are made in the language of the moment; switching language
  leaves earlier ones in the old language.
- Operating system button names quoted in the bridge steps stay English.
- The 22 Orca languages are machine-translated and unreviewed.
- Setting names come only from the strings in the engine's option definitions and
  desktop's settings pages (`PrintConfig.cpp`, `Tab.cpp`); the object-settings categories
  desktop names elsewhere stay English when Orca's pages don't use the same words.
- More languages: add a folder, run `scripts/word-lists.mjs`, and add a line in `LANGUAGES`
  (and a `LOAD` entry).
