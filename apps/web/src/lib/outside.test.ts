import { describe, expect, it } from 'vitest';
import { FEATURES, parseGcode } from './gcode';
import { blocksPrinting, objectsOutside, plateBounds, toolpathWarnings } from './outside';

const U1 = plateBounds('0x0,270x0,270x270,0x270', '270');

// One triangle per part, [object, volume, first, count] per part.
function preview(tris: number[][][], parts: number[][]) {
  return { positions: Float32Array.from(tris.flat(2)), partList: Int32Array.from(parts.flat()) };
}

describe('plateBounds', () => {
  it('reads the printable area and height', () => {
    expect(U1).toEqual({ minX: 0, minY: 0, maxX: 270, maxY: 270, maxZ: 270 });
    expect(plateBounds('10x5,110x5,110x105,10x105', '0').maxZ).toBe(Infinity);
  });
});

describe('objectsOutside', () => {
  it('finds objects with a part over the plate edge or above the printer', () => {
    const inside = [[10, 10, 0], [20, 10, 0], [10, 20, 5]];
    const overEdge = [[260, 10, 0], [275, 10, 0], [260, 20, 5]];
    const tooTall = [[50, 50, 0], [60, 50, 0], [50, 60, 280]];
    const p = preview([inside, overEdge, inside, tooTall], [[0, 0, 0, 1], [1, 0, 1, 1], [1, 1, 2, 1], [2, 0, 3, 1]]);
    expect(objectsOutside(p, U1)).toEqual([1, 2]);
  });
  it('ignores what sinks below the bed and points on the edge', () => {
    const p = preview([[[0, 0, -5], [270, 0, 0], [0, 270, 10]]], [[0, 0, 0, 1]]);
    expect(objectsOutside(p, U1)).toEqual([]);
  });
});

describe('toolpathWarnings', () => {
  const gcode = (body: string) => parseGcode(`G90\nM83\n;LAYER_CHANGE\n;Z:0.2\nG1 Z0.2\n${body}`);
  it('passes paths on the plate', () => {
    expect(toolpathWarnings(gcode(';TYPE:Outer wall\nG1 X10 Y10\nG1 X260 Y10 E1\n'), U1)).toEqual([]);
  });
  it('flags a path off the plate, but not custom G-code like a purge line', () => {
    const off = toolpathWarnings(gcode(';TYPE:Brim\nG1 X10 Y10\nG1 X275 Y10 E1\n'), U1);
    expect(off).toEqual([{ text: 'A G-code path goes beyond the plate boundaries.', level: 'serious' }]);
    expect(blocksPrinting(off[0])).toBe(true);
    expect(toolpathWarnings(gcode(';TYPE:Custom\nG1 X-2 Y10\nG1 X-2 Y100 E5\n'), U1)).toEqual([]);
  });
  it('flags layers above the printer height first', () => {
    const tall = toolpathWarnings(gcode(';TYPE:Outer wall\nG1 X10 Y10\n;LAYER_CHANGE\n;Z:271\nG1 Z271\nG1 X300 Y10 E1\n'), U1);
    expect(tall.map((w) => w.text)).toEqual(['A G-code path goes beyond the max print height.']);
  });
  it('skips segments with no feature type (the start G-code)', () => {
    const parsed = parseGcode('G90\nM83\nG1 Z0.2\nG1 X-3 Y-3\nG1 X50 Y-3 E3\n');
    expect(Array.from(parsed.features)).toEqual([FEATURES.indexOf('Other')]);
    expect(toolpathWarnings(parsed, U1)).toEqual([]);
  });
});
