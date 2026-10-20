// Rebuilds src/device/addons/u1-errors.json, the words for the Snapmaker U1's
// error codes, from Snapmaker Orca's own device page (its Flutter web app keeps
// them as "error_<code>_title" / "error_<code>_desc" in assets/i10n/en.json).
// Snapmaker Orca's deviceError.json is a Bambu leftover the page never reads.
//
//   node scripts/u1-errors.mjs [path/to/en.json]
//
// Defaults to the engine/orcaslicer checkout (git submodule update --init engine/orcaslicer).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = process.argv[2] ?? fileURLToPath(new URL('../../../engine/orcaslicer/resources/web/flutter_web/assets/assets/i10n/en.json', import.meta.url));
const words = JSON.parse(readFileSync(source, 'utf8'));
const titles = [];
const errors = {};
for (const [key, value] of Object.entries(words)) {
  const m = /^error_(\d{16})_(title|desc)$/.exec(key);
  if (!m) continue;
  const e = (errors[m[1]] ??= [-1, '']);
  if (m[2] === 'title') {
    if (!titles.includes(value)) titles.push(value);
    e[0] = titles.indexOf(value);
  } else e[1] = value;
}
const sorted = Object.fromEntries(Object.entries(errors).sort(([a], [b]) => a.localeCompare(b)));
const out = fileURLToPath(new URL('../src/device/addons/u1-errors.json', import.meta.url));
writeFileSync(out, `${JSON.stringify({ source: 'Snapmaker Orca resources/web/flutter_web/assets/assets/i10n/en.json', titles, errors: sorted })}\n`);
console.log(`${Object.keys(sorted).length} error codes, ${titles.length} titles -> ${out}`);
