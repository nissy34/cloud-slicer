# Hosting

> **Read this when** you change where something runs, its address, its Cloudflare
> settings, or how relay and bridge changes are tried before merging. **CI jobs, caches
> and secrets:** [CI.md](../CI.md). **Related:** [relay](relay.md), [data](data.md).

## What runs where

| What | Cloudflare | Address | Deployed by |
|---|---|---|---|
| Site and `/api` Functions | Pages project `cloud-slicer` | https://slicer.awesomestuff.qzz.io (main) | `ci.yml` deploy, after every test passed |
| Branch previews | same Pages project | `<branch>.cloud-slicer.pages.dev` | `ci.yml` preview, as soon as the site is built |
| D1 `cloud-slicer`, R2 `cloud-slicer-projects` | | | created by `scripts/setup-accounts.mjs` on deploy |
| Relay | Worker `cloud-slicer-relay` | https://cloud-slicer-relay.awesomestuff.qzz.io (also its first `cloud-slicer-relay.nissy34.workers.dev`, kept for good) | `device.yml`, main only, only when relay files changed |
| Bridge builds | R2 `cloud-slicer-bridge` | served by the relay | `device.yml`, main only, only when bridge files changed |
| Test relay | Worker `cloud-slicer-relay-test`, R2 `cloud-slicer-bridge-test` | https://cloud-slicer-relay-test.awesomestuff.qzz.io | label `use test relay` on a PR, or a manual Device run on a branch |

Custom domains are added once in the Cloudflare dashboard, not in `wrangler.toml`, so the
CI token needs no zone rights.

## Rules

- Links shown to users use the site's own origin or https://slicer.awesomestuff.qzz.io,
  never `*.pages.dev`.
- Every deploy signs in through the production host (see [accounts](accounts.md)).
- The site always sends cross-origin isolation headers (COOP/COEP, `public/_headers`),
  which the engine's threads need.
- Saved bridges and printers on the old relay address move to the new one by themselves
  (`movedRelays` in the bridge, `currentRelay` on the site).
- A pull request never deploys the live relay. A manual Device workflow run deploys the
  test relay from a branch, and the live relay only from `main`.

## Test relay

Add the label `use test relay` to **one** pull request at a time: its relay goes to the
test relay, its bridges to that relay's downloads, and branch previews set up new bridges
there, shown with a **Test** tag. A test bridge ("Cloud Slicer Bridge (test)",
`FLAVOR=test`) installs beside the real one and updates only from the test relay. The
test relay keeps whatever was sent last (no reset on merge).

The label only starts `device.yml` when the pull request changes a path that workflow
watches (bridge, relay, `src/device/`, and the rest listed at the top of `device.yml`).
For any other pull request, run the Device workflow by hand on the branch: a branch run
always goes to the test relay.

Trying a change on a preview writes to the **production** database: a new migration and
anything you set there (limits, projects) is live at once.

## Why

Cloudflare's free tier is the only budget; previews share production's D1 so sign-in
works on them. See [decisions.md](../decisions.md#hosting-and-ci).
