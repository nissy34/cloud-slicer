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

// What OrcaSlicer writes for Bambu Lab printers.
const bambu = `
M83
; CHANGE_LAYER
; Z_HEIGHT: 0.2
; LAYER_HEIGHT: 0.2
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 X10 Y10 F3000
G1 X20 Y10 E0.5
; CHANGE_LAYER
; Z_HEIGHT: 0.4
; LAYER_HEIGHT: 0.2
T255
T1000
T7
; FEATURE: Inner wall
G1 X20 Y20 E0.5
`;

describe('parseGcode on Bambu printers', () => {
  const g = parseGcode(bambu);
  it('reads their layer and feature markers', () => {
    expect(Array.from(g.layerZ)).toEqual([0.2, 0.4].map((v) => Math.fround(v)));
    expect(FEATURES[g.features[0]]).toBe('Outer wall');
    expect(FEATURES[g.features[1]]).toBe('Inner wall');
  });
  it('ignores the T255/T1000 control codes', () => {
    expect(g.toolsUsed).toEqual([0, 7]);
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

describe('parseGcode values per segment', () => {
  const text = `
; HEADER_BLOCK_START
; filament_diameter: 1.75,2.85
; HEADER_BLOCK_END
M83
M104 S215 T0
M104 S240 T1
;TYPE:Custom
G1 X0 Y0 Z0.3 F600
G1 X10 Y0 E1 F1200
;LAYER_CHANGE
;Z:0.2
G1 Z0.2
;TYPE:Outer wall
;WIDTH:0.4
;HEIGHT:0.2
M106 S127.5
G1 X0 Y0 F600
G1 X10 Y0 E0.5 F3000
G4 P1000
;LAYER_CHANGE
;Z:0.4
G1 Z0.4
T1
M107
G1 X0 Y0 E0.5 F6000
T0
G1 X10 Y0 E0.5
; filament used [mm] = 120.50, 30.25
; filament used [g] = 3.60, 1.10
; filament cost = 0.09, 0.03
; total filament used [g] = 4.70
; total filament cost = 0.12
; estimated printing time (normal mode) = 1m 0s
`;
  const g = parseGcode(text);
  it('folds the start G-code purge line into the first layer', () => {
    expect(g.layerZ.length).toBe(2);
    expect(g.layerZ[0]).toBeCloseTo(0.2);
    expect(g.layerStarts[1]).toBe(2);
  });
  it('reads speed, fan and nozzle temperature', () => {
    expect(g.speeds[1] / 10).toBeCloseTo(50);
    expect(g.speeds[2] / 10).toBeCloseTo(100);
    expect(g.fans[1]).toBe(50);
    expect(g.fans[2]).toBe(0);
    expect(g.temps[1]).toBe(215);
    expect(g.temps[2]).toBe(240);
  });
  it('works out the volumetric flow from E, the filament diameter and the speed', () => {
    const area175 = (Math.PI * 1.75 ** 2) / 4;
    expect(g.flows[1] / 100).toBeCloseTo(((0.5 * area175) / 10) * 50, 1);
    const area285 = (Math.PI * 2.85 ** 2) / 4;
    expect(g.flows[2] / 100).toBeCloseTo(((0.5 * area285) / 10) * 100, 1);
  });
  it('counts filament changes between extrusions', () => {
    expect(g.stats.toolChanges).toBe(2);
  });
  it('shares the estimate between layers by the time of their moves', () => {
    // The travel before the purge line is start G-code time, outside the layers.
    const total = g.layerTimes[0] + g.layerTimes[1];
    expect(total).toBeLessThan(60);
    expect(total).toBeGreaterThan(40);
    // The first layer has the slow moves and the dwell.
    expect(g.layerTimes[0]).toBeGreaterThan(g.layerTimes[1]);
  });
  it('reads Orca\'s filament statistics', () => {
    expect(g.stats.filaments).toEqual([
      { mm: 120.5, grams: 3.6, cost: 0.09 },
      { mm: 30.25, grams: 1.1, cost: 0.03 },
    ]);
    expect(g.stats.totalGrams).toBeCloseTo(4.7);
    expect(g.stats.totalCost).toBeCloseTo(0.12);
    expect(g.stats.seconds).toBe(60);
  });
  it('keeps the values with their segments in drawing order', () => {
    const p = orderForPreview(g);
    expect(Array.from(p.temps)).toEqual(Array.from(g.temps));
    expect(p.layerTimes).toBe(g.layerTimes);
    expect(p.stats).toBe(g.stats);
  });
});
