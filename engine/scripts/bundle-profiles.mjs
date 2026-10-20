#!/usr/bin/env node
// Packs the system presets the engine loads, one file per printer brand.
//
//   node engine/scripts/bundle-profiles.mjs <out-dir> [vendor ...]
//
// Writes, with paths relative to Orca's system preset folder (e.g. "Snapmaker.json",
// "Snapmaker/machine/fdm_U1.json"):
//   <out-dir>/profiles.json             the presets loaded at start-up: the start-up
//                                       vendors (default Snapmaker) and OrcaFilamentLibrary,
//                                       which vendor filaments inherit from as in desktop Orca.
//                                       { version, vendors, files: { "<path>": "<json text>" } }
//   <out-dir>/profiles/<vendor>.json    every other brand, the same shape, fetched by the
//                                       page only when a printer of that brand is needed
//                                       (engine-worker.js `vendors`)
//   <out-dir>/profiles/catalog.json     every brand's printer models for the setup wizard
//                                       and printer picker, without loading any of them:
//                                       { vendors: [{ id, name, file, bytes, models: [{ model,
//                                       cover, send, nozzles: [{ name, nozzle }] }] }] }
//                                       send: the printer runs Klipper (G-code flavor), so the
//                                       Device tab can send to it through Moonraker.
//   <out-dir>/profiles/covers/...       each model's picture, shown in the wizard
// The page writes each file under <dataDir>/system/ in the wasm FS and calls
// presetsLoad(dataDir). The start-up vendors' printer pictures, bed models and
// textures (non-JSON files) are also copied to <out-dir>/assets/<vendor>/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
// ENGINE_FLAVOR=orca bundles upstream OrcaSlicer's presets instead.
const root = resolve(here, process.env.ENGINE_FLAVOR === 'orca' ? '../orcaslicer-upstream/resources/profiles' : '../orcaslicer/resources/profiles');
const [outDir, ...vendorArgs] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: bundle-profiles.mjs <out-dir> [vendor ...]');
  process.exit(2);
}
const LIBRARY = 'OrcaFilamentLibrary';
const startup = [...new Set([LIBRARY, ...(vendorArgs.length ? vendorArgs : ['Snapmaker'])])];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};
// A file name safe in a URL for a vendor id ("Co Print" -> "Co_Print").
const slug = (s) => s.replace(/[^\w.-]+/g, '_');

// Every vendor with an index file and a folder ("blacklist.json" has no folder).
const allVendors = readdirSync(root)
  .filter((f) => f.endsWith('.json') && existsSync(join(root, f.slice(0, -5))) && statSync(join(root, f.slice(0, -5))).isDirectory())
  .map((f) => f.slice(0, -5))
  .sort((a, b) => a.localeCompare(b));
for (const v of startup) if (!allVendors.includes(v)) throw new Error(`bundle-profiles: no vendor ${v} under ${root}`);

/**
 * A printer model file without its "default_materials". Orca marks only those
 * filaments installed (visible) once any loaded model names some, which would
 * hide nearly every filament from every printer, the U1 included, as soon as a
 * second brand is loaded. Snapmaker's models name none, so every filament stays
 * visible, as the page expects: the setup wizard picks the filaments instead.
 * (The wizard's starting picks come from each printer's default_filament_profile.)
 */
function withoutDefaultMaterials(text) {
  if (!text.includes('"default_materials"')) return text;
  try {
    const json = JSON.parse(text);
    if (json.type !== 'machine_model') return text;
    delete json.default_materials;
    return JSON.stringify(json, null, 4);
  } catch {
    return text;
  }
}

/** The vendor's preset files ({path: text}); its other files go to assets/ when `assets` is set. */
function vendorFiles(vendor, assets) {
  const files = { [`${vendor}.json`]: readFileSync(join(root, `${vendor}.json`), 'utf8') };
  let copied = 0;
  for (const file of walk(join(root, vendor))) {
    const rel = relative(root, file).split('\\').join('/');
    if (file.endsWith('.json')) files[rel] = withoutDefaultMaterials(readFileSync(file, 'utf8'));
    else if (assets) {
      const dest = join(outDir, 'assets', rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file, dest);
      copied++;
    }
  }
  return { files, copied };
}

/**
 * The vendor's printer models as desktop's wizard lists them: each model in the
 * vendor index with the printer presets that instantiate it (one per nozzle),
 * and whether they run Klipper. Values are looked up through `inherits`, as Orca
 * does; a preset that never sets gcode_flavor gets Orca's default (Marlin).
 */
