// Runs the Snapmaker Orca wasm engine off the main thread. Slicing blocks for
// seconds, and the engine's pthreads need Atomics.wait, which browsers forbid
// on the UI thread.
//
// Classic script on purpose: Emscripten starts each engine pthread as a new
// Worker running this same file (named 'em-pthread'), and those only need the
// importScripts below.
//
// Protocol (postMessage). Requests carry an `id`; replies echo it.
//   -> { id, method, args: [...] }                 see `methods` below
//   <- { type: 'ready', presets }                  presets loaded (counts, selection)
//   <- { type: 'result', id, value }               value may carry transferred buffers
//   <- { type: 'progress', id, pct, stage }
//   <- { type: 'error', id, message }              id null: the engine failed to start
//
// The page loads this file as engine-worker.js?v=<engine build hash>; every
// file it loads carries the same ?v, so a cached file from an older deploy is
// never mixed with a newer one.
const here = (path) => new URL(path + self.location.search, self.location.href).href;
importScripts(here('orca-engine.js'));

if (self.name !== 'em-pthread') {
  const DATA_DIR = '/orca';
  const log = () => {};

  const json = (text) => {
    const out = JSON.parse(text);
    if (out && out.ok === false) throw new Error(out.error);
    return out;
  };

  const ready = Promise.all([
    createOrcaEngine({ print: log, printErr: log, locateFile: here }),
    fetch(here('profiles.json')).then((r) => {
      if (!r.ok) throw new Error(`profiles.json: HTTP ${r.status}`);
      return r.json();
    }),
  ]).then(([engine, bundle]) => {
    for (const [rel, text] of Object.entries(bundle.files)) {
      const path = `${DATA_DIR}/system/${rel}`;
      engine.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      engine.FS.writeFile(path, text);
    }
    const presets = json(engine.presetsLoad(DATA_DIR));
    presets.vendorVersion = bundle.version;
    engine.FS.mkdirTree('/work');
    postMessage({ type: 'ready', presets });
    return engine;
  });

  // Width and depth of a printable_area value ("0x0,270x0,270x270,0x270").
  const bedSize = (area) => {
    const pts = String(area || '0x0,270x0,270x270,0x270').split(',').map((p) => p.split('x').map(Number));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };

  const methods = {
    printers: (e) => JSON.parse(e.presetsPrinters()),
    select: (e, selection) => json(e.presetsSelect(JSON.stringify(selection))),
    fullConfig: (e, overrides) => json(e.presetsFullConfig(JSON.stringify(overrides || {}))),
    presetConfig: (e, type, name) => JSON.parse(e.presetConfig(type, name) || 'null'),
    options: (e) => JSON.parse(e.configOptionsJson()),
    modelInfo: (e) => JSON.parse(e.modelInfoJson()),
    fileConfig: (e) => JSON.parse(e.fileConfigJson()),

    // Adds a geometry file to the project (or opens a 3MF project).
    load(e, name, bytes, plate, printableArea) {
      const path = `/work/${name.replace(/[^\w.\-]+/g, '_')}`;
      e.FS.writeFile(path, new Uint8Array(bytes));
      const [w, d] = bedSize(printableArea);
      const res = json(e.loadModel(path, plate, w, d));
      e.FS.unlink(path);
      return { ...res, info: JSON.parse(e.modelInfoJson()) };
    },
    clear(e) {
      e.clearModel();
      return JSON.parse(e.modelInfoJson());
    },
    preview(e, plate) {
      const m = e.previewMesh(plate);
      return { value: m, transfer: [m.positions.buffer, m.filaments.buffer, m.objectTriangles.buffer] };
    },
    transform: (e, o, i, changes) => (json(e.setInstanceTransform(o, i, JSON.stringify(changes))), JSON.parse(e.modelInfoJson())),
    setExtruder: (e, o, v, f) => (json(e.setExtruder(o, v, f)), JSON.parse(e.modelInfoJson())),
    deleteObject: (e, o) => (json(e.deleteObject(o)), JSON.parse(e.modelInfoJson())),
    addInstance: (e, o, i, dx, dy) => (json(e.addInstance(o, i, dx, dy)), JSON.parse(e.modelInfoJson())),
    deleteInstance: (e, o, i) => (json(e.deleteInstance(o, i)), JSON.parse(e.modelInfoJson())),
    resizePlates: (e, w, d) => (json(e.resizePlates(w, d)), JSON.parse(e.modelInfoJson())),
    arrangePlate: (e, plate, spacing) => (json(e.arrangePlate(plate, spacing)), JSON.parse(e.modelInfoJson())),
    orientObject: (e, o) => (json(e.orientObject(o)), JSON.parse(e.modelInfoJson())),
    splitObject: (e, o) => (json(e.splitObject(o)), JSON.parse(e.modelInfoJson())),
    cutObject: (e, o, i, z, keep, flip) => (json(e.cutObject(o, i, z, keep, flip)), JSON.parse(e.modelInfoJson())),
    mirrorInstance: (e, o, i, axis) => (json(e.mirrorInstance(o, i, axis)), JSON.parse(e.modelInfoJson())),
    setObjectSettings: (e, o, v, values) => (json(e.setObjectSettings(o, v, JSON.stringify(values))), JSON.parse(e.modelInfoJson())),
    // A paint stroke; returns the project plus whatever shows the new paint.
    paint(e, plate, options) {
      json(e.paint(plate, JSON.stringify(options)));
      const info = JSON.parse(e.modelInfoJson());
      if (options.kind === 'color') {
        const m = e.previewMesh(plate);
        return { value: { info, preview: m }, transfer: [m.positions.buffer, m.filaments.buffer, m.objectTriangles.buffer] };
      }
      const o = e.paintOverlay(plate, options.kind);
      return { value: { info, overlay: o }, transfer: [o.positions.buffer, o.states.buffer] };
    },
    paintOverlay(e, plate, kind) {
      const o = e.paintOverlay(plate, kind);
      return { value: o, transfer: [o.positions.buffer, o.states.buffer] };
    },
    clearPaint: (e, o, kind) => (json(e.clearPaint(o, kind)), JSON.parse(e.modelInfoJson())),
    addPlate: (e) => (json(e.addPlate()), JSON.parse(e.modelInfoJson())),
    deletePlate: (e, plate) => (json(e.deletePlate(plate)), JSON.parse(e.modelInfoJson())),

    // Slices one plate with the current preset selection plus overrides.
    slice(e, plate, overrides, id) {
      const t0 = performance.now();
      const { config } = json(e.presetsFullConfig(JSON.stringify(overrides || {})));
      const result = JSON.parse(e.sliceWithConfig(JSON.stringify(config), plate, '/work/plate.gcode', (pct, stage) =>
        postMessage({ type: 'progress', id, pct, stage })));
      if (!result.success) throw new Error(result.error || 'Slicing failed');
      const gcode = e.FS.readFile(result.gcodePath).buffer;
      e.FS.unlink(result.gcodePath);
      return { value: { result, gcode, ms: performance.now() - t0 }, transfer: [gcode] };
    },
  };

  self.onmessage = async ({ data }) => {
    const { id, method, args = [] } = data;
    try {
      const engine = await ready;
      const fn = methods[method];
      if (!fn) throw new Error(`Unknown request: ${method}`);
      const out = fn(engine, ...args, id);
      if (out && out.transfer) postMessage({ type: 'result', id, value: out.value }, out.transfer);
      else postMessage({ type: 'result', id, value: out });
    } catch (e) {
      postMessage({ type: 'error', id, message: e?.message ?? String(e) });
    }
  };

  ready.catch((e) => {
    console.error('Engine failed to start', e?.stack ?? e);
    postMessage({ type: 'error', id: null, message: `Engine failed to start: ${e?.message ?? e}` });
  });
}
