// Starts the built MCP server the way Claude does (over stdin/stdout, with the
// official SDK's client) and drives it: open, presets, settings, slice, save.
//   node build.mjs && node --test test/mcp.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../fixtures');
const out = mkdtempSync(join(tmpdir(), 'mcp-test-'));
let client;

before(async () => {
  client = new Client({ name: 'test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(here, '../dist/server.mjs')], env: { ...process.env, HOME: out, CLOUD_SLICER_ACCOUNT_FILE: join(out, 'account.json') }, stderr: 'inherit' }));
});
after(async () => {
  await client.close();
  rmSync(out, { recursive: true, force: true });
});

async function tool(name, args = {}, opts) {
  const r = await client.callTool({ name, arguments: args }, undefined, opts);
  const body = r.content[0].text;
  if (r.isError) return { error: body };
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

// G-code thumbnails: "; thumbnail begin 300x300 <len>" then base64 lines; the size list.
function thumbnailsIn(gcode) {
  return [...gcode.matchAll(/^; thumbnail(?:_\w+)? begin (\d+)x(\d+)/gm)].map((m) => `${m[1]}x${m[2]}`);
}

test('lists its tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['open_model', 'choose_presets', 'change_settings', 'slice', 'save_project', 'move_object', 'sign_in', 'account', 'sign_out', 'online_projects', 'open_online_project', 'save_online_project', 'project_history', 'sliced_picture', 'layer_change']) assert.ok(names.includes(n), n);
});

test('opens an STL and slices it on the U1, with plate pictures and progress', async () => {
  const opened = await tool('open_model', { path: resolve(fixtures, 'tetrahedron.stl') });
  assert.equal(opened.objects.length, 1);
  assert.equal(opened.presets.printer, 'Snapmaker U1 (0.4 nozzle)');
  const steps = [];
  const sliced = await tool('slice', { out }, { onprogress: (p) => steps.push(p.progress) });
  assert.ok(!sliced.error, sliced.error);
  assert.ok(sliced.grams > 0 && sliced.layers > 0 && sliced.printSeconds > 0, JSON.stringify(sliced));
  assert.equal(sliced.perFilament[0].slot, 1);
  assert.ok(steps.length > 0 && steps.at(-1) === 100, `progress ${steps}`);
  const gcode = readFileSync(sliced.gcodeFile, 'utf8');
  assert.match(sliced.gcodeFile, /tetrahedron_plate_01.*\.gcode$/);
  assert.deepEqual(thumbnailsIn(gcode), sliced.platePictures);
  assert.ok(sliced.platePictures.length > 0);
});

test('changes settings by key and refuses what the engine refuses', async () => {
  await tool('open_model', { path: resolve(fixtures, '3DBenchy.stl') });
  const before = await tool('slice', { out });
  const changed = await tool('change_settings', { settings: { wall_loops: 6, sparse_infill_density: '60%', no_such_setting: 1 } });
  assert.deepEqual(changed.applied.sort(), ['sparse_infill_density', 'wall_loops']);
  assert.match(changed.refused.join(), /no_such_setting/);
  const read = await tool('read_settings', { keys: ['wall_loops'] });
  assert.equal(read.wall_loops.value, '6');
  assert.equal(read.wall_loops.changed, true);
  const after = await tool('slice', { out });
  assert.ok(after.grams > before.grams, `${after.grams} > ${before.grams}`);
  const low = await tool('change_settings', { settings: { wall_loops: -3, layer_height: 'thick', support_type: 'sideways' } });
  assert.equal(low.changedSettings.wall_loops, '0');
  assert.match(low.notes.join(), /wall_loops/);
  assert.match(low.refused.join(), /layer_height.*not a number/);
  assert.match(low.refused.join(), /support_type.*not one of/);
  const back = await tool('change_settings', { settings: { wall_loops: null, sparse_infill_density: null } });
  assert.deepEqual(back.applied.sort(), ['sparse_infill_density', 'wall_loops']);
  assert.deepEqual(back.changedSettings, {});
  assert.ok((await tool('find_settings', { search: 'wall loops' })).some((s) => s.key === 'wall_loops'));
});

test('another brand: Prusa MK4 presets, plates follow its bed', async () => {
  const found = await tool('find_printers', { search: 'prusa mk4' });
  const printer = found.brands[0].models.flatMap((m) => m.printers).find((p) => /0\.4/.test(p));
  assert.ok(printer, JSON.stringify(found));
  const chosen = await tool('choose_presets', { printer });
  assert.equal(chosen.printer, printer);
  const lists = await tool('list_presets', { search: 'PETG' });
  assert.ok(lists.filaments.length > 0);
  await tool('choose_presets', { filaments: [lists.filaments[0].name] });
  const sliced = await tool('slice', { out });
  assert.ok(!sliced.error, sliced.error);
  assert.match(readFileSync(sliced.gcodeFile, 'utf8'), /PETG/);
  const missing = await tool('choose_presets', { process: 'No such process' });
  assert.ok(missing.notFound?.length);
  await tool('choose_presets', { printer: 'Snapmaker U1 (0.4 nozzle)' });
});

test("a 3MF project brings its own presets and settings", async () => {
  const opened = await tool('open_model', { path: resolve(fixtures, 'colored_3DBenchy.3mf') });
  assert.equal(opened.presets.printer, 'Snapmaker U1 (0.4 nozzle)');
  assert.match(opened.presets.process, /0\.12/);
  assert.equal(opened.presets.filaments.length, 4);
  assert.match(opened.notes.join(), /project's presets/);
});

test('move, copies, arrange, then save and reopen the project', async () => {
  await tool('open_model', { path: resolve(fixtures, 'tetrahedron.stl') });
  const moved = await tool('move_object', { object: 0, positionMm: [60, 70], rotationDeg: [0, 0, 45] });
  assert.deepEqual(moved.objects[0].copies[0].positionMm.slice(0, 2), [60, 70]);
  assert.equal(moved.objects[0].copies[0].rotationDeg[2], 45);
  const copies = await tool('set_copies', { object: 0, count: 4 });
  assert.equal(copies.objects[0].copies.length, 4);
  const arranged = await tool('arrange_plate', {});
  const spots = new Set(arranged.objects[0].copies.map((c) => c.positionMm.slice(0, 2).join()));
  assert.equal(spots.size, 4);
  // Desktop's Arrange options, as the site's Arrange pop-up passes them.
  const rotated = await tool('arrange_plate', { spacingMm: 20, autoRotate: true, multipleMaterialsOnPlate: false });
  assert.equal(new Set(rotated.objects[0].copies.map((c) => c.positionMm.slice(0, 2).join())).size, 4);
  await tool('change_settings', { settings: { wall_loops: 5 } });
  const file = join(out, 'saved.3mf');
  assert.equal((await tool('save_project', { path: file })).saved, file);
  assert.ok(existsSync(file));
  const reopened = await tool('open_model', { path: file });
  assert.equal(reopened.objects[0].copies.length, 4);
  assert.equal(reopened.presets.changedSettings.wall_loops, '5');
});

test('filament per object, settings per object, a picture to look at', async () => {
  await tool('open_model', { path: resolve(fixtures, 'tetrahedron.stl') });
  await tool('open_model', { path: resolve(fixtures, 'tetrahedron.stl'), add: true });
  const pla = (await tool('list_presets', { search: 'PLA' })).filaments[0].name;
  await tool('choose_presets', { filaments: [pla, pla], colours: ['#FFFFFF', '#E5383B'] });
  const tooMany = await tool('set_filament', { object: 1, slot: 3 });
  assert.match(tooMany.error, /2 filament slots/);
  const set = await tool('set_filament', { object: 1, slot: 2 });
  assert.equal(set.objects[1].filamentSlot, 2);
  const own = await tool('object_settings', { object: 0, settings: { wall_loops: 4, nozzle_temperature: 250 } });
  assert.equal(own.objects[0].ownSettings.wall_loops, '4');
  assert.match(own.refused.join(), /nozzle_temperature/);
  await tool('arrange_plate', {});
  const shown = await client.callTool({ name: 'show_plate', arguments: {} });
  assert.equal(shown.content[0].type, 'image');
  assert.equal(shown.content[0].mimeType, 'image/png');
  assert.ok(Buffer.from(shown.content[0].data, 'base64').subarray(1, 4).toString() === 'PNG');
  const sliced = await tool('slice', { out });
  assert.ok(!sliced.error, sliced.error);
  assert.equal(sliced.perFilament.length, 2, JSON.stringify(sliced.perFilament));
  assert.match(readFileSync(sliced.gcodeFile, 'utf8'), /^T1$/m);
});

test('slices every plate at once', async () => {
  await tool('open_model', { path: resolve(fixtures, 'tetrahedron.stl') });
  await tool('open_model', { path: resolve(fixtures, 'tetrahedron.stl'), add: true });
  const moved = await tool('move_object', { object: 1, plate: 1, positionMm: [100, 100] });
  assert.ok(!moved.error, moved.error);
  assert.equal(moved.plates, 2);
  const sliced = await tool('slice', { allPlates: true, out });
  assert.ok(!sliced.error, sliced.error);
  assert.equal(sliced.plates.length, 2);
  assert.match(sliced.plates[1].gcodeFile, /plate_02/);
});

test('slices with OrcaSlicer 2.5.0 too', async () => {
  const opened = await tool('open_model', { path: resolve(fixtures, 'tetrahedron.stl'), engine: 'orca' });
  assert.match(opened.presets.engine, /OrcaSlicer/);
  const sliced = await tool('slice', { out });
  assert.ok(!sliced.error, sliced.error);
  assert.ok(sliced.grams > 0);
});

test('opens a model made in the chat: ASCII STL as text, a binary one as base64', async () => {
  // A 20 mm cube, as an ASCII STL Claude might write.
  const v = [[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const stl = `solid cube\n${faces.map((f) => `facet normal 0 0 0\nouter loop\n${f.map((i) => `vertex ${v[i].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid cube\n`;
  const text = await tool('open_model', { content: stl, name: 'cube.stl' });
  assert.ok(!text.error, text.error);
  assert.deepEqual(text.objects[0].sizeMm, [20, 20, 20]);
  assert.equal(text.savedAs, join(out, 'Cloud Slicer', 'From the chat', 'cube.stl'));
  assert.equal(readFileSync(text.savedAs, 'utf8'), stl);
  // The same name again never writes over the first one.
  const binary = await tool('open_model', { content: readFileSync(resolve(fixtures, 'tetrahedron.stl')).toString('base64'), base64: true, name: 'cube.stl' });
  assert.ok(!binary.error, binary.error);
  assert.equal(binary.savedAs, join(out, 'Cloud Slicer', 'From the chat', 'cube (2).stl'));
  const sliced = await tool('slice', {});
  assert.ok(!sliced.error, sliced.error);
  assert.ok(sliced.gcodeFile.startsWith(join(out, 'Cloud Slicer', 'From the chat')), 'the G-code goes beside it');
  // A name that tries to leave the folder stays in it; a wrong kind of file is refused.
  const sneaky = await tool('open_model', { content: stl, name: '../../escape.stl' });
  assert.equal(sneaky.savedAs, join(out, 'Cloud Slicer', 'From the chat', 'escape.stl'));
  assert.match((await tool('open_model', { content: stl, name: 'cube.txt' })).error, /ending \.stl, \.obj, \.3mf or \.amf/);
  assert.match((await tool('open_model', {})).error, /path of a file on this computer, or the content and name/);
});

test('a picture of the slice, coloured like the Preview', async () => {
  await tool('open_model', { path: resolve(fixtures, '3DBenchy.stl') });
  const sliced = await tool('slice', { out });
  assert.ok(!sliced.error, sliced.error);
  const picture = async (args) => {
    const r = await client.callTool({ name: 'sliced_picture', arguments: args }, undefined, { timeout: 120_000 });
    if (r.isError) return { error: r.content[0].text };
    const png = Buffer.from(r.content[0].data, 'base64');
    return { png, about: JSON.parse(r.content[1].text) };
  };
  const lineTypes = await picture({});
  assert.equal(lineTypes.png.subarray(1, 4).toString(), 'PNG');
  assert.equal(lineTypes.about.colouredBy, 'Line type');
  assert.equal(lineTypes.about.layers, `all ${sliced.layers}`);
  const names = lineTypes.about.legend.map((l) => l.lineType);
  for (const n of ['Outer wall', 'Inner wall', 'Sparse infill', 'Top surface']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('Custom'), 'the purge line is left out');
  const speed = await picture({ colourBy: 'speed', view: 'top', size: 300 });
  assert.equal(speed.about.colouredBy, 'Speed (mm/s)');
  assert.equal(speed.about.legend.length, 6);
  assert.ok(Number(speed.about.legend[0].value) > Number(speed.about.legend[5].value), 'fastest first');
  const part = await picture({ toLayer: 20, hide: ['Sparse infill'] });
  assert.equal(part.about.layers, `1 to 20 of ${sliced.layers}`);
  assert.deepEqual(part.about.hidden.sort(), ['Custom', 'Sparse infill']);
  assert.notDeepEqual(part.png, lineTypes.png);
  assert.match((await picture({ hide: ['Walls'] })).error, /No line type called "Walls"/);
});

test('a pause and custom G-code at layers, like the layer slider', async () => {
  // The picture test left the Benchy sliced: layers come from that slice.
  const paused = await tool('layer_change', { type: 'pause', layer: 10 });
  assert.ok(!paused.error, paused.error);
  assert.deepEqual(paused.layerChanges.map((c) => [c.layer, c.does]), [[10, 'Pause']]);
  const custom = await tool('layer_change', { type: 'custom', heightMm: 20, gcode: 'M117 Halfway' });
  assert.equal(custom.layerChanges.length, 2);
  assert.match((await tool('layer_change', { type: 'remove', layer: 3 })).error, /nothing at that layer/);
  assert.match((await tool('layer_change', { type: 'pause' })).error, /layer number or the height/);
  const sliced = await tool('slice', { out });
  assert.ok(!sliced.error, sliced.error);
  // Layer by layer (";LAYER_CHANGE" starts each): the pause at the start of layer 10, the G-code where the top is nearest 20 mm.
  const layers = readFileSync(sliced.gcodeFile, 'utf8').split(/^;LAYER_CHANGE/m);
  assert.match(layers[10], /^;PAUSE_PRINT$/m);
  const at = layers.findIndex((l) => /^M117 Halfway$/m.test(l));
  assert.equal(custom.layerChanges.find((c) => c.does.includes('Halfway')).layer, at);
  assert.deepEqual((await tool('model_info')).layerChanges.map((c) => c.does), ['Pause', 'Custom G-code: M117 Halfway']);
  await tool('layer_change', { type: 'remove', layer: 10 });
  assert.deepEqual((await tool('model_info')).layerChanges.map((c) => c.does), ['Custom G-code: M117 Halfway']);
});

test('says plainly what went wrong', async () => {
  assert.match((await tool('open_model', { path: join(out, 'missing.stl') })).error, /No file at/);
  assert.match((await tool('move_object', { object: 99 })).error, /.+/);
});
