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
  // The part is a triangle soup: each vertex once, to 0.05 mm.
  const seen = new Set<number>();
  const all: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = ((Math.round(x * 20) + 65536) * 131072 + (Math.round(y * 20) + 65536)) * 131072 + (Math.round(z * 20) + 65536);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(new THREE.Vector3(x, y, z));
  }
  if (all.length < 4) return [];
  // Points inside the hull of the extreme points in 26 directions can't be on
  // the full hull, so they are dropped first (Akl-Toussaint).
  const dirs: THREE.Vector3[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) dirs.push(new THREE.Vector3(x, y, z));
  const extreme = dirs.map((dir) => all.reduce((a, b) => (b.dot(dir) > a.dot(dir) ? b : a)));
  let points = all;
  const core = [...new Set(extreme)];
  if (core.length >= 4) {
    const inner = new ConvexHull().setFromPoints(core).faces;
    points = all.filter((p) => inner.some((f) => f.normal.dot(p) - f.constant > -0.01));
  }
  if (points.length < 4) return [];
  const hull = new ConvexHull().setFromPoints(points);
  // Coplanar hull faces make one plane: grouped by their normal and offset.
  const groups = new Map<string, { normal: THREE.Vector3; area: number; tris: number[] }>();
  let total = 0;
  for (const face of hull.faces) {
    const loop: THREE.Vector3[] = [];
    let edge = face.edge;
    do {
      loop.push(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
    total += face.area;
    const n = face.normal;
    const key = `${Math.round(n.x * 200)},${Math.round(n.y * 200)},${Math.round(n.z * 200)},${Math.round(face.constant * 10)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { normal: n.clone(), area: 0, tris: [] }));
    g.area += face.area;
    for (let k = 1; k + 1 < loop.length; k++) for (const v of [loop[0], loop[k], loop[k + 1]]) g.tris.push(v.x, v.y, v.z);
  }
  const down = new THREE.Vector3(0, 0, -1);
  return [...groups.values()]
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
