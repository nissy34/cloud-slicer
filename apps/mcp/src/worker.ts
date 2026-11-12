// The engine's own thread, like the site's engine worker (public/engine/engine-worker.js):
// a slice blocks the thread it runs on, so it runs here and the MCP server
// stays free to answer Claude and pass on progress. One engine per worker.
//
// Messages in: {id, method, args}. Out: {id, result} | {id, error} | {id, progress: {pct, stage}}.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
// @ts-expect-error plain JS module shared with the CLI and the engine tests
import { addBrands, call, openEngine, openModel, slicePlate, writeUserPresets } from '../../../engine/node/engine.mjs';

interface Engine {
  [fn: string]: any;
  FS: { readFile(path: string): Uint8Array; unlink(path: string): void; [fn: string]: any };
}

const dir: string = workerData.dir;
const { engine } = (await openEngine({
  modulePath: resolve(dir, 'orca-engine.js'),
  profiles: resolve(dir, 'profiles.json'),
})) as { engine: Engine };
const brands = new Set<string>();

type Methods = Record<string, (id: number, ...args: any[]) => unknown>;
const methods: Methods = {
  // An engine call that answers JSON with {ok, error}: throws on ok = false.
  json: (_id, fn: string, ...args: unknown[]) => call(engine, fn, ...args),
  // An engine call that answers plain JSON (modelInfoJson, configOptionsJson, ...).
  read: (_id, fn: string, ...args: unknown[]) => JSON.parse(engine[fn](...args)),
  brands: (_id, files: string[]) => addBrands(engine, resolve(dir, 'profiles'), files, brands),
  open: (_id, file: string, opts: object) => openModel(engine, file, opts),
  userPresets: (_id, presets: object[]) => writeUserPresets(engine, presets),
  preview(_id, plate: number) {
    const p = engine.previewMesh(plate);
    return { positions: p.positions, filaments: p.filaments };
  },
  slice: (id, config: object, opts: object) =>
    slicePlate(engine, config, { ...opts, onProgress: (pct: number, stage: string) => parentPort!.postMessage({ id, progress: { pct, stage } }) }),
  // Writes the project (presets + changes as its settings) to `file` on disk.
  saveProject(_id, file: string, config: object, thumbnail: object | null) {
    const path = '/work/project.3mf';
    call(engine, 'saveProject', path, JSON.stringify(config), thumbnail);
    writeFileSync(file, engine.FS.readFile(path));
    engine.FS.unlink(path);
    return { file };
  },
};

parentPort!.on('message', ({ id, method, args }: { id: number; method: string; args: unknown[] }) => {
  try {
    const result = methods[method](id, ...args);
    parentPort!.postMessage({ id, result });
  } catch (e) {
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
parentPort!.postMessage({ ready: true, info: JSON.parse(engine.engineInfo()) });
