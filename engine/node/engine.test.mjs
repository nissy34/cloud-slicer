// Engine tests: presets, model loading and slicing through the wasm module.
//   node --test engine/node/engine.test.mjs
// Needs engine/build/engine/orca-engine.js and engine/build/profiles/profiles.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync, inflateSync } from 'node:zlib';
import { DATA_DIR, DEFAULT_PRINTER, bedSize, call, openEngine } from './engine.mjs';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
let engine;
let presets;
// Which engine this build is (engine/README.md, "Two engines"): the same tests
// run on both; preset names differ and colour mixing is Snapmaker Orca's own.
let flavor = { flavor: 'snapmaker', mixing: true };
let STANDARD = '0.20mm Standard @Snapmaker U1 (0.4 nozzle)';

before(async () => {
  ({ engine, presets } = await openEngine());
  if (engine.engineInfo) flavor = JSON.parse(engine.engineInfo());
  if (flavor.flavor === 'orca') STANDARD = '0.20 Standard @Snapmaker U1 (0.4 nozzle)';
});
// Snapmaker Orca's colour mixing (engine/src/mixed_api.cpp) isn't in OrcaSlicer.
const needsMixing = (t) => !flavor.mixing && (t.skip('colour mixing is Snapmaker Orca only'), true);
after(() => setImmediate(() => process.exit(process.exitCode ?? 0)));  // pthread workers keep Node alive

const select = (selection) => call(engine, 'presetsSelect', JSON.stringify(selection));
const fullConfig = (overrides = {}) => call(engine, 'presetsFullConfig', JSON.stringify(overrides)).config;

// Opens a fixture as a new project; `add` adds it to the open one instead
// (a 3MF as geometry only).
function load(name, plate = 0, add = false, orientation = 0) {
  const path = `/work/${name}`;
  engine.FS.writeFile(path, typeof name === 'string' && !name.startsWith('gen-') ? readFileSync(resolve(fixtures, name)) : generated[name]);
  const [w, d] = bedSize(fullConfig());
  if (!add) engine.clearModel();
  call(engine, 'loadModel', path, plate, w, d, add, orientation);
  return JSON.parse(engine.modelInfoJson());
}

// ASCII STL of axis-aligned cubes (size s mm) at the given corners: one mesh
// with several separate pieces.
function cubesStl(corners, s = 10) {
  const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
  const tris = corners.flatMap(([x, y, z]) => {
    const v = (i, j, k) => [x + i * s, y + j * s, z + k * s];
    return [
      ...quad(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
      ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)), ...quad(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)),
      ...quad(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)), ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
    ];
  });
  const facets = tris.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((p) => `vertex ${p.join(' ')}`).join('\n')}\nendloop\nendfacet`);
  return new TextEncoder().encode(`solid cubes\n${facets.join('\n')}\nendsolid cubes\n`);
}
// ASCII STL of an upright cylinder (radius r, height h) with `n` sides, centred on x = y = 0.
function cylinderStl(r, h, n = 96) {
  const at = (k, z) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), z];
  const tris = [];
  for (let k = 0; k < n; k++) {
    const [a, b, c, d] = [at(k, 0), at(k + 1, 0), at(k + 1, h), at(k, h)];
    tris.push([a, b, c], [a, c, d], [[0, 0, 0], b, a], [[0, 0, h], d, c]);
  }
  const facets = tris.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((p) => `vertex ${p.join(' ')}`).join('\n')}\nendloop\nendfacet`);
  return new TextEncoder().encode(`solid cylinder\n${facets.join('\n')}\nendsolid cylinder\n`);
}
const generated = {
  'gen-two-cubes.stl': cubesStl([[0, 0, 0], [30, 0, 0]]),
  'gen-cube-20.stl': cubesStl([[0, 0, 0]], 20),
  'gen-cylinder.stl': cylinderStl(15, 30),
};

// The files in a zip (stored or deflated), and a zip (stored) made of files.
function unzip(bytes) {
  const buf = Buffer.from(bytes);
  const files = {};
  let end = buf.length - 22;
  while (buf.readUInt32LE(end) !== 0x06054b50) end--;
  let at = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const [method, size, nameLen, extraLen, commentLen, local] = [10, 20, 28, 30, 32, 42].map((o) => (o === 20 || o === 42 ? buf.readUInt32LE(at + o) : buf.readUInt16LE(at + o)));
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(data, data + size);
    files[name] = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc32(data), 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, data);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dirBuf = Buffer.concat(central), tail = Buffer.alloc(22);
  tail.writeUInt32LE(0x06054b50, 0);
  tail.writeUInt16LE(Object.keys(files).length, 8); tail.writeUInt16LE(Object.keys(files).length, 10);
  tail.writeUInt32LE(dirBuf.length, 12); tail.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, tail]);
}

function slice(config, plate = 0, thumbnails = null, name = '') {
  const result = JSON.parse(engine.sliceWithConfig(JSON.stringify(config), plate, '/work/out.gcode', null, thumbnails, name));
  assert.ok(result.success, `slice failed: ${result.error}`);
  return { result, gcode: new TextDecoder().decode(engine.FS.readFile(result.gcodePath)) };
}

/** Each filament's length as the G-code's statistics give it ("; filament used [mm] = a, b"). */
const usedMm = (gcode) => /^; filament used \[mm\] = (.*)$/m.exec(gcode)[1].split(',').map(Number);

const toolCounts = (gcode) => {
  const counts = {};
  for (const m of gcode.matchAll(/^T(\d+)\s*$/gm)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  return counts;
};

test('loads every Snapmaker printer, filament and process preset', () => {
  assert.ok(presets.counts.printers >= 10, JSON.stringify(presets.counts));
  assert.ok(presets.counts.filaments >= 100, JSON.stringify(presets.counts));
  assert.ok(presets.counts.processes >= 20, JSON.stringify(presets.counts));
  const printers = JSON.parse(engine.presetsPrinters()).map((p) => p.name);
  for (const n of ['0.2', '0.4', '0.6', '0.8']) assert.ok(printers.includes(`Snapmaker U1 (${n} nozzle)`), `U1 ${n} missing`);
});

test('selecting the U1 lists only compatible presets and resolves its full config', () => {
  const sel = select({ printer: DEFAULT_PRINTER });
  assert.equal(sel.selection.printer, DEFAULT_PRINTER);
  assert.ok(sel.processes.length > 0 && sel.processes.every((p) => p.compatible));
  assert.ok(sel.processes.some((p) => p.name === STANDARD));
  assert.ok(sel.filaments.some((f) => /PLA/.test(f.name)));
  const cfg = fullConfig();
  assert.equal(cfg.gcode_flavor, 'klipper');
  assert.ok(Math.abs(Number(cfg.printable_height) - 270) < 1, cfg.printable_height);
  assert.match(cfg.machine_start_gcode, /PRINT_START/);
  assert.equal(cfg.nozzle_diameter.split(',').length, 4, 'U1 has four extruders');
});

test('overrides apply on top of the presets', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  const cfg = fullConfig({ sparse_infill_density: '42%', wall_loops: 5 });
  assert.equal(cfg.sparse_infill_density, '42%');
  assert.equal(cfg.wall_loops, '5');
  assert.equal(cfg.layer_height, '0.2');
});

test('option metadata covers the print, filament and printer settings', () => {
  const opts = JSON.parse(engine.configOptionsJson());
  assert.ok(Object.keys(opts).length > 500);
  assert.equal(opts.layer_height.type, 'float');
  assert.ok(opts.sparse_infill_pattern.enumValues.includes('gyroid'));
  assert.ok(['simple', 'advanced', 'develop'].includes(opts.wall_loops.mode));
  // What an object or a part can carry on its own (desktop's "Add settings").
  assert.equal(opts.wall_loops.scope, 'region');
  assert.equal(opts.layer_height.scope, 'object');
  assert.equal(opts.enable_support.scope, 'object');
  assert.equal(opts.nozzle_temperature.scope, undefined);
});

test('slices an STL with the U1 presets', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  const info = load('tetrahedron.stl');
  assert.equal(info.objects.length, 1);
  assert.equal(info.objects[0].instances[0].plate, 0);
  const { result, gcode } = slice(fullConfig());
  assert.match(gcode, /^PRINT_START/m);
  assert.match(gcode, /^EXCLUDE_OBJECT_DEFINE/m);
  assert.ok(result.totalLayers > 10);
  assert.ok(result.estimatedTimeSeconds > 0);
  // Desktop's Prepare time: part of the total, the start G-code's share.
  assert.ok(result.prepareSeconds >= 0 && result.prepareSeconds < result.estimatedTimeSeconds, `prepare ${result.prepareSeconds} s`);
});

test('the layer count is the G-code\'s, support layers included only once', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  load('3DBenchy.stl');
  const { result, gcode } = slice(fullConfig({ enable_support: '1', support_type: 'normal(auto)' }));
  assert.match(gcode, /^;TYPE:Support/m, 'the Benchy gets supports');
  const written = Number(/^; total layer number: (\d+)/m.exec(gcode)?.[1]);
  assert.equal(result.totalLayers, written, `summary ${result.totalLayers}, G-code ${written}`);
  // Filament use split like desktop's Filament view: the model and its support.
  const parts = result.filamentParts['1'];
  assert.ok(parts.model.mm > 0 && parts.model.g > 0, JSON.stringify(result.filamentParts));
  assert.ok(parts.support.mm > 0 && parts.support.g > 0, JSON.stringify(result.filamentParts));
  assert.ok(!parts.tower && !parts.flushed, 'one filament: no tower, nothing flushed');
  const sum = Object.values(parts).reduce((a, p) => a + p.mm, 0);
  const used = usedMm(gcode)[0];
  assert.ok(Math.abs(sum - used) < 1, `parts ${sum} mm, G-code ${used} mm`);
});

test('slicing reports desktop\'s warnings: G-code path conflicts and models that need support', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  // Two separate objects overlapping by half: their paths cross on every layer.
  load('gen-cube-20.stl');
  load('gen-cube-20.stl', 0, true);
  call(engine, 'setInstanceTransform', 0, 0, JSON.stringify({ offset: [100, 100] }));
  call(engine, 'setInstanceTransform', 1, 0, JSON.stringify({ offset: [110, 100] }));
  const { result } = slice(fullConfig());
  const conflict = result.warnings.find((w) => /^Conflicts of G-code paths have been found at layer \d+, z = [\d.]+ mm/.test(w.text));
  assert.ok(conflict, JSON.stringify(result.warnings));
  assert.equal(conflict.level, 'serious');

  // A 20 mm ledge sticking out at 10 mm, with supports off.
  engine.FS.writeFile('/work/gen-ledge.stl', cubesStl([[0, 0, 0], [10, 0, 10], [20, 0, 10]]));
  engine.clearModel();
  const [w, d] = bedSize(fullConfig());
  call(engine, 'loadModel', '/work/gen-ledge.stl', 0, w, d, false);
  const ledge = slice(fullConfig({ enable_support: '0' })).result;
  const support = ledge.warnings.find((x) => /Please re-orient the object or enable support generation/.test(x.text));
  assert.ok(support, JSON.stringify(ledge.warnings));
  assert.equal(support.level, 'warning');
  assert.match(support.object ?? '', /gen-ledge/);
});

test('a slice stops when the page cancels it, and the engine slices again after', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  load('3DBenchy.stl');
  const cfg = JSON.stringify(fullConfig());
  // [0] the request id to cancel, [1] the running slice's id (the worker's job in the browser).
  const cells = engine.sliceCancelFlag();
  const run = (id, cancelAt) => {
    Atomics.store(cells, 1, id);
    const seen = [];
    try {
      return { seen, result: JSON.parse(engine.sliceWithConfig(cfg, 0, '/work/out.gcode', (pct) => {
        seen.push(pct);
        // The page clicks Cancel while the engine is busy (here, from inside its progress callback).
        if (cancelAt != null && pct >= cancelAt) Atomics.store(cells, 0, cancelAt === -1 ? id + 1 : id);
      }, null, '')) };
    } finally {
      Atomics.store(cells, 1, 0);
    }
  };

  const cancelled = run(7, 5);
  assert.equal(cancelled.result.success, false);
  assert.equal(cancelled.result.cancelled, true);
  assert.ok(Math.max(...cancelled.seen) < 90, `stopped before G-code export, progress ${cancelled.seen}`);

  // Cancelling another request leaves this one alone, and the engine still slices.
  const other = run(8, -1);
  assert.ok(other.result.success, `slice after cancel failed: ${other.result.error}`);
  assert.match(new TextDecoder().decode(engine.FS.readFile('/work/out.gcode')), /^PRINT_START/m);
});

// Thumbnail blocks Orca wrote: [{format, width, height, png bytes}].
function thumbnailBlocks(gcode) {
  return [...gcode.matchAll(/^; (thumbnail\w*) begin (\d+)x(\d+) (\d+)\n([\s\S]*?)^; \1 end$/gm)].map((m) => {
    const data = Buffer.from(m[5].replace(/^; /gm, '').replace(/\s/g, ''), 'base64');
    assert.equal(m[5].replace(/^; /gm, '').replace(/\s/g, '').length, Number(m[4]));
    return { tag: m[1], width: Number(m[2]), height: Number(m[3]), data };
  });
}

// RGBA of one pixel (top-left origin) of a PNG Orca wrote (8-bit RGBA, filter 0 rows).
function pngPixel(png, x, y) {
  const w = png.readUInt32BE(16);
  const idat = [];
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const row = raw.subarray(y * (w * 4 + 1), (y + 1) * (w * 4 + 1));
  assert.equal(row[0], 0, 'unfiltered row');
  return [...row.subarray(1 + x * 4, 5 + x * 4)];
}

test('embeds the plate picture as the printer profile\'s thumbnails', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  const cfg = fullConfig();
  assert.equal(cfg.thumbnails, '48x48/PNG, 300x300/PNG');
  load('tetrahedron.stl');
  // Rows bottom to top, like glReadPixels: bottom half red, top half blue.
  const pixels = new Uint8Array(300 * 300 * 4);
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 300; x++) pixels.set(y < 150 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 300 + x) * 4);
  const { gcode } = slice(cfg, 0, [{ width: 300, height: 300, pixels }]);
  const blocks = thumbnailBlocks(gcode);
  assert.deepEqual(blocks.map((b) => `${b.tag} ${b.width}x${b.height}`), ['thumbnail 48x48', 'thumbnail 300x300']);
  for (const b of blocks) {
    assert.equal(b.data.toString('latin1', 1, 4), 'PNG');
    assert.equal(b.data.readUInt32BE(16), b.width);
  }
  // The 48x48 one is resampled from the 300x300 picture; both stay upright.
  for (const b of blocks) {
    assert.deepEqual(pngPixel(b.data, 2, 2), [0, 0, 255, 255], `${b.width}: top is blue`);
    assert.deepEqual(pngPixel(b.data, 2, b.height - 3), [255, 0, 0, 255], `${b.width}: bottom is red`);
  }
  // Before the first move, inside the header Moonraker scans.
  assert.ok(gcode.indexOf('; THUMBNAIL_BLOCK_START') < gcode.search(/^G1 /m));
  // QOI, as some printers ask for, comes from the same picture.
  const qoi = thumbnailBlocks(slice({ ...cfg, thumbnails: '96x96/QOI' }, 0, [{ width: 300, height: 300, pixels }]).gcode);
  assert.deepEqual(qoi.map((b) => `${b.tag} ${b.width}x${b.height}`), ['thumbnail_QOI 96x96']);
  assert.equal(qoi[0].data.toString('latin1', 0, 4), 'qoif');
  // No picture, no thumbnail blocks.
  assert.doesNotMatch(slice(cfg).gcode, /thumbnail begin/);
});

// N slots of the printer's default PLA, like adding filaments in the sidebar.
function selectSlots(n) {
  const pla = select({ printer: DEFAULT_PRINTER }).filaments.find((f) => /Snapmaker PLA/.test(f.name))
    ?? select({ printer: DEFAULT_PRINTER }).filaments[0];
  return select({ printer: DEFAULT_PRINTER, filaments: Array(n).fill(pla.name) });
}

test('Bambu 3MF with painted colours slices with several tools', () => {
  select({ printer: DEFAULT_PRINTER });
  const info = load('colored_3DBenchy.3mf');
  assert.ok(info.objects.some((o) => o.volumes.some((v) => v.painted)), 'paint data lost on load');
  const colours = info.file.filamentColours.split(';').filter(Boolean);
  assert.ok(colours.length >= 2, `file colours: ${info.file.filamentColours}`);
  const n = Math.min(colours.length, 4);
  assert.equal(selectSlots(n).selection.filaments.length, n);
  const cfg = fullConfig({ filament_colour: colours.slice(0, n).join(';') });
  const { gcode } = slice(cfg);
  const tools = Object.keys(toolCounts(gcode));
  assert.ok(tools.length >= 2, `tools used: ${tools}`);
  // The file paints with filaments 5-10 too, but lists 4. Desktop drops that
  // paint when it opens the project, and the slice prints those areas with
  // the object's filament: Prepare shows the filaments the G-code uses.
  const mesh = engine.previewMesh(0);
  const highest = mesh.filaments.reduce((a, b) => Math.max(a, b), 0);
  assert.ok(highest <= colours.length, `Prepare shows filament ${highest} of ${colours.length}`);
  const printed = info.objects.findIndex((o) => o.instances[0].printable);
  const first = [...mesh.objectTriangles].slice(0, printed).reduce((a, b) => a + b, 0);
  const shown = new Set(mesh.filaments.subarray(first, first + mesh.objectTriangles[printed]));
  assert.deepEqual([...shown].sort().map((f) => String(f - 1)), tools.sort(), 'Prepare and the G-code use the same filaments');
});

