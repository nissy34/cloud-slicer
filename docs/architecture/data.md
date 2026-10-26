# Data

> **Read this when** you add a table or column, store anything new (D1, R2, Durable
> Object, browser), or change what is synced to the account. **Related:**
> [accounts](accounts.md), [projects](projects.md), [relay](relay.md).

Every place the system keeps something, and what for.

## D1 (`cloud-slicer`, binding `DB`)

One database for production **and every branch preview**. Migrations in
`apps/web/migrations`, applied by every deploy.

| Table | Holds | From |
|---|---|---|
| `user`, `session`, `account`, `verification` | Better Auth (plus `role`, `banned`… from its admin plugin) | 0001, 0005 |
| `presets` | User presets: `type`, `name`, `inherits`, `config` (diff), `engines`, `version` | 0001, 0006 |
| `user_settings` | Small JSON values by key (below) | 0001 |
| `devices` | Saved printers and bridges: `url`, `api_key_enc`, `extra` (bridge, relay, kind) | 0001 |
| `projects` | Online project index: R2 keys, size, `version`, `engine`, `draft`, `device`, `device_name`, `plates` | 0004, 0005, 0007, 0009 |
| `project_prints` | Print history records per plate ([print history](print-history.md)) | 0009 |
| `site_settings` | Admin switches (invite only, defaults) | 0005 |
| `allowed_emails` | Invite-only list | 0005 |
| `user_limits` | Per-person storage and bridges overrides | 0005, 0006 |
| `relay_bridges` | Which account uses which bridge (the 3-bridge cap) | 0005 |
| `relay_bridge_info` | Per bridge: relay, turned off, guest use | 0006 |
| `bridge_setup_codes` | Setup codes as SHA-256 only, one use, one hour | 0008 |

Account settings keys (`user_settings.key`): `setup` (wizard choices), `theme`,
`autosave`, `alerts.last` (last alert choices), `device-layout.<printer id>`.

## R2

| Bucket | Binding | Holds |
|---|---|---|
| `cloud-slicer-projects` | `PROJECTS` (site) | Project 3MFs and PNG thumbnails, a new key per save |
| `cloud-slicer-bridge` | `DOWNLOADS` (relay) | Signed bridge builds and installers (`bridge/`), alert pictures (`alerts/`, deleted after a day by a lifecycle rule) |
| `cloud-slicer-bridge-test` | test relay | The same for the [test relay](hosting.md#test-relay) |

## Durable Object storage (relay, one object per bridge)

Hashes of the bridge's keys (`keyHash`, `clientHash`), `owner`, `bridgeId`, `origin`,
`info` (printers, version, where it runs), browser push subscriptions and alert choices
(`push:<hash>`), offline alarm state, `blocked`, `off`, `removed`. Nothing about
alerts or prints is logged.

## The bridge's computer

`~/.cloud-slicer-bridge.json` (mode 0600; on a printer, in `printer_data`): bridge id,
secret key, printers and their API keys or access codes.

## Browser storage (per device, `cloud-slicer:*`)

| Key | Holds |
|---|---|
| `session:v1`, `session:orca:v1` | Preset selection per engine |
| `user-presets:v1`, `user-settings:v1`, `devices:v1` | Signed-out account data, merged at sign-in |
| `engine:v1` | Default engine |
| `open-project:v1`, `continue-dismissed:v1` | Continue card |
| `alerts:v1` | Alert choices for printers reached directly |
| `console-filters:v1`, `printer-active:v1`, `printer-send:v1` | Device tab conveniences |
| `ask-simplify:v1`, `convert:v1` (what to do with a 3MF for a printer we don't have), `font-files:v1`, `theme` | Other per-device choices |
| `device:v1` | This browser's random device id for AutoSave |
| `printers:v1` | Old printer list, moved once into the account store |

## Rules

- **Migrations only add.** Never rename or drop what main uses; previews run against the
  same database. Two migrations share the numbers 0005 and 0006: leave them as they are.
- A new table or setting gets a row here in the same pull request.
- Secrets never go in D1 in plain text: printer API keys are encrypted; setup codes and
  bridge keys are stored as hashes.
