// Rebuilds src/device/addons/bambu-errors.json, the words for Bambu Lab
// printers' error codes, from the lists OrcaSlicer ships for them
// (resources/hms/hms_en_<model>.json, Bambu's own texts for the printers'
// "HMS" health messages and their print errors). Each file is one printer
// family; most codes mean the same on every printer, so they are merged, the
// single-nozzle printers' words first (the dual-nozzle H2D's often name a nozzle).
//
//   node scripts/bambu-errors.mjs [path/to/resources/hms]
//
// Defaults to the engine/orcaslicer-upstream checkout (git submodule update --init engine/orcaslicer-upstream).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? fileURLToPath(new URL('../../../engine/orcaslicer-upstream/resources/hms', import.meta.url));
const files = readdirSync(dir).filter((f) => /^hms_en_\w+\.json$/.test(f));
// Single-nozzle families first: their words fit every other printer too.
const nozzles = (f) => {
  const all = JSON.parse(readFileSync(join(dir, f), 'utf8')).data.device_hms.en.map((e) => e.intro).join(' ');
  return (all.match(/\b(left|right) (hot ?end|nozzle)\b/gi) ?? []).length;
};
const ordered = files.map((f) => [f, nozzles(f)]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
const hms = {};
const error = {};
for (const [f] of ordered) {
  const { data } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const [kind, out] of [['device_hms', hms], ['device_error', error]])
    for (const e of data[kind]?.en ?? []) {
      const code = String(e.ecode ?? '').toUpperCase();
      const text = String(e.intro ?? '').trim();
      if (/^[0-9A-F]+$/.test(code) && text && !(code in out)) out[code] = text;
    }
}
const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const out = fileURLToPath(new URL('../src/device/addons/bambu-errors.json', import.meta.url));
writeFileSync(out, `${JSON.stringify({ source: `OrcaSlicer resources/hms (${ordered.map(([f]) => f).join(', ')})`, hms: sort(hms), error: sort(error) })}\n`);
console.log(`${Object.keys(hms).length} HMS codes, ${Object.keys(error).length} print errors -> ${out}`);
