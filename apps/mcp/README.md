# Cloud Slicer for Claude (MCP server)

Lets Claude slice 3D models on your computer with Cloud Slicer's engines (Snapmaker
Orca 2.4.1 and OrcaSlicer 2.5.0) and their presets. Slicing stays on your computer;
signing in to your Cloud Slicer account is optional.
Design and rules: [docs/architecture/mcp.md](../../docs/architecture/mcp.md).

## Install

- **Claude Desktop**: download [cloud-slicer.mcpb](https://github.com/nissy34/cloud-slicer/releases/download/mcp/cloud-slicer.mcpb)
  and open it; Claude Desktop shows an Install button. Nothing else to install.
- **Claude Code** (needs Node 20 or newer):
  ```bash
  claude mcp add cloud-slicer -- npx -y https://github.com/nissy34/cloud-slicer/releases/download/mcp/cloud-slicer-mcp.tgz
  ```

Both links always give the newest version: CI rebuilds them on every change to `main`
(`pack.mjs`, the `mcp` job in `ci.yml`).

## Build

Needs Node 20 or newer.

```bash
node engine/scripts/fetch-engine.mjs     # from the repository root: both engines, in seconds
cd apps/mcp
npm ci
npm run build                            # dist/: the server and both engines with their presets
npm test                                 # starts the server and slices with it
npm run pack                             # release/: cloud-slicer.mcpb and cloud-slicer-mcp.tgz
```

## Use a build from this checkout

Claude Code:

```bash
claude mcp add cloud-slicer -- node /full/path/to/cloud-slicer/apps/mcp/dist/server.mjs
```

Claude Desktop: Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "cloud-slicer": { "command": "node", "args": ["/full/path/to/cloud-slicer/apps/mcp/dist/server.mjs"] }
  }
}
```

Then ask, for example: "Slice ~/Downloads/benchy.stl for the Snapmaker U1 in PETG with 4
walls and tell me the time and grams."

## Tools

| Tool | What it does |
|---|---|
| `open_model` | Opens an STL, 3MF, OBJ or AMF (a 3MF brings its presets and settings); `add` puts it beside what is open; `engine` picks Snapmaker Orca or OrcaSlicer |
| `model_info` | Objects by number, sizes, where each copy is; the chosen presets |
| `find_printers` | Printer presets by brand and model |
| `choose_presets` | Printer, process and filament per slot, colours |
| `list_presets` | Processes and filaments that fit the printer |
| `find_settings`, `read_settings`, `change_settings` | Settings by OrcaSlicer key, checked like the site's settings boxes |
| `set_filament` | Which filament slot prints an object or one of its parts |
| `object_settings` | Settings for one object or part only (what OrcaSlicer's object list offers) |
| `show_plate` | A picture of the plate for Claude to look at |
| `slice` | Writes the G-code (with plate pictures) for one plate or every plate; returns time, grams and metres per slot, layers, warnings |
| `save_project` | Writes a 3MF that the site and desktop OrcaSlicer open |
| `move_object`, `set_copies`, `remove_object`, `arrange_plate`, `auto_orient` | Move (also to another or a new plate), turn, scale, copy, arrange (with desktop's Arrange options), orient |
| `sign_in`, `account`, `sign_out` | Connects your Cloud Slicer account: you open the link it gives (signed in on the site), check the code and tap Connect |
| `printers`, `printer_status`, `printer_files` | Your printers from the site's Device tab: how each is doing, its filaments, its files |
| `printer_camera` | A still picture from each of a printer's cameras (is the plate clear? how is the print going?) |
| `send_to_printer` | Uploads the newest slice; with `print` it starts it, after you say yes (on screen, or in the chat on a phone) |
| `printer_control` | Print a file on it, pause, resume, stop, skip an object, home, move, extrude, heat, fans, light, speed, U1 tool heads. Anything that heats, moves or prints asks you first, every time (on screen, or in the chat on a phone) |
