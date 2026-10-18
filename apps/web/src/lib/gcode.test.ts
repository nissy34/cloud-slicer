import { describe, expect, it } from 'vitest';
import { FEATURES, parseGcode } from './gcode';

const sample = `
G90
M83
;LAYER_CHANGE
;Z:0.2
G1 Z0.2 F600
;TYPE:Outer wall
;WIDTH:0.42
;HEIGHT:0.2
G1 X10 Y10 F3000
G1 X20 Y10 E0.5
G1 X20 Y20 E0.5
;TYPE:Sparse infill
G1 X10 Y20 E0.5
G1 X15 Y15
;LAYER_CHANGE
;Z:0.4
G1 Z0.4
T1
;TYPE:Top surface
G3 X10 Y20 I-5 J0 E1
`;

describe('parseGcode', () => {
  const g = parseGcode(sample);
  it('groups extrusions into layers', () => {
    expect(Array.from(g.layerZ)).toEqual([0.2, 0.4].map((v) => Math.fround(v)));
    expect(g.layerStarts[0]).toBe(0);
    expect(g.layerStarts[1]).toBe(3);
  });
  it('tags features and tools', () => {
    expect(FEATURES[g.features[0]]).toBe('Outer wall');
    expect(FEATURES[g.features[2]]).toBe('Sparse infill');
    expect(FEATURES[g.features[3]]).toBe('Top surface');
    expect(g.tools[3]).toBe(1);
    expect(g.toolsUsed).toEqual([0, 1]);
  });
  it('reads extrusion width and height', () => {
    expect(g.sizes[0]).toBeCloseTo(0.42);
    expect(g.sizes[1]).toBeCloseTo(0.2);
  });
  it('splits arcs and ignores travel', () => {
    const arcSegments = g.layerStarts[2] - g.layerStarts[1];
    expect(arcSegments).toBeGreaterThan(2);
    const last = g.positions.slice((g.layerStarts[2] - 1) * 6, g.layerStarts[2] * 6);
    expect(last[3]).toBeCloseTo(10);
    expect(last[4]).toBeCloseTo(20);
  });
});