test('dual-colour 3MF keeps per-part filaments', () => {
  select({ printer: DEFAULT_PRINTER });
  const info = load('calib-cube-10-dual-colour-merged.3mf');
  const extruders = new Set(info.objects.flatMap((o) => o.volumes.filter((v) => v.kind === 'part').map((v) => v.extruder)));
  assert.ok(extruders.size >= 2, `extruders: ${[...extruders]}`);
  selectSlots(2);
  const { gcode } = slice(fullConfig({ filament_colour: '#FF0000;#0000FF' }));
  assert.ok(Object.keys(toolCounts(gcode)).length >= 2);
});

test('prime tower: shown and sized like desktop Prepare, sliced where it was placed', () => {
  selectSlots(2);
  load('calib-cube-10-dual-colour-merged.3mf');
  const two = { filament_colour: '#FF0000;#0000FF', enable_prime_tower: '1' };
  const tower = (overrides, plate = 0, sliced = -1) => JSON.parse(engine.wipeTowerJson(JSON.stringify(fullConfig(overrides)), plate, sliced));

  const t = tower(two);
  assert.ok(t.show, JSON.stringify(t));
  assert.deepEqual(t.filaments, [1, 2]);
  assert.equal(t.width, Number(fullConfig(two).prime_tower_width));
  assert.ok(t.depth > 0 && t.height > 9, JSON.stringify(t));
  assert.ok(!tower({ ...two, enable_prime_tower: '0' }).show, 'prime tower turned off');
  // Off the bed it comes back on, like desktop.
  const [w, d] = bedSize(fullConfig());
  const far = tower({ ...two, wipe_tower_x: '900', wipe_tower_y: '-50' });
  assert.ok(far.x + far.width < w && far.x > 0 && far.y > 0 && far.y + far.depth < d, JSON.stringify(far));

  // One position per plate; the slice puts the tower where this plate's says.
  const placed = { ...two, wipe_tower_x: '120,5', wipe_tower_y: '40,5' };
  const at = tower(placed);
  assert.equal(at.x, 120);
  assert.equal(at.y, 40);
  const { gcode, result } = slice(fullConfig(placed));
  assert.ok(result.wipeTowerDepth > 0, `sliced tower depth: ${result.wipeTowerDepth}`);
  // Both filaments print part of the model and part of the tower, adding up to
  // the G-code's total. (Per filament OrcaSlicer's statistics charge some tower
  // filament to the other filament; the parts follow the G-code's tools.)
  for (const f of ['1', '2']) {
    const parts = result.filamentParts[f];
    assert.ok(parts?.model?.mm > 0 && parts?.tower?.mm > 0, JSON.stringify(result.filamentParts));
  }
  const sum = Object.values(result.filamentParts).flatMap(Object.values).reduce((a, p) => a + p.mm, 0);
  const used = usedMm(gcode).reduce((a, mm) => a + mm, 0);
  assert.ok(Math.abs(sum - used) < 1, `parts ${sum} mm, G-code ${used} mm`);
  const xs = [], ys = [];
  let inTower = false;
  for (const line of gcode.split('\n')) {
    if (line.startsWith(';TYPE:')) inTower = line.startsWith(';TYPE:Prime tower');
    // Extrusions only: the tool change G-code in between parks the head.
    const m = inTower && /^G1 .*X([-\d.]+) Y([-\d.]+).* E[\d.]+/.exec(line);
    if (m) xs.push(Number(m[1])), ys.push(Number(m[2]));
  }
  assert.ok(xs.length > 0, 'no prime tower moves');
  // The tower stands where placed (its brim, wider than set, round it).
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const box = `X${x0}..${x1} Y${y0}..${y1}`;
  assert.ok(x0 <= 120.5 && x1 >= 120 + t.width - 1 && y0 <= 40.5 && y1 >= 40 + result.wipeTowerDepth - 1, `tower ${box}`);
  assert.ok(x0 >= 105 && x1 <= 120 + t.width + 15 && y0 >= 25 && y1 <= 40 + result.wipeTowerDepth + 15, `tower ${box}`);
  // Once sliced, the view shows the tower as deep as the slice made it, but
  // never shallower than the engine's minimum for the object's height
  // (WipeTower::min_depth_per_height): 20 mm up to 100 mm tall in Snapmaker
  // Orca; OrcaSlicer starts at 5 mm for 5 mm and grows to 20 mm at 100 mm.
  const minDepth = flavor.flavor === 'orca' ? 5 + ((10 - 5) * (20 - 5)) / (100 - 5) : 20;
  const shown = tower(placed, 0, result.wipeTowerDepth).depth;
  assert.ok(Math.abs(shown - Math.max(result.wipeTowerDepth, minDepth)) < 1e-4, `shown ${shown}, sliced ${result.wipeTowerDepth}`);

  // A plate printed with one filament has no tower.
  load('tetrahedron.stl');
  assert.ok(!tower(two).show, 'single-filament plate');
  // Printed with a mix only, the slice makes no tower (Orca counts the mix as
  // one filament), so none shows; with the mix and another filament it does.
  if (!flavor.mixing) return;
  const mix = call(engine, 'mixedFilaments', JSON.stringify({ definitions: '', colours: ['#FF0000', '#0000FF'], op: { kind: 'add', row: { componentA: 1, componentB: 2, mixBPercent: 50, uiMode: 0 } } }));
  call(engine, 'setExtruder', 0, -1, 3);
  const withMix = { ...two, mixed_filament_definitions: mix.definitions };
  assert.ok(!tower(withMix).show, 'only a mix on the plate');
  assert.ok(!/;TYPE:Prime tower/.test(slice(fullConfig(withMix)).gcode), 'the slice makes no tower for a mix alone');
  load('tetrahedron.stl', 0, true);
  call(engine, 'setExtruder', 1, -1, 1);
  const m = tower(withMix);
  assert.ok(m.show, 'a mix and a filament');
  assert.deepEqual(m.filaments, [1, 2]);
  assert.ok(/;TYPE:Prime tower/.test(slice(fullConfig(withMix)).gcode), 'the slice makes the tower');
});

test('resizing plates keeps objects centred on their plate', () => {
  select({ printer: DEFAULT_PRINTER });
  const info = load('calib-cube-10-dual-colour-merged.3mf');  // made on a 180 mm A1 mini bed
  assert.ok(Math.abs(info.plateWidth - 180) < 1, `plate ${info.plateWidth}`);
  const centre = (i) => {
    const inst = i.objects[0].instances[0];
    return [inst.offset[0] - i.plateWidth / 2, inst.offset[1] - i.plateDepth / 2];
  };
  const before = centre(info);
  call(engine, 'resizePlates', 270, 270);
  const after = JSON.parse(engine.modelInfoJson());
  assert.equal(after.plateWidth, 270);
  assert.equal(after.objects[0].instances[0].plate, 0);
  assert.ok(Math.abs(centre(after)[0] - before[0]) < 0.01 && Math.abs(centre(after)[1] - before[1]) < 0.01);
});

const info = () => JSON.parse(engine.modelInfoJson());
const cut = (request) => JSON.stringify(request);

test('object tools: cut, split, mirror, orient', () => {
  select({ printer: DEFAULT_PRINTER });
  let m = load('3DBenchy.stl');
  const height = m.objects[0].size[2];
  call(engine, 'cutObject', 0, 0, cut({ position: 20, upper: 'place' }));
  m = info();
  assert.equal(m.objects.length, 2, 'cut gives two objects');
  const heights = m.objects.map((o) => o.size[2]).sort((a, b) => a - b);
  assert.ok(Math.abs(heights[0] - 20) < 0.5 && Math.abs(heights[1] - (height - 20)) < 0.5, `heights ${heights}`);

  m = load('calib-cube-10-dual-colour-merged.3mf');
  const objects = m.objects.length;
  call(engine, 'splitObject', 0);
  assert.ok(info().objects.length > objects, 'split adds objects');

  load('3DBenchy.stl');
  call(engine, 'mirrorInstance', 0, 0, 0);
  call(engine, 'orientObject', 0);
  assert.equal(info().objects.length, 1);
  assert.ok(info().objects[0].instances[0].offset[2] >= -0.01, 'on the bed');
});

test('cut with a turned plane: upright cut, parts kept, thrown away or laid on the cut', () => {
  select({ printer: DEFAULT_PRINTER });
  // The lowest point of each object on plate 1, from its triangles.
  const lowest = () => {
    const mesh = engine.previewMesh(0);
    const out = [];
    let tri = 0;
    for (const count of mesh.objectTriangles) {
      let z = Infinity;
      for (let k = tri * 9 + 2; k < (tri + count) * 9; k += 3) z = Math.min(z, mesh.positions[k]);
      if (count) out.push(z);
      tri += count;
    }
    return out;
  };
  let m = load('3DBenchy.stl');
  const [sx, , sz] = m.objects[0].size;
  // Turned 90° about Y the arrow points along +X: an upright cut through the middle.
  call(engine, 'cutObject', 0, 0, cut({ position: 0, rotation: [0, 90, 0] }));
  m = info();
  assert.equal(m.objects.length, 2, 'two halves');
  const widths = m.objects.map((o) => o.size[0]);
  assert.ok(Math.abs(widths[0] + widths[1] - sx) < 0.5, `widths ${widths} add up to ${sx}`);
  // Standing upright: the taller half (with the cabin) keeps the boat's height, both stay on the bed.
  assert.ok(Math.abs(Math.max(...m.objects.map((o) => o.size[2])) - sz) < 0.5, `the taller half stays ${sz} tall`);
  for (const o of m.objects) assert.ok(o.size[2] > sz / 2, `each half stands upright: ${o.size}`);
  for (const z of lowest()) assert.ok(Math.abs(z) < 0.01, `each half on the bed: ${z}`);

  m = load('3DBenchy.stl');
  call(engine, 'cutObject', 0, 0, cut({ position: 0, rotation: [0, 90, 0], asParts: true }));
  m = info();
  assert.equal(m.objects.length, 1, 'kept as one object');
  assert.equal(m.objects[0].volumes.filter((v) => v.kind === 'part').length, 2, 'with two parts');
  assert.ok(Math.abs(m.objects[0].size[0] - sx) < 0.5, 'the parts stay where they were');

  load('3DBenchy.stl');
  call(engine, 'cutObject', 0, 0, cut({ position: 0, rotation: [0, 90, 0], upper: 'place', lower: 'drop' }));
  m = info();
  assert.equal(m.objects.length, 1, 'the lower half is thrown away');
  assert.ok(Math.abs(m.objects[0].size[2] - widths[0]) < 1 || Math.abs(m.objects[0].size[2] - widths[1]) < 1, `laid on its cut face: ${m.objects[0].size}`);

  // Tilted 30° about X: both halves are on the bed and smaller than the boat.
  load('3DBenchy.stl');
  call(engine, 'cutObject', 0, 0, cut({ position: sz / 2, rotation: [30, 0, 0] }));
  m = info();
  assert.equal(m.objects.length, 2);
  for (const o of m.objects) assert.ok(o.size[2] < sz - 1, `each half is lower than the boat: ${o.size}`);
  for (const z of lowest()) assert.ok(Math.abs(z) < 0.01, `each half on the bed: ${z}`);
  assert.throws(() => call(engine, 'cutObject', 0, 0, cut({ position: 5, upper: 'drop', lower: 'drop' })), /at least one part/);
  engine.clearModel();
});

test('cut keeps multi-material paint and support painting on cut parts', () => {
  select({ printer: DEFAULT_PRINTER });
  load('colored_3DBenchy.3mf');
  const startInfo = info();
  assert.ok(startInfo.objects[0].volumes[0].painted);

  const preMesh = engine.previewMesh(0);
  const origUnique = new Set(preMesh.filaments);
  assert.ok(origUnique.size >= 4, 'all filaments present before cut');

  call(engine, 'cutObject', 0, 0, cut({ position: 15 }));

  const cutInfo = info();
  assert.equal(cutInfo.objects.length, 3, 'cut creates upper and lower parts');
  assert.ok(cutInfo.objects[1].volumes[0].painted, 'upper part keeps paint');
  assert.ok(cutInfo.objects[2].volumes[0].painted, 'lower part keeps paint');

  const cutMesh = engine.previewMesh(0);
  const start1 = cutMesh.objectTriangles[0];
  const end1 = start1 + cutMesh.objectTriangles[1];
  const upperFil = new Set(cutMesh.filaments.subarray(start1, end1));
  const lowerFil = new Set(cutMesh.filaments.subarray(end1));
  assert.ok(upperFil.size >= 3, `upper part has multiple painted filaments: ${[...upperFil]}`);
  assert.ok(lowerFil.size >= 3, `lower part has multiple painted filaments: ${[...lowerFil]}`);
  engine.clearModel();
});

test('cut does not cross-contaminate paint onto unpainted volumes in multi-volume objects', () => {
  select({ printer: DEFAULT_PRINTER });
  load('calib-cube-10-dual-colour-merged.3mf');
  const start = info();
  assert.equal(start.objects[0].volumes.length, 2, 'two volumes in model');
  assert.equal(start.objects[0].volumes[0].painted, false);
  assert.equal(start.objects[0].volumes[1].painted, false);

  // Paint only volume 1 at (88, 95)
  call(engine, 'paint', 0, JSON.stringify({
    rays: [[88, 95, 200, 0, 0, -1]],
    kind: 'color',
    state: 2,
    tool: 'sphere',
    radius: 2,
  }));
  const paintedInfo = info();
  assert.equal(paintedInfo.objects[0].volumes[0].painted, false, 'volume 0 is unpainted');
  assert.equal(paintedInfo.objects[0].volumes[1].painted, true, 'volume 1 is painted');

  // Cut the multi-volume object at z = 5
  call(engine, 'cutObject', 0, 0, cut({ position: 5 }));

  const halves = info();
  assert.equal(halves.objects.length, 2, 'uncut replaced by upper and lower objects');
  // Upper object (halves.objects[0]) preserves paint on volume 1, volume 0 remains unpainted
  assert.equal(halves.objects[0].volumes[0].painted, false, 'upper volume 0 remains unpainted (no cross-contamination)');
  assert.equal(halves.objects[0].volumes[1].painted, true, 'upper volume 1 preserves paint');
  // Lower object (halves.objects[1]) has no paint bleed onto either volume
  assert.equal(halves.objects[1].volumes[0].painted, false, 'lower volume 0 remains unpainted');
  assert.equal(halves.objects[1].volumes[1].painted, false, 'lower volume 1 has no bleed from upper paint');
  engine.clearModel();
});

test('split to parts makes each piece a part of the same object', () => {
  select({ printer: DEFAULT_PRINTER });
  load('gen-two-cubes.stl');
  assert.equal(info().objects[0].volumes.length, 1);
  call(engine, 'splitParts', 0);
  const m = info();
  assert.equal(m.objects.length, 1, 'still one object');
  assert.equal(m.objects[0].volumes.filter((v) => v.kind === 'part').length, 2, 'two parts');
  assert.throws(() => call(engine, 'splitParts', 0), /single pieces/);
});

test('adding models puts them next to the ones on the plate', () => {
  select({ printer: DEFAULT_PRINTER });
  load('3DBenchy.stl');
  load('3DBenchy.stl', 0, true);
  let m = load('calib-cube-10-dual-colour-merged.3mf', 0, true);
  assert.equal(m.objects.length, 3, 'a 3MF added as geometry keeps what was there');
  assert.ok(m.objects.every((o) => o.instances[0].plate === 0), 'all on plate 1');
  // Bounding boxes from the plate's preview mesh, one run of triangles per object.
  const mesh = engine.previewMesh(0);
  const boxes = [];
  let tri = 0;
  for (const count of mesh.objectTriangles) {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = tri * 9; i < (tri + count) * 9; i += 3) {
      b.x0 = Math.min(b.x0, mesh.positions[i]); b.x1 = Math.max(b.x1, mesh.positions[i]);
      b.y0 = Math.min(b.y0, mesh.positions[i + 1]); b.y1 = Math.max(b.y1, mesh.positions[i + 1]);
    }
    if (count) boxes.push(b);
    tri += count;
  }
  assert.equal(boxes.length, 3);
  for (let a = 0; a < boxes.length; a++)
    for (let b = a + 1; b < boxes.length; b++) {
      const [p, q] = [boxes[a], boxes[b]];
      const apart = p.x1 <= q.x0 || q.x1 <= p.x0 || p.y1 <= q.y0 || q.y1 <= p.y0;
      assert.ok(apart, `objects ${a} and ${b} overlap: ${JSON.stringify([p, q])}`);
    }
  m = load('calib-cube-10-dual-colour-merged.3mf');
  assert.ok(m.objects.length >= 1 && m.objects.length < 3, 'opening a 3MF as a project replaces the project');
});

