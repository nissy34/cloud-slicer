#!/usr/bin/env node
// Checks Snapmaker's preset feed for a newer preset pack and stores it in
// engine/presets/snapmaker/ (preset-packs.mjs explains the folder).
//
//   node engine/scripts/snapmaker-presets.mjs check            # ours, Snapmaker's latest, whether to update
//   node engine/scripts/snapmaker-presets.mjs update [--zip <file>]
//
// check prints one line per fact and, in GitHub Actions, writes
// new=true|false and version=<latest> to $GITHUB_OUTPUT. update downloads the
// latest pack the feed names (or reads --zip), keeps the files that differ from
// the engine's presets and rewrites pack.json; it needs the engine/orcaslicer
// submodule and the `unzip` command. Like desktop, a pack is taken only when it
// is newer than ours and supports our engine's Snapmaker Orca version.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEED_URL, PACK_DIR, compareVersions, presetsVersion, readPack, supportsApp } from './preset-packs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, '../orcaslicer');
const engineProfiles = join(engineRoot, 'resources/profiles');
const VENDOR = 'Snapmaker';

const [command, ...args] = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function engineApp() {
  const inc = readFileSync(join(engineRoot, 'version.inc'), 'utf8');
  const m = /set\(Snapmaker_VERSION "([^"]+)"\)/.exec(inc);
  if (!m) throw new Error('no Snapmaker_VERSION in engine/orcaslicer/version.inc (fetch the submodule first)');
  return m[1];
}

async function feed() {
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`${FEED_URL}: HTTP ${res.status}`);
  const data = (await res.json()).data ?? {};
  if (!data.file_version || !data.file_url) throw new Error(`${FEED_URL}: no file_version or file_url`);
  return { version: data.file_version, url: data.file_url, minApp: data.min_support_pc_version || '', maxApp: data.max_support_pc_version || '' };
}

function ours() {
  return readPack()?.version || presetsVersion(engineProfiles, VENDOR);
}

async function check() {
  const latest = await feed();
  const current = ours();
  const app = engineApp();
  const supported = supportsApp(latest, app);
  const update = supported && compareVersions(latest.version, current) > 0;
  console.log(`ours: ${current}`);
  console.log(`Snapmaker's latest: ${latest.version} (for Snapmaker Orca ${latest.minApp || 'any'} to ${latest.maxApp || 'any'})`);
  console.log(`our engine: Snapmaker Orca ${app}${supported ? '' : ', which this pack does not support'}`);
  console.log(update ? `update: yes, to ${latest.version}` : 'update: no');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `new=${update}\nversion=${latest.version}\n`);
  return { latest, update };
}

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const parse = (buf) => {
  try {
    return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
};
// Same JSON, whatever the spacing, line endings or key order.
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
const same = (a, b) => a !== undefined && JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

async function update() {
  if (!existsSync(engineProfiles)) throw new Error('engine/orcaslicer is not checked out (git submodule update --init engine/orcaslicer)');
  const zipArg = opt('--zip');
  const latest = zipArg ? null : await feed();
  if (latest && !supportsApp(latest, engineApp())) throw new Error(`pack ${latest.version} does not support Snapmaker Orca ${engineApp()}`);
  const work = mkdtempSync(join(tmpdir(), 'snapmaker-presets-'));
  try {
    const zip = zipArg ? resolve(zipArg) : join(work, 'profiles.zip');
    if (!zipArg) {
      const res = await fetch(latest.url);
      if (!res.ok) throw new Error(`${latest.url}: HTTP ${res.status}`);
      writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    }
    const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex');
    const out = join(work, 'unzipped');
    execFileSync('unzip', ['-q', zip, '-d', out]);
    // The zip holds profiles/Snapmaker.json, profiles/Snapmaker/...
    const top = existsSync(join(out, 'profiles', `${VENDOR}.json`)) ? join(out, 'profiles') : out;
    const version = presetsVersion(top, VENDOR);
    if (!version) throw new Error(`the pack has no ${VENDOR}.json`);
    if (latest && version !== latest.version) throw new Error(`the feed says ${latest.version}, the pack's ${VENDOR}.json says ${version}`);
    const engineVersion = presetsVersion(engineProfiles, VENDOR);
    if (compareVersions(version, engineVersion) <= 0) throw new Error(`the engine already ships ${VENDOR} presets ${engineVersion} (pack ${version})`);

    const files = walk(top).filter((f) => f.endsWith('.json'));
    const changed = files.filter((f) => {
      const rel = relative(top, f);
      const mine = join(engineProfiles, rel);
      return !existsSync(mine) || !same(parse(readFileSync(f)), parse(readFileSync(mine)));
    });
    const inPack = new Set(files.map((f) => relative(top, f).split('\\').join('/')));
    const dropped = walk(join(engineProfiles, VENDOR))
      .filter((f) => f.endsWith('.json'))
      .map((f) => relative(engineProfiles, f).split('\\').join('/'))
      .filter((rel) => !inPack.has(rel));

    rmSync(PACK_DIR, { recursive: true, force: true });
    for (const f of changed) {
      const dest = join(PACK_DIR, relative(top, f));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(f));
    }
    const changelog = existsSync(join(top, `${VENDOR}.changelog`)) ? readFileSync(join(top, `${VENDOR}.changelog`), 'utf8').replace(/\r\n/g, '\n').trim() : '';
    const pack = {
      vendor: VENDOR,
      version,
      url: latest?.url ?? '',
      sha256,
      minApp: latest?.minApp ?? '',
      maxApp: latest?.maxApp ?? '',
      engineVersion,
      changelog,
    };
    writeFileSync(join(PACK_DIR, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
    console.log(`${VENDOR} presets ${version}: ${changed.length} of ${files.length} files differ from the engine's ${engineVersion}`);
    for (const f of changed) console.log(`  ${relative(top, f)}`);
    // A preset file the pack leaves out keeps the engine's copy.
    if (dropped.length) console.log(`not in the pack (the engine's kept): ${dropped.join(', ')}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  if (command === 'check') await check();
  else if (command === 'update') await update();
  else {
    console.error('usage: snapmaker-presets.mjs check | update [--zip <file>]');
    process.exit(2);
  }
} catch (e) {
  console.error(`snapmaker-presets: ${e.message}`);
  process.exit(1);
}
