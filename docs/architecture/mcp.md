# Slicing from Claude (MCP server)

> **Read this when** you change `apps/mcp/`, or `engine/node/engine.mjs` (the MCP server
> shares it with the CLI and the engine tests). **Install and tool list:**
> [apps/mcp/README.md](../../apps/mcp/README.md). **Related:** [engine](engine.md),
> [presets](presets.md), [settings](settings.md), [projects](projects.md).

## What it does

A small program on the person's own computer that lets Claude (Claude Code, Claude
Desktop) slice: open a model, choose presets and filament colours, pick which filament
prints each object, change settings (for the plate or one object), move or copy objects
across plates, look at the plate, slice one plate or all, and read the print time and
filament use. It uses the same engines and presets
as the site, running under Node instead of a browser, so a slice from Claude matches a
slice on the site. Slicing never leaves the computer. Signing in is optional: it
connects the person's Cloud Slicer account (see Signing in) for what needs it; nothing
else goes over the internet.

## Pieces

| Part | Where |
|---|---|
| The tools Claude sees (official MCP TypeScript SDK, over stdin/stdout) | `apps/mcp/src/server.ts` |
| One engine, one open project, the chosen presets and changed settings | `apps/mcp/src/slicer.ts` |
| The engine on its own thread, like the site's engine worker | `apps/mcp/src/worker.ts`, `engine-client.ts` |
| Plate pictures without a GPU | `apps/mcp/src/picture.ts` |
| Signing in to the person's account, and calls to the site's `/api` as them | `apps/mcp/src/account.ts` |
| The site's approval window for that sign-in | `apps/web/src/account/LinkProgramDialog.tsx` |
| Their printers: status, files, send, the Device tab's controls | `apps/mcp/src/printers.ts`, with the site's `device/session.ts`, `link/bridge.ts`, `link/direct.ts`, add-ons, `device/print-plan.ts`, `device/saved.ts`, `device/commands.ts` |
| Loading the engine, presets, brands, opening and slicing (shared with `slice.mjs` and the engine tests) | `engine/node/engine.mjs` |
| The site's own rules it reuses | `lib/project-import.ts` (a 3MF's own settings), `lib/presets.ts` (matching filaments), `lib/option-check.ts` (checking typed values), `lib/thumbnail.ts` (picture camera and colours), `lib/format.ts` |
| Build: one bundle plus both engines and their presets | `apps/mcp/build.mjs` → `apps/mcp/dist/` |
| Install files: Claude Desktop extension and `npx` package, on the `mcp` release | `apps/mcp/pack.mjs` → `apps/mcp/release/`; CI job `mcp` publishes on main |

## How it flows

```mermaid
sequenceDiagram
  participant C as Claude
  participant S as server.ts
  participant W as worker.ts (engine thread)
  C->>S: open_model {path}
  S->>W: open (reads the file from disk)
  W-->>S: objects, plates, the file's presets
  S->>W: presetsSelect + the project's own settings (as the site does)
  C->>S: change_settings {wall_loops: 4}
  S->>S: checked like the site's settings boxes
  C->>S: slice {}
  S->>W: previewMesh
  S->>S: draw the plate pictures
  S->>W: sliceWithConfig
  W-->>C: progress
  W-->>S: G-code + time + grams
  S-->>C: file path, print time, grams and metres per slot, warnings
```

- Everything is in Orca's own words: preset names, option keys, values as Orca writes them.
- A 3MF made for a printer the presets have opens with its presets, filaments and own
  settings, like the site. One made for another printer stays on the current printer
  with its filaments matched by material, and Claude is told; the site asks the person
  instead.
- Brands beyond Snapmaker load when a printer of that brand is chosen, like the site.
- The engine runs on its own thread so the server keeps answering (and passes progress
  on) while a slice runs. Calls run one at a time. If the engine stops (out of memory),
  the next call starts a fresh one and says the model must be opened again.

## Installing

Two files on the GitHub release `mcp`, rebuilt on every push to main with the same links,
so a link given out keeps working and always gives the newest: `cloud-slicer.mcpb` (a
Claude Desktop extension: open it, Install; it runs on the Node that Claude Desktop
ships) and `cloud-slicer-mcp.tgz` (`npx -y <link>` for Claude Code and other MCP apps).
Both carry the engines inside (about 11 MB each), so they never depend on CI's
`engine-builds`, which keeps only the newest 15. No npm account, no hosting: $0.

