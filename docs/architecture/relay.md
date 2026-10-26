# Relay

> **Read this when** you change the relay Worker, its messages, limits, alerts or print
> reports, or anything that sends more messages through it. **Routes in detail:**
> [apps/device-relay/README.md](../../apps/device-relay/README.md). **Related:**
> [bridge](bridge.md), [security](security.md), [hosting](hosting.md).

## What it does

A Cloudflare Worker with one Durable Object per bridge, passing messages between the
browsers watching that bridge's printers and the bridge itself. It also serves bridge
downloads and installers, sends print alerts, and passes print reports to the site.

## Pieces

| Part | Where (`apps/device-relay/src/`) |
|---|---|
| Routes, the `Bridge` Durable Object, tickets, claims, releases | `index.ts` |
| Print alerts and Web Push | `alerts.ts` |
| Print reports to the site | `prints.ts` |
| Holder page for printer pages | `page-shell.ts` |

## How it flows

```
browser  --text-->  relay  --{c, m: text}-->  bridge  --> printer
browser  <--text--  relay  <--{c, m: text}--  bridge
```

- Browsers speak Moonraker JSON-RPC; the relay wraps each message with the browser's
  number `c`. Control messages: bridge → relay `hello`, `drop`, `alert`, `print`;
  relay → bridge `open`, `close`, `alerts`.
- A browser needs a ticket from the site ([accounts](accounts.md#how-it-flows)),
  checked in the Worker before the Durable Object wakes.
- Sockets hibernate, so an idle bridge costs nothing.

## Free tier budget

Durable Object **requests** are the tight limit (100,000 a day; incoming WebSocket
messages count 20 to 1, outgoing are free). Estimated ceiling: about 75 daily bridge
users (4 hours of status and 1 hour of camera each).

- Status is merged to at most one message a second, only while a browser watches.
- Cameras and uploads go over a direct WebRTC link; only when that is blocked does a
  camera fall back to one picture a second through the relay.
- Rate limits: 60 connects and 5 new bridge ids a minute per IP; 20 alert browsers,
  120 alerts and 30 pictures an hour per bridge; 120 print reports an hour per bridge.
- Cameras through the relay (pictures, `bridge.snapshot`): at most the ticket's `cams`
  per account at once (2, the owner 8; checked in `cameraRefusal`). Direct WebRTC cameras
  are capped by the bridge instead: 4 per browser (`maxDirectCameras`, `camera.go`).
- Over a limit, that kind of request fails until midnight UTC.

## Rules

- Count the messages a change adds before adding it.
- The relay deploys only from main (or to the [test relay](hosting.md#test-relay)).
- Keep `workers_dev` on for good: old bridges and printer pages use the
  `*.workers.dev` address.
- Addresses given out (install lines, alert pictures) always use `RELAY_ORIGIN`.

## Why

- A relay because a public https page can't reach `http://192.168.x.x` (mixed content,
  private-network blocking, no route in).
- One Durable Object per bridge so each bridge's sockets live together and hibernate.
  See [decisions.md](../decisions.md#bridge-and-relay).

## Tests

`relay-live.mjs` (live check after deploy), `device-smoke.mjs`, `alerts-live.mjs`.
