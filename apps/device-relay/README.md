# Device relay

A Cloudflare Worker with one Durable Object per bridge, passing messages
between browsers and the bridge agent (`apps/device-bridge`). Websockets
hibernate, so an idle bridge costs nothing; it runs on the free plan.

- `GET /bridge.mjs` serves the agent, with this relay as its default.
- `wss://…/v1/bridges/<id>/agent?key=…` the agent. The first agent to connect
  claims the id; the relay stores only a SHA-256 of the key.
- `wss://…/v1/bridges/<id>/client?key=…&printer=…` a browser.

```bash
npm ci
npx wrangler dev      # local relay on :8787
npx wrangler deploy   # needs CLOUDFLARE_API_TOKEN with Workers Scripts: Edit
```

CI (`.github/workflows/device.yml`) deploys it from main.
