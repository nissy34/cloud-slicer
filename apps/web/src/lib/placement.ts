import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import type { InstanceChanges } from '../engine/client';

// Instance rotations are Orca's Euler angles in degrees: R = Rz * Ry * Rx,
// which is three.js's 'ZYX' order.
export const DEG = Math.PI / 180;
export const toQuat = (r: number[]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'ZYX'));
export const toDegrees = (q: THREE.Quaternion) => {
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX');
  return [e.x, e.y, e.z].map((a) => Math.round((a / DEG) * 1e4) / 1e4);
};

export interface Placement {
  object: number;
  instance: number;
  plate: number;
  offset: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  /** Bounding box centre of the part, which the gizmos turn and scale around. */
  centre: THREE.Vector3;
}

/** New offset (on the plate) of an instance after `m` (about the part's centre) was applied to it. */
export const movedOffset = (p: Placement, m: THREE.Matrix4): [number, number] => {
  const o = p.offset.clone().applyMatrix4(m);
  return [o.x, o.y];
};

export interface FlatPlane {
  geometry: THREE.BufferGeometry;
  normal: THREE.Vector3;
}

/**
 * Faces the part can lie on, like desktop's Lay on face: the planes of its
 * convex hull (coplanar hull faces merged), largest first, leaving out tiny
 * ones and the one it already lies on.
 */
export function hullPlanes(geometry: THREE.BufferGeometry): FlatPlane[] {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const seen = new Set<string>();
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(new THREE.Vector3(x, y, z));
  }
  if (points.length < 4) return [];
  const hull = new ConvexHull().setFromPoints(points);
  const groups: { normal: THREE.Vector3; constant: number; area: number; tris: number[] }[] = [];
  let total = 0;
  for (const face of hull.faces) {
    const loop: THREE.Vector3[] = [];
    let edge = face.edge;
    do {
      loop.push(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
    total += face.area;
    let g = groups.find((p) => p.normal.dot(face.normal) > 0.9995 && Math.abs(p.constant - face.constant) < 0.05);
    if (!g) groups.push((g = { normal: face.normal.clone(), constant: face.constant, area: 0, tris: [] }));
    g.area += face.area;
    for (let k = 1; k + 1 < loop.length; k++) for (const v of [loop[0], loop[k], loop[k + 1]]) g.tris.push(v.x, v.y, v.z);
  }
  const down = new THREE.Vector3(0, 0, -1);
  return groups
    .filter((g) => g.area >= Math.max(1, total * 0.002) && g.normal.dot(down) < 0.9999)
    .sort((a, b) => b.area - a.area)
    .slice(0, 254)
    .map((g) => {
      // Just outside the hull, so the planes are what the pointer hits.
      const lift = g.normal.clone().multiplyScalar(0.15);
      const tris = new Float32Array(g.tris);
      for (let i = 0; i < tris.length; i += 3) {
        tris[i] += lift.x;
        tris[i + 1] += lift.y;
        tris[i + 2] += lift.z;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(tris, 3));
      return { geometry, normal: g.normal.clone() };
    });
}

/** Lay on face: turns the instance so the face with outward `normal` points down, about the part's centre. */
export function layOnFace(place: Placement, normal: THREE.Vector3): InstanceChanges {
  const turn = new THREE.Quaternion().setFromUnitVectors(normal.clone().normalize(), new THREE.Vector3(0, 0, -1));
  const m = new THREE.Matrix4()
    .makeTranslation(place.centre)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(turn))
    .multiply(new THREE.Matrix4().makeTranslation(place.centre.clone().negate()));
  return { rotation: toDegrees(turn.multiply(place.rotation)), offset: movedOffset(place, m), plate: place.plate };
}
