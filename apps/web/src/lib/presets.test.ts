import { describe, expect, it } from 'vitest';
import type { PresetSummary } from '../engine/protocol';
import { pickFilamentPreset, shortName, splitList } from './presets';

const preset = (name: string, filamentType: string, vendor = 'Snapmaker'): PresetSummary => ({
  name, label: name, type: 'filament', system: true, user: false, compatible: true, inherits: '', vendor, filamentType,
});

describe('splitList', () => {
  it('splits Orca list values', () => {
    expect(splitList('#FF0000;#00FF00')).toEqual(['#FF0000', '#00FF00']);
    expect(splitList('0.4,0.4,0.4,0.4')).toHaveLength(4);
    expect(splitList('')).toEqual([]);
    expect(splitList('"PLA";"PETG"')).toEqual(['PLA', 'PETG']);
  });
});

describe('pickFilamentPreset', () => {
  const presets = [
    preset('Generic PETG @Snapmaker U1', 'PETG', 'OrcaFilamentLibrary'),
    preset('Snapmaker PLA @U1', 'PLA'),
    preset('Generic PLA @Snapmaker U1', 'PLA', 'OrcaFilamentLibrary'),
  ];
  it('prefers the printer vendor preset of the same material', () => {
    expect(pickFilamentPreset(presets, 'PLA')).toBe('Snapmaker PLA @U1');
  });
  it('falls back to a generic preset of the material', () => {
    expect(pickFilamentPreset(presets, 'petg')).toBe('Generic PETG @Snapmaker U1');
  });
  it('uses the fallback for unknown materials', () => {
    expect(pickFilamentPreset(presets, 'PEEK', 'Snapmaker PLA @U1')).toBe('Snapmaker PLA @U1');
  });
});

describe('shortName', () => {
  it('drops the printer suffix', () => {
    expect(shortName('0.20mm Standard @Snapmaker U1 (0.4 nozzle)')).toBe('0.20mm Standard');
  });
});
