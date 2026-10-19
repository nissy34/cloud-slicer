#!/usr/bin/env node
// Downloads the engine CI already built for these sources, instead of building it
// (about 40 minutes). Takes seconds.
//
//   node engine/scripts/fetch-engine.mjs           # -> engine/build/engine/orca-engine.{js,wasm}
//
// CI's engine job publishes every engine it builds as a file on the `engine-builds`
// GitHub release, named after the engine key (engine-key.mjs: the Orca commit plus a
// hash of the engine's own sources). This script works out the key of the checkout and
// downloads the matching file. When the engine sources changed and CI hasn't built
// them yet there is no matching file: push and let CI build it, or build it yourself
// (README.md). It never downloads an engine built from other sources.
//
// It also fetches the pinned engine/orcaslicer submodule (shallow, about 15 s) when it
// isn't checked out, because the web app's presets and the Node tests read it.
//
// Uses git, curl and tar, which Linux, macOS and Windows 10+ all have; curl follows the
// HTTPS_PROXY of a cloud session.
//
//   ENGINE_REPO  GitHub repo with the release (default nissy34/cloud-slicer)
//   --quiet      only print when something is downloaded or goes wrong
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineKey } from './engine-key.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const quiet = process.argv.includes('--quiet');
const log = (msg) => quiet || console.log(`fetch-engine: ${msg}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

function fetchOrcaOrWarn() {
  try {
    fetchOrca();
  } catch (e) {
    console.warn(`fetch-engine: couldn't fetch engine/orcaslicer (${e.message}); presets won't be bundled`);
  }
}

function fetchOrca() {
  const dir = join(repo, 'engine/orcaslicer');
  if (existsSync(join(dir, 'resources/profiles'))) return;
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const sha = git(['ls-files', '-s', 'engine/orcaslicer']).split(/\s+/)[1];
  const url = git(['config', '-f', '.gitmodules', 'submodule.engine/orcaslicer.url']);
  console.log(`fetch-engine: fetching the Snapmaker Orca submodule at ${sha.slice(0, 12)} (shallow)`);
  mkdirSync(dir, { recursive: true });
  // Its own repository first, so no git command below can act on the parent repo.
  if (!existsSync(join(dir, '.git'))) run('git', ['init', '-q'], { cwd: dir });
  run('git', ['fetch', '-q', '--depth', '1', url, sha], { cwd: dir });
  run('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: dir });
}

export function fetchEngine() {
  const key = engineKey(repo);
  const outDir = join(repo, 'engine/build/engine');
  const stamp = join(outDir, '.engine-key');
  const have = existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === key
    && ['orca-engine.js', 'orca-engine.wasm'].every((f) => existsSync(join(outDir, f)));
  if (have) {
    log(`engine ${key} already here`);
    return true;
  }
  const slug = process.env.ENGINE_REPO ?? 'nissy34/cloud-slicer';
  const url = `https://github.com/${slug}/releases/download/engine-builds/engine-${key}.tar.gz`;
  const tmp = mkdtempSync(join(tmpdir(), 'engine-'));
  const file = join(tmp, 'engine.tar.gz');
  try {
    const code = execFileSync('curl', ['-sSL', '--retry', '3', '-o', file, '-w', '%{http_code}', url], { encoding: 'utf8' }).trim();
    if (code === '404') {
      console.warn(
        `fetch-engine: CI hasn't built engine ${key} (these engine sources) yet.\n` +
          '  Push the branch and wait for CI\'s engine job, or build it yourself (README.md, "Build the engine").',
      );
      return false;
    }
    if (code !== '200') throw new Error(`HTTP ${code} for ${url}`);
    mkdirSync(outDir, { recursive: true });
    run('tar', ['-xzf', file, '-C', outDir]);
    writeFileSync(stamp, `${key}\n`);
    console.log(`fetch-engine: downloaded engine ${key} into engine/build/engine`);
    return true;
  } catch (e) {
    console.warn(`fetch-engine: download failed: ${e.message}`);
    return false;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fetchOrcaOrWarn();
  process.exit(fetchEngine() ? 0 : 1);
}
