import { describe, expect, it } from 'vitest';
import type { LayerCode } from '../engine/protocol';
import { canChangeFilament, codeAt, codeLabel, layerOf, newCode, withCodeAt } from './layerCodes';

const layerZ = Float32Array.from([0.2, 0.4, 0.6, 0.8, 1.0]);
const pause = newCode('pause', 0.6);

describe('layer slider items', () => {
  it('finds the layer a code runs at, by the nearest layer top', () => {
    expect(layerOf(0.6, layerZ)).toBe(2);
    expect(layerOf(0.58, layerZ)).toBe(2);
    expect(layerOf(0.69, layerZ)).toBe(2);
    expect(layerOf(0.71, layerZ)).toBe(3);
    expect(layerOf(0.05, layerZ)).toBe(0);
    expect(layerOf(9, layerZ)).toBe(4);
    expect(layerOf(1, [])).toBe(-1);
  });

  it('keeps one code per layer, in height order', () => {
    let codes: LayerCode[] = withCodeAt([], layerZ, 3, newCode('custom', 0, { gcode: 'M117 hi' }));
    codes = withCodeAt(codes, layerZ, 2, pause);
    expect(codes.map((c) => [c.type, c.z])).toEqual([
      ['pause', layerZ[2]],
      ['custom', layerZ[3]],
    ]);
    expect(codeAt(codes, layerZ, 3)?.gcode).toBe('M117 hi');
    codes = withCodeAt(codes, layerZ, 3, newCode('filament', 0, { filament: 2, colour: '#0000FF' }));
    expect(codes.map((c) => c.type)).toEqual(['pause', 'filament']);
    expect(withCodeAt(codes, layerZ, 2, null).map((c) => c.type)).toEqual(['filament']);
    expect(codeAt(codes, layerZ, 0)).toBeUndefined();
  });

  it('describes codes like desktop', () => {
    expect(codeLabel(pause)).toBe('Pause');
    expect(codeLabel(newCode('filament', 1, { filament: 3 }))).toBe('Change to filament 3');
    expect(codeLabel(newCode('custom', 1, { gcode: 'M106 S255\nM117 fan' }))).toBe('Custom G-code: M106 S255 …');
    expect(codeLabel(newCode('template', 1))).toBe('Custom template');
  });

  it('offers a filament change only when the plate prints with one filament of several', () => {
    expect(canChangeFilament(4, [1])).toBe(true);
    expect(canChangeFilament(4, [])).toBe(true);
    expect(canChangeFilament(4, [1, 2])).toBe(false);
    expect(canChangeFilament(1, [1])).toBe(false);
  });
});
