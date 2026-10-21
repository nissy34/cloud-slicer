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
//   <out-dir>/profiles/beds/<vendor>.json  the brand's printer beds as desktop draws them,
//                                       by model: { "<model>": { model, texture } }, file
//                                       names under profiles/beds/<vendor>/: the bed's 3D
//                                       shape (its STL as a small mesh file, bed-mesh.mjs)
//                                       and its print sheet picture (SVG or PNG). The 3D view
//                                       fetches only the selected printer's (src/lib/bed.ts).
// The page writes each file under <dataDir>/system/ in the wasm FS and calls
// presetsLoad(dataDir).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { encodeBedMesh, readStl } from './bed-mesh.mjs';

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

/** The vendor's preset files ({path: text}). */
function vendorFiles(vendor) {
  const files = { [`${vendor}.json`]: readFileSync(join(root, `${vendor}.json`), 'utf8') };
  for (const file of walk(join(root, vendor))) {
    const rel = relative(root, file).split('\\').join('/');
    if (file.endsWith('.json')) files[rel] = withoutDefaultMaterials(readFileSync(file, 'utf8'));
  }
  return files;
}

/**
 * The vendor's beds, as desktop shows them under the plate: each printer model's
 * bed_model (an STL, drawn below the plate) and bed_texture (an SVG or PNG laid
 * over the printable area), from its machine_model file. Writes profiles/beds/;
 * returns the index file name ('' when the brand has none) and the bytes written.
 */
function vendorBeds(vendor, files) {
  const index = JSON.parse(files[`${vendor}.json`]);
  const dir = join(outDir, 'profiles/beds', slug(vendor));
  const beds = {};
  const written = new Map();
  const bytes = { model: 0, texture: 0 };
  const add = (name, kind) => {
    if (typeof name !== 'string' || !name || name.includes('..')) return undefined;
    if (written.has(name)) return written.get(name);
    const src = join(root, vendor, name);
    let out;
    if (!existsSync(src)) out = undefined; // a few machine files name a file the brand doesn't ship
    else if (kind === 'model' && /\.stl$/i.test(name)) {
      try {
        const data = encodeBedMesh(readStl(readFileSync(src)));
        out = `${slug(name.replace(/\.stl$/i, ''))}.bed`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, out), data);
        bytes.model += data.length; // served as is (not a type the server compresses)
      } catch (e) {
        console.warn(`bundle-profiles: skipped ${vendor}/${name}: ${e.message}`);
      }
    } else if (kind === 'texture' && /\.(svg|png)$/i.test(name)) {
      out = slug(name).replace(/\.(svg|png)$/i, (ext) => ext.toLowerCase());
      mkdirSync(dir, { recursive: true });
      copyFileSync(src, join(dir, out));
      // The server compresses SVG; PNG is compressed already.
      bytes.texture += /\.svg$/i.test(out) ? gzipSync(readFileSync(src)).length : statSync(src).size;
    }
    written.set(name, out);
    return out;
  };
  for (const { name: model, sub_path } of index.machine_model_list ?? []) {
    const info = readJson(join(root, vendor, sub_path));
    if (!info || (info.machine_tech && info.machine_tech !== 'FFF')) continue;
    const bed = { model: add(info.bed_model, 'model'), texture: add(info.bed_texture, 'texture') };
    if (bed.model || bed.texture) beds[model] = bed;
  }
  if (!Object.keys(beds).length) return { file: '', bytes };
  const file = `${slug(vendor)}.json`;
  writeFileSync(join(outDir, 'profiles/beds', file), JSON.stringify(beds));
  return { file, bytes };
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
  const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[;,]/) : []);
  // A printer with mixed heads (U1 "0.4+0.6": two 0.4 and two 0.6) reads "0.4+0.6", not a second "0.4".
  const nozzleLabel = (p) => [...new Set(list(value(p, 'nozzle_diameter')).map((d) => String(d).trim()).filter(Boolean))].join('+') || String(value(p, 'printer_variant') ?? '');
  const covers = join(outDir, 'profiles/covers', slug(vendor));
  return (index.machine_model_list ?? [])
    .map(({ name: model, sub_path }) => {
      const info = readJson(join(root, vendor, sub_path)) ?? {};
      if (info.machine_tech && info.machine_tech !== 'FFF') return null;
      const presets = [...byName.values()].filter((p) => p.type === 'machine' && p.instantiation !== 'false' && value(p, 'printer_model') === model);
      if (!presets.length) return null;
      const nozzles = presets
        .map((p) => ({ name: p.name, nozzle: nozzleLabel(p) }))
        .sort((a, b) => parseFloat(a.nozzle) - parseFloat(b.nozzle) || a.nozzle.length - b.nozzle.length || a.name.localeCompare(b.name));
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

rmSync(join(outDir, 'assets'), { recursive: true, force: true }); // older builds copied bed files there
mkdirSync(join(outDir, 'profiles/beds'), { recursive: true });

const bundle = {};
for (const vendor of startup) Object.assign(bundle, vendorFiles(vendor));
const version = JSON.parse(bundle['Snapmaker.json'] ?? bundle[`${startup[1]}.json`] ?? '{}').version ?? '';
writeFileSync(join(outDir, 'profiles.json'), JSON.stringify({ version, vendors: startup, files: bundle }));

const catalog = [];
const bedSizes = [];
let lazyBytes = 0;
for (const vendor of allVendors) {
  if (vendor === LIBRARY) continue;
  const loaded = startup.includes(vendor);
  const files = loaded ? Object.fromEntries(Object.entries(bundle).filter(([rel]) => rel === `${vendor}.json` || rel.startsWith(`${vendor}/`))) : vendorFiles(vendor);
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
  const beds = vendorBeds(vendor, files);
  bedSizes.push({ vendor, ...beds.bytes });
  catalog.push({ id: vendor, name: index.name || vendor, file, bytes, beds: beds.file, models });
}
writeFileSync(join(outDir, 'profiles/catalog.json'), JSON.stringify({ version, vendors: catalog }));

const kb = (n) => `${Math.round(n / 1024)} KB`;
const models = catalog.reduce((n, v) => n + v.models.length, 0);
console.log(
  `${join(outDir, 'profiles.json')}: ${Object.keys(bundle).length} preset files (${startup.join(', ')}, ${version}); ` +
    `profiles/: ${catalog.length} brands, ${models} printer models, ${kb(lazyBytes)} compressed if every brand were loaded`,
);
const bedTotal = (b) => b.model + b.texture;
bedSizes.sort((a, b) => bedTotal(b) - bedTotal(a));
console.log(
  `profiles/beds/: ${catalog.filter((v) => v.beds).length} brands with beds, ${kb(bedSizes.reduce((n, b) => n + bedTotal(b), 0))} compressed in all ` +
    `(each page fetches only its printer's); largest brands: ${bedSizes
      .slice(0, 5)
      .map((b) => `${b.vendor} ${kb(bedTotal(b))}`)
      .join(', ')}`,
);
if (process.env.BED_SIZES) writeFileSync(process.env.BED_SIZES, JSON.stringify(bedSizes, null, 1));
