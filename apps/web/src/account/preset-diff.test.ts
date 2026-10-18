import { describe, expect, it } from 'vitest';
import type { OptionDef } from '../engine/protocol';
import { changesFor, copyName, presetDiff, slotValue, splitValues, systemParent } from './preset-diff';

const opt = (type: string) => ({ type }) as OptionDef;

describe('systemParent', () => {
  it('is the preset itself for a system preset, else what it inherits', () => {
    expect(systemParent({ name: 'PLA @U1', system: true, inherits: '' })).toBe('PLA @U1');
    expect(systemParent({ name: 'My PLA', system: false, inherits: 'PLA @U1' })).toBe('PLA @U1');
  });
});

describe('splitValues / slotValue', () => {
  it('splits number lists on commas and string lists on semicolons outside quotes', () => {
    expect(splitValues('220,230', 'ints')).toEqual(['220', '230']);
    expect(splitValues('"a;b";"c"', 'strings')).toEqual(['"a;b"', '"c"']);
  });
  it('takes the slot item only when the list has one item per slot', () => {
    expect(slotValue('220,230', 'ints', 1, 2)).toBe('230');
    expect(slotValue('220', 'ints', 1, 2)).toBe('220');
    expect(slotValue('0.2', 'float', 1, 2)).toBe('0.2');
    expect(slotValue('220,230', 'ints', 0, 1)).toBe('220,230');
  });
});

describe('presetDiff', () => {
  const parent = { layer_height: '0.2', wall_loops: '2', name: 'Std', inherits: '' };

  it('keeps only what differs from the parent, with the overrides on top', () => {
    const own = { layer_height: '0.2', wall_loops: '3', name: 'Mine', inherits: 'Std' };
    const diff = presetDiff({ own, parent, overrides: { layer_height: '0.28', nozzle_temperature: '210' }, options: {} });
    expect(diff).toEqual({ layer_height: '0.28', wall_loops: '3' });
  });

  it('drops a change back to the parent value', () => {
    const own = { layer_height: '0.2', wall_loops: '3' };
    expect(presetDiff({ own, parent, overrides: { wall_loops: '2' }, options: {} })).toEqual({});
  });

  it('takes a filament slot out of per-slot values', () => {
    const own = { nozzle_temperature: '220', filament_type: '"PLA"' };
    const p = { nozzle_temperature: '220', filament_type: '"PLA"' };
    const overrides = { nozzle_temperature: '200,215' };
    const options = { nozzle_temperature: opt('ints'), filament_type: opt('strings') };
    expect(presetDiff({ own, parent: p, overrides, options, slot: { index: 1, count: 2 } })).toEqual({ nozzle_temperature: '215' });
    expect(presetDiff({ own, parent: p, overrides, options, slot: { index: 0, count: 2 } })).toEqual({ nozzle_temperature: '200' });
  });

  it('never saves preset bookkeeping', () => {
    const own = { print_settings_id: 'Mine', compatible_printers: '"X"', version: '1' };
    expect(presetDiff({ own, parent: {}, overrides: {}, options: {} })).toEqual({});
  });
});

describe('changesFor / copyName', () => {
  it('counts only the changes that belong to the preset', () => {
    expect(changesFor({ layer_height: '0.2' }, { layer_height: '0.3', nozzle_temperature: '200' })).toBe(1);
  });
  it('names a copy without the printer suffix, avoiding taken names', () => {
    const taken = new Set(['PLA - Copy']);
    expect(copyName('PLA @Snapmaker U1', (n) => taken.has(n))).toBe('PLA - Copy 2');
    expect(copyName('0.20mm Standard', () => false)).toBe('0.20mm Standard - Copy');
  });
});