function vendorModels(vendor, files) {
  const index = JSON.parse(files[`${vendor}.json`]);
  const byName = new Map();
  for (const [rel, text] of Object.entries(files)) {
    if (!rel.startsWith(`${vendor}/machine/`)) continue;
    try {
      const p = JSON.parse(text);
      if (p.name) byName.set(p.name, p);
    } catch {
      // Orca skips unreadable files too.
    }
  }
  const value = (p, key, seen = new Set()) => {
    if (!p || seen.has(p.name)) return undefined;
    seen.add(p.name);
    return p[key] ?? (p.inherits ? value(byName.get(p.inherits), key, seen) : undefined);
  };
  const first = (v) => (Array.isArray(v) ? v[0] : typeof v === 'string' ? v.split(/[;,]/)[0] : undefined);
  const covers = join(outDir, 'profiles/covers', slug(vendor));
  return (index.machine_model_list ?? [])
    .map(({ name: model, sub_path }) => {
      const info = readJson(join(root, vendor, sub_path)) ?? {};
      if (info.machine_tech && info.machine_tech !== 'FFF') return null;
      const presets = [...byName.values()].filter((p) => p.type === 'machine' && p.instantiation !== 'false' && value(p, 'printer_model') === model);
      if (!presets.length) return null;
      const nozzles = presets
        .map((p) => ({ name: p.name, nozzle: String(first(value(p, 'nozzle_diameter')) ?? value(p, 'printer_variant') ?? '') }))
        .sort((a, b) => Number(a.nozzle) - Number(b.nozzle) || a.name.localeCompare(b.name));
      const send = presets.every((p) => value(p, 'gcode_flavor') === 'klipper');
      let cover = '';
      const picture = join(root, vendor, `${model}_cover.png`);
      if (existsSync(picture)) {
        mkdirSync(covers, { recursive: true });
        cover = `covers/${slug(vendor)}/${slug(model)}.png`;
        copyFileSync(picture, join(outDir, 'profiles', cover));
      }
      return { model, cover, send, nozzles };
    })
    .filter(Boolean)
    .sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true }));
}

rmSync(join(outDir, 'profiles'), { recursive: true, force: true });
mkdirSync(join(outDir, 'profiles'), { recursive: true });

const bundle = {};
let assets = 0;
for (const vendor of startup) {
  const { files, copied } = vendorFiles(vendor, true);
  Object.assign(bundle, files);
  assets += copied;
}
const version = JSON.parse(bundle['Snapmaker.json'] ?? bundle[`${startup[1]}.json`] ?? '{}').version ?? '';
writeFileSync(join(outDir, 'profiles.json'), JSON.stringify({ version, vendors: startup, files: bundle }));

const catalog = [];
let lazyBytes = 0;
for (const vendor of allVendors) {
  if (vendor === LIBRARY) continue;
  const loaded = startup.includes(vendor);
  const files = loaded ? Object.fromEntries(Object.entries(bundle).filter(([rel]) => rel === `${vendor}.json` || rel.startsWith(`${vendor}/`))) : vendorFiles(vendor, false).files;
  const index = JSON.parse(files[`${vendor}.json`]);
  const models = vendorModels(vendor, files);
  if (!models.length) continue;
  let file = '';
  let bytes = 0;
  if (!loaded) {
    file = `${slug(vendor)}.json`;
    const text = JSON.stringify({ version: index.version ?? '', vendors: [vendor], files });
    writeFileSync(join(outDir, 'profiles', file), text);
    // What the browser downloads: the server compresses JSON.
    bytes = gzipSync(text).length;
    lazyBytes += bytes;
  }
  catalog.push({ id: vendor, name: index.name || vendor, file, bytes, models });
}
writeFileSync(join(outDir, 'profiles/catalog.json'), JSON.stringify({ version, vendors: catalog }));

const kb = (n) => `${Math.round(n / 1024)} KB`;
const models = catalog.reduce((n, v) => n + v.models.length, 0);
console.log(
  `${join(outDir, 'profiles.json')}: ${Object.keys(bundle).length} preset files (${startup.join(', ')}, ${version}), ${assets} assets; ` +
    `profiles/: ${catalog.length} brands, ${models} printer models, ${kb(lazyBytes)} compressed if every brand were loaded`,
);
