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

```bash
npm ci
npx wrangler dev      # local relay on :8787
npx wrangler deploy   # needs CLOUDFLARE_API_TOKEN with Workers Scripts: Edit
```

CI (`.github/workflows/device.yml`) deploys it from main.
