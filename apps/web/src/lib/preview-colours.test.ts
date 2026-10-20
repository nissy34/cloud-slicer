import { describe, expect, it } from 'vitest';
import { FEATURES, orderForPreview, parseGcode } from './gcode';
import { RANGE_COLOURS, formatValue, rangeColour, segmentColours, shortTime, valueAt, valueRange } from './preview-colours';
import { rgb } from './colour';

const text = `
M83
;LAYER_CHANGE
;Z:0.2
G1 Z0.2
;TYPE:Outer wall
G1 X10 Y0 E0.5 F1200
;TYPE:Sparse infill
G1 X20 Y0 E0.5 F6000
;LAYER_CHANGE
;Z:0.4
G1 Z0.4
;TYPE:Outer wall
G1 X10 Y0 E0.5 F3000
`;
const p = orderForPreview(parseGcode(text));
const wall = FEATURES.indexOf('Outer wall');
const infill = FEATURES.indexOf('Sparse infill');

describe('valueRange', () => {
  it('spans the shown segments', () => {
    expect(valueRange(p, 'speed', new Set())).toEqual({ min: 20, max: 100, log: false });
  });
  it('leaves hidden line types out', () => {
    expect(valueRange(p, 'speed', new Set([infill]))).toEqual({ min: 20, max: 50, log: false });
  });
  it('has no range for line type and filament views, or with everything hidden', () => {
    expect(valueRange(p, 'feature', new Set())).toBeNull();
    expect(valueRange(p, 'speed', new Set([wall, infill]))).toBeNull();
  });
  it('is per layer for layer time', () => {
    const r = valueRange(p, 'layerTimeLog', new Set())!;
    expect(r.log).toBe(true);
    expect(r.min).toBeCloseTo(Math.min(...p.layerTimes));
    expect(r.max).toBeCloseTo(Math.max(...p.layerTimes));
  });
});

describe('scale colours', () => {
  it('runs from Orca\'s blue to its red', () => {
    expect(rangeColour(0)).toEqual(rgb(RANGE_COLOURS[0]));
    expect(rangeColour(1).map((v) => v.toFixed(3))).toEqual(rgb(RANGE_COLOURS.at(-1)).map((v) => v.toFixed(3)));
  });
  it('gives the slowest segment blue and the fastest red', () => {
    const r = valueRange(p, 'speed', new Set());
    const c = segmentColours(p, 'speed', [], r);
    // Drawing order: layer 1's wall (20 mm/s), layer 2's wall (50), then the infill (100).
    const at = (s: number) => Array.from(c.subarray(s * 3, s * 3 + 3));
    expect(at(0)).toEqual(rgb(RANGE_COLOURS[0]).map((v) => Math.round(v * 255)));
    expect(at(2)).toEqual(rgb(RANGE_COLOURS.at(-1)).map((v) => Math.round(v * 255)));
  });
  it('colours by line type with Orca\'s feature colours', () => {
    const c = segmentColours(p, 'feature', [], null);
    expect(Array.from(c.subarray(0, 3))).toEqual([0xff, 0x7d, 0x38]);
  });
  it('labels a log scale by its own steps', () => {
    const r = { min: 1, max: 100, log: true };
    expect(valueAt(r, 0.5)).toBeCloseTo(10);
    expect(valueAt({ ...r, log: false }, 0.5)).toBeCloseTo(50.5);
  });
});

describe('legend values', () => {
  it('reads like desktop', () => {
    expect(shortTime(42)).toBe('42s');
    expect(shortTime(185)).toBe('3m 05s');
    expect(shortTime(3720)).toBe('1h 02m');
    expect(formatValue('width', 0.42)).toBe('0.42');
    expect(formatValue('flow', 12.345)).toBe('12.3');
    expect(formatValue('speed', 199.6)).toBe('200');
  });
});
