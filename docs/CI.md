# CI and deploys

Two GitHub Actions workflows. Neither ever talks to a real printer: printer tests run
against a mock Moonraker. The repository is public, so Actions minutes are free.

Screenshots for a pull request go on the `pr-screenshots` branch, which runs no CI; see
[pr-screenshots.md](pr-screenshots.md).

## `ci.yml`: engine, site, tests, Pages deploy

Runs on every pull request, on pushes to `main`, and by hand. A change to Markdown files or
`docs/` alone doesn't run it, and a pull request that only changes the bridge or the relay
(`apps/device-bridge`, `apps/device-relay`, `device.yml`) skips every job after `changes`:
the Device workflow tests those.

```
         ┌ unit ──────────────────────────────────────┐
changes ─┤        ┌─ engine-tests ────────────────────┤
         └ engine ┼─ shared-settings ─────────────────┼─ deploy (main)
                  └─ site ─┬─ browser (smoke, ...) ───┘
                           └─ preview (other branches)
```

| Job | Does |
|---|---|
| `changes` | Decides whether the site needs building (always, except for a bridge- or relay-only pull request) |
| `unit` | Printer driver tests, web typecheck (app and Functions) and Vitest |
| `engine` | Builds the wasm engine, or skips the build when an engine built from the same sources is cached, and publishes it (below) |
| `engine-tests` | Bundles the presets, runs `engine/node/engine.test.mjs`, and checks that Klipper accepts sliced G-code (`engine/klipper-check/check.sh`, on a U1 stand-in and a Voron) |
| `site` | Builds the web app with the engine and uploads it as the `web-site` artifact (kept 7 days) |
| `shared-settings` | Checks `apps/web/src/lib/shared-settings.json` is up to date with both engines' presets |
| `browser` | One job per group of browser tests in `apps/web/test/` (matrix `suite`), against the built site. The slow Assemble test (`TOOLBAR_PART=assemble`) and phone gestures with choosing several models (`view-touch.mjs`, `multi-select.mjs`) have jobs of their own |
| `preview` | Every branch but `main`: deploys a preview to Cloudflare Pages as soon as `site` is done, beside the tests, then smoke-tests it |
| `deploy` | `main` only, after every test passed: deploys the live site, smoke-tests it and gives the live relay the site's ticket key |

Both deploy jobs use `.github/actions/deploy-site`. Browser jobs install Playwright's
Chromium through `.github/actions/playwright`: cached, and without `--with-deps`, since
the runner already has Chromium's libraries (that flag only added fonts from an Ubuntu
mirror that sometimes took over 10 minutes). If Chromium doesn't start, the step
installs the system packages after all.

### Engine caches

- **Engine output** (`orca-engine.*`), key `engine-out-<engine key>`. The engine key
  (`engine/scripts/engine-key.mjs`) is
  `v$ENGINE_CACHE_VERSION-<emsdk>-<orca submodule sha>-<hash of engine/CMakeLists.txt, engine/cmake, engine/compat, engine/patches, engine/src, engine/scripts/build-deps.sh>`.
  A change to tests, presets bundling or `engine/node` doesn't rebuild the engine. Bump
  `ENGINE_CACHE_VERSION` in `ci.yml` when the build itself changes (flags, commands)
  without an engine source change.
- **Dependencies** (`engine/build/deps`), key on the emsdk version and
  `build-deps.sh`. A cold build takes about 40 minutes; downloads from ftp.gnu.org are
  retried because they often time out.
- **ccache** for the engine's own sources, per commit, kept small so it doesn't evict
  the dependency cache (the repository has 10 GB of cache in total).

Typical runs: about 6 minutes with a cached engine (a preview is up after about 4),
about 7 more for an engine rebuild with ccache.

### Published engines

