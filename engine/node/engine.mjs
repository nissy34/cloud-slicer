// Loads the wasm engine under Node.js with the bundled Snapmaker presets, for
// the CLI and the engine tests. The browser worker does the same steps.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
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

// Adds printer brands beyond the start-up ones, as the page's worker does
// (engine-worker.js `vendors`): each `profiles/<file>` from bundle-profiles.mjs
// is written beside the others and every preset reloads when one was new.
// `loaded` remembers what is in already. Returns whether anything was added.
export function addBrands(engine, profilesDir, files, loaded = new Set()) {
  const added = files.filter((f) => !loaded.has(f));
  for (const file of added) {
    writeProfiles(engine, JSON.parse(readFileSync(resolve(profilesDir, file), 'utf8')));
    loaded.add(file);
  }
  if (added.length) call(engine, 'presetsLoad', DATA_DIR);
  return added.length > 0;
}

// Opens a model file from disk as the project (or adds it to the open one), on
// plates the size of `config`'s bed. Returns the engine's loadModel answer and
// the model info.
export function openModel(engine, file, { plate = 0, add = false, config = {}, orientation = 0 } = {}) {
  const path = `/work/${basename(file)}`;
  engine.FS.writeFile(path, readFileSync(file));
  const [w, d] = bedSize(config);
  if (!add) engine.clearModel();
  try {
    const loaded = call(engine, 'loadModel', path, plate, w, d, add, orientation);
    return { loaded, info: JSON.parse(engine.modelInfoJson()) };
  } finally {
    engine.FS.unlink(path);
  }
}

// Slices `plate` with the full `config`. onProgress(pct, stage); thumbnails:
// the plate pictures [{width, height, pixels}] or []. Returns the engine's
// result plus `gcode` (and `gcode3mf` for printers that take a .gcode.3mf) as bytes.
export function slicePlate(engine, config, { plate = 0, name = '', thumbnails = [], onProgress = () => {} } = {}) {
  const result = JSON.parse(engine.sliceWithConfig(JSON.stringify(config), plate, '/work/out.gcode', onProgress, thumbnails, name));
  if (!result.success) return result;
  result.gcode = engine.FS.readFile(result.gcodePath);
  engine.FS.unlink(result.gcodePath);
  if (result.gcode3mfPath) {
    result.gcode3mf = engine.FS.readFile(result.gcode3mfPath);
    engine.FS.unlink(result.gcode3mfPath);
  }
  return result;
}
