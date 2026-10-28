import * as THREE from 'three';
import { toDegrees, toQuat } from './placement';

/**
 * The Cut tool's plane, as the engine's cutObject takes it (tools_api.cpp): it
 * starts flat and turns by `rotation` (degrees about the bed's X, then Y, then
 * Z, like Orca's rotation_transform); its arrow is the turned +Z. `position` is
 * how far the plane is along its arrow from the bed under the middle of the
 * object, so a flat plane's position is its height above the bed.
 */
export type CutRotation = [number, number, number];

/** What happens to one half: kept as it stands, laid on its cut face, or thrown away. */
export type CutPart = 'keep' | 'place' | 'drop';

export interface CutRequest {
  position: number;
  rotation: CutRotation;
  upper: CutPart;
  lower: CutPart;
  /** Both halves stay, as parts of one object, where they stand. */
  asParts: boolean;
}

/** The rotation as a quaternion (Orca turns about X, then Y, then Z, like an instance's rotation). */
export const cutQuaternion = (rotation: CutRotation): THREE.Quaternion => toQuat(rotation);

/** The plane's arrow. */
export function cutNormal(rotation: CutRotation): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(cutQuaternion(rotation));
}

/** The rotation of a quaternion, in degrees rounded to 0.01. */
export function rotationOf(q: THREE.Quaternion): CutRotation {
  const [x, y, z] = toDegrees(q).map((a) => Math.round(a * 100) / 100 + 0);
  return [x, y, z];
}

/** An angle in (-180, 180]. */
export function wrapAngle(a: number): number {
  const r = ((((a + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

/** The plane's middle: the object's middle slid along the arrow onto the plane. */
export function cutCentre(middle: THREE.Vector3, position: number, normal: THREE.Vector3): THREE.Vector3 {
  const base = new THREE.Vector3(middle.x, middle.y, 0);
  const off = normal.dot(middle.clone().sub(base)) - position;
  return middle.clone().addScaledVector(normal, -off);
}

/** The position of the plane through `point`. */
export function positionAt(middle: THREE.Vector3, point: THREE.Vector3, normal: THREE.Vector3): number {
  return normal.dot(point.clone().sub(new THREE.Vector3(middle.x, middle.y, 0)));
}

/** The positions at which the plane still crosses a box, standing on the bed with this middle and size. */
export function positionRange(size: [number, number, number], rotation: CutRotation): [number, number] {
  const n = cutNormal(rotation);
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [-size[0] / 2, size[0] / 2])
    for (const y of [-size[1] / 2, size[1] / 2])
      for (const z of [0, size[2]]) {
        const p = n.x * x + n.y * y + n.z * z;
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      }
  return [lo, hi];
}

/**
 * Desktop's "Flip plane": the same plane with its arrow the other way, so the
 * upper and lower halves swap.
 */
export function flipPlane(position: number, rotation: CutRotation): { position: number; rotation: CutRotation } {
  return { position: -position, rotation: [wrapAngle(rotation[0] + 180), rotation[1], rotation[2]] };
}
