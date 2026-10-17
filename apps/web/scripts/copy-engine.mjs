// Copies the engine build and the files its worker loads into public/engine/,
// where Vite serves them as-is (the worker is a classic script: Emscripten
// pthreads re-run it with importScripts).
//
//   ENGINE_DIR  engine build dir (default: ../../engine/build/engine)
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(web, '../..');
const engineDir = process.env.ENGINE_DIR ?? join(repo, 'engine/build/engine');
const out = join(web, 'public/engine');

const files = {
  'u1slicer.js': join(engineDir, 'u1slicer.js'),
  'u1slicer.wasm': join(engineDir, 'u1slicer.wasm'),
  // Phase 0 slices with the U1 defaults the spike CLI uses; phase 1 replaces
  // these with the full Snapmaker preset bundle.
  'app-defaults.mjs': join(repo, 'engine/node/app-defaults.mjs'),
  'snapmaker_u1.json': join(repo, 'engine/profiles/u1/printer/snapmaker_u1.json'),
};

mkdirSync(out, { recursive: true });
const missing = Object.values(files).filter((f) => !existsSync(f));
if (missing.length) {
  console.warn(`copy-engine: not found, the page will load without an engine:\n  ${missing.join('\n  ')}`);
  console.warn('Build it first (see README.md) or set ENGINE_DIR.');
}
for (const [name, src] of Object.entries(files)) {
  if (existsSync(src)) copyFileSync(src, join(out, name));
}
