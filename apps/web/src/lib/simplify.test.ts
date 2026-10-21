import { describe, expect, it } from 'vitest';
import { DETAIL_LEVELS, LIGHT_TRIANGLES, heavyModel, simplifyBy, triangleCount } from './simplify';

describe('simplify', () => {
  it('asks for a detail level or a ratio, within range', () => {
    expect(simplifyBy('level', 2, 50)).toEqual({ level: 2 });
    expect(simplifyBy('level', 7, 50)).toEqual({ level: 4 });
    expect(simplifyBy('ratio', 2, 120)).toEqual({ ratio: 100 });
    expect(simplifyBy('ratio', 2, -3)).toEqual({ ratio: 0 });
    expect(DETAIL_LEVELS).toHaveLength(5);
  });
});

describe('heavyModel', () => {
  it('leaves light projects alone', () => {
    expect(heavyModel([400_000, 300_000])).toBeNull();
  });
  it('simplifies the big objects of a heavy project to about half a million triangles', () => {
    const plan = heavyModel([3_160_000])!;
    expect(plan.objects).toEqual([0]);
    expect(plan.triangles).toBe(3_160_000);
    expect(Math.round(3_160_000 * (1 - plan.ratio / 100))).toBeLessThan(LIGHT_TRIANGLES + 20_000);
    const two = heavyModel([900_000, 900_000, 1_000])!;
    expect(two.objects).toEqual([0, 1]);
    expect(two.ratio).toBe(72);
  });
  it('keeps some of every object, however many small ones there are', () => {
    expect(heavyModel([1_200_000, ...Array(30).fill(45_000)])!.ratio).toBe(95);
  });
  it('counts only the plate being sliced', () => {
    // Superman: a heavy body on one plate, two light eye pieces on another.
    expect(heavyModel([5_000_000, 20_000, 20_000], [1, 2])).toBeNull();
    const plan = heavyModel([5_000_000, 20_000, 20_000], [0])!;
    expect(plan.objects).toEqual([0]);
    expect(plan.triangles).toBe(5_000_000);
  });
  it('writes counts for people', () => {
    expect(triangleCount(3_160_000)).toBe('3.2 million');
    expect(triangleCount(2_000_000)).toBe('2 million');
    expect(triangleCount(800_000)).toBe('800,000');
  });
});
