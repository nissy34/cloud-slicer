# Slicing in the background

> **Read this when** you change what happens while a plate slices and the page is not on
> screen: the screen wake lock, the progress in the tab title, or the "Slicing done"
> notification. **Related:** [engine](engine.md) (the worker that slices),
> [print alerts](print-alerts.md) (same notification permission and service worker).

## What it does

- **While a plate slices**, the phone's screen stays on (only while the slicer is on
  screen) and the tab title reads `42% · Slicing · Cloud Slicer`, so the progress shows
  in the tab strip and the phone's app switcher. When the slice ends, cancels or fails,
  the screen may sleep again and the title goes back.
- **A slice that ends while the page is hidden** shows a notification: "Slicing done"
  (naming the plate when the project has more than one), "Slicing failed" with the first
  line of the reason, or "Slicing needs you" when the foreign G-code question is waiting.
  Tapping it brings the slicer tab back. Only when notifications are already allowed
  (for [print alerts](print-alerts.md)); it never asks for permission itself.

## Pieces

| Piece | File |
| --- | --- |
| Title and notification words | `apps/web/src/lib/backgroundSlice.ts` (+ `.test.ts`) |
| Wake lock, title, notification, watching the store's `job` | `apps/web/src/state/backgroundSlice.ts` (imported by `App.tsx`) |
| Tapping the notification | `apps/web/public/sw.js` (`data.slice`) |

## Rules

- The wake lock is taken when `job` becomes `slicing` and the page is visible, taken
  again on `visibilitychange` back to visible (browsers drop it whenever the page is
  hidden), and released when the slice ends. A refused lock (battery saver) is ignored.
- Notify only when the page is hidden at the end, so nobody gets a notification for a
  slice they watched finish.

## Why

The engine already slices in a dedicated Web Worker, so a hidden tab on a computer keeps
slicing at full speed. Android Chrome (and an installed app, which is the same Chrome)
freezes a hidden page, worker included, soon after, and may close it to get its memory
back, so a long slice on a phone only keeps going while the screen is on. A service
worker or Background Fetch can't run the engine (stopped after minutes, no wasm threads),
and slicing on a server isn't free. Keeping the screen awake is the one thing that works.

## Tests

- `lib/backgroundSlice.test.ts`: title and notification words.
- `test/background-slice.mjs` (Chromium, `cancel` CI suite): wake lock held while
  slicing and taken again after the page comes back, title shows progress and comes
  back, no notification while on screen, "Slicing done" when it ends hidden. The wake
  lock, visibility and notifications are stand-ins, since headless Chromium has none.

## Open

- Not tried on a real phone yet: how long Android lets a hidden page run before freezing it.
- A page Android closed mid-slice comes back without the slice (no "slice again" offer).
