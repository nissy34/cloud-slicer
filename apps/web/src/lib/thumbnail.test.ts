import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { downsample, thumbnailCamera, thumbnailSizes } from './thumbnail';

describe('thumbnail sizes', () => {
  it('reads Orca thumbnails values', () => {
    expect(thumbnailSizes('48x48/PNG, 300x300/PNG')).toEqual([{ width: 48, height: 48 }, { width: 300, height: 300 }]);
    expect(thumbnailSizes('96x96')).toEqual([{ width: 96, height: 96 }]);
    expect(thumbnailSizes('32x32/QOI;400x300/JPG')).toEqual([{ width: 32, height: 32 }, { width: 400, height: 300 }]);
  });
  it('skips empty and broken entries', () => {
    expect(thumbnailSizes(undefined)).toEqual([]);
    expect(thumbnailSizes('')).toEqual([]);
    expect(thumbnailSizes('0x0/PNG, abc, 9999x9999')).toEqual([]);
  });
});

describe('thumbnail camera', () => {
  it("looks from the front left, 45 degrees down, like Orca's iso view", () => {
    const box = new THREE.Box3(new THREE.Vector3(100, 100, 0), new THREE.Vector3(120, 120, 20));
    const cam = thumbnailCamera(box, 300, 300);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    expect(dir.x).toBeCloseTo(0.5);
    expect(dir.y).toBeCloseTo(0.5);
    expect(dir.z).toBeCloseTo(-Math.SQRT1_2);
  });
  it('fits the parts with a small margin and keeps them centred', () => {
    const box = new THREE.Box3(new THREE.Vector3(100, 100, 0), new THREE.Vector3(120, 120, 20));
    const cam = thumbnailCamera(box, 300, 300);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? 120 : 100, i & 2 ? 120 : 100, i & 4 ? 20 : 0).project(cam);
      for (const v of [p.x, p.y]) { min = Math.min(min, v); max = Math.max(max, v); }
    }
    expect(max).toBeLessThan(1);
    expect(min).toBeGreaterThan(-1);
    expect(Math.max(max, -min)).toBeGreaterThan(0.9);
    expect(new THREE.Vector3(110, 110, 10).project(cam).x).toBeCloseTo(0, 1);
  });
});

describe('downsample', () => {
  it('averages blocks, ignoring the transparent background in the colour', () => {
    // 2x2 -> 1x1: three red opaque pixels and one transparent.
    const src = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
    expect([...downsample(src, 1, 1, 2)]).toEqual([255, 0, 0, 191]);
    expect([...downsample(new Uint8Array(16), 1, 1, 2)]).toEqual([0, 0, 0, 0]);
  });
});
