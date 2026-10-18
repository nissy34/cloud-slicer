import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hullPlanes, layOnFace, toDegrees, toQuat, type Placement } from './placement';

// A box of w x d x h mm with its corner at the origin, as triangles.
function box(w: number, d: number, h: number) {
  const v = (i: number, j: number, k: number) => [i * w, j * d, k * h];
  const quad = (a: number[], b: number[], c: number[], e: number[]) => [a, b, c, a, c, e];
  const tris = [
    ...quad(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
    ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)), ...quad(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)),
    ...quad(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)), ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
  ].flat();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  return g;
}

const place = (rotation = [0, 0, 0]): Placement => ({
  object: 0,
  instance: 0,
  plate: 0,
  offset: new THREE.Vector3(5, 5, 0),
  rotation: toQuat(rotation),
  scale: new THREE.Vector3(1, 1, 1),
  centre: new THREE.Vector3(5, 5, 10),
});

describe('instance rotation', () => {
  it('round-trips Orca Euler angles (Rz * Ry * Rx)', () => {
    for (const r of [[0, 0, 0], [90, 0, 0], [10, 20, 30], [-45, 60, 170]]) {
      const back = toDegrees(toQuat(r));
      back.forEach((a, i) => expect(a).toBeCloseTo(r[i], 3));
    }
  });
  it('applies X first, then Y, then Z, like Orca', () => {
    // X 90 then Z 90: the object's +Y axis goes to +Z, then stays on +Z.
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(toQuat([90, 0, 90]));
    expect(y.z).toBeCloseTo(1);
    // and +Z goes to -Y, then (Z 90) to +X.
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(toQuat([90, 0, 90]));
    expect(z.x).toBeCloseTo(1);
  });
});

describe('lay on face', () => {
  it('finds the faces of the convex hull, without the one on the bed', () => {
    const planes = hullPlanes(box(10, 10, 20));
    expect(planes).toHaveLength(5);
    const normals = planes.map((p) => p.normal.toArray().map((n) => Math.round(n)).join(','));
    expect(normals).toContain('0,0,1');
    expect(normals).not.toContain('0,0,-1');
  });
  it('turns a side face down', () => {
    const changes = layOnFace(place(), new THREE.Vector3(1, 0, 0));
    const r = toQuat(changes.rotation!);
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(r).z).toBeCloseTo(-1);
    // Turned about the centre, which stays where it was.
    expect(changes.offset![0]).toBeCloseTo(-5);
    expect(changes.offset![1]).toBeCloseTo(5);
  });
  it('turns the top face down on an already rotated instance', () => {
    const p = place([0, 0, 45]);
    const r = toQuat(layOnFace(p, new THREE.Vector3(0, 0, 1)).rotation!);
    // The face that pointed up (object +Z after the 45° turn) now points down.
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(r).z).toBeCloseTo(-1);
  });
});
