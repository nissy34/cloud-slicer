# Print history

> **Read this when** you change which plates count as printed, "changed since printed",
> the tag line in G-code, or how printers report prints. **Related:**
> [send to printer](send-to-printer.md), [bridge](bridge.md), [plates](plates.md).

## What it does

Remembers which plates of a saved project were printed: marks on plate tabs, "Printed N
of M", and "changed since printed" with what changed. Desktop Orca has nothing like it.

## Pieces

| Part | Where |
|---|---|
| Rules: fingerprints, statuses, what changed | `lib/prints.ts` |
| The open project's records, the printer's word | `state/prints.ts` |
| History window, marks | `components/PrintHistory.tsx`, plate tabs |
| Plate fingerprint (objects, placement, copies, settings, paint) | `engine/src/fingerprint_api.cpp` (`plateFingerprint`) |
| Records API | `functions/_lib/prints.ts` (`/api/projects/<id>/prints`, `/api/prints/*`, `/api/relay/print`) |
| Bridge watch and tag reading | bridge `printjob.go`, relay `prints.ts` |

## How it flows

```mermaid
sequenceDiagram
  participant S as Send window
  participant A as Account (D1 project_prints)
  participant B as Bridge
  participant R as Relay
  S->>A: record (sent / uploaded) with print id
  Note over S: G-code carries "; cloud_slicer_print = project/plate/fingerprint/print id"
  B->>B: print starts: read first 16 KB, find the tag
  B->>R: {ctl:'print', state, tag}
  R->>A: POST /api/relay/print (bridge's browser key as proof)
  A->>A: record by print id → printing → printed / failed / cancelled
```

The tag names the record, so the printer's word lands on the right one in any order,
even for a renamed file or a print started on the printer's screen. Untagged files
(Prusa, Elegoo, Bambu Lab) match a waiting record by printer and file name.

## What it keeps

D1 `project_prints`: plate, status (`uploaded sent printing printed failed cancelled
marked unmarked unknown`), times, duration, progress, printer, file, fingerprint,
summary.

## Rules

- An end counts for a waiting send only if the job fits in the time since the send; an
  end heard again after a bridge restart (`late`) never makes a new record.
- Records waiting for the printer become "no word" (`unknown`) after a week, when the same
  file goes to the same printer again, or when the plate is marked by hand.
- Only settings both engines have are compared, so a newer engine's new settings don't
  make every plate "changed".
- Deleting a plate drops its records and renumbers later ones; Save a copy copies the
  finished ones; deleting the project deletes them.
- Unsaved and signed-out projects have no history.

## Why

- Stored in the account (D1), not the browser, so every device agrees.
- The bridge watches every printer so prints count with no page open ("sturdy" pick).
- A print id in the tag (#183) fixed two records for one print when the bridge heard the
  start before the page recorded the send. A three-table split (files, sends, prints) was
  judged too much for now. See [decisions.md](../decisions.md#print-history).

## Tests

`accounts.mjs`; unit tests `prints.test.ts`; bridge `printjob_test.go`.

## Open

- Untested on a real U1. Harmless edits count as changed; Bambu matches by name only;
  Download is never recorded; reading Bambu tags over FTPS isn't done.
