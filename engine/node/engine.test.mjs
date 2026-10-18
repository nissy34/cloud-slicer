// Engine tests: presets, model loading and slicing through the wasm module.
//   node --test engine/node/engine.test.mjs
// Needs engine/build/engine/orca-engine.js and engine/build/profiles/profiles.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { DATA_DIR, DEFAULT_PRINTER, bedSize, call, openEngine } from './engine.mjs';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
let engine;
let presets;

before(async () => {
  ({ engine, presets } = await openEngine());
});
after(() => setImmediate(() => process.exit(process.exitCode ?? 0)));  // pthread workers keep Node alive

const select = (selection) => call(engine, 'presetsSelect', JSON.stringify(selection));
const fullConfig = (overrides = {}) => call(engine, 'presetsFullConfig', JSON.stringify(overrides)).config;

function load(name, plate = 0) {
  const path = `/work/${name}`;
  engine.FS.writeFile(path, readFileSync(resolve(fixtures, name)));
  const [w, d] = bedSize(fullConfig());
  engine.clearModel();
  call(engine, 'loadModel', path, plate, w, d);
  return JSON.parse(engine.modelInfoJson());
}

function slice(config, plate = 0, thumbnails = null) {
  const result = JSON.parse(engine.sliceWithConfig(JSON.stringify(config), plate, '/work/out.gcode', null, thumbnails));
  assert.ok(result.success, `slice failed: ${result.error}`);
  return { result, gcode: new TextDecoder().decode(engine.FS.readFile(result.gcodePath)) };
}

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
  assert.ok(sel.processes.some((p) => p.name === '0.20mm Standard @Snapmaker U1 (0.4 nozzle)'));
  assert.ok(sel.filaments.some((f) => /PLA/.test(f.name)));
  const cfg = fullConfig();
  assert.equal(cfg.gcode_flavor, 'klipper');
  assert.ok(Math.abs(Number(cfg.printable_height) - 270) < 1, cfg.printable_height);
  assert.match(cfg.machine_start_gcode, /PRINT_START/);
  assert.equal(cfg.nozzle_diameter.split(',').length, 4, 'U1 has four extruders');
});

test('overrides apply on top of the presets', () => {
  select({ printer: DEFAULT_PRINTER, process: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)' });
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
});

test('slices an STL with the U1 presets', () => {
  select({ printer: DEFAULT_PRINTER, process: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)' });
  const info = load('tetrahedron.stl');
  assert.equal(info.objects.length, 1);
  assert.equal(info.objects[0].instances[0].plate, 0);
  const { result, gcode } = slice(fullConfig());
  assert.match(gcode, /^PRINT_START/m);
  assert.match(gcode, /^EXCLUDE_OBJECT_DEFINE/m);
  assert.ok(result.totalLayers > 10);
  assert.ok(result.estimatedTimeSeconds > 0);
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
  select({ printer: DEFAULT_PRINTER, process: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)' });
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

test('object tools: cut, split, mirror, orient', () => {
  select({ printer: DEFAULT_PRINTER });
  let m = load('3DBenchy.stl');
  const height = m.objects[0].size[2];
  call(engine, 'cutObject', 0, 0, 20, 'both', true);
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

test('plates: add, arrange, delete', () => {
  select({ printer: DEFAULT_PRINTER });
  load('3DBenchy.stl');
  call(engine, 'addInstance', 0, 0, 0, 0);  // a copy right on top of the first
  call(engine, 'addInstance', 0, 0, 0, 0);
  call(engine, 'arrangePlate', 0, 6);
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
  select({ printer: DEFAULT_PRINTER, process: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)' });
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
  const PROCESS = '0.20mm Standard @Snapmaker U1 (0.4 nozzle)';
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
    assert.deepEqual(sel.selection.filaments, ['My PLA']);
    assert.ok(sel.processes.find((p) => p.name === 'My fast')?.user);
    const cfg = fullConfig();
    assert.equal(cfg.layer_height, '0.28');
    assert.equal(cfg.wall_loops, '3');
    assert.equal(cfg.nozzle_temperature, '212');
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
