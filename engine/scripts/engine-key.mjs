#!/usr/bin/env node
// Prints the engine key: one name for "an engine built from exactly these sources".
//
//   node engine/scripts/engine-key.mjs                 # e.g. v1-6.0.12-b1831e5dcb46-3f9c0a1e7d2b4c58
//   node engine/scripts/engine-key.mjs --flavor orca   # upstream OrcaSlicer: v1-orca-6.0.12-8500fcdccaa1-...
//
// CI caches each engine build under this key and publishes it as a GitHub release
// file (see fetch-engine.mjs), so a checkout can tell whether a ready-made engine
// matches it. It covers everything the wasm build reads: the build version and
// Emscripten version from ci.yml, the pinned commit of the engine's source (the
// engine/orcaslicer submodule, or engine/orcaslicer-upstream for the orca flavor,
// engine/README.md "Two engines"), and engine/CMakeLists.txt,
// cmake/, compat/, patches/, src/ and scripts/build-deps.sh as they are on disk now
// (uncommitted and new files included). Tests, presets bundling and engine/node are
// not part of it. Files are hashed as git stores them, so Windows line endings don't
// change the key.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// orca-next: the next upstream OrcaSlicer, only built by the engine-next workflow.
export const FLAVORS = { snapmaker: 'engine/orcaslicer', orca: 'engine/orcaslicer-upstream', 'orca-next': 'engine/orcaslicer-next' };

export function engineKey(repo = join(dirname(fileURLToPath(import.meta.url)), '../..'), flavor = 'snapmaker') {
  const submodule = FLAVORS[flavor];
  if (!submodule) throw new Error(`engine-key: unknown flavor ${flavor} (${Object.keys(FLAVORS).join(' or ')})`);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
  const ci = readFileSync(join(repo, '.github/workflows/ci.yml'), 'utf8');
  const env = (name) => {
    const m = ci.match(new RegExp(`^\\s*${name}:\\s*(\\S+)`, 'm'));
    if (!m) throw new Error(`engine-key: ${name} not found in ci.yml`);
    return m[1];
  };
  const orca = git('ls-files', '-s', submodule).split(/\s+/)[1];
  if (!orca) throw new Error(`engine-key: ${submodule} is not a submodule in the index`);

  const inputs = ['engine/CMakeLists.txt', 'engine/cmake', 'engine/compat', 'engine/patches', 'engine/src', 'engine/scripts/build-deps.sh'];
  if (flavor === 'orca-next') inputs.push('engine/scripts/build-deps-next.sh');
  const list = (...args) => git('ls-files', '-z', ...args, '--', ...inputs).split('\0').filter(Boolean);
  const deleted = new Set(list('-d'));
  const files = [...new Set(list('-co', '--exclude-standard'))].filter((f) => !deleted.has(f)).sort();
  const ids = execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: repo, input: files.join('\n') + '\n', encoding: 'utf8' })
    .trim()
    .split('\n');
  const h = createHash('sha256');
  files.forEach((f, i) => h.update(`${f}\0${ids[i]}\n`));
  // The Snapmaker key keeps its original form, so builds published before there
  // were two engines still match.
  const tag = flavor === 'snapmaker' ? '' : `${flavor}-`;
  return `v${env('ENGINE_CACHE_VERSION')}-${tag}${env('EMSDK_VERSION')}-${orca.slice(0, 12)}-${h.digest('hex').slice(0, 16)}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--flavor');
  console.log(engineKey(undefined, i > 0 ? process.argv[i + 1] : 'snapmaker'));
}
