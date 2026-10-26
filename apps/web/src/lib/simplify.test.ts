import { describe, expect, it } from 'vitest';
import { DETAIL_LEVELS, LIGHT_TRIANGLES, heavyModel, heavyProject, heavyQuestion, simplifyBy, triangleCount } from './simplify';

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

describe('heavyProject', () => {
  const counts = (...t: [number, boolean?][]) => t.map(([triangles, painted = false]) => ({ triangles, painted }));
  it('asks nothing when every plate is light', () => {
    expect(heavyProject(counts([600_000], [600_000]), [[0], [1]])).toBeNull();
  });
  it('simplifies every heavy plate, heaviest first, and leaves light plates alone', () => {
    const plan = heavyProject(counts([1_200_000], [20_000], [1_800_000, true]), [[0], [1], [2]])!;
    expect(plan.plates).toEqual([
      { plate: 2, triangles: 1_800_000 },
      { plate: 0, triangles: 1_200_000 },
    ]);
    expect(plan.objects.map((o) => o.object)).toEqual([0, 2]);
    expect(plan.painted).toBe(true);
    expect(heavyQuestion(plan, 3)).toContain('2 plates have more than 1 million triangles (up to 1.8 million)');
  });
  it('names the plate when the project has several', () => {
    const plan = heavyProject(counts([1_800_000], [20_000]), [[0], [1]])!;
    expect(plan.painted).toBe(false);
    expect(heavyQuestion(plan, 2)).toMatch(/^Plate 1 has 1.8 million triangles/);
    expect(heavyQuestion(heavyProject(counts([1_800_000]), [[0]])!, 1)).toMatch(/^This model has 1.8 million triangles.*about 500,000/);
  });
});
