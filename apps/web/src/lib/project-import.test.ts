import { describe, expect, it } from 'vitest';
import type { PresetSummary } from '../engine/protocol';
import { changedOnPurpose, emptyProjectMessage, modelProcessKeys, pickProcess, processKeys, projectOverrides, withoutForeignGcode } from './project-import';

const known = { layer_height: {}, wall_loops: {}, nozzle_diameter: {}, wipe_tower_x: {}, print_settings_id: {} };

describe('projectOverrides', () => {
  const file = { layer_height: '0.1', wall_loops: '2', nozzle_diameter: '0.4', wipe_tower_x: '150', print_settings_id: 'x', unknown_key: '1' };
  const base = { layer_height: '0.12', wall_loops: '2', nozzle_diameter: '0.6' };
  it('keeps only changed, known, non-identity values', () => {
    expect(projectOverrides(file, base, known)).toEqual({ layer_height: '0.1', nozzle_diameter: '0.4' });
  });
  it('skips values outside the option range', () => {
    const k = { wall_filament: { min: 1 }, wall_loops: { min: 0, max: 1000 } };
    expect(projectOverrides({ wall_filament: '0', wall_loops: '3' }, {}, k)).toEqual({ wall_loops: '3' });
  });
  it('can be limited to some keys', () => {
    expect(projectOverrides(file, base, known, new Set(['layer_height']))).toEqual({ layer_height: '0.1' });
  });
});

describe('processKeys', () => {
  it('collects the process tab options', () => {
    const layout = { print: [{ page: 'Quality', groups: [{ title: 'Layer height', options: ['layer_height'] }] }], filament: [], printer: [] };
    expect([...processKeys(layout)]).toEqual(['layer_height']);
  });
});

describe('modelProcessKeys', () => {
  const layout = {
    print: [
      { page: 'Quality', groups: [
        { title: 'Layer height', options: ['layer_height'] },
        { title: 'Line width', options: ['line_width', 'outer_wall_line_width'] },
        { title: 'Precision', options: ['xy_hole_compensation', 'precise_outer_wall'] },
      ] },
      { page: 'Speed', groups: [
        { title: 'Acceleration', options: ['default_acceleration'] },
        { title: 'Jerk(XY)', options: ['default_jerk'] },
        { title: 'Other layers speed', options: ['outer_wall_speed'] },
      ] },
      { page: 'Support', groups: [{ title: 'Support', options: ['enable_support', 'support_type'] }] },
      { page: 'Multimaterial', groups: [{ title: 'Prime tower', options: ['prime_volume'] }] },
    ],
    filament: [],
    printer: [],
  };
  it('keeps model settings and drops the machine ones', () => {
    expect([...modelProcessKeys(layout)]).toEqual(['layer_height', 'precise_outer_wall', 'enable_support', 'support_type']);
  });
});

describe('pickProcess', () => {
  const p = (name: string, layerHeight: string) => ({ name, layerHeight, compatible: true }) as PresetSummary;
  const list = [p('0.20mm Strength', '0.2'), p('0.20mm Standard', '0.2'), p('0.12mm Fine', '0.12')];
  it('prefers the standard preset of the same layer height', () => {
    expect(pickProcess(list, '0.2', 'x')).toBe('0.20mm Standard');
    expect(pickProcess(list, '0.12', 'x')).toBe('0.12mm Fine');
  });
  it('falls back to the default', () => {
    expect(pickProcess(list, '0.3', 'default')).toBe('default');
  });
});

describe('emptyProjectMessage', () => {
  it('explains sliced-only 3MF files', () => {
    expect(emptyProjectMessage('Cube.gcode.3mf')).toMatch(/sliced file.*original project/);
    expect(emptyProjectMessage('empty.3mf')).toBe('empty.3mf has no objects to print.');
  });
});

describe('changedOnPurpose', () => {
  it('reads the keys the author changed, for the process and the other presets', () => {
    const file = { different_settings_to_system: 'enable_support;wall_loops;;nozzle_temperature;;' };
    expect([...changedOnPurpose(file)!].sort()).toEqual(['enable_support', 'layer_height', 'nozzle_temperature', 'wall_loops']);
  });
  it('counts the layer height even when nothing was changed', () => {
    expect([...changedOnPurpose({ different_settings_to_system: ';;;' })!]).toEqual(['layer_height']);
  });
  it("is null when the file doesn't say", () => {
    expect(changedOnPurpose({ layer_height: '0.2' })).toBeNull();
  });
});

describe('withoutForeignGcode', () => {
  it('leaves out every G-code setting and counts them', () => {
    expect(withoutForeignGcode({ machine_start_gcode: 'M620', filament_start_gcode: 'M106', wall_loops: '3' })).toEqual({ overrides: { wall_loops: '3' }, dropped: 2 });
    expect(withoutForeignGcode({ wall_loops: '3' })).toEqual({ overrides: { wall_loops: '3' }, dropped: 0 });
  });
});
