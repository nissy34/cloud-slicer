// Puts everything the engine worker loads into public/engine/, where Vite
// serves it as-is (the worker is a classic script: Emscripten pthreads re-run
// it with importScripts):
//   orca-engine.js / .wasm   the engine build
//   profiles.json, assets/   the Snapmaker Orca system presets (bundle-profiles.mjs)
//   settings-layout.json     desktop Orca's settings pages (extract-settings-layout.mjs)
//
//   ENGINE_DIR  engine build dir (default: ../../engine/build/engine)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(web, '../..');
const engineDir = process.env.ENGINE_DIR ?? join(repo, 'engine/build/engine');
const out = join(web, 'public/engine');
mkdirSync(out, { recursive: true });

const binaries = ['orca-engine.js', 'orca-engine.wasm'].map((f) => join(engineDir, f));
const missing = binaries.filter((f) => !existsSync(f));
if (missing.length) {
  console.warn(`copy-engine: not found, the page will load without an engine:\n  ${missing.join('\n  ')}`);
  console.warn('Build it first (see README.md) or set ENGINE_DIR.');
}
for (const src of binaries) if (existsSync(src)) copyFileSync(src, join(out, src.split('/').pop()));

if (existsSync(join(repo, 'engine/orcaslicer/resources/profiles'))) {
  execFileSync('node', [join(repo, 'engine/scripts/bundle-profiles.mjs'), out], { stdio: 'inherit' });
  execFileSync('node', [join(repo, 'engine/scripts/extract-settings-layout.mjs'), join(out, 'settings-layout.json')], { stdio: 'inherit' });
} else {
  console.warn('copy-engine: engine/orcaslicer is not checked out; no presets bundled.');
}
