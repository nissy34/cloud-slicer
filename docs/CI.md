# CI and deploys

Four GitHub Actions workflows: `ci.yml` (engines, site, tests, Pages deploy), `device.yml`
(bridge, relay, Device tab), `klipper.yml` (real Klipper printers, nightly) and
`desktop-orca.yml` (our G-code against the real desktop apps, nightly). None ever
talks to a real printer: tests use pretend printers (a Node mock Moonraker, real Klipper on
a simulated board in Docker, the real OctoPrint's virtual printer, and pretend Prusa, Elegoo
and Bambu Lab printers; see [architecture/testing.md](architecture/testing.md)). The
repository is public, so Actions minutes are free.

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
         │        ├─ desktop-orca (engine PRs)
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
| `desktop-orca` | Pull requests that change the engine, its presets or the desktop check, and runs by hand: slices the test files with our engine and with the real desktop app of the same version, and fails if what gets printed differs ([testing.md](architecture/testing.md#same-as-desktop-orca)) |
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

The jobs after `engine` restore it with `.github/actions/restore-engine`. When many
jobs start at once, GitHub's cache storage sometimes refuses a download ("Egress is
over the account limit"); the action then waits 20 to 40 seconds (random, so the jobs
don't all try again together) and tries once more before failing the job.

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

Runs when the Device tab, the bridge, the relay, or shared top-bar files change (touching
any file in `src/styles/` alone triggers it).

- On every run: the Go bridge's vet, gofmt and tests, and its builds for every Linux
  chip and Windows; relay typecheck, web unit tests and build; then the Device tab end to
  end with the real Linux bridge: the mock U1 through relay and bridge and a mock Klipper
  printer directly (`device-smoke.mjs`), alerts (`device-alerts.mjs`, `alerts-live.mjs`
  with a pretend push service), Arrange, Send (`device-upload.mjs`), page cards, one
  test per brand (Prusa, the real OctoPrint, Elegoo, Bambu Lab), a relay with accounts
  (setup codes, tickets, camera cap, blocking) and a bridge installed on a printer. The
  Windows app is checked on a Windows runner (install, start at sign-in with no window,
  uninstall) and the Mac apps are built and checked on a macOS runner.
- A `where` job decides what a run may deploy. On `main`: the live relay Worker only when
  `apps/device-relay/**` or the install scripts changed, and new bridge builds in R2
  `cloud-slicer-bridge` only when `apps/device-bridge/**` changed (tests, docs and
  `testdata/` don't count), so installed bridges don't update to identical code. Then the
  live relay is checked end to end with the Linux bridge against a mock printer.
- A pull request labelled `use test relay` (one at a time), or a manual run on any other
  branch, deploys both to the test relay instead
  ([architecture/hosting.md](architecture/hosting.md#test-relay)). A manual run on `main`
  deploys the live relay (or the test relay with `target: test`).

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

## Desktop Orca comparison (`.github/workflows/desktop-orca.yml`)

Every night on `main` and by hand (Actions → Desktop Orca comparison → Run workflow): gets
main's engines from the `engine-builds` release, downloads desktop Snapmaker Orca and
OrcaSlicer for Linux of the same versions (cached; `engine/desktop-check/desktop.sh`
checks each download's SHA-256) and runs `engine/desktop-check/check.mjs` for each. The
steps live in `.github/actions/desktop-check`, shared with ci.yml's `desktop-orca` job,
which runs the same check on pull requests that change the engine. About 3 minutes per
engine. The table of results is in the run's summary; on failure every case's files are
the `desktop-check-<flavor>` artifact.

