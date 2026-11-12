# Accounts, admin and limits

> **Read this when** you change sign-in, what an account saves, the Admin page, per-person
> limits, or relay tickets. **Related:** [data](data.md), [relay](relay.md),
> [security](security.md).

## What it does

Google sign-in keeps presets, setup choices, printers and projects on every device.
Everything works signed out from browser storage and is merged in at sign-in. The site's
owner gets an Admin page: people, block, invite only, online projects per person, bridges, usage.

## Pieces

| Part | Where |
|---|---|
| Sign-in (Better Auth, Google only, oAuthProxy) | `functions/_lib/auth.ts`, `/api/auth/*` |
| Per-user presets, settings, printers | `functions/_lib/userdata.ts`, `presets.ts` |
| Client: same calls signed in or out | `src/state/account.ts`, `src/account/api.ts` |
| Admin page and its API | `components/AdminScreen.tsx`, `account/admin-api.ts`, `functions/_lib/admin.ts`, `access.ts`, `usage.ts` |
| Relay tickets, setup codes, bridge records | `functions/_lib/relay.ts` |
| AI app add-on sign-in (device codes, `Authorization: Bearer` sessions) and its Connect window | `functions/_lib/auth.ts`, `src/account/LinkProgramDialog.tsx`; see [mcp](mcp.md#signing-in) |
| All routes, listed at the top | `functions/api/[[path]].ts` |
| Privacy and terms pages (linked from the account menu; Google needs them to publish the sign-in app) | `public/privacy.html`, `public/terms.html` |

## How it flows

**Sign-in.** Every deploy, previews included, signs in through `AUTH_ORIGIN`
(https://slicer.awesomestuff.qzz.io) with Better Auth's oAuthProxy plugin, so one Google
OAuth client serves them all. The client passes an absolute `callbackURL`.

**Signed out → signed in.** Presets, settings and printers saved in the browser are
merged into the account (setup lists unioned).

**Saving a setting.** `saveUserSetting` shows the new value at once and saves it to the
account behind it; an older reply never overwrites a newer choice, and a failed save
puts the old value back and throws.

**Relay ticket.** A browser asks `/api/relay/ticket` for a bridge; the site signs a JWT
(ES256, one hour, one account and one bridge, with the camera cap) with
`RELAY_TICKET_KEY`; the relay checks it with the public key before waking the bridge's
Durable Object; the page renews it over the socket.

## What it keeps

D1 `user`, `session`, `account`, `verification`, `deviceCode` (Better Auth), `program_use`, `presets`,
`user_settings`, `devices` (API keys AES-GCM encrypted with `ACCOUNT_ENC_KEY`),
`site_settings`, `allowed_emails`, `user_limits`, `relay_bridges`,
`relay_bridge_info`, `bridge_setup_codes`. Details in [data](data.md).

## Rules

- Owners are the emails in the `OWNER_EMAILS` secret; Block and the user list are Better
  Auth's admin plugin; Invite only is a database hook on new accounts and sessions.
- Per account: online projects on or off (on unless the owner turns them off; the files
  are in the person's own Google Drive, so there is no storage to share out), 2 cameras
  at once through the relay (signed into the ticket as `cams`, 8 for owners; see
  [relay](relay.md) for the direct-camera cap).
- Bridges per person: one site number on the Admin page (any whole number from 1, or no limit = -1; 1 when never set,
  kept in `site_settings` 'access' as `bridgesPerPerson`), and a person's own number in
  `user_limits.bridges` (NULL = the site's, -1 = no limit, 0 = none, which closes their bridges at once). The page shows a number box and a No limit switch.
  One bridge reaches every printer on its network, so printers aren't capped: a printer
  is one small row and only bridges cost relay requests. Lowering a number stops new
  bridges; bridges already in use keep working. Owners have no cap.
- A bridge nobody opened for 30 days (`relay_bridges.last_used_at`, `UNUSED_MS`) stops
  counting toward its person's number, so an old install or a dead computer frees its
  place by itself. The Admin page's Bridges list shows each bridge by the name it's saved
  under, with its printers ("Not saved by anyone" = left over), and Remove takes one off
  the list for everyone (`DELETE /api/admin/bridges/<id>`).
- Blocking someone drops their relay connections at once (`POST /v1/revoke`).
- The site's ticket key is made once and never replaced; every live deploy of the site
  and the relay copies the public half from `/api/relay/key`, so they always match.
- Usage today needs the optional read-only `CLOUDFLARE_ANALYTICS_TOKEN`.
- D1 cost per request: Better Auth is built per request, so its schema check is off
  (`validateSchema: false`; it read every table's columns each time, half of all D1
  time) and the owners' ids are looked up only for the Admin page's actions. The session itself is
  cached in a signed cookie for 5 minutes (`cookieCache`), so most requests skip D1;
  Block, Delete and signing out elsewhere reach other open devices within those 5
  minutes (relay connections still drop at once).

## Setup, once

- Google OAuth client (Web application), redirect URI
  `https://slicer.awesomestuff.qzz.io/api/auth/callback/google`; its id and secret as
  repository secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- In the same Google Cloud project: the Google Drive API enabled, `.../auth/drive.file` added
  under Data access (sign-in asks for it, [projects](projects.md)), and the app published
  (Audience → Publish app; home page and `/privacy` on the Branding page). No logo: a logo
  makes Google require a review.
- For Open from Google Drive ([projects](projects.md)): in the same Google Cloud project,
  the Google Picker API enabled and an API key (Credentials → Create credentials → API key)
  limited to websites `https://slicer.awesomestuff.qzz.io/*` and `https://*.cloud-slicer.pages.dev/*`
  and to the Google Picker API, saved as the repository variable `GOOGLE_PICKER_KEY`. CI stores
  it as a Pages secret even though every browser gets it: each deploy replaces Pages' plain
  variables with `wrangler.toml`'s `[vars]`, which would drop it. Without it the menu row is grayed out.
- The owner's Google email(s) as `OWNER_EMAILS` (comma separated).
- The CI token needs "D1: Edit" ([CI.md](../CI.md#secrets)). The site has no R2 bucket:
  project files are in each person's Google Drive.
- CI creates the database, applies migrations, copies secrets to Pages and
  makes `BETTER_AUTH_SECRET`, `ACCOUNT_ENC_KEY` and the relay ticket key pair once.
- Optional: `CLOUDFLARE_ANALYTICS_TOKEN` (the "Read analytics and logs" template) for
  today's request counts on the Admin page.

## Why

- Better Auth over hand-written sign-in (well-known library); Google only, since GitHub
  sign-in was too much setup.
- One database for production and previews so sign-in works on previews.
- The relay ticket key used to be regenerated by preview deploys, which broke new bridges
  on the live relay (#123). See [decisions.md](../decisions.md#accounts-and-limits).

## Tests

`accounts.mjs` (local Pages Functions + D1, mock Google; needs
`NO_PROXY=localhost,127.0.0.1` behind a proxy); unit tests in `src/account/`.

## Open

- The site spends a setup code before the relay confirms the claim, so a failed claim
  leaves a bridge entry to remove by hand.
