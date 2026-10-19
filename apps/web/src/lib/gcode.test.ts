import { describe, expect, it } from 'vitest';
import { FEATURES, orderForPreview, parseGcode } from './gcode';

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

describe('parseGcode extrusion modes', () => {
  // U1 start G-code switches XYZ back to absolute (G90, G91/G90 pairs) after
  // M83. E must stay relative, or every move that extrudes no more than the one
  // before it is dropped and walls show gaps.
  const segments = (text: string) => parseGcode(text).features.length;
  const walls = `
;LAYER_CHANGE
;Z:0.2
G1 X0 Y0 Z0.2
;TYPE:Outer wall
G1 X10 Y0 E0.5
G1 X10 Y10 E0.5
G1 X0 Y10 E0.4
G1 X0 Y0 E0.5
`;
  it('keeps E relative after G90 following M83', () => {
    expect(segments(`M83\nG91\nG1 Z1\nG90\n${walls}`)).toBe(4);
  });
  it('treats E as absolute with M82', () => {
    expect(segments(`G90\nM82\n${walls}`)).toBe(2);
  });
  it('treats E as relative under G91', () => {
    expect(segments(`M82\nG91\nG1 X0 Y0 E0\n${walls.replace(/X(\d+) Y(\d+)/g, 'X0 Y1')}`)).toBe(4);
  });
});

describe('orderForPreview', () => {
  const parsed = parseGcode(sample);
  const g = orderForPreview(parsed);
  const arc = parsed.features.length - 3; // the top surface arc, in chords
  it('puts every layer\'s shell first, then the inner segments, layer by layer', () => {
    const names = Array.from(g.features, (f) => FEATURES[f]);
    expect(names).toEqual(['Outer wall', 'Outer wall', ...Array(arc).fill('Top surface'), 'Sparse infill']);
    expect(Array.from(g.shellStarts)).toEqual([0, 2, 2 + arc]);
    expect(Array.from(g.innerStarts)).toEqual([2 + arc, 3 + arc, 3 + arc]);
  });
  it('keeps each segment\'s data together', () => {
    const last = parsed.features.length - 1;
    expect(Array.from(g.positions.subarray(last * 6, last * 6 + 6))).toEqual(Array.from(parsed.positions.subarray(12, 18)));
    expect(g.tools[2]).toBe(1);
    expect(g.tools[last]).toBe(0);
  });
});
