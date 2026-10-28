import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cutCentre, cutNormal, cutQuaternion, flipPlane, positionAt, positionRange, rotationOf, wrapAngle } from './cut';

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

  it('wraps angles', () => {
    expect(wrapAngle(190)).toBe(-170);
    expect(wrapAngle(-180)).toBe(180);
    expect(wrapAngle(45)).toBe(45);
  });
});