test('undo and redo step through edits, paint and plates, like desktop', () => {
  select({ printer: DEFAULT_PRINTER });
  let m = load('3DBenchy.stl');
  call(engine, 'clearHistory');
  const [x, y] = m.objects[0].instances[0].offset;
  assert.deepEqual(call(engine, 'historyStatus'), { ok: true, undo: null, redo: null });

  call(engine, 'snapshot', 'Rotate');
  call(engine, 'setInstanceTransform', 0, 0, JSON.stringify({ rotation: [0, 0, 90] }));
  call(engine, 'snapshot', 'Paint');
  call(engine, 'paint', 0, JSON.stringify({ rays: [[x, y, 200, 0, 0, -1]], kind: 'color', state: 2, tool: 'sphere', radius: 10 }));
  call(engine, 'snapshot', 'Add plate');
  call(engine, 'addPlate');
  m = info();
  assert.equal(m.plates.length, 2);
  assert.ok(m.objects[0].volumes[0].painted);

  assert.deepEqual(call(engine, 'undo'), { ok: true, undo: 'Paint', redo: 'Add plate' });
  assert.equal(info().plates.length, 1, 'undo takes the plate away');
  call(engine, 'undo');
  assert.equal(info().objects[0].volumes[0].painted, false, 'undo takes the paint away');
  // Painting again after an undo works on the restored part.
  call(engine, 'paint', 0, JSON.stringify({ rays: [[x, y, 200, 0, 0, -1]], kind: 'color', state: 2, tool: 'sphere', radius: 10 }));
  assert.ok(info().objects[0].volumes[0].painted);
  call(engine, 'clearPaint', 0, 'all');
  assert.deepEqual(call(engine, 'undo'), { ok: true, undo: null, redo: 'Rotate' });
  assert.deepEqual(info().objects[0].instances[0].rotation.map((r) => Math.round(r) + 0), [0, 0, 0], 'undo takes the rotation back');
  assert.throws(() => call(engine, 'undo'), /nothing to undo/);

  call(engine, 'redo');
  call(engine, 'redo');
  m = info();
  assert.deepEqual(m.objects[0].instances[0].rotation.map((r) => Math.round(r) + 0), [0, 0, 90], 'redo turns it again');
  assert.ok(m.objects[0].volumes[0].painted, 'redo brings the paint back');
  call(engine, 'redo');
  assert.equal(info().plates.length, 2);
  assert.throws(() => call(engine, 'redo'), /nothing to redo/);

  // A new edit drops the redo steps; a failed one drops its snapshot.
  call(engine, 'undo');
  call(engine, 'snapshot', 'Delete');
  call(engine, 'deleteObject', 0);
  assert.equal(call(engine, 'historyStatus').redo, null);
  call(engine, 'snapshot', 'Split to parts');
  assert.deepEqual(call(engine, 'dropSnapshot'), { ok: true, undo: 'Delete', redo: null });
  call(engine, 'undo');
  assert.equal(info().objects.length, 1, 'undo brings the deleted object back');
});

test('plates: add, arrange, delete', () => {
  select({ printer: DEFAULT_PRINTER });
  load('3DBenchy.stl');
  call(engine, 'addInstance', 0, 0, 0, 0);  // a copy right on top of the first
  call(engine, 'addInstance', 0, 0, 0, 0);
  call(engine, 'arrangePlate', 0, 6, 0);
  let m = info();
  const xs = m.objects[0].instances.map((i) => [i.offset[0], i.offset[1]]);
  for (let a = 0; a < xs.length; a++)
    for (let b = a + 1; b < xs.length; b++)
      assert.ok(Math.hypot(xs[a][0] - xs[b][0], xs[a][1] - xs[b][1]) > 20, 'copies were spread out');
  assert.ok(m.objects[0].instances.every((i) => i.plate === 0));

  call(engine, 'addPlate');
  m = info();
  assert.equal(m.plates.length, 2);
  assert.ok(m.objects[0].instances.every((i) => i.plate === 0), 'instances stay on plate 1');
  call(engine, 'deletePlate', 0);
  m = info();
  assert.equal(m.plates.length, 1);
  assert.equal(m.objects.length, 0, 'deleting plate 1 deleted its objects');
});

test('per-object settings change how that object slices', () => {
  select({ printer: DEFAULT_PRINTER });
  load('3DBenchy.stl');
  const base = slice(fullConfig()).result.totalLayers;
  call(engine, 'setObjectSettings', 0, -1, JSON.stringify({ layer_height: '0.3' }));
  assert.equal(info().objects[0].settings.layer_height, '0.3');
  const coarse = slice(fullConfig()).result.totalLayers;
  assert.ok(coarse < base * 0.8, `layers ${base} -> ${coarse}`);
  call(engine, 'setObjectSettings', 0, -1, JSON.stringify({ layer_height: null }));
  assert.equal(info().objects[0].settings.layer_height, undefined);
});

test('painting: colour, supports and seams, like the desktop paint tools', () => {
  select({ printer: DEFAULT_PRINTER });
  let m = load('3DBenchy.stl');
  const [x, y] = m.objects[0].instances[0].offset;
  const down = [[x, y, 200, 0, 0, -1]];
  const paint = (opts) => call(engine, 'paint', 0, JSON.stringify({ rays: down, ...opts }));
  // A miss paints nothing.
  assert.deepEqual(call(engine, 'paint', 0, JSON.stringify({ rays: [[-50, -50, 200, 0, 0, -1]] })).objects, []);

  assert.deepEqual(paint({ kind: 'color', state: 2, tool: 'sphere', radius: 10 }).objects, [0]);
  m = info();
  assert.ok(m.objects[0].volumes[0].painted, 'colour paint stored on the part');
  selectSlots(2);
  const { gcode } = slice(fullConfig({ filament_colour: '#FF0000;#0000FF' }));
  assert.ok(Object.keys(toolCounts(gcode)).length >= 2, 'the painted area prints with filament 2');

  paint({ kind: 'support', state: 1, tool: 'circle', radius: 5 });
  paint({ kind: 'seam', state: 2, tool: 'fill', angle: 20 });
  m = info();
  assert.deepEqual(m.objects[0].volumes[0].paint, { support: true, seam: true, fuzzy: false });
  const overlay = engine.paintOverlay(0, 'support');
  assert.ok(overlay.states.length > 0 && overlay.states.every((s) => s === 1), 'support enforcers in the overlay');
  assert.equal(overlay.positions.length, overlay.states.length * 9);

  // Erasing with state 0, then clearing everything.
  paint({ kind: 'support', state: 0, tool: 'sphere', radius: 50 });
  assert.equal(info().objects[0].volumes[0].paint.support, false);
  call(engine, 'clearPaint', 0, 'all');
  m = info();
  assert.equal(m.objects[0].volumes[0].painted, false);
  assert.equal(m.objects[0].volumes[0].paint.seam, false);
});

test('saves the project as an Orca 3MF that opens with everything in it', () => {
  select({ printer: DEFAULT_PRINTER });
  let m = load('3DBenchy.stl');
  const [x, y] = m.objects[0].instances[0].offset;
  call(engine, 'paint', 0, JSON.stringify({ rays: [[x, y, 200, 0, 0, -1]], kind: 'color', state: 2, tool: 'sphere', radius: 10 }));
  call(engine, 'paint', 0, JSON.stringify({ rays: [[x, y, 200, 0, 0, -1]], kind: 'support', state: 1, tool: 'circle', radius: 5 }));
  call(engine, 'setObjectSettings', 0, -1, JSON.stringify({ wall_loops: '5' }));
  call(engine, 'addPlate');
  call(engine, 'addInstance', 0, 0, 0, 0);
  call(engine, 'setInstanceTransform', 0, 1, JSON.stringify({ offset: [100, 100], plate: 1 }));
  m = info();
  assert.deepEqual(m.objects[0].instances.map((i) => i.plate), [0, 1]);

  const w = 4, h = 2;
  const pixels = new Uint8Array(w * h * 4).fill(200);
  const config = fullConfig({ layer_height: '0.28', filament_colour: '#123456' });
  call(engine, 'saveProject', '/work/saved.3mf', JSON.stringify(config), { plate: 0, width: w, height: h, pixels });
  const bytes = engine.FS.readFile('/work/saved.3mf');
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK', 'a zip file');
  const names = new TextDecoder('latin1').decode(bytes);
  for (const f of ['3D/3dmodel.model', 'Metadata/project_settings.config', 'Metadata/model_settings.config', 'Metadata/plate_1.png'])
    assert.ok(names.includes(f), `${f} in the 3MF`);

  engine.clearModel();
  const [bw, bd] = bedSize(fullConfig());
  const opened = call(engine, 'loadModel', '/work/saved.3mf', 0, bw, bd);
  assert.equal(opened.isProject, true);
  m = info();
  assert.equal(m.plates.length, 2, 'both plates');
  assert.deepEqual(m.objects[0].instances.map((i) => i.plate), [0, 1], 'instances on their plates');
  assert.ok(Math.abs(m.objects[0].instances[1].offset[0] - 100) < 1, 'position kept');
  const part = m.objects[0].volumes[0];
  assert.ok(part.painted, 'colour paint kept');
  assert.equal(part.paint.support, true, 'support paint kept');
  assert.equal(m.objects[0].settings.wall_loops, '5', 'object settings kept');
  assert.equal(m.file.printer, DEFAULT_PRINTER);
  const file = JSON.parse(engine.fileConfigJson());
  assert.equal(file.layer_height, '0.28', 'changed settings kept');
  assert.equal(file.filament_colour, '#123456');
});

test('pauses and custom G-code saved in a 3MF go with their own plate', () => {
  // Desktop keeps the layer-slider items (pauses, colour changes, custom
  // G-code) per plate in Metadata/custom_gcode_per_layer.xml.
  select({ printer: DEFAULT_PRINTER });
  load('3DBenchy.stl');
  call(engine, 'addPlate');
  call(engine, 'addInstance', 0, 0, 0, 0);
  call(engine, 'setInstanceTransform', 0, 1, JSON.stringify({ offset: [100, 100], plate: 1 }));
  call(engine, 'saveProject', '/work/plates.3mf', JSON.stringify(fullConfig()), null);
  const item = (z, mark) => `<layer top_z="${z}" type="4" extruder="1" color="" extra="${mark}" gcode="${mark}"/>`;
  const files = unzip(engine.FS.readFile('/work/plates.3mf'));
  files['Metadata/custom_gcode_per_layer.xml'] = `<?xml version="1.0" encoding="utf-8"?>
<custom_gcodes_per_layer>
<plate><plate_info id="1"/>${item(2, 'M117 MARK_PLATE_ONE')}<mode value="SingleExtruder"/></plate>
<plate><plate_info id="2"/>${item(4, 'M117 MARK_PLATE_TWO')}<mode value="SingleExtruder"/></plate>
</custom_gcodes_per_layer>
`;
  engine.FS.writeFile('/work/plates.3mf', zip(files));
  engine.clearModel();
  const [bw, bd] = bedSize(fullConfig());
  call(engine, 'loadModel', '/work/plates.3mf', 0, bw, bd);
  assert.equal(info().plates.length, 2);

  const one = slice(fullConfig(), 0).gcode;
  assert.ok(one.includes('MARK_PLATE_ONE'), 'plate 1 prints its own custom G-code');
  assert.ok(!one.includes('MARK_PLATE_TWO'), 'plate 1 leaves out plate 2\'s');
  const two = slice(fullConfig(), 1).gcode;
  assert.ok(two.includes('MARK_PLATE_TWO'), 'plate 2 prints its own custom G-code');
  assert.ok(!two.includes('MARK_PLATE_ONE'), 'plate 2 leaves out plate 1\'s');
});

test('plate settings: a plate slices with its own print sequence, kept in the 3MF, like desktop', () => {
  // Desktop's Plate settings window keeps them in the plate's config and lays
  // them over the project's before slicing that plate.
  select({ printer: DEFAULT_PRINTER });
  load('tetrahedron.stl');
  call(engine, 'addPlate');
  call(engine, 'addInstance', 0, 0, 0, 0);
  call(engine, 'setInstanceTransform', 0, 1, JSON.stringify({ offset: [100, 100], plate: 1 }));
  const settings = (s) => call(engine, 'plateAction', 1, JSON.stringify({ op: 'settings', name: 'Own', settings: s }));
  settings({ print_sequence: 'by object', first_layer_print_sequence: '1' });
  assert.deepEqual(info().plates[1].settings, { print_sequence: 'by object', first_layer_print_sequence: '1' });
  assert.equal(info().plates[1].name, 'Own');
  assert.deepEqual(info().plates[0].settings, {});
  assert.throws(() => settings({ layer_height: '0.1' }), /not a plate setting/);

  const sequence = (gcode) => /^; print_sequence = (.*)$/m.exec(gcode)?.[1];
  assert.equal(sequence(slice(fullConfig(), 0).gcode), 'by layer', 'plate 1 keeps the project\'s');
  assert.equal(sequence(slice(fullConfig(), 1).gcode), 'by object', 'plate 2 prints with its own');

  // Desktop's plate lock, kept with the plate.
  call(engine, 'plateAction', 1, JSON.stringify({ op: 'lock', locked: true }));
  assert.equal(info().plates[1].locked, true);
  assert.equal(info().plates[0].locked, false);

  // Saved and opened again, as desktop's 3MF keeps them per plate.
  call(engine, 'saveProject', '/work/plate-settings.3mf', JSON.stringify(fullConfig()), null);
  engine.clearModel();
  const [bw, bd] = bedSize(fullConfig());
  call(engine, 'loadModel', '/work/plate-settings.3mf', 0, bw, bd);
  assert.equal(info().plates[1].settings.print_sequence, 'by object');
  assert.equal(info().plates[1].locked, true, 'the lock is saved too');
  assert.equal(sequence(slice(fullConfig(), 1).gcode), 'by object', 'an opened project\'s plate settings are used too');

  // Undo puts them back; null gives a setting back to the project.
  call(engine, 'snapshot', 'Plate settings');
  settings({ print_sequence: null, first_layer_print_sequence: null });
  assert.deepEqual(info().plates[1].settings, {});
  call(engine, 'undo');
  assert.equal(info().plates[1].settings.print_sequence, 'by object');

  // Spiral vase turned on for the plate sets what it needs on the plate's objects.
  call(engine, 'plateAction', 1, JSON.stringify({ op: 'settings', name: 'Own', settings: { spiral_mode: '1' }, vase: ['top_shell_layers', 'sparse_infill_density'] }));
  const own = info().objects[0].settings;
  assert.equal(own.top_shell_layers, '0');
  assert.equal(own.sparse_infill_density, '0%');
  assert.equal(own.wall_loops, undefined, 'a setting the project already has is not copied onto the object');
});

