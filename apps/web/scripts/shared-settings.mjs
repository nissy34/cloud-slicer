#!/usr/bin/env node
// Writes src/lib/shared-settings.json: which settings a user preset shares
// between the two engines, and which system preset of one engine stands in for
// each system preset of the other (src/lib/preset-engines.ts uses both).
//
//   node scripts/shared-settings.mjs           # update the file
//   node scripts/shared-settings.mjs --check   # fail if it is out of date (CI)
//
// Needs both engines (engine/build/engine and engine/build/engine-orca, see the
// README's "Get the engine") and their presets (public/engine*/profiles.json,
// written by `npm run engine`).
//
// A setting is shared when both engines have it with the same type, and it is
// not preset bookkeeping or G-code (each engine keeps its own G-code: Snapmaker's
// U1 start G-code uses variables OrcaSlicer lacks). Snapmaker's flow-variant
// settings (one value per standard / high flow) are shared on their standard
// value; the high flow values stay Snapmaker's.
//
// When the shared list changes (an engine update), the file gets a new version
// and keeps the old lists in `history`, so a preset saved with an older list can
// be moved to the new one (preset-engines.ts, upgradePreset).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, openEngine } from '../../../engine/node/engine.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(web, '../..');
const OUT = join(web, 'src/lib/shared-settings.json');
const check = process.argv.includes('--check');

const ENGINES = {
  snapmaker: { modulePath: join(repo, 'engine/build/engine/orca-engine.js'), profiles: join(web, 'public/engine/profiles.json') },
  orca: { modulePath: join(repo, 'engine/build/engine-orca/orca-engine.js'), profiles: join(web, 'public/engine-orca/profiles.json') },
};

// Same list as src/account/preset-diff.ts META, plus what names a printer model
// or a vendor's own preset ids.
const NOT_SHARED = new Set([
  'name',
  'inherits',
  'from',
  'is_custom_defined',
  'version',
  'setting_id',
  'instantiation',
  'print_settings_id',
  'filament_settings_id',
  'printer_settings_id',
  'compatible_printers',
  'compatible_printers_condition',
  'compatible_prints',
  'compatible_prints_condition',
  'printer_model',
  'printer_variant',
  'printer_technology',
  'default_print_profile',
  'default_filament_profile',
  'upward_compatible_machine',
  'filament_id',
]);
const isGcode = (key) => /(^|_)gcode$/.test(key) || key === 'template_custom_gcode';
const singular = { bools: 'bool', ints: 'int', floats: 'float', percents: 'percent', floatsOrPercents: 'floatOrPercent', strings: 'string', enums: 'enum' };

/** Each engine's options and system presets (every preset that fits each printer). */
async function read(flavor) {
  const { engine } = await openEngine(ENGINES[flavor]);
  const options = JSON.parse(engine.configOptionsJson());
  const printers = JSON.parse(engine.presetsPrinters()).filter((p) => p.system);
  const presets = { printer: Object.fromEntries(printers.map((p) => [p.name, p])), process: {}, filament: {} };
  for (const p of printers) {
    const r = call(engine, 'presetsSelect', JSON.stringify({ printer: p.name }));
    for (const [type, list] of [
      ['process', r.processes],
      ['filament', r.filaments],
    ])
      for (const x of list) if (x.system) (presets[type][x.name] ??= { ...x, printers: [] }).printers.push(p.name);
  }
  return { options, presets };
}

function sharedSettings(snap, orca) {
  const shared = [];
  const flow = {};
  for (const [key, s] of Object.entries(snap)) {
    const o = orca[key];
    if (!o || NOT_SHARED.has(key) || isGcode(key)) continue;
    if (s.flow) {
      if (o.type !== s.type && o.type !== singular[s.type]) continue;
      flow[key] = s.flow;
    } else if (o.type !== s.type) continue;
    shared.push(key);
  }
  return { shared: shared.sort(), flow: Object.fromEntries(Object.entries(flow).sort()) };
}

// ---- matching system presets between the engines --------------------------------

/** "0.20mm Standard @Snapmaker U1 (0.4 nozzle)" -> ["0.20", "standard"]; "Snapmaker PLA Basic" -> ["snapmaker", "pla"]. */
const words = (name) =>
  name
    .replace(/\s@.*$/, '')
    .toLowerCase()
    .replace(/(\d\.\d+)\s*mm\b/g, '$1')
    .split(/[^a-z0-9.+-]+/)
    .filter((w) => w && w !== 'basic');
