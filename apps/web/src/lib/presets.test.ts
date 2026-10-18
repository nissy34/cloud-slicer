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
  // Some of the Snapmaker U1 presets, in the engine's (alphabetical) order.
  const u1 = [
    preset('Generic PETG @U1', 'PETG', 'Snapmaker'),
    preset('Generic PETG HF @U1', 'PETG', 'Snapmaker'),
    preset('Generic PLA @U1', 'PLA', 'Snapmaker'),
    preset('Generic PLA Silk @U1', 'PLA', 'Snapmaker'),
    preset('Polymaker Silk PLA Family @U1', 'PLA', 'Polymaker'),
    preset('Snapmaker PETG HF @U1', 'PETG'),
    preset('Snapmaker PETG Translucent @U1', 'PETG'),
    preset('Snapmaker PLA Basic @U1', 'PLA'),
    preset('Snapmaker PLA Matte @U1', 'PLA'),
    preset('Snapmaker PLA Silk @U1', 'PLA'),
    preset('Snapmaker TPU 95A HF @U1', 'TPU'),
    preset('Snapmaker TPU @U1', 'TPU'),
  ];
  it('keeps the kind of filament from the file preset name', () => {
    expect(pickFilamentPreset(u1, 'PLA', undefined, 'Bambu PLA Matte @BBL X1C')).toBe('Snapmaker PLA Matte @U1');
    expect(pickFilamentPreset(u1, 'PLA', undefined, 'Bambu PLA Silk+ @BBL A1M')).toBe('Snapmaker PLA Silk @U1');
    expect(pickFilamentPreset(u1, 'PETG', undefined, 'Bambu PETG HF @BBL X1C')).toBe('Snapmaker PETG HF @U1');
    expect(pickFilamentPreset(u1, 'PETG', undefined, 'Generic PETG High Flow @System')).toBe('Snapmaker PETG HF @U1');
    expect(pickFilamentPreset(u1, 'PETG', undefined, 'Bambu PETG Translucent @BBL P1S')).toBe('Snapmaker PETG Translucent @U1');
    expect(pickFilamentPreset(u1, 'TPU', undefined, 'Bambu TPU 95A HF @BBL X1C')).toBe('Snapmaker TPU 95A HF @U1');
  });
  it('picks the plainest preset when the file names no kind', () => {
    expect(pickFilamentPreset(u1, 'PLA', undefined, 'Bambu PLA Basic @BBL X1C')).toBe('Snapmaker PLA Basic @U1');
    expect(pickFilamentPreset(u1, 'PLA')).toBe('Snapmaker PLA Basic @U1');
    expect(pickFilamentPreset(u1, 'PETG', undefined, 'Generic PETG @BBL X1C')).toBe('Generic PETG @U1');
    expect(pickFilamentPreset(u1, 'TPU', undefined, 'Bambu TPU for AMS @BBL X1C')).toBe('Snapmaker TPU @U1');
  });
});

describe('shortName', () => {
  it('drops the printer suffix', () => {
    expect(shortName('0.20mm Standard @Snapmaker U1 (0.4 nozzle)')).toBe('0.20mm Standard');
  });
});
