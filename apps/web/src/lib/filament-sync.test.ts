import { describe, expect, it } from 'vitest';
import type { PresetSummary } from '../engine/protocol';
import type { U1Head } from '../device/addons/u1';
import { matchByColour, printerFilamentName, printerFilaments, syncPlan, syncPreset, type PrinterFilament } from './filament-sync';

const head = (index: number, material: string, colour: string, vendor = 'Snapmaker', subType = ''): U1Head => ({
  index, label: `T${index + 1}`, colour, material, subType, vendor, loaded: Boolean(material), ready: Boolean(material), official: false,
  feed: null, dock: null, nozzle: null, switches: null,
});

const preset = (name: string, filamentType: string, system = true): PresetSummary => ({
  name, label: name, type: 'filament', system, user: !system, compatible: true, inherits: '', vendor: 'Snapmaker', filamentType,
});

// T1 black PLA Matte, T2 red PETG, T3 green PLA, T4 empty (the mock printer's heads).
const printer: PrinterFilament[] = printerFilaments([
  head(0, 'PLA', '#3E413F', 'Snapmaker', 'Matte'),
  head(1, 'PETG', '#E72F1D', 'Generic', 'Basic'),
  head(2, 'PLA', '#00FF00', 'Generic', 'Basic'),
  head(3, '', '#FFFFFF', ''),
]);

describe('printerFilamentName', () => {
  it('names a head like desktop does', () => {
    expect(printerFilamentName('Snapmaker', 'PLA', 'Matte')).toBe('Snapmaker PLA Matte');
    expect(printerFilamentName('Generic', 'PETG', '')).toBe('Generic PETG');
    expect(printerFilamentName('Snapmaker', 'PLA', 'Support')).toBe('Snapmaker Support For PLA');
    expect(printer[3].name).toBe('');
  });
});

describe('matchByColour', () => {
  it('takes the closest colour of the same material, else the closest of any', () => {
    const project = [
      { colour: '#FF0000', type: 'PLA' }, // red PLA: no red PLA loaded, closest PLA
      { colour: '#FF0000', type: 'PETG' }, // red PETG: T2
      { colour: '#FFFFFF', type: 'TPU' }, // no TPU: closest of all, never the empty head
      { colour: '#000000', type: 'PLA' },
    ];
    const m = matchByColour(project, printer);
    expect(m[1]).toBe(1);
    expect(m[3]).toBe(0);
    expect([0, 2]).toContain(m[0]);
    expect(m[2]).not.toBe(3);
  });
  it('is -1 with nothing loaded', () => {
    expect(matchByColour([{ colour: '#FF0000', type: 'PLA' }], [printer[3]])).toEqual([-1]);
  });
});

describe('syncPlan', () => {
  it('replace: every loaded head, objects cycle through them, mixes go', () => {
    const plan = syncPlan('replace', 4, printer, [], false);
    expect(plan.filaments.map((f) => f.label)).toEqual(['T1', 'T2', 'T3']);
    expect(plan.remap).toEqual([1, 2, 3, 1]);
    expect(plan.dropMixes).toBe(true);
  });
  it('match: keeps the count, nothing moves', () => {
    const plan = syncPlan('match', 2, printer, [2, 1], false);
    expect(plan.filaments.map((f) => f.label)).toEqual(['T3', 'T2']);
    expect(plan.remap).toBeNull();
    expect(plan.dropMixes).toBe(false);
  });
  it('match with the other heads added at the end', () => {
    const plan = syncPlan('match', 1, printer, [2], true);
    expect(plan.filaments.map((f) => f.label)).toEqual(['T3', 'T1', 'T2']);
    expect(plan.remap).toEqual([1]);
  });
  it('match never takes an empty head', () => {
    expect(syncPlan('match', 1, printer, [3], false).filaments).toEqual([]);
  });
});

describe('syncPreset', () => {
  const presets = [
    preset('Generic PLA @U1', 'PLA'),
    preset('Snapmaker PLA Matte @U1', 'PLA'),
    preset('Generic PETG @U1', 'PETG'),
    preset('Snapmaker TPU 95A HF @U1', 'TPU'),
  ];
  it('picks the preset named like the printer filament', () => {
    expect(syncPreset(presets, presets, printer[0], 'x')).toBe('Snapmaker PLA Matte @U1');
  });
  it('falls back to Generic <material>', () => {
    expect(syncPreset(presets, presets, printer[1], 'x')).toBe('Generic PETG @U1');
    expect(syncPreset(presets, presets, printer[2], 'x')).toBe('Generic PLA @U1');
  });
  it('then a preset of the same material, else keeps the current one', () => {
    const tpu = { ...printer[0], type: 'TPU', name: 'Acme TPU' };
    expect(syncPreset(presets, presets, tpu, 'x')).toBe('Snapmaker TPU 95A HF @U1');
    expect(syncPreset(presets, presets, { ...tpu, type: 'PEEK', name: 'Acme PEEK' }, 'Generic PLA @U1')).toBe('Generic PLA @U1');
  });
});
