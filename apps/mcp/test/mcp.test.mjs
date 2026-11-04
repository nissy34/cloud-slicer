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
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(here, '../dist/server.mjs')], stderr: 'inherit' }));
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
  for (const n of ['open_model', 'choose_presets', 'change_settings', 'slice', 'save_project', 'move_object']) assert.ok(names.includes(n), n);
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
  const printer = found[0].models.flatMap((m) => m.printers).find((p) => /0\.4/.test(p));
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
  await tool('change_settings', { settings: { wall_loops: 5 } });
  const file = join(out, 'saved.3mf');
  assert.equal((await tool('save_project', { path: file })).saved, file);
  assert.ok(existsSync(file));
  const reopened = await tool('open_model', { path: file });
  assert.equal(reopened.objects[0].copies.length, 4);
  assert.equal(reopened.presets.changedSettings.wall_loops, '5');
});

test('slices with OrcaSlicer 2.4.2 too', async () => {
  const opened = await tool('open_model', { path: resolve(fixtures, 'tetrahedron.stl'), engine: 'orca' });
  assert.match(opened.presets.engine, /OrcaSlicer/);
  const sliced = await tool('slice', { out });
  assert.ok(!sliced.error, sliced.error);
  assert.ok(sliced.grams > 0);
});

test('says plainly what went wrong', async () => {
  assert.match((await tool('open_model', { path: join(out, 'missing.stl') })).error, /No file at/);
  assert.match((await tool('move_object', { object: 99 })).error, /.+/);
});
