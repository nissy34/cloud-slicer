import { describe, expect, it } from 'vitest';
import type { PresetSummary } from '../engine/protocol';
import { pickProcess, processKeys, projectOverrides } from './project-import';

const known = { layer_height: {}, wall_loops: {}, nozzle_diameter: {}, wipe_tower_x: {}, print_settings_id: {} };

describe('projectOverrides', () => {
  const file = { layer_height: '0.1', wall_loops: '2', nozzle_diameter: '0.4', wipe_tower_x: '150', print_settings_id: 'x', unknown_key: '1' };
  const base = { layer_height: '0.12', wall_loops: '2', nozzle_diameter: '0.6' };
  it('keeps only changed, known, non-identity values', () => {
    expect(projectOverrides(file, base, known)).toEqual({ layer_height: '0.1', nozzle_diameter: '0.4' });
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
