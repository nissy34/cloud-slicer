# Security

> **Read this when** you change anything a stranger could reach or misuse: sign-in,
> tickets, setup codes, keys, allow lists, what the relay passes or stores, uploads.
> **Full threat model, who can see what:**
> [apps/device-relay/SECURITY.md](../../apps/device-relay/SECURITY.md).

## In short

| Secret | Lives | Never |
|---|---|---|
| Printer API keys, access codes | On the bridge's computer; encrypted in D1 for direct printers | Stored by the relay; sent back to a browser |
| Bridge secret key | Bridge computer only | Leaves it. The account keeps a browser key (HMAC of it); the relay keeps hashes |
| Setup codes | D1 as SHA-256, one use, one hour | Stored in plain text |
| Relay ticket key | Pages secret `RELAY_TICKET_KEY`; relay has the public half | Regenerated once made |
| Bridge signing key | GitHub secret `BRIDGE_SIGNING_KEY` | On the relay or R2 |
| Push key | Relay secret `VAPID_KEY` | |

## Rules

- **Allow lists, not deny lists.** The bridge passes only the Moonraker methods the Device
  tab uses, and per brand only listed requests (`allowed.go`). They guard the printer's
  computer (system commands, plugins, firmware), not G-code.
- A browser needs a signed-in, allowed account and a ticket for each bridge; blocking an
  account closes its connections at once.
- The relay sees traffic in plain text (TLS to and from it); it logs nothing about alerts
  or prints.
- Uploads stream through the bridge into the printer; it holds at most 8 MiB in memory.
- Code scanning (CodeQL): the bridge's request-forgery alerts are by design (it exists to
  make requests on the home network); only the owner dismisses alerts.

## Open

Key rotation and end-to-end encryption between browser and bridge
([SECURITY.md](../../apps/device-relay/SECURITY.md)).
