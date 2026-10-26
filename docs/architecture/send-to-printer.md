# Send to printer

> **Read this when** you change Download or Send, the Send window, uploads through the
> bridge, or G-code file names. **Related:** [device tab](device-tab.md),
> [bridge](bridge.md), [print history](print-history.md) (the tag line).

## What it does

Sends a sliced plate to a printer: "Upload only" or "Upload and print", fast at home and
still working away from home or on a VPN.

## Pieces

| Part | Where |
|---|---|
| Hand-off from the slicer | `useDevice.getState().requestSend(blob, name, preset)` in `state/device.ts` |
| Send window: printer, tool or AMS mapping, options | `device/ui/PrintDialog.tsx`, `device/slots.ts`, `lib/filament-limit.ts` |
| Upload (zip, direct link, relay stream) | `device/link/upload.ts`, bridge `upload.go` |
| File name from the preset's Filename format | engine `sliceWithConfig` → `result.fileName` |
| `.gcode.3mf` for Bambu Lab and `use_3mf` printers | engine `result.gcode3mfPath` |

## How it flows

```mermaid
flowchart TD
  z["Zip the G-code (4-5x smaller)"] --> cam{"Camera direct link open?"}
  cam -->|yes| ride["Send over it (channel upload:id)"]
  cam -->|no| own["Open own WebRTC link (5 s)"]
  own -->|bytes flow| direct["Direct to the bridge"]
  own -->|"blocked, or no bytes for 15 s"| relay["Stream through the relay<br/>256 KiB pieces, at most 8 MiB unanswered"]
  ride --> unzip
  direct --> unzip
  relay --> unzip["Bridge unzips as bytes arrive<br/>into the printer"]
```

The bar says what is happening: Zipping… / Opening a direct link… / "N% through the relay".
Cancel stops the printer's request even after the last byte.

## Rules

- Never start a print in tests on a real printer: "Upload only" there.
- A U1 maps each filament to a head when sending (several filaments per head allowed:
  `SET_PRINT_EXTRUDER_MAP`). A Bambu Lab printer gets a `.gcode.3mf` and picks an AMS
  slot per filament (same type, closest colour). Other printers print filament n from
  slot n.
- Send and Download put the print-history tag line after Orca's header.
- G-code is named by the process preset's Filename format; shipped presets include
  `_plate_{plate_number}`.

## Why

- Plain HTTP upload through the relay and a check for an existing file with the same
  name were both turned down. See [decisions.md](../decisions.md#bridge-and-relay).
- Relay pieces, in two steps. First (#161) "several pieces in flight" was turned down as
  too complicated ("why not just a big chunk"): 8 MiB pieces, one at a time. Then (#172)
  the bar jumped 0 → 100 % and a VPN user saw it stuck, so it now streams 256 KiB pieces
  back to back with at most 8 MiB unanswered. A bridge from before #172 still gets 8 MiB
  pieces one at a time.
- The upload's own direct link has 5 s to open and is then dropped only when it carries
  **nothing** for 15 s (`DIRECT_STALL_MS`); a slow but moving direct link (one routed
  over a VPN, say) is kept. Direct links use STUN only, no TURN.
- The bridge answers a relay piece once Moonraker has taken it (the write into the
  upload request blocks), so the printer's own speed sets the pace.
- The free-tier budget counts each relay piece as an incoming message (20 to 1, see
  [relay](relay.md#free-tier-budget)): a 40 MB zipped file is about 160 pieces.

## Tests

`device-upload.mjs` (direct and relay only), `device-smoke.mjs`; bridge `upload_test.go`.

## Open

- The VPN case (camera fell back, so direct is skipped) has no end-to-end test.
