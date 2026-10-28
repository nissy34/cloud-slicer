import * as THREE from 'three';
import { toDegrees, toQuat } from './placement';

const DEG = Math.PI / 180;

/**
 * The Cut tool's plane, as the engine's cutObject takes it (tools_api.cpp): it
 * starts flat and turns by `rotation` (degrees about the bed's X, then Y, then
 * Z, like Orca's rotation_transform); its arrow is the turned +Z. `position` is
 * how far the plane is along its arrow from the bed under the middle of the
 * object, so a flat plane's position is its height above the bed.
 */
export type CutRotation = [number, number, number];

/** What happens to one half: kept as it stands, laid on its cut face, turned upside down, or thrown away. */
export type CutPart = 'keep' | 'place' | 'flip' | 'drop';

/**
 * Desktop's cut connectors. A plug sticks out of the lower half into a hole in
 * the upper one; a dowel makes holes in both for a separate pin, printed as its
 * own object; a snap is a plug that clicks in. Style "frustum" is tapered.
 */
export type ConnectorType = 'plug' | 'dowel' | 'snap';
export type ConnectorStyle = 'prism' | 'frustum';
export type ConnectorShape = 'circle' | 'square' | 'hexagon' | 'triangle';

/** How new connectors are made, and what changing one changes. */
export interface ConnectorKind {
  type: ConnectorType;
  style: ConnectorStyle;
  shape: ConnectorShape;
  /** Across, in mm. */
  size: number;
  /** How far into the other half, in mm. */
  depth: number;
  /** Extra room across, and in depth, for the hole (mm), so the parts fit. */
  sizeGap: number;
  depthGap: number;
  /** A snap's bulge and the gap along its slots, as parts of its radius. */
  bulge: number;
  space: number;
}

/** A connector: [u, v] mm on the plane, along its turned X and Y from its middle. */
export interface Connector extends ConnectorKind {
  at: [number, number];
}

/** Desktop's starting values (GLGizmoCut3D), but 5 mm across: 2.5 mm pins snap off. */
export const DEFAULT_CONNECTOR: ConnectorKind = { type: 'plug', style: 'prism', shape: 'circle', size: 5, depth: 3, sizeGap: 0, depthGap: 0.1, bulge: 0.15, space: 0.3 };

/**
 * Desktop's Dovetail cut (Cut::Groove): a tongue on the lower half, along the
 * plane's Y, in a groove of the upper. `width` is across the tongue's top,
 * `depth` how far it sticks up; the flap angle tilts its sides (above 90° it
 * widens upwards and locks), the groove angle tapers it along its length.
 * The tolerances make the groove that much deeper and wider, so it fits.
 */
export interface Groove {
  depth: number;
  width: number;
  /** Degrees, 30 to 120. */
  flapAngle: number;
  /** Degrees, 0 to 15. */
  angle: number;
  depthTolerance: number;
  widthTolerance: number;
}

/** Desktop's starting dovetail for an object this size (GLGizmoCut3D: depth half its grabber, width four depths). */
export function defaultGroove(size: [number, number, number]): Groove {
  const depth = Math.max(1, Math.round(((size[0] + size[1] + size[2]) / 60) * 10) / 10);
  return { depth, width: Math.round(4 * depth * 10) / 10, flapAngle: 60, angle: 0, depthTolerance: 0.1, widthTolerance: 0.1 };
}

/** Desktop's has_valid_groove (its first test): the sloping sides must not cross above the tongue. */
export function grooveFits(g: Groove): boolean {
  return g.depth > 0 && g.width > 0 && (-2 * g.depth) / Math.tan(g.flapAngle * DEG) <= g.width;
}

/**
 * The surface a dovetail cuts along, as triangles (9 floats each) on the
 * plane's own axes (X across, Y along the tongue, Z the arrow), `half` mm each
 * way: flat at half the depth below the plane, the tongue rising to half the
 * depth above it.
 */
export function grooveSurface(g: Groove, half: number): Float32Array {
  const d = g.depth / 2;
  const flaps = (2 * g.depth) / Math.tan(g.flapAngle * DEG);
  const taper = Math.tan(g.angle * DEG);
  // The profile across at y: x and z of each corner.
  const profile = (y: number): [number, number][] => {
    const top = g.width / 2 - y * taper;
    const foot = (g.width + flaps) / 2 - y * taper;
    return [[-half, -d], [-foot, -d], [-top, d], [top, d], [foot, -d], [half, -d]];
  };
  const a = profile(-half);
  const b = profile(half);
  const out: number[] = [];
  for (let k = 0; k + 1 < a.length; k++) {
    const p0 = [a[k][0], -half, a[k][1]], p1 = [a[k + 1][0], -half, a[k + 1][1]];
    const q0 = [b[k][0], half, b[k][1]], q1 = [b[k + 1][0], half, b[k + 1][1]];
    out.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0);
  }
  return new Float32Array(out);
}

