// A short hash of the engine files in public/engine/. Every engine URL carries
// it (?v=), so a browser can never run one deploy's orca-engine.js against
// another deploy's .wasm: the glue and the wasm imports must match, or startup
// fails with errors like "Cannot mix BigInt and other types".
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

const files = ['engine-worker.js', 'orca-engine.js', 'orca-engine.wasm', 'profiles.json', 'settings-layout.json'];

export function engineVersion() {
  const hash = createHash('sha256');
  for (const dir of ['engine', 'engine-orca'])
    for (const f of files) {
      const path = new URL(`../public/${dir}/${f}`, import.meta.url);
      if (existsSync(path)) hash.update(`${dir}/${f}`).update(readFileSync(path));
    }
  return hash.digest('hex').slice(0, 12);
}

// What the engine downloads at start-up (the wasm and the presets), in bytes,
// so the page can show download progress; 0 without an engine.
export function engineBytes(dir = 'engine') {
  let total = 0;
  for (const f of ['orca-engine.wasm', 'profiles.json']) {
    const path = new URL(`../public/${dir}/${f}`, import.meta.url);
    if (existsSync(path)) total += statSync(path).size;
  }
  return total;
}

// Each engine's own version, read from its sources' version.inc like
// engine/CMakeLists.txt does, so the page can name the engine that isn't
// running too. Empty where the sources aren't here.
export function engineReleases() {
  const read = (submodule) => {
    const path = new URL(`../../../engine/${submodule}/version.inc`, import.meta.url);
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf8').match(/set\((?:Snapmaker|SoftFever)_VERSION "([^"]*)"/)?.[1] ?? '';
  };
  return { snapmaker: read('orcaslicer'), orca: read('orcaslicer-upstream') };
}
