// Gives a filament a bed temperature on its printers' own default plate when
// its preset leaves it at 0 °C there. OrcaSlicer 2.5's Snapmaker U1 filaments
// inherit 0 °C for the Textured PEI Plate (fdm_filament_common.json), the
// U1's default plate: 2.4.2 sliced them with the bed off, 2.5 refuses them
// ("Textured PEI Plate does not support filament 1"), desktop too. Such a
// filament takes its High Temp Plate temperature, as Snapmaker Orca's own U1
// filaments do (102 of their 110 give both plates the same temperature).
// Remove once upstream's profiles set it.
//
// `files` is bundle-profiles.mjs's map of "<Vendor>/<kind>/<name>.json" -> JSON
// text; `extra` more of them to look up parents in (OrcaFilamentLibrary).
// Changed presets are rewritten in place. Returns the changed paths.

// Desktop's plate names (default_bed_type) and their temperature options.
const PLATE_KEYS = {
  'Cool Plate': 'cool_plate_temp',
  'Engineering Plate': 'eng_plate_temp',
  'High Temp Plate': 'hot_plate_temp',
  'Textured PEI Plate': 'textured_plate_temp',
  'Textured Cool Plate': 'textured_cool_plate_temp',
  'Supertack Plate': 'supertack_plate_temp',
};
const FALLBACK = 'hot_plate_temp';

export function fillPlateTemps(files, extra = {}) {
  const byName = { machine: new Map(), filament: new Map() };
  for (const [path, text] of [...Object.entries(extra), ...Object.entries(files)]) {
    const kind = /^[^/]+\/(machine|filament)\/.+\.json$/.exec(path)?.[1];
    if (!kind) continue;
    try {
      const json = JSON.parse(text);
      if (typeof json?.name === 'string') byName[kind].set(json.name, { path, json });
    } catch {
      // not a preset
    }
  }
  // A setting as the preset ends up with it, through its parents.
  const resolve = (kind, name, key, seen = new Set()) => {
    const entry = byName[kind].get(name);
    if (!entry || seen.has(name)) return undefined;
    seen.add(name);
    return entry.json[key] ?? (entry.json.inherits ? resolve(kind, entry.json.inherits, key, seen) : undefined);
  };
  const hot = (v) => Array.isArray(v) && v.length > 0 && v.every((t) => Number(t) > 0);
  const off = (v) => Array.isArray(v) && v.some((t) => Number(t) === 0);

  const changed = [];
  for (const [name, { path, json }] of byName.filament) {
    if (!(path in files) || json.instantiation === 'false') continue;
    const printers = resolve('filament', name, 'compatible_printers');
    if (!Array.isArray(printers)) continue;
    const plates = new Set(printers.map((p) => resolve('machine', p, 'default_bed_type')).filter((p) => PLATE_KEYS[p] && PLATE_KEYS[p] !== FALLBACK));
    let touched = false;
    for (const plate of plates) {
      const key = PLATE_KEYS[plate];
      for (const [to, from] of [[key, FALLBACK], [`${key}_initial_layer`, `${FALLBACK}_initial_layer`]]) {
        const value = resolve('filament', name, from);
        if (off(resolve('filament', name, to)) && hot(value)) {
          json[to] = value;
          touched = true;
        }
      }
    }
    if (touched) {
      files[path] = JSON.stringify(json, null, 4);
      changed.push(path);
    }
  }
  return changed;
}