On the site, **Use with an AI app** (`apps/web/src/components/AiAppsDialog.tsx`) shows
how: in the account menu, and in the Project menu too, since the add-on needs no account
and the account menu has no items before signing in. Two choices: **Claude Desktop** (the
`.mcpb` download, open it, Install) and **Other chat apps** (the `mcpServers` settings
with `npx` and the `.tgz` link, with Copy). Chat apps only: coding apps work with the same
line but aren't offered (the README has it). The same window on a phone, which can't run
it but can read how. Named for any AI app, not Claude, because MCP is an open standard.

## Signing in

Better Auth's device authorization plugin (RFC 8628, the "enter this code on your TV"
sign-in), set up in `functions/_lib/auth.ts`:

```mermaid
sequenceDiagram
  participant C as Claude
  participant A as add-on (account.ts)
  participant S as site /api/auth
  participant P as person's browser
  C->>A: sign_in
  A->>S: POST /device/code {client_id: cloud-slicer-mcp}
  S-->>A: code, link (<site>/?user_code=…#link), every 5 s
  A-->>C: "Open the link, check the code, tap Connect"
  P->>S: GET /device?user_code= (claims it for the signed-in account)
  P->>S: POST /device/approve
  A->>S: POST /device/token (in the background, every 5 s)
  S-->>A: a session token of its own
  A->>S: /api/... with Authorization: Bearer <token>
```

- The link opens the site's **Connect an AI app** window: signed out, it asks to sign in
  with Google first; signed in, it shows the account's email and the code, and Connect /
  Don't connect. The setup wizard waits while it is open. A bare `#link` asks for the code.
- No password or Google sign-in passes through the add-on or the AI app. The token is an
  ordinary session (the `bearer` plugin), so it ends on Sign out, Block or Delete like
  any other, and lasts as long as a browser session.
- Only `PROGRAM_CLIENTS` (`cloud-slicer-mcp`) may ask for a code. Codes last 10 minutes;
  expired ones are deleted when the next is asked for, and at most 200 may wait at once
  (`deviceCode` table, [data](data.md)).
- Tools: `sign_in` (the link and code), `account` (who, or still waiting, or why it
  failed), `sign_out` (ends the session on the site too).
- **Their own presets**: signed in, the add-on fetches `/api/presets` (at most once a
  minute while tools are used, and at once after signing in or out) and loads them the
  way the site does (`presetForEngine` / `expandPending` from `lib/preset-engines.ts`,
  then `writeUserPresets` in `engine/node/engine.mjs`, desktop Orca's user preset
  files). A printer of their own loads its base printer's brand first. `find_printers`
  and `list_presets` mark them `yours`. Offline it keeps the last ones it had.
- The site ending the session (Sign out there, Block, Delete) shows on the next call:
  the add-on forgets the sign-in and their presets.

## Their printers

Signed in, the add-on reaches the account's printers (`/api/devices`, each one's key from
`/api/devices/<id>/secret`) the way the Device tab does, with the same code: a printer
behind a bridge through the relay with the site's ticket (`/api/relay/ticket`), one
reached directly over its own address. Node has no WebRTC, so uploads always stream
through the relay (and over plain `fetch` to a direct printer). A connection opens when
a tool needs it and closes a minute after the last use: no streaming in the background.

| Tool | What it does | Asks first |
|---|---|---|
| `printers` | The account's printers | |
| `printer_status` | Printing or not, progress, temperatures, each head's filament, errors | |
| `printer_files` | Files on the printer, newest first | |
| `send_to_printer` | Uploads the newest slice (the `.gcode.3mf` when the printer takes one) or a file; with `print`, starts it with the Send window's own plan (`device/print-plan.ts`: slot per filament, the printer's options, checks, start calls) | `print` only |
| `printer_control` | print a file on it, pause, resume, stop, skip object, home, move, extrude, heat, U1 load / unload / pick / park a head | yes |
| `printer_control` | motors off, heat off, fans, light, speed and flow %, a U1 head's filament type and colour | no |

- **Asking** is MCP elicitation (`askPerson` in `server.ts`): one Accept / Decline message
  on screen, every time, before anything is sent. Decline does nothing. An app without
  elicitation gets an error and nothing that heats, moves or prints happens; upload only
  still works there.
