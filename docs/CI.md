# CI and deploys

Two GitHub Actions workflows. Neither ever talks to a real printer: printer tests run
against a mock Moonraker. The repository is public, so Actions minutes are free.

## `ci.yml`: engine, site, tests, Pages deploy

Runs on every pull request, on pushes to `main`, and by hand.

```
unit ─────────────────────────────────────────────┐
engine ─┬─ engine-tests ──────────────────────────┤
        └─ site ── browser (smoke, startup,       ├─ deploy
                    presets, accounts, toolbar,   │
                    mixing, loading, cancel) ─────┘
```

| Job | Does |
|---|---|
| `unit` | Printer driver tests, web typecheck (app and Functions) and Vitest |
| `engine` | Builds the wasm engine, or skips the build when an engine built from the same sources is cached |
| `engine-tests` | Bundles the presets and runs `engine/node/engine.test.mjs` |
| `site` | Builds the web app with the engine and uploads it as the `web-site` artifact (kept 7 days) |
| `browser` | One job per browser test in `apps/web/test/` (matrix `suite`), against the built site |
| `deploy` | Deploys to Cloudflare Pages, then smoke-tests the deployed site |

### Engine caches

- **Engine output** (`orca-engine.*`), key
  `engine-out-v$ENGINE_CACHE_VERSION-<emsdk>-<orca submodule sha>-<hash of engine/CMakeLists.txt, engine/cmake, engine/compat, engine/patches, engine/src, engine/scripts/build-deps.sh>`.
  A change to tests, presets bundling or `engine/node` doesn't rebuild the engine. Bump
  `ENGINE_CACHE_VERSION` in `ci.yml` when the build itself changes (flags, commands)
  without an engine source change.
- **Dependencies** (`engine/build/deps`), key on the emsdk version and
  `build-deps.sh`. A cold build takes about 40 minutes; downloads from ftp.gnu.org are
  retried because they often time out.
- **ccache** for the engine's own sources, per commit, kept small so it doesn't evict
  the dependency cache (the repository has 10 GB of cache in total).

Typical runs: about 4 to 5 minutes with a cached engine, about 7 with a ccache rebuild.

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

- On every run: bridge unit tests, relay typecheck, web unit tests and build, the
  Device tab end to end (`apps/web/test/device-smoke.mjs`: browser → local relay →
  bridge → mock U1, and direct to a mock Klipper printer), and the bridge apps built
  with Bun, with the Linux app serving the mock U1 through a local relay.
- On `main` only: deploys the relay Worker (one shared Worker, so a PR must never
  deploy it), builds the bridge apps and uploads them to the R2 bucket
  `cloud-slicer-bridge`, then checks the live relay end to end with the script and the
  Linux app against a mock printer.

## When a check fails at once

A job that fails before starting with "recent account payments have failed or your
spending limit needs to be increased" means the account's Actions minutes ran out, not
a workflow bug. Job logs 404 in that case; the reason is in the check run's
annotations.
