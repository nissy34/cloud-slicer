import { describe, expect, it } from 'vitest';
import { excludeObjectGcode } from './commands';
import { cleanName, mapBox, printObjects, svgPoints } from './objects';

describe('print objects', () => {
  it('names objects the way Prepare does', () => {
    expect(cleanName('Benchy.stl_id_0_copy_0')).toBe('Benchy');
    expect(cleanName('BENCHY.STL_ID_0_COPY_1')).toBe('Benchy');
    expect(cleanName('CALIBRATION_CUBE.3MF_ID_1_COPY_0')).toBe('Calibration cube');
    expect(cleanName('My_Part_id_2_copy_0')).toBe('My Part');
    expect(cleanName('Orca-PA-Calibration-Test')).toBe('Orca-PA-Calibration-Test');
  });

  it('reads objects, the skipped ones and the one printing now', () => {
    const p = printObjects({
      exclude_object: {
        objects: [
          { name: 'BENCHY.STL_ID_0_COPY_0', center: [75, 172], polygon: [[45, 150], [105, 150], [105, 195], [45, 195]] },
          { name: 'BENCHY.STL_ID_0_COPY_1', center: [180, 172], polygon: [[150, 150], [210, 150], [210, 195]] },
          { name: 'CUBE_ID_1_COPY_0', center: [77, 77] },
        ],
        excluded_objects: ['CUBE_ID_1_COPY_0'],
        current_object: 'BENCHY.STL_ID_0_COPY_1',
      },
    });
    expect(p.supported).toBe(true);
    expect(p.objects.map((o) => o.label)).toEqual(['Benchy', 'Benchy 2', 'Cube']);
    expect(p.objects.map((o) => o.skipped)).toEqual([false, false, true]);
    expect(p.objects.map((o) => o.current)).toEqual([false, true, false]);
    expect(p.objects[2].polygon).toEqual([]);
    expect(p.objects[2].center).toEqual([77, 77]);
  });

  it('tells a printer without the module from a file without objects', () => {
    expect(printObjects({ print_stats: {} })).toEqual({ supported: false, objects: [] });
    expect(printObjects({ exclude_object: { objects: [], excluded_objects: [], current_object: null } })).toEqual({ supported: true, objects: [] });
  });

  it('maps the printer travel area with the back of the bed at the top', () => {
    const box = mapBox([], [0, 0, 0], [270, 270, 270]);
    expect(box).toEqual({ x: 0, y: 0, w: 270, h: 270 });
    expect(svgPoints([[10, 20], [30, 260]], box)).toBe('10,250 30,10');
    const fit = mapBox(printObjects({ exclude_object: { objects: [{ name: 'A', polygon: [[100, 100], [120, 130]] }] } }).objects, null, null);
    expect(fit.w).toBe(fit.h);
    expect(fit.x).toBeLessThan(100);
    expect(fit.x + fit.w).toBeGreaterThan(120);
  });

  it('builds the skip command for any name the slicer writes', () => {
    expect(excludeObjectGcode('BENCHY.STL_ID_0_COPY_1')).toBe('EXCLUDE_OBJECT NAME=BENCHY.STL_ID_0_COPY_1');
    expect(excludeObjectGcode('דגם_ID_0_COPY_0')).toBe('EXCLUDE_OBJECT NAME=דגם_ID_0_COPY_0');
    expect(() => excludeObjectGcode('A\nFIRMWARE_RESTART')).toThrow();
    expect(() => excludeObjectGcode('A B')).toThrow();
    expect(() => excludeObjectGcode('A;B')).toThrow();
  });
});