export interface CutRequest {
  position: number;
  rotation: CutRotation;
  upper: CutPart;
  lower: CutPart;
  /** Both halves stay, as parts of one object, where they stand. Not with connectors. */
  asParts: boolean;
  connectors?: Connector[];
  /** Per piece (in cutPieces' order), whether it goes with the upper half; without it the plane decides. */
  pieces?: boolean[];
  /** A dovetail cut instead of a flat one, centred at `spot` on the plane ([u, v] mm). Not with connectors or pieces. */
  groove?: Groove;
  spot?: [number, number];
}

/**
 * The separate pieces the plane cuts an object into (engine cutPieces), like
 * desktop's part selection: plate-local triangles, 9 floats each, a run per
 * piece, and whether each piece is above the plane.
 */
export interface CutPieces {
  positions: Float32Array;
  pieceTriangles: Int32Array;
  above: Uint8Array;
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

/** Where a point on the plane is, as a connector's [u, v]. */
export function planeSpot(point: THREE.Vector3, centre: THREE.Vector3, rotation: CutRotation): [number, number] {
  const local = point.clone().sub(centre).applyQuaternion(cutQuaternion(rotation).invert());
  return [Math.round(local.x * 100) / 100, Math.round(local.y * 100) / 100];
}

/** A connector's middle on the plane, in the 3D view's coordinates. */
export function spotPoint(at: [number, number], centre: THREE.Vector3, rotation: CutRotation): THREE.Vector3 {
  return new THREE.Vector3(at[0], at[1], 0).applyQuaternion(cutQuaternion(rotation)).add(centre);
}

/**
 * Tilts the plane about the gizmo's point, like desktop: the plane turns there
 * instead of about the bed under the object. `spot` is where the gizmo sits on
 * the plane, from the point nearest the object's middle (`middleZ` up from
 * the bed). Gives the plane's new position and the gizmo's new spot.
 */
export function turnPlane(middleZ: number, position: number, rotation: CutRotation, spot: [number, number], next: CutRotation): { position: number; spot: [number, number] } {
  const middle = new THREE.Vector3(0, 0, middleZ);
  const pivot = spotPoint(spot, cutCentre(middle, position, cutNormal(rotation)), rotation);
  const normal = cutNormal(next);
  const moved = Math.round(positionAt(middle, pivot, normal) * 100) / 100;
  return { position: moved, spot: planeSpot(pivot, cutCentre(middle, moved, normal), next) };
}

/** Sides of a connector's shape (a circle is drawn with 32). */
export const SIDES: Record<ConnectorShape, number> = { triangle: 3, square: 4, hexagon: 6, circle: 32 };

/**
 * Where a plane meets a mesh, as line segments (6 floats each: two points), in
 * the mesh's coordinates: for each triangle that crosses the plane, the stretch
 * of the plane inside it.
 */
export function cutOutline(geometry: THREE.BufferGeometry, centre: THREE.Vector3, normal: THREE.Vector3): number[] {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const tris = index ? index.count / 3 : pos.count / 3;
  const out: number[] = [];
  const { x: nx, y: ny, z: nz } = normal;
  const off = normal.dot(centre);
  const d = [0, 0, 0];
  const p = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < tris; t++) {
    let pos3 = 0;
    let neg = 0;
    for (let c = 0; c < 3; c++) {
      const i = index ? index.getX(t * 3 + c) : t * 3 + c;
      p[c * 3] = pos.getX(i);
      p[c * 3 + 1] = pos.getY(i);
      p[c * 3 + 2] = pos.getZ(i);
      d[c] = nx * p[c * 3] + ny * p[c * 3 + 1] + nz * p[c * 3 + 2] - off;
      if (d[c] > 0) pos3++;
      else neg++;
    }
    if (!pos3 || !neg) continue;
    // The two edges whose ends lie on either side.
    for (let c = 0; c < 3; c++) {
      const e = (c + 1) % 3;
      if (d[c] > 0 === d[e] > 0) continue;
      const k = d[c] / (d[c] - d[e]);
      out.push(p[c * 3] + (p[e * 3] - p[c * 3]) * k, p[c * 3 + 1] + (p[e * 3 + 1] - p[c * 3 + 1]) * k, p[c * 3 + 2] + (p[e * 3 + 2] - p[c * 3 + 2]) * k);
    }
  }
  return out;
}