test('by object: the tool head clearance round each object, and Arrange keeps it, like desktop', () => {
  // Desktop draws each object's outline grown by half the printer's
  // extruder_clearance_radius and refuses to slice when two touch; its Arrange
  // spaces objects by the clearance when printing object by object.
  select({ printer: DEFAULT_PRINTER });
  load('3DBenchy.stl');
  call(engine, 'addInstance', 0, 0, 0, 0);
  call(engine, 'setInstanceTransform', 0, 1, JSON.stringify({ offset: [info().objects[0].instances[0].offset[0] + 70, info().objects[0].instances[0].offset[1]] }));
  const clearance = (o = {}) => call(engine, 'clearanceJson', JSON.stringify(fullConfig({ print_sequence: 'by object', ...o })), 0);
  assert.equal(call(engine, 'clearanceJson', JSON.stringify(fullConfig({ print_sequence: 'by layer' })), 0).byObject, false);

  let c = clearance();
  const cfg = fullConfig();
  assert.equal(c.radius, Number(cfg.extruder_clearance_radius), "the printer preset's clearance");
  assert.equal(c.rod, Number(cfg.extruder_clearance_height_to_rod));
  assert.equal(c.outlines.length, 2);
  assert.deepEqual(c.outlines.map((o) => o.order).sort(), [1, 2]);
  assert.ok(c.collisions.length > 0, 'two Benchies 70 mm apart are too close');
  assert.match(c.error, /too close to others/);
  // The outline is the Benchy grown by half the radius on each side.
  const xs = c.outlines[0].points.map((p) => p[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 60 + c.radius - 5, `outline ${Math.max(...xs) - Math.min(...xs)} mm wide`);

  // Arrange by the clearance: then it slices.
  call(engine, 'arrangePlate', 0, Math.max(6, c.spacing), c.short ? 0 : c.rod);
  c = clearance();
  assert.equal(c.error, '', 'arranged by the clearance');
  assert.equal(c.collisions.length, 0);

  // A Benchy (48 mm) is taller than the rod: each ends its row, so the rod
  // never passes over one printed earlier.
  const [a, b] = info().objects[0].instances.map((i) => i.offset[1]);
  assert.ok(Math.abs(a - b) > c.radius, `the tall Benchies are in different rows (y ${a}, ${b})`);
});

test('lists the filaments that work with a printer, for the setup wizard', () => {
  const before = call(engine, 'presetsSelect', JSON.stringify({})).selection;
  const r = call(engine, 'presetsFilamentsFor', DEFAULT_PRINTER);
  const names = r.filaments.map((f) => f.name);
  assert.ok(names.length >= 20, `${names.length} filaments`);
  assert.ok(r.filaments.some((f) => /Snapmaker PLA/.test(f.name) && f.filamentType === 'PLA'));
  assert.ok(r.defaults.length > 0 && r.defaults.every((d) => names.includes(d)), JSON.stringify(r.defaults));
  assert.deepEqual(call(engine, 'presetsSelect', JSON.stringify({})).selection, before, 'the selection is unchanged');
  assert.throws(() => call(engine, 'presetsFilamentsFor', 'No such printer'));
});

test('calibration tests set up like desktop and change settings per layer', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  selectSlots(1);
  const here = dirname(fileURLToPath(import.meta.url));
  const start = (mode, model, opts = {}) => {
    const path = `/work/${model.split('/').pop()}`;
    const file = model.includes('/') ? resolve(here, '../orcaslicer/resources/calib', model) : resolve(here, '../calib', model);
    engine.FS.writeFile(path, readFileSync(file));
    const base = fullConfig();
    const [w, d] = bedSize(base);
    const r = call(engine, 'calibrationStart', JSON.stringify({ mode, model: path, ...opts }), JSON.stringify(base), w, d);
    assert.ok(info().objects.length > 0, `${mode}: test model loaded`);
    return slice(fullConfig(r.overrides)).gcode;
  };
  const values = (gcode, re) => [...new Set([...gcode.matchAll(re)].map((m) => Number(m[1])))];

  // Temperature tower: the nozzle steps from 230 down to 200 in 5 degree blocks.
  let gcode = start('temperature', 'temperature_tower/temperature_tower.stl', { start: 230, end: 200, step: 5 });
  const temps = values(gcode, /^M104 S(\d+)/gm);
  for (const t of [230, 215, 200]) assert.ok(temps.includes(t), `temperature ${t} in ${temps}`);

  // Pressure advance tower: SET_PRESSURE_ADVANCE climbs layer by layer.
  gcode = start('paTower', 'pressure_advance/tower_with_seam.stl', { start: 0, end: 0.1, step: 0.002 });
  const pa = values(gcode, /^SET_PRESSURE_ADVANCE ADVANCE=([\d.]+)/gm);
  assert.ok(pa.length > 10 && Math.max(...pa) > 0.05, `pressure advance values ${pa.slice(0, 5)}...`);

  // Pressure advance pattern: one handle cube per speed and acceleration pair,
  // and the zig-zag pattern around it comes from custom G-code at slicing,
  // its walls stepping through every PA value.
  const patternStart = (opts) => {
    const base = fullConfig();
    const [w, d] = bedSize(base);
    return call(engine, 'calibrationStart', JSON.stringify({ mode: 'paPattern', start: 0, end: 0.08, step: 0.005, ...opts }), JSON.stringify(base), w, d);
  };
  let r = patternStart({ speeds: [60, 120], accelerations: [5000] });
  assert.deepEqual(info().objects.map((o) => o.name), ['pa_pattern_60_5000', 'pa_pattern_120_5000']);
  assert.deepEqual(r.notes, []);
  gcode = slice(fullConfig(r.overrides)).gcode;
  assert.equal(gcode.match(/; start pressure advance pattern for layer/g)?.length > 2, true, 'pattern G-code on several layers');
  const steps = values(gcode, /^SET_PRESSURE_ADVANCE ADVANCE=([\d.]+)/gm);
  for (let i = 0; i <= 16; i++) assert.ok(steps.includes(Number((i * 0.005).toFixed(3))), `PA ${i * 0.005} in ${steps}`);
  // With no lists, desktop picks the speed and acceleration and says so.
  r = patternStart({});
  assert.equal(info().objects.length, 1);
  assert.equal(r.notes.length, 2, JSON.stringify(r.notes));
  assert.ok(r.overrides.outer_wall_speed, 'the speed it picked is set');

  // Retraction tower and flow rate both slice; flow rate needs no calib params.
  gcode = start('retraction', 'retraction/retraction_tower.stl', { start: 0, end: 2, step: 0.1 });
  assert.ok(gcode.length > 1000);
  gcode = start('flowRate', 'filament_flow/flowrate-test-pass1.3mf', { pass: 1 });
  assert.ok(info().objects.length >= 9, 'pass 1 has a block per flow ratio');

  // Max volumetric speed (a STEP model) and VFA: the speed climbs up the tower.
  gcode = start('volumetricSpeed', 'SpeedTestStructure.stl', { start: 5, end: 20, step: 0.5 });
  assert.ok(values(gcode, /^G1 [^F\n]*F(\d+)/gm).length > 5, 'speeds change up the tower');
  gcode = start('vfa', 'vfa/VFA.stl', { start: 40, end: 200, step: 10 });
  assert.ok(gcode.length > 1000);

  engine.calibrationStop();
});

test('user presets (diffs over a system preset) load like desktop user presets', () => {
  const PROCESS = STANDARD;
  select({ printer: DEFAULT_PRINTER, process: PROCESS });
  const filament = call(engine, 'presetsSelect', JSON.stringify({})).selection.filaments[0];
  // What the web worker's userPresets writes (one JSON file per preset).
  const write = (folder, preset) => {
    const dir = `${DATA_DIR}/user/default/${folder}`;
    engine.FS.mkdirTree(dir);
    engine.FS.writeFile(`${dir}/${preset.name}.json`, JSON.stringify({ ...preset, from: 'User', is_custom_defined: '0', version: '1.0.0' }));
  };
  write('process', { name: 'My fast', inherits: PROCESS, layer_height: '0.28', wall_loops: '3' });
  write('filament', { name: 'My PLA', inherits: filament, nozzle_temperature: '212' });
  write('machine', { name: 'My U1', inherits: DEFAULT_PRINTER, retraction_length: '0.6,0.6,0.6,0.6' });
  try {
    call(engine, 'presetsLoad', DATA_DIR);
    const printer = JSON.parse(engine.presetsPrinters()).find((p) => p.name === 'My U1');
    assert.ok(printer?.user && printer.inherits === DEFAULT_PRINTER, JSON.stringify(printer));
    const sel = select({ printer: 'My U1', process: 'My fast', filaments: ['My PLA'] });
    assert.equal(sel.selection.printer, 'My U1');
    assert.equal(sel.selection.process, 'My fast', 'a system process stays compatible with a user printer of that printer');
    // OrcaSlicer keeps a filament per tool head (four on the U1), copying the last one.
    assert.deepEqual(sel.selection.filaments, flavor.flavor === 'orca' ? Array(4).fill('My PLA') : ['My PLA']);
    assert.ok(sel.processes.find((p) => p.name === 'My fast')?.user);
    const cfg = fullConfig();
    assert.equal(cfg.layer_height, '0.28');
    assert.equal(cfg.wall_loops, '3');
    assert.ok(cfg.nozzle_temperature.split(',').every((t) => t === '212'), cfg.nozzle_temperature);
    assert.equal(cfg.retraction_length.split(',')[0], '0.6');
    // Everything else comes from the system presets they inherit.
    assert.equal(cfg.sparse_infill_density, JSON.parse(engine.presetConfig('process', PROCESS)).sparse_infill_density);
  } finally {
    for (const folder of ['process', 'filament', 'machine']) {
      const dir = `${DATA_DIR}/user/default/${folder}`;
      for (const f of engine.FS.readdir(dir)) if (f.endsWith('.json')) engine.FS.unlink(`${dir}/${f}`);
    }
    call(engine, 'presetsLoad', DATA_DIR);
  }
});

// Colour mixing: the mixed-filament list of a project (what desktop's Color Mixing panel edits).
const mixed = (request) => call(engine, 'mixedFilaments', JSON.stringify(request));
const TWO = ['#0000FF', '#FFFF00'];

test('colour mixing: a mix of two filaments is filament 3 and prints with both', (t) => {
  if (needsMixing(t)) return;
  selectSlots(2);
  const added = mixed({ definitions: '', colours: TWO, op: { kind: 'add', row: { componentA: 1, componentB: 2, mixBPercent: 50, uiMode: 0 } } });
  assert.equal(added.rows.length, 1);
  const [row] = added.rows;
  assert.equal(row.virtualId, 3, 'numbered after the physical filaments');
  assert.equal(row.componentA, 1);
  assert.equal(row.componentB, 2);
  // FilamentMixer blends like paint: blue + yellow is green, not grey.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(row.colour.slice(i, i + 2), 16));
  assert.ok(g > r && g > b, `blue + yellow should look green, got ${row.colour}`);
  assert.ok(added.definitions.length > 0);
  // Reading the definitions back gives the same row.
  assert.deepEqual(mixed({ definitions: added.definitions, colours: TWO }).rows, added.rows);

  load('tetrahedron.stl');
  call(engine, 'setExtruder', 0, -1, 3);
  const { gcode, result } = slice(fullConfig({ filament_colour: TWO.join(';'), mixed_filament_definitions: added.definitions }));
  const tools = toolCounts(gcode);
  assert.ok(tools[0] > 0 && tools[1] > 0, `both tools print the mix: ${JSON.stringify(tools)}`);
  assert.ok(!tools[2], 'the virtual filament never reaches the G-code as a tool');
  // 50% alternates every layer.
  assert.ok(tools[0] + tools[1] >= result.totalLayers - 2, `${JSON.stringify(tools)} over ${result.totalLayers} layers`);
});

test('colour mixing: a 3:1 ratio prints the first filament three times as often', (t) => {
  if (needsMixing(t)) return;
  selectSlots(2);
  const { definitions } = mixed({ definitions: '', colours: TWO, op: { kind: 'add', row: { componentA: 1, componentB: 2, mixBPercent: 25, ratioA: 3, ratioB: 1 } } });
  load('tetrahedron.stl');
  call(engine, 'setExtruder', 0, -1, 3);
  const { gcode } = slice(fullConfig({ filament_colour: TWO.join(';'), mixed_filament_definitions: definitions }));
  // Layers per tool, from the tool active at each layer change.
  const layers = { 0: 0, 1: 0 };
  let tool = 0;
  for (const line of gcode.split('\n')) {
    const t = /^T(\d+)\s*$/.exec(line);
    if (t) tool = Number(t[1]);
    if (line.startsWith(';LAYER_CHANGE')) layers[tool] = (layers[tool] ?? 0) + 1;
  }
  const share = layers[0] / (layers[0] + layers[1]);
  assert.ok(share > 0.6 && share < 0.9, `filament 1 on ${Math.round(share * 100)}% of layers`);
});

test('colour mixing: painted mixes and the mix list survive saving and opening the 3MF', (t) => {
  if (needsMixing(t)) return;
  selectSlots(2);
  const { definitions } = mixed({ definitions: '', colours: TWO, op: { kind: 'add', row: { componentA: 1, componentB: 2, mixBPercent: 50 } } });
  let m = load('3DBenchy.stl');
  const [x, y] = m.objects[0].instances[0].offset;
  call(engine, 'paint', 0, JSON.stringify({ rays: [[x, y, 200, 0, 0, -1]], kind: 'color', state: 3, tool: 'sphere', radius: 10 }));
  assert.ok(engine.previewMesh(0).filaments.includes(3), 'painted with the mix');
  const config = fullConfig({ filament_colour: TWO.join(';'), mixed_filament_definitions: definitions });
  call(engine, 'saveProject', '/work/mixed.3mf', JSON.stringify(config), null);

  engine.clearModel();
  const [bw, bd] = bedSize(fullConfig());
  call(engine, 'loadModel', '/work/mixed.3mf', 0, bw, bd);
  const file = JSON.parse(engine.fileConfigJson());
  assert.equal(file.mixed_filament_definitions, definitions, 'mix list kept');
  assert.ok(engine.previewMesh(0).filaments.includes(3), 'mix paint kept');
  const { gcode } = slice(fullConfig({ filament_colour: TWO.join(';'), mixed_filament_definitions: file.mixed_filament_definitions }));
  const tools = toolCounts(gcode);
  assert.ok(tools[0] > 0 && tools[1] > 0, JSON.stringify(tools));
});

test('colour mixing: deleting a mix or a filament moves what uses later filaments', (t) => {
  if (needsMixing(t)) return;
  const THREE = ['#FF0000', '#0000FF', '#FFFF00'];
  let d = mixed({ definitions: '', colours: THREE, op: { kind: 'add', row: { componentA: 1, componentB: 2 } } }).definitions;
  d = mixed({ definitions: d, colours: THREE, op: { kind: 'add', row: { componentA: 2, componentB: 3 } } }).definitions;
  load('calib-cube-10-dual-colour-merged.3mf');
  call(engine, 'setExtruder', 0, -1, 5);  // the second mix (2 + 3)
  // Deleting the first mix: the second becomes filament 4.
  const afterDelete = mixed({ definitions: d, colours: THREE, op: { kind: 'delete', index: 0 } });
  assert.deepEqual(afterDelete.rows.map((r) => [r.deleted, r.virtualId]), [[true, 0], [false, 4]]);
  assert.equal(info().objects[0].extruder, 4);
  // Deleting filament 1: the mix of 2 + 3 is now 1 + 2, filament 3.
  const afterRemove = mixed({ definitions: afterDelete.definitions, colours: THREE, op: { kind: 'removePhysical', filament: 1 } });
  const live = afterRemove.rows.filter((r) => !r.deleted);
  assert.deepEqual(live.map((r) => [r.componentA, r.componentB, r.virtualId]), [[1, 2, 3]]);
  assert.equal(info().objects[0].extruder, 3);
});

test('sync filament: replacing the filaments moves objects and drops mixes, adding keeps mixes', (t) => {
  if (needsMixing(t)) return;
  const THREE = ['#FF0000', '#0000FF', '#FFFF00'];
  const d = mixed({ definitions: '', colours: THREE, op: { kind: 'add', row: { componentA: 1, componentB: 2 } } }).definitions;
  load('calib-cube-10-dual-colour-merged.3mf');
  call(engine, 'setExtruder', 0, -1, 4);  // the mix
  // Adding a fourth filament at the end: the mix moves from 4 to 5 and stays.
  const FOUR = [...THREE, '#FFFFFF'];
  const added = mixed({ definitions: d, colours: THREE, op: { kind: 'replacePhysical', colours: FOUR, remap: [1, 2, 3], dropMixes: false } });
  assert.deepEqual(added.rows.filter((r) => r.enabled).map((r) => r.virtualId), [5]);
  assert.equal(info().objects[0].extruder, 5);
  // Direct override with two printer filaments: 1 -> 1, 2 -> 2, 3 -> 1, 4 -> 2; the mix goes.
  call(engine, 'setExtruder', 0, -1, 3);
  const replaced = mixed({ definitions: added.definitions, colours: FOUR, op: { kind: 'replacePhysical', colours: ['#000000', '#00FF00'], remap: [1, 2, 1, 2], dropMixes: true } });
  assert.equal(replaced.rows.filter((r) => r.enabled).length, 0);
  assert.equal(info().objects[0].extruder, 1);
});

test('switching to an engine without mixing: each mix becomes one of its filaments', (t) => {
  if (needsMixing(t)) return;
  const THREE = ['#FF0000', '#0000FF', '#FFFF00'];
  let d = mixed({ definitions: '', colours: THREE, op: { kind: 'add', row: { componentA: 1, componentB: 2 } } }).definitions;
  d = mixed({ definitions: d, colours: THREE, op: { kind: 'add', row: { componentA: 2, componentB: 3 } } }).definitions;
  load('calib-cube-10-dual-colour-merged.3mf');
  call(engine, 'setExtruder', 0, -1, 5);  // the second mix
  const flat = mixed({ definitions: d, colours: THREE, op: { kind: 'flatten', to: [1, 3] } });
  assert.equal(flat.rows.filter((r) => r.enabled).length, 0);
  assert.equal(info().objects[0].extruder, 3);
});

