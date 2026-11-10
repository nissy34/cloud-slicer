# Snapmaker preset packs

`snapmaker/` holds Snapmaker's latest preset pack: `pack.json` and the pack's preset
files that differ from the engine's (`engine/orcaslicer/resources/profiles`). Made by
`node engine/scripts/snapmaker-presets.mjs update`, normally from the weekly
`.github/workflows/presets.yml`; don't edit the files by hand. Delete the folder once the
engine itself ships this version or a newer one (preset bundling then fails and says so).
See [docs/architecture/presets.md](../../docs/architecture/presets.md#snapmaker-preset-packs).
