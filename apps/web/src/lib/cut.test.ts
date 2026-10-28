import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultGroove, grooveFits, grooveSurface, turnPlane, cutOutline, planeSpot, spotPoint, cutCentre, cutNormal, cutQuaternion, flipPlane, positionAt, positionRange, rotationOf, wrapAngle } from './cut';

const close = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 6);
  expect(v.y).toBeCloseTo(y, 6);
  expect(v.z).toBeCloseTo(z, 6);
};

describe('cut plane', () => {
  it('turns like Orca: about X, then Y, then Z', () => {
    close(cutNormal([0, 0, 0]), 0, 0, 1);
    close(cutNormal([0, 90, 0]), 1, 0, 0);
    close(cutNormal([-90, 0, 0]), 0, 1, 0);
    // X first, then Y: (0, -sin, cos) turned 90° about Y.
    const a = 30 * (Math.PI / 180);
    close(cutNormal([30, 90, 0]), Math.cos(a), -Math.sin(a), 0);
  });

  it('reads back the angles it was given', () => {
    expect(rotationOf(cutQuaternion([20, -35, 10]))).toEqual([20, -35, 10]);
  });

  it('a flat plane sits at its position above the bed', () => {
    const middle = new THREE.Vector3(50, 60, 12);
    close(cutCentre(middle, 7, cutNormal([0, 0, 0])), 50, 60, 7);
    expect(positionAt(middle, new THREE.Vector3(1, 2, 7), cutNormal([0, 0, 0]))).toBeCloseTo(7);
  });

  it('an upright plane at 0 goes through the middle', () => {
    const middle = new THREE.Vector3(50, 60, 12);
    close(cutCentre(middle, 0, cutNormal([0, 90, 0])), 50, 60, 12);
    close(cutCentre(middle, 5, cutNormal([0, 90, 0])), 55, 60, 12);
  });

  it('the range covers the box along the arrow', () => {
    expect(positionRange([10, 20, 30], [0, 0, 0])).toEqual([0, 30]);
    const [lo, hi] = positionRange([10, 20, 30], [0, 90, 0]);
    expect(lo).toBeCloseTo(-5);
    expect(hi).toBeCloseTo(5);
  });

  it('flipping keeps the plane and swaps its sides', () => {
    const middle = new THREE.Vector3(0, 0, 10);
    const before = { position: 8, rotation: [25, 10, 0] as [number, number, number] };
    const after = flipPlane(before.position, before.rotation);
    close(cutNormal(after.rotation), ...(cutNormal(before.rotation).negate().toArray() as [number, number, number]));
    const c1 = cutCentre(middle, before.position, cutNormal(before.rotation));
    const c2 = cutCentre(middle, after.position, cutNormal(after.rotation));
    close(c2, c1.x, c1.y, c1.z);
    expect(after.rotation[0]).toBe(-155);
  });

  it('a spot on a turned plane goes there and back', () => {
    const centre = new THREE.Vector3(10, 20, 5);
    const rotation: [number, number, number] = [30, -20, 15];
    const p = spotPoint([3, -4], centre, rotation);
    expect(cutNormal(rotation).dot(p.clone().sub(centre))).toBeCloseTo(0, 6);
    expect(planeSpot(p, centre, rotation)).toEqual([3, -4]);
    close(spotPoint([3, -4], centre, [0, 0, 0]), 13, 16, 5);
  });

  it('outlines where the plane meets a mesh', () => {
    const box = new THREE.BoxGeometry(10, 20, 30); // indexed, centred on 0
    const length = (seg: number[]) => {
      let sum = 0;
      for (let i = 0; i < seg.length; i += 6) sum += Math.hypot(seg[i + 3] - seg[i], seg[i + 4] - seg[i + 1], seg[i + 5] - seg[i + 2]);
      return sum;
    };
    const flat = cutOutline(box, new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, 1));
    expect(length(flat)).toBeCloseTo(60, 4); // the 10 x 20 rectangle's sides
    for (let i = 2; i < flat.length; i += 3) expect(flat[i]).toBeCloseTo(3, 6);
    expect(cutOutline(box, new THREE.Vector3(0, 0, 40), new THREE.Vector3(0, 0, 1))).toEqual([]);
    const upright = cutOutline(box.toNonIndexed(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 0));
    expect(length(upright)).toBeCloseTo(100, 4); // 20 x 30
  });

  it('tilting turns the plane about the gizmo, not the bed', () => {
    const middle = new THREE.Vector3(0, 0, 24);
    const at = (position: number, rotation: [number, number, number], spot: [number, number]) => spotPoint(spot, cutCentre(middle, position, cutNormal(rotation)), rotation);
    // Cut low on the object: the gizmo at z 5 stays there as the plane tilts.
    let state = { position: 5, rotation: [0, 0, 0] as [number, number, number], spot: [0, 0] as [number, number] };
    for (const next of [[30, 0, 0], [30, -20, 0], [-60, 45, 0]] as [number, number, number][]) {
      const t = turnPlane(24, state.position, state.rotation, state.spot, next);
      state = { position: t.position, rotation: next, spot: t.spot };
      const p = at(state.position, state.rotation, state.spot);
      expect(p.x).toBeCloseTo(0, 1);
      expect(p.y).toBeCloseTo(0, 1);
      expect(p.z).toBeCloseTo(5, 1);
    }
  });

  it('starts a dovetail like desktop and knows when its sides cross', () => {
    expect(defaultGroove([60, 31, 48])).toEqual({ depth: 2.3, width: 9.2, flapAngle: 60, angle: 0, depthTolerance: 0.1, widthTolerance: 0.1 });
    expect(defaultGroove([10, 10, 10]).depth).toBe(1);
    const g = defaultGroove([60, 31, 48]);
    expect(grooveFits(g)).toBe(true);
    expect(grooveFits({ ...g, flapAngle: 120, width: 1 })).toBe(false); // widening upwards past its own width
    expect(grooveFits({ ...g, flapAngle: 120 })).toBe(true);
  });

  it('a dovetail surface: flat below the plane, the tongue rising above it', () => {
    const g = { depth: 4, width: 6, flapAngle: 60, angle: 0, depthTolerance: 0.1, widthTolerance: 0.1 };
    const tri = grooveSurface(g, 20);
    expect(tri.length).toBe(5 * 2 * 9);
    const zs = new Set<number>();
    let widest = 0;
    for (let k = 0; k < tri.length; k += 3) {
      zs.add(Math.round(tri[k + 2] * 100) / 100);
      if (tri[k + 2] > 0) widest = Math.max(widest, Math.abs(tri[k]));
    }
    expect([...zs].sort()).toEqual([-2, 2]);
    expect(widest).toBeCloseTo(3, 6); // the tongue's top is its width
  });

  it('wraps angles', () => {
    expect(wrapAngle(190)).toBe(-170);
    expect(wrapAngle(-180)).toBe(180);
    expect(wrapAngle(45)).toBe(45);
  });
});
