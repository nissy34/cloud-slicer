# Design system

> **Read this when** you change how anything looks: a colour, text size, spacing, corner,
> shadow, a shared part (button, window, message) or any file in `apps/web/src/styles/`.
> **Related:** [layout and phones](layout.md) (the page frame and phone rules).

How the site looks, and the rules every screen follows. The values live in
[`apps/web/src/styles/tokens.css`](../../apps/web/src/styles/tokens.css); every
part, light and dark side by side, is on the design page: open the site with
`#design` at the end of the address (`/#design`). The design page is not linked
from the app.

`apps/web/src/lib/stylesheets.test.ts` checks the rules it can, so CI fails when
a rule types a value the tokens already name.

## Tokens

| Kind | Tokens | Rule |
| --- | --- | --- |
| Colour | `--bg` `--surface` `--surface-2` `--border` `--text` `--muted` `--accent` `--accent-text` `--ok` `--warn` `--danger`, their `-soft` tints, `-solid` fills, and named colours for things the theme doesn't choose (`--on-colour`, `--media-*`, `--scene-*`) | No colour typed outside `tokens.css`. A new colour is a new token. |
| Text | `--t-xs` 11, `--t-sm` 12, `--t-md` 13, `--t-lg` 15, `--t-xl` 18, `--t-2xl` 22; `--font-sans` (Inter, shipped with the site), `--font-mono` | Weights 400 and 600 only. |
| Spacing | `--s-1` … `--s-8`: 2, 4, 6, 8, 12, 16, 24, 32 px | Gaps in a row 4 to 8, between fields 12, card padding 12 × 16, between cards 12, page edge 16. Older rules still use other values; the test counts them and the count may only go down. |
| Corners | `--r-sm` 4 (tags, swatches), `--r-md` 6 (buttons, fields), `--r-lg` 10 (cards, menus, panels), `--r-xl` 12 (windows, messages), `--r-full` (chips) | Also `0`, `50%` (circles), `inherit`. |
| Shadows | `--shadow-1` lifted, `--shadow-2` menus, `--shadow-3` windows | |
| Layers | `--z-notice` 40, `--z-menu` 50, `--z-context` 60 | Plain numbers up to 10 for stacking inside a part. Windows use the browser's top layer. |
| Controls | `--ctl` 30 px, 40 px on a phone | The height of every button and icon button. |
| Widths | phone up to 760 px (`PHONE` in `src/lib/breakpoints.ts`), narrow phone up to 420 px, tablet steps 1099/1100 and 1279/1280 px | No other `@media` widths. Code uses `PHONE`, never its own number. |

Dark theme: `index.html` and `src/lib/theme.ts` always set `data-theme` on
`<html>`, so dark values are written once, under `[data-theme='dark']`. Any
element can carry `data-theme` to show the other theme inside it.

## Rules

1. **Tokens only.** No colour, text size, corner, shadow or layer typed by hand.
2. **Button or link.** Does something: a button (Quiet when it is small and in a row or card header). Goes to another page: a link. No characters (✕ ⋯ ✎ ⚠ ▾) as icons: use Lucide.
3. **Chip, switch or check box.** Picking among several (filters, materials, which filaments): chips. One thing on or off (Advanced, Keep up, Half width, Level the bed): a switch row, its words after the switch; several of them stack in a `.switch-list`. Picking rows in a long list, and a setting's own box in the settings list: a check box, and only there.
4. **Tabs or chooser.** Changes what you see below: line tabs. Picks one value of 2 to 4 (or a few numbers, like columns): a chooser. More than 4: a dropdown. Status words that can't be tapped: a tag.
5. **Tooltip over text.** Help goes in a tooltip or ⓘ. Text on screen only when it changes what you'd do now.
6. **Every icon button has a tooltip**, with the same words as its label for screen readers, and it works by long-press on a phone.
7. **One red.** Red text for remove and delete; a solid red button only when it can't be undone.
8. **Titles in sentence case**, bold. SMALL CAPITALS only for a small label inside a card.
9. **Phone is one width** (760 px). Taps at least 44 px tall. The page never scrolls.
10. **Same words.** Cancel when a window asks, Close when it only shows, Done for tool panels, Delete when it's gone for good, Remove when it's only taken off a list. "…" only when a window follows.

## Parts

Shared parts and where they live. A screen uses these instead of styling its own.

