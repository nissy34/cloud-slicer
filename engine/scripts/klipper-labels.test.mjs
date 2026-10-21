// node --test engine/scripts/klipper-labels.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelObjectsForKlipper } from './klipper-labels.mjs';

const j = (o) => JSON.stringify(o);

test('turns on exclude_object only for processes made for Klipper printers', () => {
  const files = {
    'Acme.json': j({ name: 'Acme' }),
    'Acme/machine/fdm_common.json': j({ name: 'fdm_common', gcode_flavor: 'marlin2' }),
    'Acme/machine/fdm_klipper.json': j({ name: 'fdm_klipper', inherits: 'fdm_common', gcode_flavor: 'klipper' }),
    'Acme/machine/K1.json': j({ name: 'Acme K1 0.4', inherits: 'fdm_klipper', instantiation: 'true' }),
    'Acme/machine/K2.json': j({ name: 'Acme K2 0.4', inherits: 'fdm_klipper', instantiation: 'true' }),
    'Acme/machine/E3.json': j({ name: 'Acme Ender 0.4', inherits: 'fdm_common', instantiation: 'true' }),
    'Acme/process/common.json': j({ name: 'fdm_process_common', exclude_object: '0' }),
    'Acme/process/k1.json': j({ name: '0.20mm Standard @Acme K1', inherits: 'fdm_process_common', instantiation: 'true', compatible_printers: ['Acme K1 0.4', 'Acme K2 0.4'] }),
    'Acme/process/k1-on.json': j({ name: '0.10mm Fine @Acme K1', inherits: 'fdm_process_common', instantiation: 'true', exclude_object: '1', compatible_printers: ['Acme K1 0.4'] }),
    'Acme/process/both.json': j({ name: '0.20mm Standard @Acme', inherits: 'fdm_process_common', instantiation: 'true', compatible_printers: ['Acme K1 0.4', 'Acme Ender 0.4'] }),
    'Acme/process/ender.json': j({ name: '0.20mm Standard @Acme Ender', inherits: 'fdm_process_common', instantiation: 'true', compatible_printers: ['Acme Ender 0.4'] }),
    'Acme/process/any.json': j({ name: '0.30mm Draft @Acme', inherits: 'fdm_process_common', instantiation: 'true' }),
    'Acme/filament/pla.json': j({ name: 'Acme PLA' }),
  };
  const before = { ...files };
  const changed = labelObjectsForKlipper(files);
  assert.deepEqual(changed, ['Acme/process/k1.json']);
  assert.equal(JSON.parse(files['Acme/process/k1.json']).exclude_object, '1');
  for (const path of Object.keys(before)) if (path !== 'Acme/process/k1.json') assert.equal(files[path], before[path], path);
});

test('a process inheriting the Klipper printer list is changed on itself, not on its parent', () => {
  const files = {
    'V/machine/m.json': j({ name: 'V2 0.4', gcode_flavor: 'klipper', instantiation: 'true' }),
    'V/process/base.json': j({ name: 'base', compatible_printers: ['V2 0.4'] }),
    'V/process/leaf.json': j({ name: '0.2 @V2', inherits: 'base', instantiation: 'true' }),
  };
  assert.deepEqual(labelObjectsForKlipper(files), ['V/process/leaf.json']);
  assert.equal(JSON.parse(files['V/process/base.json']).exclude_object, undefined);
});
