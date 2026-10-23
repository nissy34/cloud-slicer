// node --test engine/scripts/plate-file-names.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plateInFileNames } from './plate-file-names.mjs';

const j = (o) => JSON.stringify(o);

test('puts {plate_number} after the model name in every process preset that sets the format', () => {
  const files = {
    'Acme.json': j({ name: 'Acme' }),
    'Acme/machine/fdm_common.json': j({ name: 'fdm_common', filename_format: '{input_filename_base}.gcode' }),
    'Acme/process/common.json': j({ name: 'fdm_process_common', filename_format: '{input_filename_base}_{filament_type[0]}_{print_time}.gcode' }),
    'Acme/process/fine.json': j({ name: '0.10mm Fine @Acme', inherits: 'fdm_process_common' }),
    'Acme/process/own.json': j({ name: '0.20mm Own @Acme', inherits: 'fdm_process_common', filename_format: '{input_filename_base}_{layer_height}.gcode' }),
    'Acme/process/has.json': j({ name: '0.30mm Has @Acme', inherits: 'fdm_process_common', filename_format: '{plate_name}_{input_filename_base}.gcode' }),
    'Acme/process/top.json': j({ name: 'fdm_process_top' }),
    'Acme/process/odd.json': j({ name: 'fdm_process_odd', filename_format: 'print.gcode' }),
  };
  const before = { ...files };
  const changed = plateInFileNames(files);
  assert.deepEqual(changed, ['Acme/process/common.json', 'Acme/process/own.json', 'Acme/process/top.json']);
  const format = (p) => JSON.parse(files[p]).filename_format;
  assert.equal(format('Acme/process/common.json'), '{input_filename_base}_plate_{plate_number}_{filament_type[0]}_{print_time}.gcode');
  assert.equal(format('Acme/process/own.json'), '{input_filename_base}_plate_{plate_number}_{layer_height}.gcode');
  assert.equal(format('Acme/process/top.json'), '{input_filename_base}_plate_{plate_number}.gcode');
  for (const path of Object.keys(before)) if (!changed.includes(path)) assert.equal(files[path], before[path], path);
});
