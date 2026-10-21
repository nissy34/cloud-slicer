// Turns on "Exclude objects" (exclude_object) in the system process presets of
// every Klipper printer, so the G-code lists each object and the Device tab can
// skip one mid-print. Orca's default is off and only some vendors turn it on
// (Snapmaker U1 and Voron do; Creality, Qidi, Elegoo, ... don't). People can
// still turn it off: a preset saved with it off keeps that.
//
// `files` is bundle-profiles.mjs's map of "<Vendor>/<kind>/<name>.json" -> JSON
// text; changed presets are rewritten in place. Returns the changed paths.

export function labelObjectsForKlipper(files) {
  const presets = new Map(); // "<vendor>/<kind>" -> Map(name -> { path, json })
  for (const [path, text] of Object.entries(files)) {
    const m = /^([^/]+)\/(machine|process)\/.+\.json$/.exec(path);
    if (!m) continue;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof json?.name !== 'string') continue;
    const group = `${m[1]}/${m[2]}`;
    if (!presets.has(group)) presets.set(group, new Map());
    presets.get(group).set(json.name, { path, json });
  }

  // A key's value after inheritance (Orca: a preset inherits from one parent in its vendor).
  const value = (group, name, key) => {
    const seen = new Set();
    for (let p = group?.get(name); p && !seen.has(p); p = group.get(p.json.inherits)) {
      seen.add(p);
      if (p.json[key] !== undefined) return p.json[key];
    }
    return undefined;
  };

  const changed = [];
  for (const [groupName, processes] of presets) {
    const [vendor, kind] = groupName.split('/');
    if (kind !== 'process') continue;
    const machines = presets.get(`${vendor}/machine`);
    if (!machines) continue;
    const klipper = new Set([...machines.keys()].filter((n) => value(machines, n, 'gcode_flavor') === 'klipper'));
    if (!klipper.size) continue;
    for (const [name, p] of processes) {
      if (p.json.instantiation !== 'true') continue;
      const printers = value(processes, name, 'compatible_printers');
      if (!Array.isArray(printers) || !printers.length || !printers.every((n) => klipper.has(n))) continue;
      if (String(value(processes, name, 'exclude_object') ?? '0') === '1') continue;
      p.json.exclude_object = '1';
      files[p.path] = JSON.stringify(p.json, null, 4);
      changed.push(p.path);
    }
  }
  return changed;
}