test('colour mixing: Match finds the recipe for a target colour', (t) => {
  if (needsMixing(t)) return;
  const target = mixed({ definitions: '', colours: TWO, op: { kind: 'add', row: { componentA: 1, componentB: 2, mixBPercent: 30 } } }).rows[0].colour;
  const match = call(engine, 'mixedMatch', JSON.stringify({ colours: TWO, types: ['PLA', 'PLA'], target, minPercent: 10 }));
  assert.ok(match.valid);
  assert.deepEqual([match.componentA, match.componentB], [1, 2]);
  assert.ok(Math.abs(match.mixBPercent - 30) <= 3, `mix ${match.mixBPercent}%`);
  assert.ok(match.deltaE < 2, `ΔE ${match.deltaE}`);
  // PLA and PETG can't be mixed.
  const none = call(engine, 'mixedMatch', JSON.stringify({ colours: TWO, types: ['PLA', 'PETG'], target, minPercent: 10 }));
  assert.equal(none.valid, false);
  const row = { componentA: 1, componentB: 2 };
  assert.equal(mixed({ definitions: '', colours: TWO, types: ['PLA', 'PETG'], draft: row }).draftCompatible, false);
  assert.equal(mixed({ definitions: '', colours: TWO, types: ['PLA', 'PLA'], draft: row }).draftCompatible, true);
  assert.equal(mixed({ definitions: '', colours: TWO, types: ['PETG', 'TPU'], op: { kind: 'add', row } }).rows[0].compatible, true);
});

test('simplify: fewer triangles by detail level or ratio, keeping paint', () => {
  select({ printer: DEFAULT_PRINTER });
  load('3DBenchy.stl');
  const simplify = (request) => call(engine, 'simplifyObject', 0, JSON.stringify(request));
  const start = simplify({ op: 'get' }).triangles;
  assert.ok(start > 100000, `Benchy has many triangles: ${start}`);

  // Preview changes nothing; Apply uses the same result.
  const half = simplify({ op: 'preview', ratio: 50 });
  assert.equal(half.triangles, start);
  assert.ok(Math.abs(half.after - start / 2) < start * 0.02, `half the triangles: ${half.after} of ${start}`);
  assert.equal(simplify({ op: 'get' }).triangles, start);

  // Coarser detail levels keep fewer triangles.
  const levels = [0, 2, 4].map((level) => simplify({ op: 'preview', level }).after);
  assert.ok(levels[0] >= levels[1] && levels[1] > levels[2], `extra high >= medium > extra low: ${levels}`);

  const [x, y] = info().objects[0].instances[0].offset;
  call(engine, 'paint', 0, JSON.stringify({ rays: [[x, y, 200, 0, 0, -1]], kind: 'support', state: 1, tool: 'sphere', radius: 10 }));
  assert.ok(simplify({ op: 'get' }).painted);
  const size = info().objects[0].size;
  const applied = simplify({ op: 'apply', ratio: 50 });
  assert.equal(applied.triangles, half.after);
  assert.equal(simplify({ op: 'get' }).triangles, half.after);
  assert.ok(info().objects[0].volumes[0].paint.support && simplify({ op: 'get' }).painted, 'support paint stays on the simplified mesh');
  assert.ok(info().objects[0].size.every((v, i) => Math.abs(v - size[i]) < 0.5), 'the shape keeps its size');
  slice(fullConfig());

  // A 0% ratio leaves the mesh as it is.
  assert.equal(simplify({ op: 'preview', ratio: 0 }).after, half.after);

  // Multi-colour painted 3MF keeps its filament colours after simplifying,
  // previews correctly with zero-deserialization paint traversal, and undo/redo works.
  const colored = load('colored_3DBenchy.3mf');
  assert.ok(colored.objects.some((o) => o.volumes.some((v) => v.painted)));
  const beforeMesh = engine.previewMesh(0);
  const beforeUnique = new Set(beforeMesh.filaments);
  assert.ok(beforeUnique.size >= 4, `multi-filament paint in preview: ${[...beforeUnique]}`);
  const beforeFacets = beforeMesh.filaments.length;

  call(engine, 'snapshot', 'Simplify');
  const simpColored = call(engine, 'simplifyObject', 0, JSON.stringify({ op: 'apply', ratio: 50 }));
  assert.ok(simpColored.painted && info().objects[0].volumes.some((v) => v.painted), 'colour painting stays on the simplified 3MF');

  const afterMesh = engine.previewMesh(0);
  const afterUnique = new Set(afterMesh.filaments);
  assert.deepEqual([...afterUnique].sort(), [...beforeUnique].sort(), 'all painted filaments preserved in previewMesh after simplify');
  assert.ok(afterMesh.filaments.length < beforeFacets, `previewMesh facets reduced: ${afterMesh.filaments.length} < ${beforeFacets}`);

  call(engine, 'undo');
  const undoMesh = engine.previewMesh(0);
  assert.equal(undoMesh.filaments.length, beforeFacets, 'undo restores original painted facets');
  assert.deepEqual([...new Set(undoMesh.filaments)].sort(), [...beforeUnique].sort(), 'undo restores original filament set');

  call(engine, 'redo');
  const redoMesh = engine.previewMesh(0);
  assert.equal(redoMesh.filaments.length, afterMesh.filaments.length, 'redo restores simplified facets');
  assert.deepEqual([...new Set(redoMesh.filaments)].sort(), [...beforeUnique].sort(), 'redo restores simplified filament set');
});

test('brim ears: on the corners, by hand, and printed when the brim type is painted', () => {
  select({ printer: DEFAULT_PRINTER });
  load('gen-cube-20.stl');
  const config = JSON.stringify(fullConfig());
  const ears = (request, o = 0, i = 0) => call(engine, 'brimEars', o, i, config, JSON.stringify(request));
  const brimLines = (gcode) => gcode.split(/^;TYPE:/m).filter((b) => /^Brim/.test(b)).join('');

  const none = ears({ op: 'get' });
  assert.deepEqual(none.ears, []);
  assert.ok(none.defaultDiameter > 4 && none.defaultDiameter < 12, `16 first-layer lines across: ${none.defaultDiameter}`);

  const auto = ears({ op: 'auto', diameter: 8, maxAngle: 125, detection: 1 });
  assert.equal(auto.ears.length, 4, 'one ear on each corner of the cube');
  const xs = auto.ears.map((e) => e.x), ys = auto.ears.map((e) => e.y);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 20) < 0.5 && Math.abs(Math.max(...ys) - Math.min(...ys) - 20) < 0.5, 'ears 20 mm apart, on the corners');
  assert.ok(auto.ears.every((e) => e.attached && Math.abs(e.diameter - 8) < 1e-4));
  assert.equal(ears({ op: 'auto', diameter: 8, maxAngle: 125, detection: 1 }).ears.length, 4, 'running it again adds no duplicates');

  // An ear by hand, far from the cube, doesn't touch it.
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const loose = ears({ op: 'add', x: cx + 40, y: cy, diameter: 6 });
  assert.equal(loose.ears.length, 5);
  assert.equal(loose.ears[4].attached, false);
  assert.ok(Math.abs(loose.ears[4].x - cx - 40) < 1e-3);
  const resized = ears({ op: 'resize', indices: [0], diameter: 10 });
  assert.ok(Math.abs(resized.ears[0].diameter - 10) < 1e-4);
  assert.equal(ears({ op: 'remove', indices: [4] }).ears.length, 4);

  // Printed only with the painted brim type, as on desktop.
  call(engine, 'setObjectSettings', 0, -1, JSON.stringify({ brim_type: 'no_brim' }));
  assert.equal(ears({ op: 'get' }).brimType, 'no_brim');
  assert.equal(brimLines(slice(fullConfig()).gcode), '', 'no brim without the painted type');
  call(engine, 'setObjectSettings', 0, -1, JSON.stringify({ brim_type: 'painted' }));
  assert.equal(ears({ op: 'get' }).brimType, 'painted');
  const painted = brimLines(slice(fullConfig()).gcode);
  assert.ok(painted.length > 0, 'the ears print as brim');
  // Brim only under the ears: no brim line runs along the sides away from them.
  const corners = resized.ears.slice(0, 4);
  const moves = [...painted.matchAll(/^G1 X([\d.]+) Y([\d.]+) E/gm)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(moves.length > 20);
  const nearEar = ([x, y]) => corners.some((e) => Math.hypot(x - e.x, y - e.y) <= e.diameter / 2 + 1);
  const onCube = ([x, y]) => Math.abs(x - cx) <= 10.5 && Math.abs(y - cy) <= 10.5;
  assert.deepEqual(moves.filter((m) => !nearEar(m) && !onCube(m)), [], 'brim only at the ears');
  assert.ok(moves.some(([x]) => x < cx - 11.5), 'the ears reach past the cube');

  assert.deepEqual(ears({ op: 'clear' }).ears, []);
});

test('variable layer height: adaptive, smooth, manual edits and reset change what a slice prints', () => {
  select({ printer: DEFAULT_PRINTER });
  load('3DBenchy.stl');
  const config = JSON.stringify(fullConfig());
  const layers = (request) => call(engine, 'layerHeights', 0, config, JSON.stringify(request));
  const layerCount = (gcode) => (gcode.match(/^;LAYER_CHANGE/gm) ?? []).length;

  const plain = layers({ op: 'get' });
  assert.equal(plain.custom, false);
  assert.ok(plain.height > 40 && plain.height < 50, `Benchy is about 48 mm tall: ${plain.height}`);
  const heights = (p) => p.layers.filter((_, i) => i % 2).map((top, i) => top - p.layers[i * 2]);
  assert.ok(heights(plain).slice(1).every((h) => Math.abs(h - plain.layerHeight) < 1e-6), 'without a profile every layer is the layer height');
  const plainLayers = layerCount(slice(fullConfig()).gcode);

  const adaptive = layers({ op: 'adaptive', quality: 0 });
  assert.equal(adaptive.custom, true);
  const hs = heights(adaptive);
  assert.ok(Math.min(...hs.slice(1)) < plain.layerHeight - 1e-6, 'adaptive (quality) makes some layers thinner');
  assert.ok(hs.every((h) => h >= adaptive.minLayerHeight - 1e-6 && h <= adaptive.maxLayerHeight + 1e-6), 'within the printer\'s layer heights');
  const adaptiveLayers = layerCount(slice(fullConfig()).gcode);
  assert.ok(adaptiveLayers > plainLayers, `the slice follows the profile: ${adaptiveLayers} layers vs ${plainLayers}`);

  const smooth = layers({ op: 'smooth', radius: 5, keepMin: false });
  assert.equal(smooth.custom, true);

  layers({ op: 'reset' });
  const thin = layers({ op: 'adjust', action: 'decrease', zs: Array(20).fill(20), band: 4 });
  const at = (p, z) => heights(p)[p.layers.findIndex((v, i) => i % 2 === 0 && p.layers[i + 1] >= z) / 2];
  assert.ok(at(thin, 20) < plain.layerHeight - 0.01, `adding detail at 20 mm makes layers there thinner: ${at(thin, 20)}`);
  // (within a hair: Orca stretches the layers a little so the last one ends at the top)
  assert.ok(Math.abs(at(thin, 40) - plain.layerHeight) < 0.005, `and leaves layers far away alone: ${at(thin, 40)}`);

  const reset = layers({ op: 'reset' });
  assert.equal(reset.custom, false);
  assert.equal(layerCount(slice(fullConfig()).gcode), plainLayers, 'reset goes back to the plain layers');

  // Reading the layers caches the object's height; turning it afterwards
  // still drops it onto the bed.
  call(engine, 'setInstanceTransform', 0, 0, JSON.stringify({ rotation: [90, 0, 0] }));
  const pos = engine.previewMesh(0).positions;
  let low = Infinity;
  for (let i = 2; i < pos.length; i += 3) low = Math.min(low, pos[i]);
  assert.ok(Math.abs(low) < 1e-3, `on the bed after turning: lowest z ${low}`);
});

test('measure: faces, edges and corners under a ray, and the distance and angle between them', () => {
  select({ printer: DEFAULT_PRINTER });
  load('gen-cube-20.stl');
  // The cube's centre on the plate, from its triangles: it spans x±10, y±10, z 0..20.
  const pos = engine.previewMesh(0).positions;
  const span = (k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); } return [lo, hi]; };
  const [[x0, x1], [y0, y1], [z0, z1]] = [span(0), span(1), span(2)];
  assert.ok(Math.abs(x1 - x0 - 20) < 1e-3 && Math.abs(z1 - z0 - 20) < 1e-3 && Math.abs(z0) < 1e-3, 'a 20 mm cube on the plate');
  const [x, y] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const feature = (ray, onlyPlane = false) => call(engine, 'measureFeature', 0, JSON.stringify({ ray, onlyPlane })).feature;
  const near = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-3, `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`));

  const top = feature([x, y, 100, 0, 0, -1]);
  assert.equal(top.type, 'plane');
  near(top.normal, [0, 0, 1], 'top face normal');
  assert.equal(top.triangles.length, 2 * 9, 'the top face is two triangles');
  assert.ok(top.triangles.every((v, i) => i % 3 !== 2 || Math.abs(v - 20) < 1e-3), 'the top face is at 20 mm');

  const edge = feature([x + 9.8, y, 100, 0, 0, -1]);
  assert.equal(edge.type, 'edge', 'close to the side of the top face');
  assert.ok(Math.abs(Math.hypot(...edge.start.map((v, i) => v - edge.end[i])) - 20) < 1e-3, 'the edge is 20 mm');
  assert.equal(feature([x + 9.8, y, 100, 0, 0, -1], true).type, 'plane', 'whole faces only');

  const corner = feature([x + 9.9, y + 9.9, 100, 0, 0, -1]);
  assert.equal(corner.type, 'point', 'close to a corner');
  near(corner.point, [x + 10, y + 10, 20], 'the corner');

  const left = feature([x - 50, y, 10, 1, 0, 0]);
  const right = feature([x + 50, y, 10, -1, 0, 0]);
  near(left.normal, [-1, 0, 0], 'left face normal');
  const across = call(engine, 'measureBetween', left.id, right.id);
  assert.ok(Math.abs((across.distance ?? across.perpendicular).distance - 20) < 1e-3, `opposite faces are 20 mm apart: ${JSON.stringify(across)}`);
  const angle = call(engine, 'measureBetween', top.id, left.id);
  assert.ok(Math.abs(angle.angle.degrees - 90) < 1e-3, `top and side are square: ${JSON.stringify(angle)}`);
  assert.equal(feature([x + 100, y + 100, 100, 0, 0, -1]), null, 'nothing under a ray that misses');
});

test('assemble: faces turned and moved onto each other, objects joined, parts stacked, points moved, like desktop', () => {
  select({ printer: DEFAULT_PRINTER });
  load('gen-cube-20.stl');
  load('gen-cube-20.stl', 0, true);
  // Two 20 mm cubes: x 60..80 and 120..140, y 100..120, z 0..20 (the offset is a corner).
  call(engine, 'setInstanceTransform', 0, 0, JSON.stringify({ offset: [60, 100] }));
  call(engine, 'setInstanceTransform', 1, 0, JSON.stringify({ offset: [120, 100] }));
  const info = () => JSON.parse(engine.modelInfoJson());
  const feature = (ray, onlyPlane = true) => call(engine, 'measureFeature', 0, JSON.stringify({ ray, onlyPlane })).feature;
  const assemble = (a, b, request) => call(engine, 'assembleAction', a.id, b.id, JSON.stringify(request));
  const near = (a, b, msg, tol = 1e-3) => [a].flat().forEach((v, i) => assert.ok(Math.abs(v - [b].flat()[i]) < tol, `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`));

  const side = feature([100, 110, 10, -1, 0, 0]);  // the first cube's right face
  const top = feature([130, 110, 100, 0, 0, -1]);  // the second cube's top
  near(side.normal, [1, 0, 0], 'right face');
  near(top.normal, [0, 0, 1], 'top face');
  assert.equal(call(engine, 'measureBetween', side.id, top.id).assembly.parallel, true, 'square faces can be made parallel');

  // Parallel: the second cube turns its top to face the first cube's side.
  let r = assemble(side, top, { op: 'parallel' });
  near(r.second.normal, [-1, 0, 0], 'the top now faces the side');
  assert.equal(r.assembly.parallel, false);
  assert.ok(r.assembly.aroundCentre && r.assembly.parallelDistance !== undefined, 'now parallel faces have a distance');
  assert.equal(r.second.id, top.id, 'the feature keeps its id');

  // Center coincidence: face on face, middle on middle (the cube stays on the bed).
  r = assemble(side, top, { op: 'centre' });
  near(r.second.origin, r.first.origin, 'middle on middle');
  near(r.assembly.parallelDistance, 0, 'touching');

  r = assemble(side, top, { op: 'distance', value: 5 });
  near(r.assembly.parallelDistance, 5, 'parallel distance');
  near(r.second.origin[0], 85, 'moved 5 mm away');
  r = assemble(side, top, { op: 'rotate', degrees: 90 });
  near(r.second.normal, [-1, 0, 0], 'turning about the face keeps it facing');
  r = assemble(side, top, { op: 'flip' });
  near(r.second.normal, [1, 0, 0], 'flipped over');
  assemble(side, top, { op: 'flip' });

  // Join: one "Assembly" object with both cubes as parts, the picks still on them.
  r = assemble(side, top, { op: 'join' });
  assert.equal(info().objects.length, 1);
  assert.equal(info().objects[0].name, 'Assembly');
  assert.equal(info().objects[0].volumes.length, 2);
  assert.equal(r.object, 0);
  assert.equal(r.assembly.sameObject, true);
  near(r.second.origin[0], 85, 'the parts stay where they were');

  // Parts can leave the bed: the second cube's face goes onto the first cube's top.
  const roof = feature([70, 110, 100, 0, 0, -1]);
  near(roof.normal, [0, 0, 1], 'the first cube top');
  r = assemble(roof, top, { op: 'centre' });
  near(r.second.origin, roof.origin, 'stacked middle on middle');
  near(info().objects[0].size[2], 40, 'two cubes high', 1e-2);

  // Point and point: a corner of the upper cube moved onto a corner under the lower one.
  const under = feature([60.1, 100.1, -100, 0, 0, 1], false);
  const upper = feature([79.9, 119.9, 100, 0, 0, -1], false);
  assert.equal(under.type, 'point');
  assert.equal(upper.type, 'point');
  near(upper.point[2], 40, 'the upper cube top corner');
  r = assemble(under, upper, { op: 'move', by: under.point.map((v, i) => v - upper.point[i]) });
  near(r.second.point, r.first.point, 'corner on corner');
  assert.throws(() => assemble(under, upper, { op: 'flip' }), /pick two faces/);
  assert.throws(() => assemble(roof, roof, { op: 'parallel' }), /two different parts/);
});

