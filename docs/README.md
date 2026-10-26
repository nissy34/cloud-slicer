# Docs map

The docs are in layers. Read the top layer, then go down only as far as the task needs.
Nobody, person or AI, needs to read all of them.

| Layer | Read | Size | Holds |
|---|---|---|---|
| 0 | [`AGENTS.md`](../AGENTS.md) | 1 page | The rules every change follows, and where to go next |
| 1 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | 1 page | The whole system: pieces, where data lives, the five main flows |
| 2 | One page in [`architecture/`](architecture/) | 1 page each | One feature: its pieces, flow, data, rules, why, tests, open holes |
| 3 | The part's own README | longer | Commands and protocol detail: [engine](../engine/README.md), [web app](../apps/web/README.md), [bridge](../apps/device-bridge/README.md), [relay](../apps/device-relay/README.md) |
| 4 | The code | | Comments at the top of each file say what it is for |

Also at hand, read only when the task is about them: [features.md](features.md) (everything
the site does, in user words), [decisions.md](decisions.md) (what was
chosen and turned down, and why), [CI.md](CI.md) (workflows, caches, secrets),
[relay SECURITY.md](../apps/device-relay/SECURITY.md) (who can see what),
[pr-screenshots.md](pr-screenshots.md).

## Which feature page?

Find the folder or file you are about to change; read that page first.

| You are changing | Read |
|---|---|
| `engine/` (anything), `apps/web/src/engine/`, `public/engine/engine-worker.js` | [engine](architecture/engine.md) |
| `lib/presets.ts`, `setup.ts`, `preset-files.ts`, `preset-engines.ts`, `printer-catalog.ts`, `bed.ts`, `components/SetupWizard.tsx`, `Bed.tsx`, `account/Preset*` | [presets](architecture/presets.md) |
| `lib/settings-pages.ts`, `option-toggles.ts`, `option-check.ts`, `flow-variants.ts`, `object-settings.ts`, `components/SettingsPanel.tsx`, `OptionField.tsx`, `SettingsPrompt.tsx` | [settings](architecture/settings.md) |
| `lib/project-import.ts`, `engines.ts`, `engine-switch.ts`, `gcode-errors.ts`, `components/ConvertDialog.tsx`, `GcodeFallbackDialog.tsx`, `ProjectMenu.tsx`, `OpenProjectDialog.tsx`, `functions/_lib/projects.ts` | [projects](architecture/projects.md) |
| `lib/autosave.ts`, `share-target.ts`, `state/projects.ts` (saving), `components/ContinueCard.tsx`, `public/sw.js` (share) | [autosave](architecture/autosave.md) |
| `lib/plate-settings.ts`, `clearance.ts`, `wipe-tower.ts`, `plateMenu.ts`, `components/Plate*`, `Clearance.tsx`, `WipeTower.tsx`, `engine/src/plate_api.cpp`, `wipe_tower_api.cpp` | [plates](architecture/plates.md) |
| `src/styles/` (any CSS), `components/DesignPage.tsx`, `Dialog.tsx`, `Notice.tsx`, `IconButton.tsx`, `Slider.tsx`, `Swatch.tsx`, `Card.tsx`, `Note.tsx`, `Empty.tsx`, `device/ui/icons.tsx`, `lib/stylesheets.test.ts`, anything about how it looks | [design system](architecture/design-system.md) |
| `App.tsx`, `components/TopBar.tsx`, `Sidebar.tsx`, `ActionBar.tsx`, `BottomTabs.tsx`, anything about phones (the 760 px width) | [layout and phones](architecture/layout.md) |
| `components/*Panel.tsx`, `Toolbar.tsx`, `ObjectMenu.tsx`, `lib/transform.ts`, `simplify.ts`, `boolean.ts`, `measure.ts`, `brim.ts`, `layers.ts`, the tool files in `engine/src/` | [prepare tools](architecture/prepare-tools.md) |
| `lib/mixing.ts`, `flush.ts`, `components/ColorMixing.tsx`, `FlushVolumes.tsx`, `engine/src/mixed_api.cpp`, `flush_api.cpp` | [colour mixing](architecture/colour-mixing.md) |
| `components/Preview.tsx`, `LayerCodes.tsx`, `lib/gcode.ts`, `preview-colours.ts`, `layerCodes.ts`, `engine/gcode-worker.ts` | [preview](architecture/preview.md) |
| `lib/calibration.ts`, `components/CalibrationDialog.tsx`, `engine/src/calib_api.cpp`, `engine/calib/` | [calibration](architecture/calibration.md) |
| `functions/_lib/auth.ts`, `admin.ts`, `relay.ts` (tickets), `access.ts`, `usage.ts`, `account/`, `state/account.ts`, `components/AdminScreen.tsx` | [accounts](architecture/accounts.md) |
| `apps/web/migrations/`, anything that stores data (D1, R2, Durable Object storage, browser storage) | [data](architecture/data.md) |
| `apps/web/src/device/` (not `link/`), `state/device.ts`, `device/ui/` | [device tab](architecture/device-tab.md) |
| `apps/device-bridge/` (install, setup, update, brands, search) | [bridge](architecture/bridge.md) |
| `apps/device-relay/` | [relay](architecture/relay.md) |
| `device/link/`, `upload.go`, the Send window (`device/ui/PrintDialog.tsx`), file names | [send to printer](architecture/send-to-printer.md) |
| `device/alerts.ts`, `alert-text.ts`, `state/alerts.ts`, `ui/AlertsCard.tsx`, `alerts.go`, `watch.go`, relay `alerts.ts` | [print alerts](architecture/print-alerts.md) |
| `lib/prints.ts`, `state/prints.ts`, `components/PrintHistory.tsx`, `functions/_lib/prints.ts`, `printjob.go`, relay `prints.ts`, `fingerprint_api.cpp` | [print history](architecture/print-history.md) |
| `functions/api/[[path]].ts` (every `/api` route, listed at its top) | the page of the feature the route serves |
| `wrangler.toml` files, domains, the test relay | [hosting](architecture/hosting.md) |
| `.github/`, `apps/web/test/`, `engine/node/`, `engine/klipper-check/` | [CI.md](CI.md) and [testing](architecture/testing.md) |
| Anything a stranger could reach: keys, tickets, allow lists | [security](architecture/security.md) |

## Keeping docs in step

- A pull request that changes how a feature works updates that feature's page in the same
  pull request. A new feature gets a new page, a row in the table above and a line in
  [ARCHITECTURE.md](ARCHITECTURE.md)'s index.
- A choice made with the owner (picked, turned down, parked) goes into
  [decisions.md](decisions.md) with its date.
- Each fact lives in one place. A feature page links to a README or another page rather
  than copying it.
