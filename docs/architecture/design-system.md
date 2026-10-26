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
| Widths | phone up to 760 px (`PHONE` in `src/lib/breakpoints.ts`), narrow phone up to 420 px, tablet steps 1099/1100 and 1279/1280 px | No other `@media` widths. Code uses `PHONE`, never its own number. |

Dark theme: `index.html` and `src/lib/theme.ts` always set `data-theme` on
`<html>`, so dark values are written once, under `[data-theme='dark']`. Any
element can carry `data-theme` to show the other theme inside it.

## Rules

1. **Tokens only.** No colour, text size, corner, shadow or layer typed by hand.
2. **Button or link.** Does something: a button. Goes to another page: a link.
3. **Chip, switch or check box.** One of a set: a chip. One thing that acts at once: a switch. Picking rows in a long list: a check box, and only there.
4. **Tabs or chooser.** Changes what you see: tabs. Picks one value of 2 to 4: a chooser. More than 4: a dropdown.
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
| Buttons | `.primary`, `.secondary`, `.ghost` in `styles/base.css` |

Still to come (picked on the design-system page): Quiet and danger buttons,
icon button, Lucide icons, chips and tags, one switch, tabs and chooser,
fields, slider, filament swatch, card, menu and pop-over, phone tooltips, notes,
empty places. Each joins this table and the design page when it is built.

## Stylesheets

`src/styles/index.css` imports the files in cascade order: tokens first, then
the base, then each area. Later files may override earlier ones (the phone file
comes after the desktop rules it changes), so add a new file where its rules
belong in that order.
