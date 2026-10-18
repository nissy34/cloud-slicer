import { describe, expect, it } from 'vitest';
import { earAt, type BrimEar } from './brim';

const ear = (x: number, y: number, diameter = 8): BrimEar => ({ x, y, diameter, attached: true });

describe('brim ears', () => {
  it('finds the ear under a point, the last one drawn when they overlap', () => {
    const ears = [ear(0, 0), ear(5, 0), ear(40, 40)];
    expect(earAt(ears, 0.5, 0.5)).toBe(0);
    expect(earAt(ears, 3, 0)).toBe(1);
    expect(earAt(ears, 40, 43.9)).toBe(2);
    expect(earAt(ears, 40, 44.1)).toBe(-1);
    expect(earAt([], 0, 0)).toBe(-1);
  });
});