test('object menu: rename, printable, center, scale to fit, clone, units, replace with STL and export STL', () => {
  select({ printer: DEFAULT_PRINTER });
  let m = load('gen-cube-20.stl');
  const act = (o, i, request) => call(engine, 'objectAction', o, i, JSON.stringify(request));
  const info = () => JSON.parse(engine.modelInfoJson());
  const near = (a, b, msg, tol = 1e-2) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
  const [w, d] = bedSize(fullConfig());

  act(0, 0, { op: 'rename', name: 'Box' });
  assert.equal(info().objects[0].name, 'Box');
  assert.throws(() => act(0, 0, { op: 'rename', name: '' }), /empty/);

  act(0, 0, { op: 'printable', value: false });
  assert.equal(info().objects[0].instances[0].printable, false);
  act(0, 0, { op: 'printable', value: true });

  // The cube's centre on the plate, from its triangles.
  const centre = () => {
    const pos = engine.previewMesh(0).positions;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], pos[i]); hi[i % 3] = Math.max(hi[i % 3], pos[i]); }
    return { mid: lo.map((v, k) => (v + hi[k]) / 2), size: lo.map((v, k) => hi[k] - v), bottom: lo[2] };
  };
  call(engine, 'setInstanceTransform', 0, 0, JSON.stringify({ offset: [30, 40] }));
  act(0, 0, { op: 'center' });
  let c = centre();
  near(c.mid[0], w / 2, 'centred in x');
  near(c.mid[1], d / 2, 'centred in y');

  // As large as the plate allows, with room for floating-point rounding, still on the bed.
  act(0, 0, { op: 'scaleToFit', height: 100 });
  c = centre();
  near(c.size[2], 100 * 20 / 20.02, 'the height limits a cube to 100 mm', 0.05);
  near(c.bottom, 0, 'on the bed');
  near(c.mid[0], w / 2, 'still centred');
  act(0, 0, { op: 'scaleToFit', height: 0 });
  const fit = centre().size[0];
  assert.ok(fit <= Math.min(w, d) && fit > Math.min(w, d) - 0.1, `without a height, the plate limits it: ${fit}`);

  m = load('gen-cube-20.stl');
  act(0, 0, { op: 'clone', count: 3 });
  m = info();
  assert.equal(m.objects.length, 4, 'three new objects');
  assert.ok(m.objects.every((o) => o.instances.length === 1));

  m = load('gen-cube-20.stl');
  act(0, 0, { op: 'convert', to: 'fromInch' });
  near(info().objects[0].size[0], 20 * 25.4, 'inches to mm', 0.1);
  assert.equal(info().objects[0].units, 'inch', 'the page offers to convert back');
  act(0, 0, { op: 'convert', to: 'toInch' });
  near(info().objects[0].size[0], 20, 'and back', 0.01);
  assert.equal(info().objects[0].units, '');
  near(centre().bottom, 0, 'on the bed after converting');

  // Another mesh in place of the part (one mesh with two pieces is still one part).
  engine.FS.writeFile('/work/two.stl', generated['gen-two-cubes.stl']);
  act(0, 0, { op: 'replace', volume: 0, path: '/work/two.stl' });
  m = info();
  assert.equal(m.objects.length, 1);
  near(m.objects[0].size[0], 40, 'the new mesh: two 10 mm cubes 30 mm apart');
  near(centre().bottom, 0, 'on the bed after replacing');

  act(0, 0, { op: 'exportStl', path: '/work/out.stl' });
  const stl = engine.FS.readFile('/work/out.stl');
  const triangles = new DataView(stl.buffer, stl.byteOffset).getUint32(80, true);
  assert.equal(triangles, 24, 'two cubes, 12 triangles each');
  assert.equal(stl.length, 84 + 50 * triangles, 'binary STL');
  assert.throws(() => act(0, 0, { op: 'nonsense' }), /unknown/);
});

test('parts and modifiers: add shapes and files, move, change type, delete, and they change the slice', () => {
  select({ printer: DEFAULT_PRINTER });
  load('gen-cube-20.stl');
  const act = (request) => call(engine, 'volumeAction', 0, JSON.stringify(request));
  const kinds = () => info().objects[0].volumes.map((v) => v.kind);
  const config = fullConfig({ sparse_infill_density: '10%' });
  const plain = slice(config).result.totalFilamentMm;

  // A negative cylinder, like desktop: square to the bed at the cube's right front corner.
  const neg = act({ op: 'add', type: 'negative', shape: 'Cylinder', instance: 0 });
  assert.equal(neg.volume, 1);
  assert.deepEqual(kinds(), ['part', 'negative']);
  assert.equal(info().objects[0].volumes[1].name, 'Generic-Cylinder');
  let preview = engine.previewMesh(0);
  assert.deepEqual([...preview.volumeList].filter((_, k) => k % 4 !== 3), [0, 1, 1]);
  assert.equal(preview.volumePositions.length / 9, preview.volumeList[3]);
  assert.deepEqual([...preview.partList], [0, 0, 0, 12], 'the cube is the only part');
  const box = (p) => {
    const xs = [], ys = [], zs = [];
    for (let k = 0; k < p.length; k += 3) xs.push(p[k]), ys.push(p[k + 1]), zs.push(p[k + 2]);
    return { min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)] };
  };
  const cube = box(preview.positions);
  let cyl = box(preview.volumePositions);
  assert.ok(Math.abs(cyl.min[0] - cube.max[0]) < 0.01 && Math.abs(cyl.min[2]) < 0.01, `beside the cube on the bed: ${JSON.stringify(cyl)}`);

  // Moved into the middle of the cube (a world translation), it cuts a hole.
  const centre = (b) => b.min.map((v, k) => (v + b.max[k]) / 2);
  const [dx, dy] = centre(cube).map((v, k) => v - centre(cyl)[k]);
  act({ op: 'transform', volume: 1, instance: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, 0, 1] });
  cyl = box(engine.previewMesh(0).volumePositions);
  assert.ok(Math.abs(centre(cyl)[0] - centre(cube)[0]) < 0.01 && Math.abs(centre(cyl)[1] - centre(cube)[1]) < 0.01, 'centred in the cube');
  const holed = slice(config).result.totalFilamentMm;
  assert.ok(holed < plain * 0.9, `the hole takes filament away: ${holed} vs ${plain}`);

  // As a modifier with 100% infill, the same cylinder adds filament instead.
  assert.equal(act({ op: 'type', volume: 1, type: 'modifier' }).volume, 1);
  call(engine, 'setObjectSettings', 0, 1, JSON.stringify({ sparse_infill_density: '100%' }));
  assert.deepEqual(kinds(), ['part', 'modifier']);
  const filled = slice(config).result.totalFilamentMm;
  assert.ok(filled > plain * 1.05, `the modifier fills the middle: ${filled} vs ${plain}`);

  // A part from a file, and rotating it a quarter turn about its centre.
  engine.FS.writeFile('/work/part.stl', cubesStl([[0, 0, 0]], 5));
  const added = act({ op: 'add', type: 'part', path: '/work/part.stl', name: 'small.stl' });
  assert.deepEqual(kinds(), ['part', 'part', 'modifier'], 'parts come first');
  assert.equal(added.volume, 1);
  assert.equal(info().objects[0].volumes[1].name, 'small.stl');
  assert.equal(engine.previewMesh(0).partList.length, 8);
  act({ op: 'rename', volume: 1, name: 'Small cube' });
  assert.equal(info().objects[0].volumes[1].name, 'Small cube');

  // Supports: a blocker; then deleting; the last part can't go.
  act({ op: 'add', type: 'supportBlocker', shape: 'Sphere', instance: 0 });
  assert.deepEqual(kinds(), ['part', 'part', 'modifier', 'supportBlocker']);
  act({ op: 'delete', volume: 3 });
  act({ op: 'delete', volume: 1 });
  assert.deepEqual(kinds(), ['part', 'modifier']);
  assert.throws(() => act({ op: 'delete', volume: 0 }), /at least one part/);
  assert.throws(() => act({ op: 'type', volume: 0, type: 'negative' }), /at least one part/);

  // Saved and opened again, the modifier and its setting are still there.
  call(engine, 'saveProject', '/work/parts.3mf', JSON.stringify(config), null);
  engine.clearModel();
  const [w, d] = bedSize(fullConfig());
  call(engine, 'loadModel', '/work/parts.3mf', 0, w, d);
  assert.deepEqual(kinds(), ['part', 'modifier']);
  assert.equal(info().objects[0].volumes[1].settings.sparse_infill_density, '100%');
});

test('mesh boolean: union, difference and intersection of two parts, like desktop', () => {
  select({ printer: DEFAULT_PRINTER });
  const volumes = (o = 0) => info().objects[o].volumes;
  const extent = () => {
    const p = engine.previewMesh(0).positions;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < p.length; k++) (lo[k % 3] = Math.min(lo[k % 3], p[k])), (hi[k % 3] = Math.max(hi[k % 3], p[k]));
    return hi.map((v, k) => Math.round((v - lo[k]) * 100) / 100);
  };
  // A 20 mm cube and a 30 mm cube part over its right half, sticking out on
  // every side so no faces lie flat on each other (mcut can't cut those).
  const setup = () => {
    load('gen-cube-20.stl');
    engine.FS.writeFile('/work/b.stl', cubesStl([[10, -5, -5]], 30));
    call(engine, 'volumeAction', 0, JSON.stringify({ op: 'add', type: 'part', path: '/work/b.stl', name: 'b.stl' }));
    assert.equal(volumes().length, 2);
  };
  const boolean = (request) => call(engine, 'meshBoolean', 0, JSON.stringify(request));

  setup();
  assert.deepEqual(extent(), [40, 30, 30], 'the two cubes overlapping');
  const union = boolean({ op: 'union', a: 0, b: 1 });
  assert.equal(volumes().length, 1, 'a union always takes the second part');
  assert.equal(union.volume, 0);
  assert.match(volumes()[0].name, / - union$/);
  assert.deepEqual(extent(), [40, 30, 30]);
  slice(fullConfig());

  setup();
  boolean({ op: 'difference', a: 0, b: 1 });
  assert.equal(volumes().length, 2, 'the tool stays unless asked to go');
  assert.equal(volumes()[0].kind, 'part');

  setup();
  boolean({ op: 'difference', a: 0, b: 1, deleteInput: true });
  assert.equal(volumes().length, 1);
  assert.deepEqual(extent(), [10, 20, 20], 'half the first cube is left');

  setup();
  boolean({ op: 'intersection', a: 1, b: 0, deleteInput: true });
  assert.equal(volumes().length, 1);
  assert.deepEqual(extent(), [10, 20, 20], 'only the overlap is left');
  assert.match(volumes()[0].name, /b\.stl - intersection/);

  setup();
  assert.throws(() => boolean({ op: 'union', a: 0, b: 0 }), /two different/);
  assert.throws(() => boolean({ op: 'xor', a: 0, b: 1 }), /unknown/);
});

