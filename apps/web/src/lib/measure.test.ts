import { describe, expect, it } from 'vitest';
import { describeFeature, measurementRows, sameFeature, type MeasureFeature } from './measure';

const edge = (start: [number, number, number], end: [number, number, number], id = 1): MeasureFeature => ({ id, object: 0, type: 'edge', start, end });

describe('measure figures', () => {
  it('describes each kind of feature like desktop', () => {
    expect(describeFeature(edge([0, 0, 0], [3, 4, 0])).rows[0]).toEqual(['Length', '5.000 mm']);
    const circle = describeFeature({ id: 2, object: 0, type: 'circle', centre: [1, 2, 3], radius: 2.5, normal: [0, 0, 1] });
    expect(circle.name).toBe('Circle');
    expect(circle.rows[0]).toEqual(['Diameter', '5.000 mm']);
    expect(describeFeature({ id: 3, object: 0, type: 'point', point: [1, 2, 3] }).rows).toEqual([['Position', '1.000, 2.000, 3.000']]);
  });

  it('lists angle, distance and the distance along each axis', () => {
    const rows = measurementRows({
      angle: { degrees: 90, centre: [0, 0, 0], e1: [[0, 0, 0], [1, 0, 0]], e2: [[0, 0, 0], [0, 1, 0]], radius: 1 },
      distance: { distance: 5, from: [0, 0, 0], to: [3, 4, 0] },
      perpendicular: { distance: 5, from: [0, 0, 0], to: [3, 4, 0] },
      xyz: [3, 4, 0],
    });
    expect(rows.map(([k]) => k)).toEqual(['Angle', 'Distance', 'Along X', 'Along Y', 'Along Z']);
    expect(rows[0][1]).toBe('90.00°');
  });

  it('shows the perpendicular distance when it differs, or alone for parallel faces', () => {
    const d = { distance: 5, from: [0, 0, 0] as [number, number, number], to: [0, 0, 5] as [number, number, number] };
    expect(measurementRows({ perpendicular: d })).toEqual([['Perpendicular distance', '5.000 mm']]);
    expect(measurementRows({ distance: { ...d, distance: 7 }, perpendicular: d }).map(([k]) => k)).toEqual(['Distance', 'Perpendicular distance']);
  });

  it('knows a feature found again under a new id', () => {
    expect(sameFeature(edge([0, 0, 0], [1, 0, 0], 1), edge([1, 0, 0], [0, 0, 0], 9))).toBe(true);
    expect(sameFeature(edge([0, 0, 0], [1, 0, 0]), edge([0, 0, 0], [2, 0, 0]))).toBe(false);
    expect(sameFeature(null, edge([0, 0, 0], [1, 0, 0]))).toBe(false);
  });
});
