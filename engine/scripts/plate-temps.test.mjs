import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillPlateTemps } from './plate-temps.mjs';

const files = (presets) => Object.fromEntries(presets.map(([path, json]) => [path, JSON.stringify(json)]));
const read = (f, path) => JSON.parse(f[path]);

test('a filament at 0 °C on its printer\'s default plate takes its High Temp Plate temperature', () => {
  const f = files([
    ['V/machine/base.json', { name: 'base', instantiation: 'false', default_bed_type: 'Textured PEI Plate' }],
    ['V/machine/P.json', { name: 'P 0.4', inherits: 'base' }],
    ['V/filament/common.json', { name: 'common', instantiation: 'false', textured_plate_temp: ['0'], textured_plate_temp_initial_layer: ['0'], hot_plate_temp: ['60'], hot_plate_temp_initial_layer: ['65'] }],
    ['V/filament/PLA.json', { name: 'PLA @P', inherits: 'common', hot_plate_temp: ['55'], compatible_printers: ['P 0.4'] }],
  ]);
  assert.deepEqual(fillPlateTemps(f), ['V/filament/PLA.json']);
  const pla = read(f, 'V/filament/PLA.json');
  assert.deepEqual(pla.textured_plate_temp, ['55']);
  assert.deepEqual(pla.textured_plate_temp_initial_layer, ['65']);
});

test('filaments that have a temperature there, other plates, and printers with no default are left alone', () => {
  const f = files([
    ['V/machine/P.json', { name: 'P', default_bed_type: 'Textured PEI Plate' }],
    ['V/machine/Q.json', { name: 'Q', default_bed_type: 'Cool Plate' }],
    ['V/machine/R.json', { name: 'R' }],
    ['V/filament/set.json', { name: 'set', textured_plate_temp: ['50'], hot_plate_temp: ['60'], compatible_printers: ['P'] }],
    ['V/filament/cool.json', { name: 'cool', cool_plate_temp: ['35'], textured_plate_temp: ['0'], hot_plate_temp: ['60'], compatible_printers: ['Q'] }],
    ['V/filament/none.json', { name: 'none', textured_plate_temp: ['0'], hot_plate_temp: ['60'], compatible_printers: ['R'] }],
    ['V/filament/any.json', { name: 'any', textured_plate_temp: ['0'], hot_plate_temp: ['60'] }],
    ['V/filament/hot0.json', { name: 'hot0', textured_plate_temp: ['0'], hot_plate_temp: ['0'], compatible_printers: ['P'] }],
  ]);
  assert.deepEqual(fillPlateTemps(f), []);
});

test('parents from another bundle (the filament library) count', () => {
  const library = files([['OrcaFilamentLibrary/filament/base.json', { name: 'lib base', instantiation: 'false', textured_plate_temp: ['0'], hot_plate_temp: ['60'] }]]);
  const f = files([
    ['V/machine/P.json', { name: 'P', default_bed_type: 'Textured PEI Plate' }],
    ['V/filament/PLA.json', { name: 'PLA', inherits: 'lib base', compatible_printers: ['P'] }],
  ]);
  assert.deepEqual(fillPlateTemps(f, library), ['V/filament/PLA.json']);
  assert.deepEqual(read(f, 'V/filament/PLA.json').textured_plate_temp, ['60']);
  assert.deepEqual(read(library, 'OrcaFilamentLibrary/filament/base.json').textured_plate_temp, ['0'], 'the parent stays as it is');
});
