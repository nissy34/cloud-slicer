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
//   <- { type: 'loading', loading }                start-up: { stage: 'download' | 'setup', loaded, total } bytes
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

  // Start-up progress for the page's loading screen: bytes of the wasm and
  // profiles.json downloaded so far. Their sizes come from the page (?bytes=),
  // since a compressed response has no usable length.
  const download = { loaded: 0, total: Number(new URLSearchParams(self.location.search).get('bytes')) || 0, sent: 0 };
  const loading = (stage) => postMessage({ type: 'loading', loading: { stage, loaded: download.loaded, total: download.total } });
  // A copy of `res` that reports its bytes as they arrive.
  const counted = (res) => {
    if (!res.body || typeof TransformStream === 'undefined') return res;
    const count = new TransformStream({
      transform(chunk, out) {
        download.loaded += chunk.byteLength;
        const now = performance.now();
        if (now - download.sent > 100) {
          download.sent = now;
          loading('download');
        }
        out.enqueue(chunk);
      },
    });
    return new Response(res.body.pipeThrough(count), { headers: res.headers });
  };
  const fetchCounted = async (file) => {
    const res = await fetch(here(file));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    return counted(res);
  };

  let startFailed;
  const failed = new Promise((_, reject) => (startFailed = reject));
  // Emscripten's hook for loading the wasm ourselves: the same streaming
  // compile it does by default, through the byte counter.
  const instantiateWasm = (imports, receive) => {
    fetchCounted('orca-engine.wasm')
      .then(async (res) => {
        const wasm = new Response(res.body, { headers: { 'Content-Type': 'application/wasm' } });
        const { instance, module } = WebAssembly.instantiateStreaming
          ? await WebAssembly.instantiateStreaming(wasm, imports)
          : await WebAssembly.instantiate(await wasm.arrayBuffer(), imports);
        loading('setup');
        receive(instance, module);
      })
      .catch(startFailed);
    return {};
  };

  loading('download');
  const ready = Promise.all([
    Promise.race([createOrcaEngine({ print: log, printErr: log, locateFile: here, instantiateWasm }), failed]),
    fetchCounted('profiles.json').then((r) => r.json()),
  ]).then(([engine, bundle]) => {
    loading('setup');
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
    filamentsFor: (e, printer) => json(e.presetsFilamentsFor(printer)),
    fullConfig: (e, overrides) => json(e.presetsFullConfig(JSON.stringify(overrides || {}))),
    presetConfig: (e, type, name) => JSON.parse(e.presetConfig(type, name) || 'null'),
    options: (e) => JSON.parse(e.configOptionsJson()),
    modelInfo: (e) => JSON.parse(e.modelInfoJson()),
    fileConfig: (e) => JSON.parse(e.fileConfigJson()),

    // Adds a geometry file to the project, or opens a 3MF project
    // (geometryOnly adds a 3MF's objects instead).
    load(e, name, bytes, plate, printableArea, geometryOnly) {
      const path = `/work/${name.replace(/[^\w.\-]+/g, '_')}`;
      e.FS.writeFile(path, new Uint8Array(bytes));
      const [w, d] = bedSize(printableArea);
      const res = json(e.loadModel(path, plate, w, d, !!geometryOnly));
      e.FS.unlink(path);
      return { ...res, info: JSON.parse(e.modelInfoJson()) };
    },
    // The project as an Orca 3MF (desktop's Save project) with the current
    // presets plus overrides as its settings. thumbnail: {plate, width,
    // height, pixels} RGBA rows top first, or null.
    saveProject(e, overrides, thumbnail) {
      const { config } = json(e.presetsFullConfig(JSON.stringify(overrides || {})));
      const path = '/work/project.3mf';
      json(e.saveProject(path, JSON.stringify(config), thumbnail || null));
      const bytes = e.FS.readFile(path).buffer;
      e.FS.unlink(path);
      return { value: bytes, transfer: [bytes] };
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
    splitParts: (e, o) => (json(e.splitParts(o)), JSON.parse(e.modelInfoJson())),
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
    // Colour mixing: the mixed-filament list (see engine/src/mixed_api.cpp).
    // An edit that removes a filament also moves the project's IDs, so the
    // project comes back with it.
    mixed(e, request) {
      const out = json(e.mixedFilaments(JSON.stringify(request)));
      const kind = request.op?.kind;
      return kind === 'delete' || kind === 'removePhysical' ? { ...out, info: JSON.parse(e.modelInfoJson()) } : out;
    },
    mixedBlend: (e, request) => json(e.mixedBlend(JSON.stringify(request))).colours,
    mixedMatch: (e, request) => json(e.mixedMatch(JSON.stringify(request))),
    clearPaint: (e, o, kind) => (json(e.clearPaint(o, kind)), JSON.parse(e.modelInfoJson())),
    // Undo history: {undo, redo} are the labels of the next steps, or null.
    snapshot: (e, label) => json(e.snapshot(label)),
    dropSnapshot: (e) => json(e.dropSnapshot()),
    clearHistory: (e) => json(e.clearHistory()),
    undo: (e) => ({ history: json(e.undo()), info: JSON.parse(e.modelInfoJson()) }),
    redo: (e) => ({ history: json(e.redo()), info: JSON.parse(e.modelInfoJson()) }),
    // Replaces the user presets ([{type, name, inherits, config}], Orca diffs
    // over a system preset) and reloads every preset, like desktop start-up.
    // The selection resets; the caller selects again.
    userPresets(e, presets) {
      const root = `${DATA_DIR}/user`;
      const remove = (path) => {
        if (!e.FS.analyzePath(path).exists) return;
        for (const name of e.FS.readdir(path)) {
          if (name === '.' || name === '..') continue;
          const child = `${path}/${name}`;
          if (e.FS.isDir(e.FS.stat(child).mode)) remove(child);
          else e.FS.unlink(child);
        }
        e.FS.rmdir(path);
      };
      remove(root);
      const folder = { printer: 'machine', filament: 'filament', process: 'process' };
      for (const p of presets || []) {
        const dir = `${root}/default/${folder[p.type]}`;
        e.FS.mkdirTree(dir);
        // Orca skips a user preset file without a version.
        const preset = { ...p.config, name: p.name, inherits: p.inherits, from: 'User', is_custom_defined: '0', version: '1.0.0' };
        e.FS.writeFile(`${dir}/${p.name}.json`, JSON.stringify(preset));
      }
      return json(e.presetsLoad(DATA_DIR)).counts;
    },
    addPlate: (e) => (json(e.addPlate()), JSON.parse(e.modelInfoJson())),
    deletePlate: (e, plate) => (json(e.deletePlate(plate)), JSON.parse(e.modelInfoJson())),

    // Replaces the project with a calibration test (desktop's Calibration
    // menu). Returns the settings the test changes, for the page to apply as
    // overrides, and the new project.
    async calibrate(e, options, overrides) {
      const res = await fetch(here(`calib/${options.model}`));
      if (!res.ok) throw new Error(`Calibration model ${options.model}: HTTP ${res.status}`);
      const path = `/work/${options.model.split('/').pop()}`;
      e.FS.writeFile(path, new Uint8Array(await res.arrayBuffer()));
      const { config } = json(e.presetsFullConfig(JSON.stringify(overrides || {})));
      const [w, d] = bedSize(config.printable_area);
      try {
        const out = json(e.calibrationStart(JSON.stringify({ ...options, model: path }), JSON.stringify(config), w, d));
        return { overrides: out.overrides, info: JSON.parse(e.modelInfoJson()) };
      } finally {
        e.FS.unlink(path);
      }
    },

    calibrationStop: (e) => e.calibrationStop(),

    // Slices one plate with the current preset selection plus overrides.
    // thumbnails: the page's plate pictures, [{width, height, pixels}].
    slice(e, plate, overrides, thumbnails, id) {
      const t0 = performance.now();
      const { config } = json(e.presetsFullConfig(JSON.stringify(overrides || {})));
      const result = JSON.parse(e.sliceWithConfig(JSON.stringify(config), plate, '/work/plate.gcode', (pct, stage) =>
        postMessage({ type: 'progress', id, pct, stage }), thumbnails || []));
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
      const out = await fn(engine, ...args, id);
      if (out && out.transfer) postMessage({ type: 'result', id, value: out.value }, out.transfer);
      else postMessage({ type: 'result', id, value: out });
    } catch (e) {
      postMessage({ type: 'error', id, message: e?.message ?? String(e) });
    }
  };

  ready.catch((e) => {
    console.error('Engine failed to start', e?.stack ?? e);
    postMessage({ type: 'error', id: null, message: `Engine failed to start: ${e?.message ?? e}${e?.stack ? `\n${e.stack}` : ''}` });
  });
}
