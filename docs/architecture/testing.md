# Testing

> **Read this when** you add or change a test, or need to know which test covers a
> feature. **How CI runs them:** [CI.md](../CI.md). **Pretend printers:**
> [apps/web/test/device/printers](../../apps/web/test/device/printers/README.md).

## Kinds of test

| Kind | Run | Where |
|---|---|---|
| Web unit tests (Vitest), beside each `lib/` and `device/` file | `cd apps/web && npm test` | `src/**/*.test.ts` |
| Engine tests in Node, both engines | `node --test engine/node/engine.test.mjs` | `engine/node/` |
| Does Klipper accept the G-code (batch mode, U1 stand-in and a Voron) | `engine/klipper-check/check.sh` | `engine/klipper-check/` |
| Bridge unit tests | `cd apps/device-bridge && go test ./...` | `*_test.go`, `testdata/` |
| Browser end-to-end (Playwright Chromium, against the built site) | `node test/<name>.mjs` | `apps/web/test/*.mjs` |
| Printer helper tests (not used by the site) | `cd packages/printer && npm test` | `packages/printer/test` |

## Pretend printers

Tests never touch a real printer.

| Printer | Pretend one |
|---|---|
| Snapmaker U1, any Klipper (Moonraker) | `test/device/mock-printer.mjs` (Node mock) |
| Real Klipper with one, two and four heads | Docker (`test/device/printers/`, simulated board), nightly in `klipper.yml` |
| OctoPrint | the real OctoPrint 1.11.8 with its virtual printer (`test/device/printers/octoprint`) |
| Prusa (PrusaLink) | `test/device/mock-prusa.mjs` |
| Elegoo Centauri Carbon | `test/device/mock-elegoo.mjs` |
| Bambu Lab | `apps/device-bridge/internal/fakebambu`, `tools/mock-bambu` |
| Push services | inside `test/device/alerts-live.mjs` (decrypts like a browser) |
| The site, for bridge setup | `test/device/fake-site.mjs`, `setup-relay.mjs` |

## Browser tests

Each feature page lists its tests under **Tests**. The main ones (run against the built
site, `cd apps/web && npm run build` first; see [apps/web/README.md](../../apps/web/README.md#tests)
for the rest):

| Test | Checks |
|---|---|
| `npm run smoke` (`test/smoke.mjs`) | Open Benchy, slice, download the G-code and check it is a real U1 print file |
| `test/startup-matrix.mjs` | The engine starts under other time zones, languages, CPU counts and in stable Chrome |
| `test/presets.mjs` | Save, find, rename and delete your own presets |
| `test/shared-presets.mjs` | A preset saved in Snapmaker Orca shows in OrcaSlicer and back, each engine on its own base |
| `test/preset-files.mjs` | Printer and filament settings windows, preset export and import |
| `test/accounts.mjs` | Sign-in, sessions, synced presets/settings/printers, online projects, AutoSave drafts, Continue on another device, view only, Share to Cloud Slicer (Pages Functions + local D1, mock Google) |
| `test/toolbar.mjs` | The object toolbar: add a model, variable layer height, simplify, brim ears, lay on face, measure, the object menu, parts and modifiers, mesh boolean, text and SVG shapes, assemble, fits a phone |
| `test/layout-fixes.mjs` | Prepare's layout and dialogs: long object and project names shorten with "…", the Paint card fits, closing the Text tool takes back an unchanged new text, preset menus name presets as their dropdowns and open upward near the bottom, Online projects closes with Esc or a click outside, unsaved changes ask in the app's own dialog, the phone's buttons after slicing fit one row |
| `test/mixing.mjs` | Make a colour mix, slice, the G-code alternates between both tools |
| `test/bed.mjs` | A Bambu Lab A1, the U1 and a Prusa MK4 each show their own bed shape and picture, fetched only for that printer, in both engines |
| `test/wipe-tower.mjs` | A two-filament plate shows the prime tower; drag it, and the slice prints it there |
| `test/view-touch.mjs` | Phone 3D view: pinching on a model that fills the screen zooms out instead of moving it; Fit all and the views menu |
| `test/loading.mjs` | The loading screen while the engine starts and a project opens |
| `test/busy.mjs` | The loading screen while Clone with Arrange runs, and every copy landing on the plate |
| `test/preview-views.mjs` | The Preview's colour key: grams and filament changes match the G-code, every view draws its scale, a tapped line type hides and comes back, and on a phone the key sits above the model |
| `test/cancel.mjs` | Cancel stops the slice in the engine, and a change while slicing drops its result |
| `test/plate-switch.mjs` | Picking another plate while one slices shows it at once and keeps the slice; each plate keeps its slice in Prepare and Preview |
| `test/restart.mjs` | After an engine crash (mid-slice or after), the engine restarts and reopens the project |
| `test/heavy.mjs` | A model with over a million triangles offers Simplify, which brings it to about half a million; on a phone the question comes before it is drawn (Cancel, Simplify, Open as is, Don't ask again) |
| `test/device-smoke.mjs` | Device tab through relay and bridge to a mock U1, and direct to a mock Klipper printer |
| `test/device-klipper.mjs` | Device tab on real Klipper and Moonraker (pretend printers in Docker with one, two and four heads): heating, homing, console, a print to the end, skip object, pause, resume, cancel, phone layout, and through the bridge |
| `test/device-alerts.mjs` | Print alerts: the Alerts card's defaults, a test alert, layer N from the Print dialog, a whole mock print pushed through bridge and relay to a pretend push service (decrypted), the open page alerting for a direct printer, turning alerts on again starting from the last-used choices, a tapped alert opening its printer, the iPhone Home Screen note |

## Rules

- Touch drags in tests must move more than 6 px on the first step (long-press wiggle limit).
- Headless Chromium reports notifications as denied even when granted: stub it.
- In a cloud coding sandbox the full Device screen test fails before the camera step
  (an environment limit); CI decides.