| Part | Code |
| --- | --- |
| Window | `components/Dialog.tsx`, `styles/windows.css` |
| Message | `components/Notice.tsx`, `components/Notices.tsx` |
| Buttons | `styles/base.css`: Main `.primary` (one per place), Normal `.secondary` (`.ghost` is Normal without its fill, for bars and tool panels), Quiet `.quiet` (blue words on a faint blue box: actions in card headers and rows, such as Arrange, Manage, + Add, Print…, Upload G-code…). Add `.danger` to any of them. An icon goes inside as a Lucide icon at 16 px, before the words. |
| Icon button | `components/IconButton.tsx` (`.icon-btn`): square, `--ctl` high, a Lucide icon, and its label as tooltip and for screen readers. ✕ (close, remove), ⋯ (more), edit, reset |
| Chips | `styles/parts.css`: `.chips` holds them; `.chip` is a `<button aria-pressed>`, or a `<label class="chip">` around a check box (the box is invisible, over the chip). Blue when on. Only for picking among several; a lone on/off is a switch |
| Tags | `styles/parts.css`: `.tag`, grey, or `.ok` `.warn` `.danger` `.accent`. Says how something is (Test, Blocked, the engine); never tappable |
| Switch | `styles/parts.css`: `<input type="checkbox" class="switch" role="switch">`, or `<span class="switch on">` drawn inside a menu row. `.switch-row` is the label with its words |
| Chooser | `styles/parts.css`: `.chooser` around 2 to 4 buttons on a grey track; the picked one (`aria-pressed`, `aria-checked`, `aria-selected`, `.on` or `.active`) is white and bold |
| Field | `styles/parts.css`: every `input`, `select` and `textarea` gets one height (`--ctl`), fill and border at zero specificity, so a screen only sizes or places one. A blue ring while typing. A wrong value: `aria-invalid` turns it red, and a one-line reason goes under it (`.option-note`). A number with a unit: `<span class="input-unit"><input/><span class="unit">mm</span></span>`, the unit inside the box |
| Slider | `components/Slider.tsx` (`.slider`): a thin track that fills in blue up to an 18 px thumb, `--ctl` tall to grab. Layers, cut, paint, mix, brim ears, simplify, Device fans. The mix slider keeps its colour strip as the track |
| Filament swatch | `components/Swatch.tsx` (`.swatch`): a rounded square in the filament's colour, its number inside in black or white, whichever reads (`textOn` in `lib/mixing.ts`, WCAG contrast). `sm` a dot in menus and file rows, `md` with a number, `lg` the filament list. `empty` (class `unloaded`): striped, no filament loaded |
| Line tabs | `styles/parts.css`: `.line-tabs` (role `tablist`) around buttons; the open one (`aria-selected` or `.active`) is underlined in blue. Settings pages |
| Card | `components/Card.tsx` (`.card`): a bordered box, 12 × 16 inside, a bold title in sentence case with its actions on the right as Quiet or icon buttons. Device cards (which add folding), Admin, the manage window's bridges; project tiles use the same box with a smaller edge |
| Section title | `.group h2` in `styles/prepare.css`: the sidebar's sections (Printer, Filament, Process, Objects, Process settings, Slicer engine) are bold sentence case with a muted Lucide icon in front |
| Note | `components/Note.tsx` (`.note`): a sign and words in a tinted box inside the page. Grey information, orange warning, red error (read out at once). A message that comes and goes is a Notice instead; a word or two in a row (Feeder jammed) stays coloured text |
| Empty place | `components/Empty.tsx` (`.empty-place`): an icon, one sentence and at most one main button, centred where the content would be. No printers, no projects, no G-code files, no camera |
| Picker | `components/Picker.tsx`, `styles/parts.css` (`.picker`, `.picker-list`): a button showing the current choice and a chevron, opening the site's own list (never the browser's), placed by Floating UI (`@floating-ui/react`). Choices may carry a colour swatch and the current one has a blue ✓; a line, then actions in the normal text colour with a grey icon in front, words ending in "…" (gear + "Printers & bridges…"). Arrow keys, Escape and a tap outside work. Use it when a list needs actions or swatches; a plain list of values stays a native `<select>`. Its rows are the shared menu rows (`.menu-item`, `.menu-check`, `hr`) that the object menu also uses |
| Icons | [Lucide](https://lucide.dev) (`lucide-react`), line icons at 16 px (20–24 px for tiles). The Device tab names its icons by meaning in `device/ui/icons.tsx`. Orca's own toolbar, view and plate icons stay as they are (`src/assets/`) |

Still to come (picked on the design-system page): menus and pop-overs (on the
Picker's rows), phone tooltips, phone polish, words and motion. Each joins this
table and the design page when it is built.

## Stylesheets

`src/styles/index.css` imports the files in cascade order: tokens first, then
the base, then each area. Later files may override earlier ones (the phone file
comes after the desktop rules it changes), so add a new file where its rules
belong in that order.
