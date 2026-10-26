# Working in this repository

Cloud Slicer: a full OrcaSlicer-like slicer that runs in the browser (desktop and phone),
with accounts, projects and a Device tab for printers. Live at
https://slicer.awesomestuff.qzz.io. Hosted on Cloudflare's free tier only.

## Where to read

Don't read every doc. Start with [docs/README.md](docs/README.md): it explains the layers
and has a table from "the files you are changing" to the one page to read. For the whole
system in one page, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Rules every change follows

- **Never start a print on a real printer.** Tests use pretend printers. "Upload only" is
  fine on a real one; "Upload and print" only with the owner's say-so.
- **Don't build the engine locally.** `node engine/scripts/fetch-engine.mjs` downloads the
  one CI built from the same sources. A change under `engine/` makes CI build it (about
  40 minutes for both engines).
- **D1 migrations only add.** Production and every branch preview share one database:
  never rename or drop a column or table that main still uses.
- **$0 a month.** Cloudflare free tier only. Count what a change costs in Durable Object
  requests, D1 rows and R2 storage ([relay](docs/architecture/relay.md#free-tier-budget)).
- **No telemetry**, no automatic error reports. Errors show with a Copy button.
- **Use Orca's own code and well-known libraries**, not hand-written stand-ins. Settings
  rules come from the engine's option metadata, never one rule per setting.
- **No jargon in the UI.** Write what a person sees ("setup code", "tap"), not how it works.
- **Keep docs in step**: the feature's page in `docs/architecture/` changes in the same
  pull request as the code ([how](docs/README.md#keeping-docs-in-step)).
- Pull request screenshots go on the `pr-screenshots` branch, never on the PR's branch
  ([docs/pr-screenshots.md](docs/pr-screenshots.md)).
