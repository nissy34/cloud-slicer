// Loads the wasm engine under Node.js with the bundled Snapmaker presets, for
// the CLI and the engine tests. The browser worker does the same steps.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const DATA_DIR = '/orca';
export const DEFAULT_PRINTER = 'Snapmaker U1 (0.4 nozzle)';

// profiles: path to profiles.json from engine/scripts/bundle-profiles.mjs.
export async function openEngine({
  modulePath = process.env.ORCA_ENGINE_JS ?? resolve(here, '../build/engine/orca-engine.js'),
  profiles = process.env.ORCA_PROFILES ?? resolve(here, '../build/profiles/profiles.json'),
} = {}) {
  const createOrcaEngine = require(modulePath);
  // ORCA_ENGINE_VERBOSE=1 shows the engine's own log output.
  const engine = await createOrcaEngine(process.env.ORCA_ENGINE_VERBOSE ? {} : { print: () => {}, printErr: () => {} });
  const bundle = JSON.parse(readFileSync(profiles, 'utf8'));
  writeProfiles(engine, bundle);
  const loaded = JSON.parse(engine.presetsLoad(DATA_DIR));
  if (!loaded.ok) throw new Error(`presetsLoad: ${loaded.error}`);
  engine.FS.mkdirTree('/work');
  return { engine, presets: loaded };
}

export function writeProfiles(engine, bundle) {
  for (const [rel, text] of Object.entries(bundle.files)) {
    const path = `${DATA_DIR}/system/${rel}`;
    engine.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    engine.FS.writeFile(path, text);
  }
}

export const call = (engine, fn, ...args) => {
  const out = JSON.parse(engine[fn](...args));
  if (out.ok === false) throw new Error(`${fn}: ${out.error}`);
  return out;
};

// Width and depth of a printer config's printable_area ("0x0,270x0,...").
export function bedSize(config) {
  const pts = String(config.printable_area ?? '0x0,270x0,270x270,0x270')
    .split(',')
    .map((p) => p.split('x').map(Number));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}