- Refused before asking: a print while the printer prints or isn't ready, a filament with
  no head or slot it can print from (the Send window's checks), moving while it prints, a
  printer whose add-on takes no commands (Bambu Lab: status, files and prints only).

## What it keeps

The sign-in, if any: the site and its token (plus name and email for showing) in
`<config>/cloud-slicer/account.json` (`%APPDATA%`, `~/Library/Application Support` or
`~/.config`), readable only by the computer's user. A token for another site
(`CLOUD_SLICER_SITE`, for tests and previews) is ignored. Nothing else between runs. The G-code (and a `.gcode.3mf` for printers that take one) goes
where Claude says, or beside the model, named by the printer's file name format.

## Rules

- **Reuse, don't copy**: engine calls go through `engine/node/engine.mjs`; preset and
  settings rules are the site's own `lib/` helpers, bundled in by esbuild. A rule the
  MCP needs that the site also has goes in `lib/` and both use it.
- **No new rules per setting**: values are checked from the engine's option descriptions
  (`checkOptionValue`, enum choices), never a list of our own.
- **The plate picture follows the site's**: `picture.ts` uses `thumbnailCamera` and
  `partColour` from `lib/thumbnail.ts` and the same lighting numbers as its shader. A
  change to one changes the other.
- **Never start a print without asking**: "Upload and print", and every control that
  heats, moves, starts, resumes or stops, asks the person on screen every time; an app
  that can't ask never does them.
- **The Device tab's code, not a copy**: printer code the add-on needs moves out of React
  and the page state into plain modules (`device/print-plan.ts`, `device/saved.ts`) that
  both use.
- Tool names and descriptions say what happens in plain words; errors say what to do.

## Why

- **No online add-on** for ChatGPT, Gemini or Claude on the web and phone (2026-11-05):
  they only take add-ons at an internet address, and we don't slice on servers, so it
  would have to hand the slice to the person's open tab: too complicated for what it gives.
- **On the person's computer, not ours**: slicing on a server is turned down (cost), and
  a local program costs nothing and works offline. An online MCP on Cloudflare can't
  slice, so it would only cover account things (later).
- **Its own engine thread**: `sliceWithConfig` blocks the thread it runs on; on the
  server's thread Claude would see no progress and no answers for the whole slice.
- **Pictures drawn on the processor**: Node has no WebGL that three.js still supports
  (headless-gl is WebGL 1 only). Drawing the site's camera, colours and lighting
  triangle by triangle gives the same picture: on the colour Benchy 64 of 90,000 pixels
  differ, all on edges.
- **Both engines in one build**: projects pick an engine on the site, so Claude can too.

## Tests

`apps/mcp/test/mcp.test.mjs` starts the built server the way Claude does (the SDK's own
client over stdin/stdout): open an STL and slice it with pictures and progress, settings
by key (refused, set to nearest, taken back), another brand (Prusa MK4, PETG), a 3MF
project's own presets, move/copies/arrange then save and reopen, filament and settings
per object with the plate picture as an image, every plate at once, OrcaSlicer 2.4.2,
and plain errors. The site's window: `apps/web/test/ai-apps.mjs` (Project menu, both
choices, links, Copy, phone) and the account menu's button in `accounts.mjs`. Signing
in: `accounts.mjs` runs `account.ts` against the real site functions (wrangler, local D1):
approve, turn down, the saved file, expired codes cleared, sign out ends the token, and
the Connect an AI app window in Chromium on desktop and phone. `apps/mcp/test/account.test.mjs`
runs the add-on against a stand-in site: their presets (a Prusa-based printer of their
own too) chosen and their settings in the slice config, fetched once, and gone when the
site ends the session. `apps/mcp/test/printers.test.mjs` uses pretend printers only: a
pretend U1 behind the real bridge (Go) and a local relay, and a pretend Klipper printer
reached directly. Status, upload only, upload and print (no sends nothing, yes starts it
the U1 way, busy is refused), the controls (which ask, which don't, a no sends nothing),
and an app that can't ask. The CI job `mcp` sets up Go and the relay for it. CI job `mcp` builds it with both engines, type-checks, runs the test,
packs the install files and starts the packed one.

## Open

- **Second step, in progress**: sign-in, their presets and printers are done; next
  limits on the site and relay per account so a program can't use up the free tier.
- Not tried on a real printer yet (rule: pretend printers in tests; "Upload only" is fine
  on a real one).
- Site-only extras (per-plate settings, colour mixes chosen on the site) come only from
  a 3MF made there.
