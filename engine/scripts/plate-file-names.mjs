// Puts the plate in the G-code file name of every system process preset:
// "_plate_{plate_number}" right after {input_filename_base} in filename_format
// (e.g. "{input_filename_base}_plate_{plate_number}_{filament_type[0]}_{print_time}.gcode"),
// so the plates of one project don't get the same name on the printer.
// {plate_number} is desktop Orca's own placeholder ("01", "02", ...), so a
// preset or project taken to desktop names its files the same way. People can
// still change it: a preset saved with another format keeps that.
//
// `files` is bundle-profiles.mjs's map of "<Vendor>/<kind>/<name>.json" -> JSON
// text; changed presets are rewritten in place. Returns the changed paths.

// Orca's own default, for a top preset that doesn't set one (PrintConfig.cpp).
const ORCA_DEFAULT = '{input_filename_base}.gcode';
const BASE = '{input_filename_base}';

export function plateInFileNames(files) {
  const changed = [];
  for (const [path, text] of Object.entries(files)) {
    if (!/^[^/]+\/process\/.+\.json$/.test(path)) continue;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof json?.name !== 'string') continue;
    // A preset that inherits one without setting its own gets the parent's.
    const format = json.filename_format ?? (json.inherits ? undefined : ORCA_DEFAULT);
    if (typeof format !== 'string' || /\{\s*plate_(number|name)\b/.test(format) || !format.includes(BASE)) continue;
    json.filename_format = format.replace(BASE, `${BASE}_plate_{plate_number}`);
    files[path] = JSON.stringify(json, null, 4);
    changed.push(path);
  }
  return changed;
}
