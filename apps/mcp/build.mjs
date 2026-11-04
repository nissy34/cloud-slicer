#!/usr/bin/env node
// Builds the MCP server into dist/, ready to run on its own:
//   dist/server.mjs, dist/worker.mjs        the server and the engine's thread (esbuild bundles)
//   dist/engines/<snapmaker|orca>/          each engine (orca-engine.js + .wasm) and its presets
//                                           (profiles.json + profiles/<brand>.json + catalog.json)
//
//   node build.mjs            needs both engines: node engine/scripts/fetch-engine.mjs
//
// Engines come from engine/build/engine and engine/build/engine-orca (fetch-engine.mjs
// or a local build); their presets are bundled here from the engines' own sources.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const dist = resolve(here, 'dist');
const ENGINES = { snapmaker: 'engine/build/engine', orca: 'engine/build/engine-orca' };

rmSync(dist, { recursive: true, force: true });
await build({
  entryPoints: { server: resolve(here, 'src/server.ts'), worker: resolve(here, 'src/worker.ts') },
  outdir: dist,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Bundled CommonJS (the SDK's dependencies) needs require in an ES module.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // The site's helpers import three; take it from here, not from apps/web's own install.
  nodePaths: [resolve(here, 'node_modules')],
  logLevel: 'warning',
});

for (const [flavor, from] of Object.entries(ENGINES)) {
  const src = resolve(repo, from);
  if (!existsSync(resolve(src, 'orca-engine.js'))) throw new Error(`No ${flavor} engine in ${from}: run node engine/scripts/fetch-engine.mjs`);
  const out = resolve(dist, 'engines', flavor);
  mkdirSync(out, { recursive: true });
  for (const f of ['orca-engine.js', 'orca-engine.wasm']) cpSync(resolve(src, f), resolve(out, f));
  // The engine is a CommonJS script; this folder would otherwise count as an ES module.
  writeFileSync(resolve(out, 'package.json'), '{ "type": "commonjs" }\n');
  const tmp = resolve(here, `.profiles-${flavor}`);
  rmSync(tmp, { recursive: true, force: true });
  execFileSync(process.execPath, [resolve(repo, 'engine/scripts/bundle-profiles.mjs'), tmp], {
    env: { ...process.env, ENGINE_FLAVOR: flavor },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  cpSync(resolve(tmp, 'profiles.json'), resolve(out, 'profiles.json'));
  // Only the presets: the printer pictures and beds are for the site's 3D view.
  mkdirSync(resolve(out, 'profiles'));
  for (const f of readdirSync(resolve(tmp, 'profiles')).filter((f) => f.endsWith('.json'))) cpSync(resolve(tmp, 'profiles', f), resolve(out, 'profiles', f));
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`built ${dist}`);
