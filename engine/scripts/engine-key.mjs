#!/usr/bin/env node
// Prints the engine key: one name for "an engine built from exactly these sources".
//
//   node engine/scripts/engine-key.mjs        # e.g. v1-6.0.12-b1831e5dcb46-3f9c0a1e7d2b4c58
//
// CI caches each engine build under this key and publishes it as a GitHub release
// file (see fetch-engine.mjs), so a checkout can tell whether a ready-made engine
// matches it. It covers everything the wasm build reads: the build version and
// Emscripten version from ci.yml, the pinned Orca commit, and engine/CMakeLists.txt,
// cmake/, compat/, patches/, src/ and scripts/build-deps.sh as they are on disk now
// (uncommitted and new files included). Tests, presets bundling and engine/node are
// not part of it. Files are hashed as git stores them, so Windows line endings don't
// change the key.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function engineKey(repo = join(dirname(fileURLToPath(import.meta.url)), '../..')) {
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
  const ci = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8');
  const env = (name) => {
    const m = ci.match(new RegExp(`^\\s*${name}:\\s*(\\S+)`, 'm'));
    if (!m) throw new Error(`engine-key: ${name} not found in ci.yml`);
    return m[1];
  };
  const orca = git('ls-files', '-s', 'engine/orcaslicer').split(/\s+/)[1];
  if (!orca) throw new Error('engine-key: engine/orcaslicer is not a submodule in the index');

  const inputs = ['engine/CMakeLists.txt', 'engine/cmake', 'engine/compat', 'engine/patches', 'engine/src', 'engine/scripts/build-deps.sh'];
  const list = (...args) => git('ls-files', '-z', ...args, '--', ...inputs).split('\0').filter(Boolean);
  const deleted = new Set(list('-d'));
  const files = [...new Set(list('-co', '--exclude-standard'))].filter((f) => !deleted.has(f)).sort();
  const ids = execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: repo, input: files.join('\n') + '\n', encoding: 'utf8' })
    .trim()
    .split('\n');
  const h = createHash('sha256');
  files.forEach((f, i) => h.update(`${f}\0${ids[i]}\n`));
  return `v${env('ENGINE_CACHE_VERSION')}-${env('EMSDK_VERSION')}-${orca.slice(0, 12)}-${h.digest('hex').slice(0, 16)}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(engineKey());
