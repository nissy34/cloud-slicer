# Cloud Slicer for Claude (MCP server)

Lets Claude slice 3D models on your computer with Cloud Slicer's engines (Snapmaker
Orca 2.4.1 and OrcaSlicer 2.4.2) and their presets. Nothing goes over the internet.
Design and rules: [docs/architecture/mcp.md](../../docs/architecture/mcp.md).

## Build

Needs Node 20 or newer.

```bash
node engine/scripts/fetch-engine.mjs     # from the repository root: both engines, in seconds
cd apps/mcp
npm ci
npm run build                            # dist/: the server and both engines with their presets
npm test                                 # starts the server and slices with it
```

## Use it from Claude Code

```bash
claude mcp add cloud-slicer -- node /full/path/to/cloud-slicer/apps/mcp/dist/server.mjs
```

## Use it from Claude Desktop

Settings → Developer → Edit Config, then add:

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
| `slice` | Writes the G-code (with plate pictures); returns time, grams and metres per slot, layers, warnings |
| `save_project` | Writes a 3MF that the site and desktop OrcaSlicer open |
| `move_object`, `set_copies`, `remove_object`, `arrange_plate`, `auto_orient` | Move, turn, scale, copy, arrange, orient |
