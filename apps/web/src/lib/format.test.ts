import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatGrams, outputFileName, sentence, stageLabel, timeDhms } from './format';

describe('formatClock', () => {
  it('shows hours, minutes and seconds like desktop', () => {
    expect(formatClock(3007)).toBe('50m 7s');
    expect(formatClock(5045)).toBe('1h 24m 5s');
    expect(formatClock(3600)).toBe('1h 0m 0s');
    expect(formatClock(19.4)).toBe('19s');
    expect(formatClock(0)).toBe('0s');
  });
  it('shows a dash for missing values', () => {
    expect(formatClock(Number.NaN)).toBe('–');
  });
});

describe('formatDuration', () => {
  it('rounds to minutes and shows hours', () => {
    expect(formatDuration(5025)).toBe('1 h 24 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(59)).toBe('1 min');
  });
  it('shows a dash for missing values', () => {
    expect(formatDuration(0)).toBe('–');
    expect(formatDuration(Number.NaN)).toBe('–');
  });
});

describe('formatGrams', () => {
  it('keeps one decimal under 10 g', () => {
    expect(formatGrams(3.64)).toBe('3.6 g');
    expect(formatGrams(12.6)).toBe('13 g');
    expect(formatGrams(0)).toBe('–');
  });
});

describe('stageLabel', () => {
  it('sentence-cases engine stages', () => {
    expect(stageLabel('GENERATING SUPPORT')).toBe('Generating support');
    expect(stageLabel('')).toBe('');
    expect(stageLabel('Generating G-code: layer 12')).toBe('Generating G-code: layer 12');
  });
});

describe('sentence', () => {
  it('starts with a capital and ends with a full stop', () => {
    expect(sentence("the letters can't be set along this surface")).toBe("The letters can't be set along this surface.");
    expect(sentence('Already a sentence.')).toBe('Already a sentence.');
    expect(sentence('')).toBe('');
  });
});

describe('outputFileName', () => {
  const u1 = '{input_filename_base}_{filament_type[0]}_{print_time}.gcode';
  it('names the file as desktop does', () => {
    expect(outputFileName(u1, 'Flexi_Hamster', { filament_type: 'PLA;PETG' }, 16_332)).toBe('Flexi_Hamster_PLA_4h32m12s.gcode');
    expect(outputFileName(u1, '3DBenchy.stl', { filament_type: '"PETG";"PLA"' }, 2832)).toBe('3DBenchy_PETG_47m12s.gcode');
  });
  it("tells plates apart with desktop's {plate_number} and {plate_name}", () => {
    const withPlate = '{input_filename_base}_plate_{plate_number}_{filament_type[0]}_{print_time}.gcode';
    expect(outputFileName(withPlate, 'Flexi_Hamster.3mf', { filament_type: 'PLA' }, 16_332)).toBe('Flexi_Hamster_plate_01_PLA_4h32m12s.gcode');
    expect(outputFileName(withPlate, 'Flexi_Hamster.3mf', { filament_type: 'PLA' }, 16_332, { index: 11 })).toBe('Flexi_Hamster_plate_12_PLA_4h32m12s.gcode');
    expect(outputFileName('{input_filename_base}_{plate_name}', 'Hamster', {}, 0, { index: 1, name: 'Ears' })).toBe('Hamster_Ears.gcode');
  });
  it('reads any setting, and its n-th value', () => {
    expect(outputFileName('{input_filename_base}_{layer_height}mm_{filament_type[1]}.gcode', 'cube', { layer_height: '0.2', filament_type: 'PLA;TPU' }, 60)).toBe('cube_0.2mm_TPU.gcode');
  });
  it('tidies up a setting with no value, and adds .gcode', () => {
    expect(outputFileName(u1, 'cube', {}, 59)).toBe('cube_59s.gcode');
    expect(outputFileName('{input_filename_base}_{nothing}', 'cube', {}, 0)).toBe('cube.gcode');
  });
  it('falls back to the model name without a format', () => {
    expect(outputFileName(undefined, 'Dragon Scale.3mf', {}, 100)).toBe('Dragon Scale.gcode');
    expect(outputFileName('', '.stl', {}, 100)).toBe('model.gcode');
  });
  it('writes the time as desktop does', () => {
    expect(timeDhms(59)).toBe('59s');
    expect(timeDhms(3600)).toBe('1h0m0s');
    expect(timeDhms(90_061)).toBe('1d1h1m1s');
  });
});