The engine job also uploads every engine to one GitHub pre-release,
[`engine-builds`](https://github.com/nissy34/cloud-slicer/releases/tag/engine-builds), as
`engine-<engine key>.tar.gz` (pushes to `main` and pull requests from this repository,
not from forks). `node engine/scripts/fetch-engine.mjs` computes the key of a checkout and
downloads the matching file, so contributors and cloud sessions get the engine in seconds
instead of building it for 40 minutes. A release file because it downloads without
signing in, unlike Actions artifacts and caches. It is not a release of the app. The job
keeps the 15 newest files and anything younger than 30 days, and publishing never fails
a run.

**Keep `main` green.** GitHub lets a branch read only caches saved on its own branch or
on `main`. If `main`'s engine job fails, every new branch rebuilds the dependencies and
the engine from scratch.

### Concurrency and deploys

- A new push to a pull request cancels that PR's older run. Runs on `main` don't wait for
  each other; only their deploys are ordered, and a deploy is skipped when `main` has
  already moved on to a newer commit.
- `main` deploys production (https://slicer.awesomestuff.qzz.io). Every other branch
  deploys a preview at `<branch>.cloud-slicer.pages.dev`, with sign-in working through
  the production host.
- A preview deploys before the tests finish, so a pull request with failing tests still
  gets one, and its D1 migrations are applied. `main` deploys only after every test passed.
- The deploy creates the Pages project the first time, sets up accounts
  (`apps/web/scripts/setup-accounts.mjs`: the D1 database, R2 bucket, sign-in secrets),
  applies D1 migrations (one database for production and previews, so migrations must
  stay additive), then deploys and runs the smoke test against the deployed URL.

### Secrets

| Secret | For |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Pages: Edit; D1: Edit for accounts; Workers R2 Storage: Edit for online projects and bridge downloads; Workers Scripts: Edit for the relay |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in, copied into the Pages project |
| `vars.CF_PAGES_PROJECT` | Optional Pages project name (default `cloud-slicer`) |

`BETTER_AUTH_SECRET` and `ACCOUNT_ENC_KEY` are generated once by the deploy. Without the
Cloudflare secrets CI still builds and tests, and skips deploying. Without D1 or R2
access the site deploys without accounts or without online projects.

## `device.yml`: bridge, relay and Device tab

Runs when the Device tab, the bridge, the relay, or shared top-bar files change.

- On every run: the Go bridge's vet, gofmt and tests, and its builds for every Linux
  chip and Windows; relay typecheck, web unit tests and build; the Device tab end to
  end with the real Linux bridge (`apps/web/test/device-smoke.mjs`: browser → local relay →
  bridge → mock U1, and direct to a mock Klipper printer), and the same bridge serving
  the mock U1 through a local relay (`relay-live.mjs`). The Windows app is checked on a
  Windows runner (install starts it at sign-in with no window, uninstall removes it all)
  and the Mac apps are built on a macOS runner (to ad-hoc sign `Cloud Slicer Bridge.app`).
- On `main` only: deploys the relay Worker (one shared Worker, so a PR must never
  deploy it), gathers the bridge apps from all three runners and uploads them to the R2 bucket
  `cloud-slicer-bridge`, then checks the live relay end to end with the Linux bridge
  against a mock printer.

## When a check fails at once

A job that fails before starting with "recent account payments have failed or your
spending limit needs to be increased" means the account's Actions minutes ran out, not
a workflow bug. Job logs 404 in that case; the reason is in the check run's
annotations.

## Real Klipper printers (`.github/workflows/klipper.yml`)

Three pretend printers in Docker (real Klipper and Moonraker on a simulated board,
`apps/web/test/device/printers`) and `apps/web/test/device-klipper.mjs` driving the Device
tab against them, directly and through the bridge. It takes about 12 minutes, so it is not
part of every pull request: it runs every night on `main`, on a pull request labelled
`real klipper`, on a pull request that changes the pretend printers or that test, and by
hand (Actions → Real Klipper printers → Run workflow). Its screenshots are the
`klipper-screenshots` artifact; on failure the printers' Klipper and Moonraker logs are in
the "Printer logs" step.