test('text shapes: a text part, an engraved text, a text object and editing the text, like desktop', () => {
  select({ printer: DEFAULT_PRINTER });
  engine.FS.writeFile('/work/font.ttf', readFileSync(resolve(fixtures, '../engine/orcaslicer/resources/fonts/NanumGothic-Regular.ttf')));
  const text = (o, request, plate = 0) => call(engine, 'textVolume', o, plate, JSON.stringify({ font: 'NanumGothic', fontPath: '/work/font.ttf', ...request }));
  const volumes = (o = 0) => info().objects[o].volumes;
  load('gen-cube-20.stl');

  const added = text(0, { op: 'add', type: 'part', text: 'Hi', size: 10, depth: 2 });
  assert.equal(added.volume, 1);
  const part = volumes()[1];
  assert.equal(part.kind, 'part');
  assert.equal(part.name, 'Hi');
  assert.deepEqual(
    { text: part.text.text, font: part.text.font, size: part.text.size, depth: part.text.depth, align: part.text.align },
    { text: 'Hi', font: 'NanumGothic', size: 10, depth: 2, align: 'center' },
  );
  const sizeBefore = info().objects[0].size;
  assert.ok(sizeBefore[1] > 20, `the text stands in front of the cube: ${sizeBefore}`);

  // Longer text, same place: the object grows along X only as far as the words.
  text(0, { op: 'update', volume: 1, text: 'Hello there', size: 10, depth: 2 });
  assert.equal(volumes()[1].text.text, 'Hello there');
  assert.equal(volumes()[1].name, 'Hello there');
  assert.ok(info().objects[0].size[0] > 40, `longer text is wider: ${info().objects[0].size}`);

  // On the surface the camera looks at: the cube's top, seen from straight above.
  const cubeTop = info().objects[0].size[2];
  const onTop = text(0, { op: 'add', type: 'part', text: 'Top', size: 5, depth: 1, camera: [135, 135, 200] });
  assert.ok(info().objects[0].size[2] > cubeTop + 0.9, `text on the top stands 1 mm above it: ${info().objects[0].size[2]} vs ${cubeTop}`);
  call(engine, 'volumeAction', 0, JSON.stringify({ op: 'delete', volume: onTop.volume }));

  const engraved = text(0, { op: 'add', type: 'negative', text: 'X', size: 5, depth: 1 });
  assert.equal(volumes()[engraved.volume].kind, 'negative');
  slice(fullConfig());

  // A text object of its own, on the plate.
  const object = text(-1, { op: 'add', type: 'part', text: 'Label', size: 12, depth: 3 });
  assert.equal(object.object, 1);
  const label = info().objects[1];
  assert.equal(label.name, 'Label');
  assert.ok(Math.abs(label.size[2] - 3) < 0.1, `the label lies flat, 3 mm thick: ${label.size}`);
  text(1, { op: 'update', volume: 0, text: 'New label', size: 12, depth: 3 });
  assert.equal(info().objects[1].name, 'New label', 'a text that is the whole object names it');

  // Saved and opened again, the text and its font settings are still there to edit.
  call(engine, 'saveProject', '/work/text.3mf', JSON.stringify(fullConfig()), null);
  engine.clearModel();
  const [w, d] = bedSize(fullConfig());
  call(engine, 'loadModel', '/work/text.3mf', 0, w, d);
  const reopened = volumes().find((v) => v.text?.text === 'Hello there');
  assert.ok(reopened, `the text part comes back: ${JSON.stringify(volumes().map((v) => v.name))}`);
  assert.equal(reopened.text.size, 10);
  assert.equal(reopened.text.depth, 2);
  assert.equal(info().objects[1].volumes[0].text.text, 'New label');

  assert.throws(() => text(0, { op: 'add', type: 'part', text: '   ' }), /type some text/);
  assert.throws(() => text(0, { op: 'add', type: 'part', text: 'A', fontPath: '/work/none.ttf' }), /can't be read/);
});

test('text in Hebrew: laid out right to left, numbers and Latin words left to right, missing letters reported', () => {
  const order = (t) => engine.textVisualOrder(t);
  assert.equal(order('Hello'), 'Hello');
  assert.equal(order('שלום עולם'), 'םלוע םולש');
  assert.equal(order('גיל 12 שנים'), 'םינש 12 ליג');
  assert.equal(order('Hi שלום 2026 there'), 'Hi 2026 םולש there');
  assert.equal(order('(שלום)'), '(םולש)', 'brackets turn round with the words');
  assert.equal(order('שָׁלוֹם'), 'םוֹלשָׁ', 'points stay after their letter');
  assert.equal(order('שלום\nabc'), 'םולש\nabc', 'each line on its own');

  select({ printer: DEFAULT_PRINTER });
  engine.FS.writeFile('/work/font.ttf', readFileSync(resolve(fixtures, '../engine/orcaslicer/resources/fonts/NanumGothic-Regular.ttf')));
  load('gen-cube-20.stl');
  const r = call(engine, 'textVolume', -1, 0, JSON.stringify({ op: 'add', type: 'part', font: 'NanumGothic', fontPath: '/work/font.ttf', text: 'Ab שלום', size: 10, depth: 2 }));
  assert.equal(r.missing, 'שלום', 'a font without Hebrew letters says which are missing');
  assert.equal(info().objects[r.object].volumes[0].text.text, 'Ab שלום', 'the text is kept as typed');
});

test('text on a surface: slid, turned, lifted, facing the camera, following a curve and letter by letter, kept in the 3MF', () => {
  select({ printer: DEFAULT_PRINTER });
  engine.FS.writeFile('/work/font.ttf', readFileSync(resolve(fixtures, '../engine/orcaslicer/resources/fonts/NanumGothic-Regular.ttf')));
  const style = { font: 'NanumGothic', fontPath: '/work/font.ttf', text: 'HELLO WORLD', size: 8, depth: 1 };
  const text = (o, request) => call(engine, 'textVolume', o, 0, JSON.stringify({ ...style, ...request }));
  const place = (request) => call(engine, 'shapePlace', 0, 0, JSON.stringify({ volume: 1, instance: 0, fontPath: '/work/font.ttf', ...request }));
  const state = () => place({ op: 'state' });
  const near = (a, b, what, tolerance = 0.2) => assert.ok(Math.abs(a - b) < tolerance, `${what}: ${a} vs ${b}`);
  const at = (m) => [m[12], m[13], m[14]];
  const axis = (m) => [m[8], m[9], m[10]].map((v) => v / Math.hypot(m[8], m[9], m[10]));
  const width = () => info().objects[0].size[0];

  // On the front of a cylinder (radius 15), seen from the front.
  load('gen-cylinder.stl');
  const centre = info().objects[0].instances[0].offset;
  text(0, { op: 'add', type: 'part', camera: [centre[0], centre[1] - 150, 15] });
  let s = state();
  assert.equal(s.surface, true);
  assert.equal(s.distance, null, 'it starts on the surface');
  near(s.angle, 0, 'it starts upright');
  near(axis(s.matrix)[1], -1, 'it faces the camera', 0.05);
  const flat = width();
  assert.ok(flat > 45, `flat, the words stick out past the cylinder: ${flat}`);

  // Following the surface, the words bend round it; letter by letter, each stands on it.
  text(0, { op: 'update', volume: 1, useSurface: true });
  assert.equal(info().objects[0].volumes[1].text.useSurface, true);
  assert.ok(width() < 33, `on the surface the words wrap round the cylinder: ${width()}`);
  text(0, { op: 'update', volume: 1, useSurface: false, perGlyph: true });
  assert.ok(width() < 36, `letter by letter they stand round the cylinder: ${width()}`);
  text(0, { op: 'update', volume: 1, useSurface: true, perGlyph: false, valign: 'top' });
  assert.equal(info().objects[0].volumes[1].text.valign, 'top');

  // Slid round to the right side, it faces right and still follows the surface.
  s = state();
  const right = place({ op: 'drag', ray: [centre[0] + 100, centre[1], 15, -1, 0, 0] });
  assert.equal(right.hit, true);
  near(axis(right.matrix)[0], 1, 'over the right side it faces right', 0.05);
  near(at(s.matrix)[0], at(state().matrix)[0], 'a drag that is not committed changes nothing');
  place({ op: 'drag', ray: [centre[0] + 100, centre[1], 15, -1, 0, 0], commit: true });
  s = state();
  near(at(s.matrix)[0], centre[0] + 15, 'it moved onto the right side', 0.3);
  assert.ok(info().objects[0].size[1] < 33, `and wraps round it there: ${info().objects[0].size}`);
  assert.equal(place({ op: 'drag', ray: [centre[0] + 100, centre[1] + 100, 15, 1, 0, 0] }).hit, false, 'off the object nothing is hit');

  // Turned, lifted off the surface (flat again), turned to the camera above.
  place({ op: 'rotate', angle: 30 });
  near(state().angle, 30, 'turned 30 degrees clockwise', 0.5);
  place({ op: 'rotate', angle: 0 });
  text(0, { op: 'update', volume: 1, useSurface: false });
  place({ op: 'distance', distance: 2 });
  near(state().distance, 2, 'lifted 2 mm', 0.1);
  place({ op: 'distance', distance: 0 });
  assert.equal(state().distance, null, 'back on the surface');
  place({ op: 'face', camera: [centre[0], centre[1], 300] });
  near(axis(state().matrix)[2], 1, 'facing the camera above', 0.05);

  // Saved and opened again, desktop's surface settings come back.
  text(0, { op: 'update', volume: 1, useSurface: true, perGlyph: true, valign: 'top' });
  call(engine, 'saveProject', '/work/surface.3mf', JSON.stringify(fullConfig()), null);
  engine.clearModel();
  const [w, d] = bedSize(fullConfig());
  call(engine, 'loadModel', '/work/surface.3mf', 0, w, d);
  const index = info().objects[0].volumes.findIndex((v) => v.text);
  const back = info().objects[0].volumes[index];
  assert.deepEqual([back.text.useSurface, back.text.perGlyph, back.text.valign], [true, true, 'top']);
  // And it can still be moved, remade where it lands.
  place({ op: 'drag', volume: index, ray: [centre[0] - 100, centre[1], 15, 1, 0, 0], commit: true });
  near(at(place({ op: 'state', volume: index }).matrix)[0], centre[0] - 15, 'moved onto the left side after reopening', 0.3);
  assert.throws(() => place({ op: 'drag', volume: index, ray: [centre[0] + 100, centre[1], 15, -1, 0, 0], commit: true, fontPath: '' }), /font/);

  // On a thin wall (the Benchy's cabin) it stays on the near side: from a
  // point on the surface a ray finds the wall's far side.
  load('3DBenchy.stl');
  text(0, { op: 'add', type: 'part', camera: [w / 2, -d * 0.75, d * 0.8] });
  const before = at(state().matrix);
  text(0, { op: 'update', volume: 1, useSurface: true });
  s = state();
  at(s.matrix).forEach((v, k) => near(v, before[k], 'following the surface it stays where it was', 0.05));
  assert.equal(s.distance, null, 'and on the surface');
});

test('SVG shapes: an SVG part, an engraved SVG, an SVG object, depth and size, kept in the 3MF, like desktop', () => {
  select({ printer: DEFAULT_PRINTER });
  // A 20 x 10 mm plate with a round hole.
  engine.FS.writeFile(
    '/work/badge.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10">' +
      '<path fill-rule="evenodd" d="M0 0 H20 V10 H0 Z M8 5 A2 2 0 1 0 12 5 A2 2 0 1 0 8 5 Z"/></svg>',
  );
  engine.FS.writeFile('/work/empty.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"></svg>');
  const svg = (o, request, plate = 0) => call(engine, 'svgVolume', o, plate, JSON.stringify(request));
  const volumes = (o = 0) => info().objects[o].volumes;
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.2, `${what}: ${a} vs ${b}`);
  load('gen-cube-20.stl');

  const added = svg(0, { op: 'add', type: 'part', path: '/work/badge.svg', name: 'badge.svg', depth: 2 });
  near(added.width, 20, 'the SVG keeps its size in mm');
  near(added.height, 10, 'the SVG keeps its size in mm');
  const part = volumes()[added.volume];
  assert.equal(part.name, 'badge');
  assert.equal(part.kind, 'part');
  near(part.svg.depth, 2, 'depth');

  // Deeper, then wider: the shape is remade, then scaled across its face.
  svg(0, { op: 'update', volume: added.volume, depth: 4 });
  near(volumes()[added.volume].svg.depth, 4, 'new depth');
  const wider = svg(0, { op: 'update', volume: added.volume, width: 30, height: 15 });
  near(wider.width, 30, 'new width');
  near(volumes()[added.volume].svg.height, 15, 'new height');
  near(volumes()[added.volume].svg.depth, 4, 'the depth stays');

  // On the cube's top, seen from above.
  const cubeTop = info().objects[0].size[2];
  const onTop = svg(0, { op: 'add', type: 'part', path: '/work/badge.svg', name: 'badge.svg', depth: 1, camera: [135, 135, 200] });
  assert.ok(info().objects[0].size[2] > cubeTop + 0.9, `the SVG on the top stands 1 mm above it: ${info().objects[0].size[2]} vs ${cubeTop}`);
  // Engraved, it goes into the top instead; a part again, it stands out again.
  const asNegative = call(engine, 'volumeAction', 0, JSON.stringify({ op: 'type', volume: onTop.volume, type: 'negative' }));
  near(info().objects[0].size[2], cubeTop, 'engraved, the SVG is inside the top');
  const asPart = call(engine, 'volumeAction', 0, JSON.stringify({ op: 'type', volume: asNegative.volume, type: 'part' }));
  near(info().objects[0].size[2], cubeTop + 1, 'a part again, the SVG stands out');
  call(engine, 'volumeAction', 0, JSON.stringify({ op: 'delete', volume: asPart.volume }));

  const engraved = svg(0, { op: 'add', type: 'negative', path: '/work/badge.svg', name: 'badge.svg', depth: 1 });
  assert.equal(volumes()[engraved.volume].kind, 'negative');
  slice(fullConfig());

  const object = svg(-1, { op: 'add', type: 'part', path: '/work/badge.svg', name: 'logo.svg', depth: 3 });
  const logo = info().objects[object.object];
  assert.equal(logo.name, 'logo');
  near(logo.size[2], 3, 'the SVG object lies flat');

  // Saved and opened again: the file is in the 3MF, so the depth can still change.
  call(engine, 'saveProject', '/work/svg.3mf', JSON.stringify(fullConfig()), null);
  engine.clearModel();
  const [w, d] = bedSize(fullConfig());
  call(engine, 'loadModel', '/work/svg.3mf', 0, w, d);
  const index = volumes().findIndex((v) => v.svg && v.kind === 'part');
  assert.ok(index >= 0, `the SVG part comes back: ${JSON.stringify(volumes().map((v) => v.name))}`);
  near(volumes()[index].svg.width, 30, 'the width comes back');
  svg(0, { op: 'update', volume: index, depth: 1 });
  near(volumes()[index].svg.depth, 1, 'depth after reopening');
  near(volumes()[index].svg.width, 30, 'the width stays after reopening');

  // Following the surface: the cube's top is flat, so the shape keeps its size.
  const top = svg(0, { op: 'add', type: 'part', path: '/work/badge.svg', name: 'badge.svg', depth: 1, camera: [135, 135, 200] });
  svg(0, { op: 'update', volume: top.volume, useSurface: true });
  assert.equal(volumes()[top.volume].svg.useSurface, true);
  near(volumes()[top.volume].svg.width, 20, 'following a flat surface keeps the width');

  assert.throws(() => svg(0, { op: 'add', type: 'part', path: '/work/empty.svg', name: 'empty.svg' }), /no paths/);
  assert.throws(() => svg(0, { op: 'add', type: 'part', path: '/work/none.svg', name: 'none.svg' }), /missing/);
});

test('plate menu: primitives as new objects on the free spot, delete all on a plate, rename a plate, like desktop', () => {
  select({ printer: DEFAULT_PRINTER });
  const plate = (p, request) => call(engine, 'plateAction', p, JSON.stringify(request));
  const [w, d] = bedSize(fullConfig());
  const side = 0.1 * Math.max(w, d);
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.05, `${what}: ${a} vs ${b}`);
  load('gen-cube-20.stl');
  const at = (o) => info().objects[o].instances[0].offset;

  // On an empty plate a primitive lies in the middle, like desktop's load_shape_object.
  plate(0, { op: 'deleteAll' });
  assert.equal(info().objects.length, 0, 'delete all emptied the plate');
  const first = plate(0, { op: 'addShape', shape: 'Cylinder' });
  assert.equal(first.object, 0);
  const cyl = info().objects[0];
  assert.equal(cyl.name, 'Cylinder');
  assert.deepEqual(cyl.volumes.map((v) => [v.name, v.kind]), [['Cylinder', 'part']]);
  near(cyl.size[0], side, 'a tenth of the bed across');
  near(cyl.size[2], side, 'as tall as wide');
  near(at(0)[0], w / 2, 'centred in x');
  near(at(0)[1], d / 2, 'centred in y');

  // A second one goes beside it, not on top of it; every shape desktop offers works.
  for (const shape of ['Cube', 'Sphere', 'Cone', 'Disc', 'Torus']) plate(0, { op: 'addShape', shape });
  const objs = info().objects;
  assert.equal(objs.length, 6);
  assert.ok(Math.hypot(at(1)[0] - at(0)[0], at(1)[1] - at(0)[1]) >= side, 'the cube is clear of the cylinder');
  near(objs[2].size[2], side, 'the sphere sits on the bed');
  near(objs[4].size[2], 0.2, 'the disc is 0.2 mm thick');
  assert.ok(objs.every((o) => o.instances[0].plate === 0));
  assert.ok(slice(fullConfig()).result.totalFilamentMm > 0, 'the shapes slice');

  // A primitive goes on the plate it was asked for; delete all leaves the other plates alone.
  call(engine, 'addPlate');
  const other = plate(1, { op: 'addShape', shape: 'Cube' });
  assert.equal(info().objects[other.object].instances[0].plate, 1);
  plate(0, { op: 'deleteAll' });
  assert.deepEqual(info().objects.map((o) => o.instances.map((i) => i.plate)), [[1]], 'only plate 2 keeps its cube');

  // Renamed plates keep their names in the 3MF.
  plate(1, { op: 'rename', name: 'Spares' });
  assert.deepEqual(info().plates.map((p) => p.name), ['', 'Spares']);
  call(engine, 'saveProject', '/work/plates.3mf', JSON.stringify(fullConfig()), null);
  engine.clearModel();
  call(engine, 'loadModel', '/work/plates.3mf', 0, w, d, false);
  assert.deepEqual(info().plates.map((p) => p.name), ['', 'Spares']);

  assert.throws(() => plate(0, { op: 'addShape', shape: 'Teapot' }), /unknown shape/);
  assert.throws(() => plate(5, { op: 'deleteAll' }), /no plate/);
});

test('layer slider: a pause, a filament change and custom G-code at a layer, per plate, kept in the 3MF, like desktop', () => {
  select({ printer: DEFAULT_PRINTER });
  const plate = (p, request) => call(engine, 'plateAction', p, JSON.stringify(request));
  const codes = (p = 0) => info().plates[p].layerCodes;
  load('gen-cube-20.stl');
  assert.deepEqual(codes(), []);
  assert.deepEqual(info().plates[0].filaments, [1], 'the cube prints with filament 1');

  // Desktop's "Add Pause" (layer tops are 0.25 mm, then every 0.2 mm), "Change Filament > Filament 2" and "Add Custom G-code".
  selectSlots(2);
  const config = fullConfig({ filament_colour: '#FF0000;#0000FF' });
  plate(0, {
    op: 'layerCodes',
    filaments: 2,
    codes: [
      { z: 10.25, type: 'filament', filament: 2, colour: '#0000FF' },
      { z: 4.25, type: 'pause' },
      { z: 6.25, type: 'custom', gcode: 'M117 LAYER_MARK' },
    ],
  });
  assert.deepEqual(codes().map((c) => [c.z, c.type]), [[4.25, 'pause'], [6.25, 'custom'], [10.25, 'filament']], 'kept in height order');
  const { gcode } = slice(config);
  const at = (text) => gcode.indexOf(text);
  const layerAt = (z) => gcode.indexOf(`;Z:${z}\n`);
  assert.ok(at(';PAUSE_PRINT') > 0, 'the pause is in the G-code');
  assert.ok(at(';PAUSE_PRINT') > layerAt(4.25) && at(';PAUSE_PRINT') < layerAt(4.45), 'at the start of the layer at 4.25 mm');
  assert.equal(gcode.match(/^M117 LAYER_MARK$/gm)?.length, 1, 'the custom G-code once');
  assert.ok(at('M117 LAYER_MARK') > layerAt(6.25) && at('M117 LAYER_MARK') < layerAt(6.45));
  const tools = toolCounts(gcode);
  assert.ok(tools['1'] >= 1, `filament 2 takes over: ${JSON.stringify(tools)}`);
  assert.ok(gcode.lastIndexOf('\nT0\n') < layerAt(10.25), 'no filament 1 after the change');

  // One item per layer: the same height replaces it; an empty list removes them all.
  plate(0, { op: 'layerCodes', filaments: 2, codes: [...codes(), { z: 4.25, type: 'custom', gcode: 'M117 OTHER' }] });
  assert.deepEqual(codes().map((c) => c.type), ['custom', 'custom', 'filament']);

  // Each plate has its own; deleting a plate moves later plates' items with them.
  call(engine, 'addPlate');
  call(engine, 'addPlate');
  plate(2, { op: 'layerCodes', filaments: 2, codes: [{ z: 2.25, type: 'pause' }] });
  assert.deepEqual(codes(1), []);
  call(engine, 'deletePlate', 1);
  assert.deepEqual(codes(1).map((c) => [c.z, c.type]), [[2.25, 'pause']], 'plate 3 became plate 2 with its pause');

  // Saved in the 3MF the way desktop does (Metadata/custom_gcode_per_layer.xml) and read back.
  call(engine, 'saveProject', '/work/layers.3mf', JSON.stringify(config), null);
  const xml = unzip(engine.FS.readFile('/work/layers.3mf'))['Metadata/custom_gcode_per_layer.xml'].toString();
  assert.match(xml, /<plate_info id="2"\/>/);
  assert.match(xml, /<mode value="MultiAsSingle"\/>/);
  engine.clearModel();
  const [w, d] = bedSize(config);
  call(engine, 'loadModel', '/work/layers.3mf', 0, w, d, false);
  assert.deepEqual(codes(0).map((c) => [c.z, c.type, c.gcode]), [[4.25, 'custom', 'M117 OTHER'], [6.25, 'custom', 'M117 LAYER_MARK'], [10.25, 'filament', '']]);
  assert.equal(codes(0)[2].filament, 2);
  assert.deepEqual(codes(1).map((c) => c.type), ['pause']);

  plate(0, { op: 'layerCodes', filaments: 2, codes: [] });
  assert.deepEqual(codes(0), []);
  assert.throws(() => plate(0, { op: 'layerCodes', codes: [{ z: 1, type: 'teleport' }] }), /unknown layer item/);
  assert.throws(() => plate(0, { op: 'layerCodes', codes: [{ z: 1, type: 'filament', filament: 0 }] }), /needs a filament/);
});

