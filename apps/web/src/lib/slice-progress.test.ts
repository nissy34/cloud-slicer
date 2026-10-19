import { describe, expect, it } from 'vitest';
import { estimateLayers, GCODE_START, slicePercent } from './slice-progress';

describe('estimateLayers', () => {
  it('counts the first layer, then the rest at the layer height', () => {
    expect(estimateLayers([48], 0.2, 0.2)).toBe(240);
    expect(estimateLayers([10, 48.1], 0.2, 0.3)).toBe(1 + 239);
  });
  it('is 0 when it cannot tell', () => {
    expect(estimateLayers([], 0.2, 0.2)).toBe(0);
    expect(estimateLayers([20], 0, 0.2)).toBe(0);
  });
});

describe('slicePercent', () => {
  it('fills the slicing stages up to where G-code starts', () => {
    expect(slicePercent(0, 2, 'Preparing', 100)).toBeCloseTo(1.5, 1);
    expect(slicePercent(0, 65, 'Generating skirt & brim', 100)).toBeLessThan(GCODE_START);
    expect(slicePercent(0, 93, 'Generating G-code', 100)).toBe(GCODE_START);
  });
  it('moves through the G-code step layer by layer', () => {
    const half = slicePercent(GCODE_START, 74, 'Generating G-code: layer 49', 100);
    expect(half).toBeCloseTo(GCODE_START + (99 - GCODE_START) / 2, 5);
    expect(slicePercent(half, 74, 'Generating G-code: layer 99', 100)).toBe(99);
  });
  it('keeps moving without a layer estimate, but never reaches 100 early', () => {
    const a = slicePercent(GCODE_START, 74, 'Generating G-code: layer 10', 0);
    const b = slicePercent(a, 74, 'Generating G-code: layer 500', 0);
    expect(a).toBeGreaterThan(GCODE_START);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(99);
  });
  it('never goes back, and is 100 only when done', () => {
    expect(slicePercent(80, 74, 'Generating G-code: layer 1', 100)).toBe(80);
    expect(slicePercent(80, 10, 'Slicing', 100)).toBe(80);
    expect(slicePercent(98, 74, 'Generating G-code: layer 400', 100)).toBe(99);
    expect(slicePercent(99, 100, 'Done', 100)).toBe(100);
  });
});
