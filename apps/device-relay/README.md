# Device relay

A Cloudflare Worker with one Durable Object per bridge, passing messages
between browsers and the bridge agent (`apps/device-bridge`). Websockets
hibernate, so an idle bridge costs nothing; it runs on the free plan.

- `GET /bridge.mjs` serves the agent, with this relay as its default.
- `GET /downloads.json` lists the one-file bridge apps in R2 (`DOWNLOADS`,
  bucket `cloud-slicer-bridge`, uploaded by CI on main), and
  `GET /download/<windows-x64|mac-arm64|mac-x64|linux-x64|linux-arm64>` serves
  one. Without R2 the list is empty and the Device tab offers `bridge.mjs`.
- `GET /install.sh` is the macOS, Linux and Raspberry Pi installer, with this relay
  filled in.
- `wss://…/v1/bridges/<id>/agent?key=…` the agent, with its secret key. The
  first agent to connect claims the id; the relay stores only a SHA-256 of the
  key, plus one of the browser key derived from it.
- `wss://…/v1/bridges/<id>/client?key=…&printer=…` a browser, with the browser
  key from the pairing code (HMAC-SHA256 of the secret key; it can't connect
  as the agent).
- Per client IP: at most 60 websocket connects and 5 new bridge ids a minute.
- **Accounts**, when the Worker has the secret `RELAY_TICKET_PUBLIC_KEY` (CI's
  `setup-accounts.mjs` sets it): a browser also needs `&ticket=…`, a JWT the site
  signs for one signed-in account and one bridge (`apps/web/functions/_lib/relay.ts`),
  checked in the Worker before the bridge's Durable Object wakes. It lasts an hour;
  the page renews it over the socket (`{"relay":"ticket","ticket":…}`). The ticket
  also carries the account's camera cap (2 at a time). The first account to use a
  bridge owns it; a bridge no account has used within 7 days of its first connect is
  refused, and so is one whose owner is blocked.
- `POST /v1/revoke` (signed by the site): an account was blocked or unblocked; its
  browsers on the listed bridges are closed at once. Orders from the site itself
  (subject `site`) turn whole bridges off or on (`bridgeOff`) or drop signed-out
  browsers (`guests`).
- `GET /v1/info` says whether accounts are on. `RELAY_TEST_PUBLIC_KEY` is CI's
  throwaway key for checking the deployed relay; it only works for `ci-` bridges.

```bash
npm ci
npx wrangler dev      # local relay on :8787
npx wrangler deploy   # needs CLOUDFLARE_API_TOKEN with Workers Scripts: Edit
```

CI (`.github/workflows/device.yml`) deploys it from main.
