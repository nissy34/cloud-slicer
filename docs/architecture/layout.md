# Layout and phones

> **Read this when** you change the page's frame (top bar, sidebar, Slice bar, bottom
> tabs) or anything about how the site behaves on a phone. **Colours, sizes and parts:**
> [design system](design-system.md). **Related:** [prepare tools](prepare-tools.md) (tool cards),
> [device tab](device-tab.md) (its own card layout).

## What it does

One responsive site for desktop and phone; no separate phone app. Below **760 px** wide
the same screens rearrange for a phone.

## Pieces

| Part | Where |
|---|---|
| The frame: top bar, sidebar, 3D view or Preview, Slice bar, Device tab, bottom tabs | `src/App.tsx` |
| Top bar (project name, Prepare / Preview / Device tabs on desktop, menus) | `components/TopBar.tsx` (`TABS`) |
| Settings sidebar | `components/Sidebar.tsx` |
| Slice bar: Download / Send / Slice plate | `components/ActionBar.tsx` |
| Phone tabs at the bottom, with the print's % or a red dot on Device | `components/BottomTabs.tsx` |
| Phone width | `PHONE` in `src/lib/breakpoints.ts`, used by code (`components/Toolbar.tsx`, `device/ui/Arrange.tsx`, `device/ui/WorksWith.tsx`); `@media (max-width: 760px)` in `src/styles/*.css` (mostly `phone.css`), checked by `lib/stylesheets.test.ts` |

## Rules

- **760 px** is the one phone width. Use the same media query everywhere; don't add a
  new breakpoint for one screen.
- The phone layout never scrolls as a page; the toolbar is always visible.
- An open tool stacks the toolbar, its card (at most half the screen) and the model; the
  settings hide until Done ([prepare tools](prepare-tools.md)).
- On a phone Prepare, Preview and Device are tabs at the bottom, under the Slice bar;
  desktop keeps them in the top bar.
- The Slice bar shows Download, Send and Slice plate. Slice plate greys out once the plate
  is sliced and comes back after a change (desktop too).
- Hints say "tap" on touch screens; `title=` tooltips don't show on a phone, so nothing
  important may live only in one.
- Pop-ups are centred windows on a phone too, not bottom sheets, and don't close on an
  outside tap.
- Touch: a drag must move more than 6 px before it counts (long-press wiggle limit); two
  fingers always zoom the 3D view.
- Big models: phones ask to simplify a plate over 1M triangles before drawing it
  ([prepare tools](prepare-tools.md#big-models)).

## Why

Phones slice fine in the browser, so a separate phone UI was dropped (2026-10-18). The
bottom tabs came from a cramped phone top bar (2026-10-26). See
[decisions.md](../decisions.md#working-rules).

## Tests

`toolbar.mjs` (fits a phone; tab bar at the bottom edge), `layout-fixes.mjs` (the phone's
buttons after slicing fit one row), `view-touch.mjs`, `preview-views.mjs` (the colour key
above the model on a phone), `heavy.mjs`.
