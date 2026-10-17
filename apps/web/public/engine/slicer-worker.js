// Runs the wasm engine off the main thread. Slicing blocks for seconds, and the
// engine's pthreads need Atomics.wait, which browsers forbid on the UI thread.
//
// Classic script on purpose: Emscripten starts each engine pthread as a new
// Worker running this same file (named 'em-pthread'), and those only need the
// importScripts below.
//
// Protocol (postMessage). Requests carry an `id`; replies echo it.
//   -> { type: 'load', id, name, bytes: ArrayBuffer }
//   -> { type: 'slice', id, options: { material, plate } }
//   <- { type: 'ready', core }
//   <- { type: 'loaded', id, info, positions: Float32Array, ms }
//   <- { type: 'progress', id, pct, stage }
//   <- { type: 'sliced', id, result, gcode: ArrayBuffer, ms }
//   <- { type: 'log', line }
//   <- { type: 'error', id, message }
importScripts('u1slicer.js');

if (self.name !== 'em-pthread') {
  // Cap the preview mesh sent to the page.
  const PREVIEW_MAX_TRIANGLES = 400000;
  const log = (line) => postMessage({ type: 'log', line });
  const here = (path) => new URL(path, self.location.href).href;

  const ready = Promise.all([
    createU1Slicer({ print: log, printErr: log, locateFile: here }),
    import(here('app-defaults.mjs')),
    fetch(here('snapmaker_u1.json')).then((r) => {
      if (!r.ok) throw new Error(`snapmaker_u1.json: HTTP ${r.status}`);
      return r.json();
    }),
  ]).then(([engine, defaults, printer]) => {
    engine.FS.mkdirTree('/work');
    postMessage({ type: 'ready', core: engine.coreVersion() });
    return { engine, defaults, printer };
  });

  const handlers = {
    load({ engine }, { id, name, bytes }) {
      const t0 = performance.now();
      engine.clearModel();
      const path = `/work/${name.replace(/[^\w.\-]+/g, '_')}`;
      engine.FS.writeFile(path, new Uint8Array(bytes));
      if (!engine.loadModel(path, 0)) throw new Error(`The engine could not read ${name}.`);
      const info = JSON.parse(engine.modelInfoJson());
      const { positions } = engine.previewMesh(PREVIEW_MAX_TRIANGLES);
      postMessage({ type: 'loaded', id, info, positions, ms: performance.now() - t0 }, [positions.buffer]);
    },

    slice({ engine, defaults, printer }, { id, options }) {
      const t0 = performance.now();
      const config = defaults.appSliceDefaults(printer, options);
      const result = JSON.parse(engine.slice(JSON.stringify(config), (pct, stage) => {
        postMessage({ type: 'progress', id, pct, stage });
      }));
      if (!result.success) {
        const heap = (engine.heapBytes() / 2 ** 20).toFixed(0);
        throw new Error(`${result.error || 'Slicing failed'} (engine memory ${heap} MB)`);
      }
      const gcode = engine.FS.readFile(result.gcodePath).buffer;
      postMessage({ type: 'sliced', id, result, gcode, ms: performance.now() - t0 }, [gcode]);
    },
  };

  self.onmessage = async ({ data }) => {
    try {
      const ctx = await ready;
      const handler = handlers[data.type];
      if (!handler) throw new Error(`Unknown request: ${data.type}`);
      handler(ctx, data);
    } catch (e) {
      postMessage({ type: 'error', id: data.id, message: e?.message ?? String(e) });
    }
  };

  ready.catch((e) => postMessage({ type: 'error', id: null, message: `Engine failed to start: ${e?.message ?? e}` }));
}