const overlap = (a, b) => a.filter((w) => b.includes(w)).length - 0.1 * (a.length + b.length - 2 * a.filter((w) => b.includes(w)).length);

function matchPrinter(p, targets) {
  if (targets[p.name]) return p.name;
  const nozzle = parseFloat(p.nozzle);
  let best = null;
  for (const t of Object.values(targets)) {
    const score = (t.model === p.model ? 10 : 0) + (t.vendor === p.vendor ? 5 : 0) - Math.abs(parseFloat(t.nozzle) - nozzle) * 10 + overlap(words(p.name), words(t.name)) * 0.1;
    if (!best || score > best.score) best = { name: t.name, score };
  }
  return best?.name ?? null;
}

/** A process's layer height, as its name says ("0.18 Standard"): a few presets' own value disagrees with it. */
const layer = (p) => parseFloat(/^(\d+\.\d+)/.exec(p.name)?.[1] ?? p.layerHeight);
/** "PETG-GF" -> "PETG". */
const family = (type) => String(type).split('-')[0];

function matchPreset(type, p, targets, printerMap) {
  if (targets[p.name]) return p.name;
  const mine = new Set(p.printers.map((n) => printerMap[n]).filter(Boolean));
  const w = words(p.name);
  let best = null;
  for (const t of Object.values(targets)) {
    const shared = t.printers.filter((n) => mine.has(n)).length;
    let score = shared ? 1000 : 0;
    if (type === 'process') {
      score -= Math.abs(layer(t) - layer(p)) * 1000;
      score += overlap(w.slice(1), words(t.name).slice(1)) * 5;
      if (/standard/i.test(t.name)) score += 0.5;
    } else {
      if (t.filamentType === p.filamentType) score += 500;
      else if (family(t.filamentType) === family(p.filamentType)) score += 250;
      if (t.filamentVendor === p.filamentVendor) score += 50;
      else if (/^generic$/i.test(t.filamentVendor)) score += 60;
      score += overlap(w, words(t.name)) * 10;
    }
    if (!best || score > best.score || (score === best.score && t.name < best.name)) best = { name: t.name, score };
  }
  return best?.name ?? null;
}

/** For each engine pair, the system presets whose stand-in has another name. */
function names(from, to) {
  const out = { printer: {}, process: {}, filament: {} };
  for (const p of Object.values(from.presets.printer)) out.printer[p.name] = matchPrinter(p, to.presets.printer);
  for (const type of ['process', 'filament'])
    for (const p of Object.values(from.presets[type])) out[type][p.name] = matchPreset(type, p, to.presets[type], out.printer);
  for (const type of Object.keys(out))
    out[type] = Object.fromEntries(
      Object.entries(out[type])
        .filter(([a, b]) => b && a !== b)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  return out;
}

// ---- write or check ------------------------------------------------------------

const snap = await read('snapmaker');
const orca = await read('orca');
const { shared, flow } = sharedSettings(snap.options, orca.options);
let current = null;
try {
  current = JSON.parse(readFileSync(OUT, 'utf8'));
} catch {}
const history = current?.history ?? [];
const last = history.at(-1);
const changed = !last || last.shared.join() !== shared.join();
const version = changed ? (last?.version ?? 0) + 1 : last.version;
const next = {
  version,
  shared,
  flow,
  names: { 'snapmaker>orca': names(snap, orca), 'orca>snapmaker': names(orca, snap) },
  history: changed ? [...history, { version, shared }] : history,
};
const text = JSON.stringify(next, null, 1) + '\n';
if (check) {
  if (!current || JSON.stringify(current) !== JSON.stringify(next)) {
    console.error('src/lib/shared-settings.json is out of date: run `node scripts/shared-settings.mjs` in apps/web and commit it.');
    process.exit(1);
  }
  console.log(`shared settings up to date (version ${version}, ${shared.length} shared)`);
} else {
  writeFileSync(OUT, text);
  const counts = Object.entries(next.names['snapmaker>orca']).map(([t, m]) => `${Object.keys(m).length} ${t}`);
  console.log(`version ${version}: ${shared.length} shared (${Object.keys(flow).length} on their standard value); renamed ${counts.join(', ')}`);
}
process.exit(0);
