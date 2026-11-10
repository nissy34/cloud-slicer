// Snapmaker preset packs: newer Snapmaker presets than the engine's source ships.
//
// Desktop Snapmaker Orca downloads its presets separately from the app, from
// Snapmaker's update feed (FEED_URL; AppConfig::get_preset_upgrade_url in their
// source), and the packs never land in their GitHub repository. We keep the
// latest pack in engine/presets/snapmaker/: pack.json (version, where it came
// from, its SHA-256, the app versions it supports) and the pack's preset files
// that differ from the engine's, byte for byte, at their paths under Orca's
// system preset folder ("Snapmaker.json", "Snapmaker/machine/...").
// bundle-profiles.mjs lays them over the engine's presets; snapmaker-presets.mjs
// fetches a new pack. Presets aren't part of the engine build (engine-key.mjs),
// so a new pack needs no engine build.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FEED_URL = 'https://meta-cfg.snapmaker.com/upgrade/profile/en/version.json';
export const PACK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../presets/snapmaker');

/** Compares Snapmaker versions like "02.03.04.05" or "2.4.1" number by number: <0, 0 or >0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Whether `app` (e.g. "2.4.1") is within the pack's supported app versions, as desktop checks it. */
export function supportsApp(pack, app) {
  if (pack.minApp && compareVersions(app, pack.minApp) < 0) return false;
  if (pack.maxApp && compareVersions(app, pack.maxApp) > 0) return false;
  return true;
}

/** The vendor index's version ("Snapmaker.json" in a preset folder), or '' without one. */
export function presetsVersion(dir, vendor = 'Snapmaker') {
  try {
    return JSON.parse(readFileSync(join(dir, `${vendor}.json`), 'utf8').replace(/^\uFEFF/, '')).version ?? '';
  } catch {
    return '';
  }
}

/** The pack we keep (pack.json), or null when there is none. */
export function readPack(dir = PACK_DIR) {
  const file = join(dir, 'pack.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/**
 * The pack's preset files to lay over the engine's presets in `root`, as
 * { "<path under the preset folder>": "<file on disk>" }; {} without a pack.
 * Throws when the engine already ships the pack's version or a newer one: the
 * pack would put older presets back, so it has to go (engine/presets/README.md).
 */
export function packOverlay(root, dir = PACK_DIR) {
  const pack = readPack(dir);
  if (!pack) return {};
  const engine = presetsVersion(root, pack.vendor);
  if (engine && compareVersions(engine, pack.version) >= 0) {
    throw new Error(`the engine ships ${pack.vendor} presets ${engine}, the preset pack in ${relative(process.cwd(), dir) || dir} is ${pack.version}: delete the pack folder`);
  }
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.json') && p !== join(dir, 'pack.json')) files[relative(dir, p).split('\\').join('/')] = p;
    }
  };
  walk(dir);
  return files;
}