test('transform fields, sinking, part fields, copy and paste, like desktop', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} vs ${b}`);
  const move = (o, i, changes) => call(engine, 'setInstanceTransform', o, i, JSON.stringify(changes));
  load('gen-cube-20.stl');

  // The object's own size, unrotated and unscaled: the page shows it times the scale in mm.
  near(info().objects[0].meshSize[0], 20, 'mesh size');
  move(0, 0, { scale: [1.5, 1.5, 1.5], rotation: [0, 0, 30] });
  near(info().objects[0].meshSize[2], 20, 'scale and rotation leave the mesh size alone');
  near(info().objects[0].size[2], 30, 'the instance is 30 mm tall');

  // A Z below the bed sinks it (sliced only above the bed); above the bed it drops back.
  const full = slice(fullConfig()).result.totalLayers;
  // Turning an object on the bed about a corner keeps it on the bed, not partly under it.
  move(0, 0, { rotation: [40, 0, 30] });
  move(0, 0, { rotation: [0, 0, 30] });
  assert.equal(slice(fullConfig()).result.totalLayers, full, 'turned and back, still all above the bed');
  const z0 = info().objects[0].instances[0].offset[2];
  move(0, 0, { offset: [100, 100, z0 - 10] });
  near(info().objects[0].instances[0].offset[2], z0 - 10, 'sunk by 10 mm');
  move(0, 0, { rotation: [0, 0, 45] });
  near(info().objects[0].instances[0].offset[2], z0 - 10, 'stays sunk after turning it');
  const sunk = slice(fullConfig()).result.totalLayers;
  assert.ok(sunk < full * 0.75 && sunk > full * 0.5, `a third under the bed: ${sunk} of ${full} layers`);
  move(0, 0, { offset: [100, 100, z0 + 25] });
  near(info().objects[0].instances[0].offset[2], z0, 'floating drops back onto the bed');

  // Part fields: offset, rotation and scale inside the object.
  call(engine, 'volumeAction', 0, JSON.stringify({ op: 'add', type: 'modifier', shape: 'Cube', instance: 0 }));
  const vol = info().objects[0].volumes.findIndex((v) => v.kind === 'modifier');
  call(engine, 'volumeAction', 0, JSON.stringify({ op: 'set', volume: vol, offset: [1, 2, 3], rotation: [0, 0, 10], scale: [2, 1, 1] }));
  const v = info().objects[0].volumes[vol];
  assert.deepEqual(v.offset.map((n) => Math.round(n * 100) / 100), [1, 2, 3]);
  near(v.rotation[2], 10, 'part rotation');
  near(v.scale[0], 2, 'part scale');
  assert.ok(v.meshSize[0] > 0, 'part mesh size');
  assert.throws(() => call(engine, 'volumeAction', 0, JSON.stringify({ op: 'set', volume: vol, scale: [0, 1, 1] })), /above 0/);

  // Copy, delete the original, paste: the copy comes back with its scale and parts.
  const plate = (p, request) => call(engine, 'plateAction', p, JSON.stringify(request));
  call(engine, 'addInstance', 0, 0, 40, 0);
  plate(0, { op: 'copy', object: 0, instance: 1 });
  call(engine, 'deleteObject', 0);
  assert.equal(info().objects.length, 0);
  assert.equal(plate(0, { op: 'paste' }).object, 0);
  const pasted = info().objects[0];
  assert.equal(pasted.instances.length, 1, 'one copy pasted, not every instance');
  near(pasted.instances[0].scale[0], 1.5, 'keeps its scale');
  assert.equal(pasted.volumes.length, 2, 'keeps its modifier');
  plate(0, { op: 'paste' });
  const [a, b] = info().objects.map((o) => o.instances[0].offset);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 30, 'a second paste goes beside the first');
  assert.throws(() => plate(0, { op: 'copy', object: 9, instance: 0 }), /no object/);
});

test('several objects chosen together: copy and paste as a block, arrange selection', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  const plate = (p, request) => call(engine, 'plateAction', p, JSON.stringify(request));
  const move = (o, x, y) => call(engine, 'setInstanceTransform', o, 0, JSON.stringify({ offset: [x, y] }));
  const at = (o) => info().objects[o].instances[0].offset;
  load('gen-cube-20.stl');
  load('gen-cube-20.stl', 0, true);
  load('gen-cube-20.stl', 0, true);
  move(0, 60, 60);
  move(1, 100, 70);
  move(2, 200, 200);

  // Two copied together paste as two new objects, 40 and 10 mm apart as before.
  plate(0, { op: 'copy', items: [{ object: 0, instance: 0 }, { object: 1, instance: 0 }] });
  const out = plate(0, { op: 'paste' });
  assert.deepEqual(out.objects, [3, 4]);
  assert.equal(out.object, 3);
  const [a, b] = [at(3), at(4)];
  assert.ok(Math.abs(b[0] - a[0] - 40) < 0.01 && Math.abs(b[1] - a[1] - 10) < 0.01, `kept their spacing: ${a} ${b}`);
  // Clear of the originals.
  for (const o of [0, 1, 2]) for (const p of [a, b]) assert.ok(Math.hypot(p[0] - at(o)[0], p[1] - at(o)[1]) > 20, `pasted on top of object ${o}`);

  // Arrange selection moves only the chosen ones, onto free spots clear of the rest.
  const still = [at(0), at(1), at(2)].map((p) => p.slice());
  move(3, 200, 200);
  move(4, 205, 205);
  plate(0, { op: 'arrangeSelection', objects: [3, 4] });
  assert.deepEqual([at(0), at(1), at(2)], still, 'the others stay put');
  const [c, d] = [at(3), at(4)];
  assert.ok(Math.hypot(c[0] - d[0], c[1] - d[1]) >= 20, `no longer on top of each other: ${c} ${d}`);
  for (const p of [c, d]) for (const q of still) assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) >= 20, `clear of the others: ${p} ${q}`);
  assert.throws(() => plate(0, { op: 'arrangeSelection', objects: [9] }), /no object/);
});

test('assemble several chosen objects: one object, every part where it stood', () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  const plate = (p, request) => call(engine, 'plateAction', p, JSON.stringify(request));
  const move = (o, x, y) => call(engine, 'setInstanceTransform', o, 0, JSON.stringify({ offset: [x, y] }));
  load('gen-cube-20.stl');
  load('gen-cube-20.stl', 0, true);
  load('gen-cube-20.stl', 0, true);
  load('gen-cube-20.stl', 0, true);
  move(0, 60, 60);
  move(1, 100, 60);
  move(2, 100, 120);
  move(3, 200, 200);

  // Assemble with objects chosen picks only on them: the ray passes through the others.
  const down = (objects) => call(engine, 'measureFeature', 0, JSON.stringify({ ray: [70, 70, 100, 0, 0, -1], onlyPlane: true, objects })).feature;
  assert.equal(down([0]).object, 0);
  assert.equal(down([1, 2]), null);

  // Three of the four: one "Assembly" of three parts, spanning where they stood; the fourth stays.
  const out = plate(0, { op: 'assemble', items: [0, 1, 2].map((object) => ({ object, instance: 0 })) });
  const objects = info().objects;
  assert.equal(objects.length, 2);
  assert.equal(out.object, 1);
  assert.equal(objects[1].name, 'Assembly');
  assert.equal(objects[1].volumes.length, 3);
  const size = objects[1].size;
  assert.ok(Math.abs(size[0] - 60) < 0.01 && Math.abs(size[1] - 80) < 0.01 && Math.abs(size[2] - 20) < 0.01, `spans the three cubes: ${size}`);
  // The cubes' offsets are their corners (x 60..120, y 60..140 together); the assembly's is its middle.
  const [x, y] = objects[1].instances[0].offset;
  assert.ok(Math.abs(x - 90) < 0.01 && Math.abs(y - 100) < 0.01, `middle of the three: ${x} ${y}`);
  assert.deepEqual(objects[0].instances[0].offset.slice(0, 2), [200, 200], 'the fourth stays put');

  assert.throws(() => plate(0, { op: 'assemble', items: [{ object: 0, instance: 0 }] }), /at least two/);
  assert.throws(() => plate(0, { op: 'assemble', items: [{ object: 9, instance: 0 }, { object: 0, instance: 0 }] }), /no object/);
});

test("plate type: a printer starts on its own plate, and any plate can be picked", () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  assert.equal(fullConfig().curr_bed_type, 'Textured PEI Plate', "the U1's default plate");
  for (const plate of ['Cool Plate', 'High Temp Plate', 'Supertack Plate']) assert.equal(fullConfig({ curr_bed_type: plate }).curr_bed_type, plate);
  // Snapmaker Orca's Graphic Effect plate is in its extended list only; it is offered too.
  const plates = JSON.parse(engine.configOptionsJson()).curr_bed_type.enumValues;
  assert.equal(plates.includes('Graphic Effect Plate'), flavor.flavor !== 'orca', plates.join(', '));
});

test("the G-code's file name comes from the process preset's filename format, like desktop", () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  load('tetrahedron.stl');
  const cfg = fullConfig({ filename_format: '{input_filename_base}_p{plate_number}_{total_weight}g{if total_weight > 0}_full{endif}.gcode' });
  const { result } = slice(cfg, 0, null, 'tetrahedron');
  assert.match(result.fileName, /^tetrahedron_p01_[\d.]+g_full\.gcode$/, result.fileName);
  // The default format names the plate, the filament and the time.
  const plain = slice(fullConfig(), 0, null, 'tetrahedron').result.fileName;
  assert.match(plain, /^tetrahedron_plate_01_PLA_.+\.gcode$/, plain);
});

test("the cost counts the printer's time cost as well as the filament, like desktop", () => {
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  load('tetrahedron.stl');
  const cfg = fullConfig();
  const filamentOnly = slice({ ...cfg, time_cost: '0' }).result;
  const withTime = slice({ ...cfg, time_cost: '6' }).result;
  const hours = withTime.estimatedTimeSeconds / 3600;
  assert.ok(Math.abs(withTime.totalCost - filamentOnly.totalCost - 6 * hours) < 0.01, `${filamentOnly.totalCost} → ${withTime.totalCost} over ${hours} h`);
});

test("an added model turns by the printer's preferred orientation", () => {
  select({ printer: DEFAULT_PRINTER });
  const span = () => {
    const p = engine.previewMesh(0).positions;
    const [x, y] = [[Infinity, -Infinity], [Infinity, -Infinity]];
    for (let i = 0; i < p.length; i += 3) {
      x[0] = Math.min(x[0], p[i]); x[1] = Math.max(x[1], p[i]);
      y[0] = Math.min(y[0], p[i + 1]); y[1] = Math.max(y[1], p[i + 1]);
    }
    return [x[1] - x[0], y[1] - y[0]];
  };
  load('gen-two-cubes.stl');
  const [w, d] = span();
  assert.ok(w > 2 * d, `long in X: ${w} × ${d}`);
  load('gen-two-cubes.stl', 0, false, 90);
  const [w2, d2] = span();
  assert.ok(d2 > 2 * w2, `turned to Y: ${w2} × ${d2}`);
});

test('a printer that takes a .gcode.3mf gets the plate in one, like desktop', (t) => {
  if (!JSON.parse(engine.configOptionsJson()).use_3mf) return t.skip('Snapmaker Orca has no "Use 3MF instead of G-code"');
  select({ printer: DEFAULT_PRINTER, process: STANDARD });
  load('tetrahedron.stl');
  const { result, gcode } = slice({ ...fullConfig(), use_3mf: '1' }, 0, null, 'tetrahedron');
  assert.ok(result.gcode3mfPath, JSON.stringify(result.warnings));
  const files = unzip(engine.FS.readFile(result.gcode3mfPath));
  assert.equal(files['Metadata/plate_1.gcode'].toString(), gcode);
  assert.match(files['Metadata/slice_info.config'].toString(), /<plate>/);
  assert.ok(!slice(fullConfig()).result.gcode3mfPath, 'only when the printer asks for it');
});

test('plate fingerprints change with what the plate prints, for the print history', () => {
  select({ printer: DEFAULT_PRINTER });
  const m = load('3DBenchy.stl');
  const fp = (p = 0) => call(engine, 'plateFingerprint', p);
  const first = fp();
  assert.equal(first.objects.length, 1);
  assert.equal(first.objects[0].copies, 1);
  for (const k of ['shape', 'place', 'settings', 'paint']) assert.match(first.objects[0][k], /^[0-9a-f]{16}$/);
  assert.match(first.plate, /^[0-9a-f]{16}$/);
  assert.deepEqual(fp(), first, 'the same project gives the same fingerprint');

  // A plate added beside it changes nothing on plate 1.
  call(engine, 'addPlate');
  assert.deepEqual(fp(), first, 'another plate in the grid');
  assert.deepEqual(fp(1).objects, [], 'the new plate is empty');

  // Each edit changes only its own part.
  const [x, y] = m.objects[0].instances[0].offset;
  call(engine, 'setInstanceTransform', 0, 0, JSON.stringify({ offset: [x + 10, y] }));
  const moved = fp();
  assert.notEqual(moved.objects[0].place, first.objects[0].place, 'moving changes the place');
  assert.equal(moved.objects[0].shape, first.objects[0].shape);
  assert.equal(moved.objects[0].settings, first.objects[0].settings);
  call(engine, 'setInstanceTransform', 0, 0, JSON.stringify({ offset: [x, y] }));
  assert.deepEqual(fp(), first, 'moved back is the same again');

  call(engine, 'setObjectSettings', 0, -1, JSON.stringify({ layer_height: '0.3' }));
  const set = fp();
  assert.notEqual(set.objects[0].settings, first.objects[0].settings, 'its own settings');
  assert.equal(set.objects[0].place, first.objects[0].place);
  call(engine, 'setObjectSettings', 0, -1, JSON.stringify({ layer_height: null }));
  assert.deepEqual(fp(), first);

  call(engine, 'paint', 0, JSON.stringify({ rays: [[x, y, 200, 0, 0, -1]], kind: 'color', state: 2, tool: 'sphere', radius: 10 }));
  const painted = fp();
  assert.notEqual(painted.objects[0].paint, first.objects[0].paint, 'paint');
  assert.equal(painted.objects[0].shape, first.objects[0].shape);
  call(engine, 'clearPaint', 0, 'all');

  call(engine, 'plateAction', 0, JSON.stringify({ op: 'layerCodes', filaments: 1, codes: [{ z: 4.25, type: 'pause' }] }));
  assert.notEqual(fp().plate, first.plate, 'a pause on the plate');
  call(engine, 'plateAction', 0, JSON.stringify({ op: 'layerCodes', filaments: 1, codes: [] }));

  call(engine, 'addInstance', 0, 0, 30, 0);
  assert.equal(fp().objects[0].copies, 2, 'a second copy');
  assert.throws(() => call(engine, 'plateFingerprint', 5), /no plate/);
});
