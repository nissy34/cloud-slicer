import { describe, expect, it } from 'vitest';
import { heightAt, layerColour, layerTexture, type LayerProfile } from './layers';

const base: LayerProfile = {
  custom: true,
  profile: [0, 0.1, 10, 0.3],
  layers: [0, 0.2, 0.2, 0.3, 0.3, 0.6, 0.6, 1],
  layerHeight: 0.2,
  minLayerHeight: 0.08,
  maxLayerHeight: 0.4,
  firstLayerHeight: 0.2,
  height: 1,
};

describe('variable layer height', () => {
  it('reads the profile between its points', () => {
    expect(heightAt(base.profile, 0)).toBeCloseTo(0.1);
    expect(heightAt(base.profile, 5)).toBeCloseTo(0.2);
    expect(heightAt(base.profile, 20)).toBeCloseTo(0.3);
    expect(heightAt([], 1)).toBe(0);
  });

  it('colours thin layers cool and thick layers warm', () => {
    const [r0, , b0] = layerColour(0.08, 0.08, 0.4);
    const [r1, , b1] = layerColour(0.4, 0.08, 0.4);
    expect(b0).toBeGreaterThan(r0);
    expect(r1).toBeGreaterThan(b1);
  });

  it('paints each layer in its colour, every other one darker', () => {
    const tex = layerTexture(base, 10);
    expect(tex.length).toBe(40);
    // Rows 0-1 are layer 0 (0.2 mm), row 2 layer 1 (0.1 mm, darker), rows 6-9 layer 3 (0.4 mm).
    expect(Array.from(tex.slice(0, 4))).toEqual(Array.from(tex.slice(4, 8)));
    expect(tex[8 + 2]).not.toBe(tex[2]);
    const [r, , b] = tex.slice(36, 40);
    expect(r).toBeGreaterThan(b);
  });
});
