# Device relay

Design, rules and why: [docs/architecture/relay.md](../../docs/architecture/relay.md). This page has the commands and the protocol detail.

A Cloudflare Worker with one Durable Object per bridge, passing messages
between browsers and the bridge agent (`apps/device-bridge`). Websockets
hibernate, so an idle bridge costs nothing; it runs on the free plan.

- `GET /downloads.json` lists the one-file bridge apps in R2 (`DOWNLOADS`,
  bucket `cloud-slicer-bridge`, uploaded by CI on main), and
  `GET /download/<windows-x64|mac-arm64|mac-x64|linux-x64|linux-arm64|linux-armv7|linux-mipsle>`
  serves one. Without R2 the list is empty and the Device tab says the bridge
  isn't available yet.
- `GET /install.sh` is the macOS, Linux and Raspberry Pi installer, `GET /install.ps1`
  and `GET /install.cmd` the Windows ones (PowerShell, Command Prompt), with this
  relay and the `?code=` setup code filled in.
- `POST /v1/bridges/<id>/claim` `{key, code, host, system, place}`: a bridge joins an
  account with a setup code. The relay asks the site (`SITE_ORIGIN`,
  `/api/relay/claim`), which spends the code and saves the bridge in the account,
  checks the site's signed answer, and stores the key hashes and the owner. CI's
  check of the deployed relay brings `{claim}` signed with its test key instead,
  for a `ci-` bridge only.
- `wss://…/v1/bridges/<id>/agent?key=…` the agent, with its secret key. The
  first agent to connect claims the id; the relay stores only a SHA-256 of the
  key, plus one of the browser key derived from it.
- `wss://…/v1/bridges/<id>/client?key=…&printer=…` a browser, with the browser
  key from the pairing code (HMAC-SHA256 of the secret key; it can't connect
  as the agent).
- Per client IP: at most 60 websocket connects and 5 new bridge ids a minute.
- **Accounts**, when the Worker has the secret `RELAY_TICKET_PUBLIC_KEY` (CI's
  `setup-accounts.mjs` makes the key pair once; every deploy of the live site and of the live relay copies it from
  the site's `/api/relay/key`, so it always matches the key the site signs with): a browser also needs `&ticket=…`, a JWT the site
  signs for one signed-in account and one bridge (`apps/web/functions/_lib/relay.ts`),
  checked in the Worker before the bridge's Durable Object wakes. It lasts an hour;
  the page renews it over the socket (`{"relay":"ticket","ticket":…}`). The ticket
  also carries the account's camera cap (2 at a time). A bridge connects only once it
  has joined an account with a setup code (above), and that account owns it; one
  whose owner is blocked is refused.
- `POST /v1/revoke` (signed by the site): an account was blocked or unblocked; its
  browsers on the listed bridges are closed at once. Orders from the site itself
  (subject `site`) turn whole bridges off or on (`bridgeOff`).
- **Print alerts**, when the Worker has the secret `VAPID_KEY` (an ES256 private
  JWK that CI makes once, `.github/workflows/device.yml`): a browser sends the
  JSON-RPC call `relay.alerts` over its socket (`op` `get`, `set` with its push
  subscription and choices, or `test`), answered by the relay itself, even with
  the bridge offline. The bridge's Durable Object keeps each browser's push
  address and choices per printer (at most 20 browsers per bridge), tells the
  agent what to watch for (`{ctl:'alerts', printers}`, on every hello and
  change), and turns the agent's `{ctl:'alert', printer, event, …}` into Web Push
  (the `web-push` library: RFC 8291 encryption, VAPID signature) to every
  browser that wants it, worded in `apps/web/src/device/alert-text.ts`. U1 error
  codes are put in Snapmaker's words from the Device tab's list
  (`apps/web/src/device/addons/u1-errors.json`, bundled). A browser sends its time
  zone and 12/24 h clock (`clock`) with `set` and `get`, so "done about 14:35" is
  in its own time; without one the alert leaves the clock time out. Push addresses must belong to a browser push service
  (Google, Mozilla, Apple, Microsoft). A camera picture sent with an alert waits
  in R2 under `alerts/` (served at `/v1/pictures/<random>.jpg`) until the
  bucket's one-day lifecycle rule deletes it. "The bridge goes offline" is a
  Durable Object alarm 10 minutes after the agent drops. Nothing about alerts is
  logged. At most 120 alerts and 30 pictures per bridge an hour.
- **Print history** (`src/prints.ts`): the agent says when a print starts or
  ends on any of its printers (`{ctl:'print', printer, file, state, tag, …}`),
  and the relay passes it to the bridge's account with `POST /api/relay/print`
  on the site, with the bridge's owner and browser key as proof (the site
  checks the key against the bridge saved in that account, as for a release).
  The browser key comes from the agent's own key when it connects and stays with
  its socket only. Only with accounts; at most 120 an hour per bridge.
- `GET /v1/info` says whether accounts are on, and gives the public push key (`push`). `RELAY_TEST_PUBLIC_KEY` is CI's
  throwaway key for checking the deployed relay; it only works for `ci-` bridges.

```bash
npm ci
npx wrangler dev      # local relay on :8787
npx wrangler deploy   # needs CLOUDFLARE_API_TOKEN with Workers Scripts: Edit
```

CI (`.github/workflows/device.yml`) deploys it from main.
