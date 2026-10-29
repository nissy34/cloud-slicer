import { describe, expect, it } from 'vitest';
import { clampWidth, SIDEBAR_MAX, SIDEBAR_MIN } from './sidebar';

describe('sidebar width', () => {
  it('stays between the least and most widths', () => {
    expect(clampWidth(100, 1920)).toBe(SIDEBAR_MIN);
    expect(clampWidth(2000, 1920)).toBe(SIDEBAR_MAX);
    expect(clampWidth(412.4, 1920)).toBe(412);
  });
  it('leaves the 3D view at least half a narrow window', () => {
    expect(clampWidth(600, 1000)).toBe(500);
    expect(clampWidth(600, 800)).toBe(400);
    // So narrow that half is under the least width: the least width.
    expect(clampWidth(600, 500)).toBe(SIDEBAR_MIN);
  });
});
