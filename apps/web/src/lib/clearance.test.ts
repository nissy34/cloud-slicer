import { describe, expect, it } from 'vitest';
import { clearanceProblems, convexOverlap, frontMiddle, moved, overlapping } from './clearance';
import type { PlatePoint } from '../engine/protocol';

const square = (x: number, y: number, size = 10): PlatePoint[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

describe('clearance', () => {
  it('finds outlines that overlap, not ones that only touch or stand apart', () => {
    expect(convexOverlap(square(0, 0), square(5, 5))).toBe(true);
    expect(convexOverlap(square(0, 0), square(10, 0))).toBe(false);
    expect(convexOverlap(square(0, 0), square(30, 0))).toBe(false);
    // Diagonal neighbours whose boxes overlap but shapes don't.
    const diamond = (cx: number, cy: number): PlatePoint[] => [
      [cx, cy - 5],
      [cx + 5, cy],
      [cx, cy + 5],
      [cx - 5, cy],
    ];
    expect(convexOverlap(diamond(0, 0), diamond(6, 6))).toBe(false);
    expect(convexOverlap(diamond(0, 0), diamond(4, 4))).toBe(true);
  });

  it('follows an outline dragged onto another', () => {
    const outlines = [square(0, 0), square(40, 0), square(80, 0)];
    expect([...overlapping(outlines)]).toEqual([]);
    outlines[2] = moved(outlines[2], [-35, 2]);
    expect([...overlapping(outlines)].sort()).toEqual([1, 2]);
  });

  it('puts the order number at the front middle', () => {
    expect(frontMiddle(square(10, 20))).toEqual([15, 20]);
  });

  it('lists each object the slice complains about', () => {
    expect(clearanceProblems('A is too close to others, and collisions may be caused.\nB is too tall, and collisions will be caused.\n')).toEqual([
      'A is too close to others, and collisions may be caused.',
      'B is too tall, and collisions will be caused.',
    ]);
    expect(clearanceProblems('')).toEqual([]);
  });
});
