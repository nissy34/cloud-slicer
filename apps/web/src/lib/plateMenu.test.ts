import { describe, expect, it } from 'vitest';
import { HANDY_MODELS, onPlate } from './plateMenu';

describe('plate menu', () => {
  it('tells the plate from the space around it', () => {
    expect(onPlate(135, 135, 270, 270)).toBe(true);
    expect(onPlate(0, 270, 270, 270)).toBe(true);
    expect(onPlate(-1, 100, 270, 270)).toBe(false);
    expect(onPlate(100, 271, 270, 270)).toBe(false);
  });
  it("offers desktop's handy models", () => {
    expect(HANDY_MODELS.map((m) => m.label)).toContain('3DBenchy');
  });
});
