// node --test engine/scripts/preset-packs.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compareVersions, packOverlay, presetsVersion, readPack, supportsApp } from './preset-packs.mjs';

const put = (dir, rel, text) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
function folders(engineVersion, packVersion) {
  const base = mkdtempSync(join(tmpdir(), 'preset-packs-'));
  const root = join(base, 'profiles');
  const pack = join(base, 'pack');
  put(root, 'Snapmaker.json', `﻿${JSON.stringify({ name: 'Snapmaker', version: engineVersion })}`);
  put(root, 'Snapmaker/machine/U1.json', '{"name":"U1","change_filament_gcode":"M104"}');
  put(pack, 'pack.json', JSON.stringify({ vendor: 'Snapmaker', version: packVersion }));
  put(pack, 'Snapmaker.json', JSON.stringify({ name: 'Snapmaker', version: packVersion }));
  put(pack, 'Snapmaker/machine/U1.json', '{"name":"U1","change_filament_gcode":"M109"}');
  put(pack, 'Snapmaker/filament/New.json', '{"name":"New"}');
  return { root, pack };
}

test('compares Snapmaker versions number by number', () => {
  assert.ok(compareVersions('02.03.04.05', '02.03.04.04') > 0);
  assert.ok(compareVersions('02.03.04.10', '02.03.04.9') > 0);
  assert.equal(compareVersions('2.4.1', '02.04.01'), 0);
  assert.ok(compareVersions('2.4', '2.4.1') < 0);
});

test('takes a pack only for the app versions it supports, like desktop', () => {
  const pack = { minApp: '2.4.1', maxApp: '2.4.2' };
  assert.equal(supportsApp(pack, '2.4.1'), true);
  assert.equal(supportsApp(pack, '2.4.2'), true);
  assert.equal(supportsApp(pack, '2.4.0'), false);
  assert.equal(supportsApp(pack, '2.5.0'), false);
  assert.equal(supportsApp({}, '9.9.9'), true);
});

test("lays the pack's files over the engine's presets, without pack.json", () => {
  const { root, pack } = folders('02.03.04.04', '02.03.04.05');
  assert.equal(presetsVersion(root), '02.03.04.04');
  assert.equal(readPack(pack).version, '02.03.04.05');
  assert.deepEqual(Object.keys(packOverlay(root, pack)).sort(), ['Snapmaker.json', 'Snapmaker/filament/New.json', 'Snapmaker/machine/U1.json']);
});

test('refuses a pack the engine already ships, so it never puts older presets back', () => {
  for (const engine of ['02.03.04.05', '02.03.05.00']) {
    const { root, pack } = folders(engine, '02.03.04.05');
    assert.throws(() => packOverlay(root, pack), /delete the pack folder/);
  }
});

test('no pack folder, nothing to lay over', () => {
  const { root } = folders('02.03.04.04', '02.03.04.05');
  assert.deepEqual(packOverlay(root, join(root, 'missing')), {});
});
