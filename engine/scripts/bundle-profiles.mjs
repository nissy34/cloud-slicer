#!/usr/bin/env node
// Packs the Snapmaker Orca system presets the engine loads into one file.
//
//   node engine/scripts/bundle-profiles.mjs <out-dir> [vendor ...]
//
// Writes <out-dir>/profiles.json: { version, vendors, files: { "<path>": "<json text>" } },
// with paths relative to Orca's system preset folder (e.g. "Snapmaker.json",
// "Snapmaker/machine/fdm_U1.json"). The page writes each file under
// <dataDir>/system/ in the wasm FS and calls presetsLoad(dataDir).
// Vendors default to Snapmaker; OrcaFilamentLibrary is always included because
// vendor filaments inherit from it, exactly as in desktop Orca.
// Printer pictures, bed models and textures (non-JSON files) are copied to
// <out-dir>/assets/<vendor>/ for the UI.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../orcaslicer/resources/profiles');
const [outDir, ...vendorArgs] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: bundle-profiles.mjs <out-dir> [vendor ...]');
  process.exit(2);
}
const vendors = [...new Set(['OrcaFilamentLibrary', ...(vendorArgs.length ? vendorArgs : ['Snapmaker'])])];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = {};
let assets = 0;
for (const vendor of vendors) {
  const index = join(root, `${vendor}.json`);
  files[`${vendor}.json`] = readFileSync(index, 'utf8');
  for (const file of walk(join(root, vendor))) {
    const rel = relative(root, file).split('\\').join('/');
    if (file.endsWith('.json')) {
      files[rel] = readFileSync(file, 'utf8');
    } else {
      const dest = join(outDir, 'assets', rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file, dest);
      assets++;
    }
  }
}

const version = JSON.parse(files['Snapmaker.json'] ?? '{}').version ?? '';
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'profiles.json');
writeFileSync(out, JSON.stringify({ version, vendors, files }));
console.log(`${out}: ${Object.keys(files).length} preset files (${vendors.join(', ')}, Snapmaker ${version}), ${assets} assets`);
