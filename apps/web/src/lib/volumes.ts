import { i18n } from '../i18n';
// Parts, negative parts, modifiers and support enforcers/blockers of an object
// (engine/src/volume_api.cpp), like desktop Orca's object list.
import type { PreviewMesh, VolumeInfo } from '../engine/protocol';

export type VolumeKind = Exclude<VolumeInfo['kind'], 'other'>;
/** Desktop's built-in shapes (ObjectList's create_mesh). */
export const SHAPES = ['Cube', 'Cylinder', 'Sphere', 'Cone', 'Disc', 'Torus'] as const;
export type Shape = (typeof SHAPES)[number];

export type VolumeAction =
  | { op: 'add'; type: VolumeKind; shape: Shape; instance: number }
  /** A mesh file (its bytes go with the request; name is the file's). */
  | { op: 'add'; type: VolumeKind; name?: string }
  | { op: 'rename'; volume: number; name: string }
  | { op: 'delete'; volume: number }
  /** remake: a text or SVG shape moves out of the surface as a part, into it otherwise (the Text and SVG tools). */
  | { op: 'type'; volume: number; type: VolumeKind; remake?: boolean }
  | { op: 'transform'; volume: number; instance: number; matrix: number[] }
  /** Its place in its object, as desktop's part fields: mm, degrees, factors. */
  | { op: 'set'; volume: number; offset?: number[]; rotation?: number[]; scale?: number[] };

/** The object menu's add submenus, in desktop's order and words. */
export const ADD_MENUS = [
  { type: 'part', label: 'volumes.addPart' },
  { type: 'negative', label: 'volumes.addNegative' },
  { type: 'modifier', label: 'volumes.addModifier' },
  { type: 'supportBlocker', label: 'volumes.addBlocker' },
  { type: 'supportEnforcer', label: 'volumes.addEnforcer' },
] as const satisfies readonly { type: VolumeKind; label: string }[];

/** What each kind is called in the object list. */
const KIND_WORDS = {
  part: 'volumes.part',
  negative: 'volumes.negative',
  modifier: 'volumes.modifier',
  supportEnforcer: 'volumes.enforcer',
  supportBlocker: 'volumes.blocker',
  other: 'volumes.other',
} as const satisfies Record<VolumeInfo['kind'], string>;
export const kindLabel = (kind: VolumeInfo['kind']) => i18n.t(KIND_WORDS[kind]);

const SHAPE_WORDS = {
  Cube: 'shapes.cube',
  Cylinder: 'shapes.cylinder',
  Sphere: 'shapes.sphere',
  Cone: 'shapes.cone',
  Disc: 'shapes.disc',
  Torus: 'shapes.torus',
} as const;
/** A shape's name in the page's language (the engine takes the English one). */
export const shapeLabel = (shape: Shape) => i18n.t(SHAPE_WORDS[shape]);

/** The kind numbers of a preview's volumeList. */
export const KIND_CODES: Partial<Record<VolumeInfo['kind'], number>> = { negative: 1, modifier: 2, supportEnforcer: 3, supportBlocker: 4 };

/** Desktop's see-through colours (GLVolume's MODEL_NEGTIVE_COL and friends), by volumeList kind. */
export const KIND_COLOURS: Record<number, { colour: string; opacity: number }> = {
  1: { colour: '#4d4d4d', opacity: 0.4 },
  2: { colour: '#ffff00', opacity: 0.6 },
  3: { colour: '#4d4dff', opacity: 0.4 },
  4: { colour: '#ff4d4d', opacity: 0.4 },
};

export interface VolumeMesh {
  object: number;
  volume: number;
  kind: number;
  positions: Float32Array;
}

/** The see-through volumes of a preview, one entry per volume of each instance. */
export function volumeMeshes(preview: Pick<PreviewMesh, 'volumePositions' | 'volumeList'>): VolumeMesh[] {
  const out: VolumeMesh[] = [];
  const list = preview.volumeList ?? new Int32Array();
  let tri = 0;
  for (let k = 0; k + 3 < list.length; k += 4) {
    const [object, volume, kind, count] = [list[k], list[k + 1], list[k + 2], list[k + 3]];
    out.push({ object, volume, kind, positions: preview.volumePositions.subarray(tri * 9, (tri + count) * 9) });
    tri += count;
  }
  return out;
}

/** Triangle ranges [first, count] of one part of object o in the preview's positions. */
export function partRanges(preview: Pick<PreviewMesh, 'partList'>, object: number, volume: number): [number, number][] {
  const out: [number, number][] = [];
  const list = preview.partList ?? new Int32Array();
  for (let k = 0; k + 3 < list.length; k += 4)
    if (list[k] === object && list[k + 1] === volume) out.push([list[k + 2], list[k + 3]]);
  return out;
}

/** The part of object o that triangle `tri` of the preview's positions belongs to, if any. */
export function partAt(preview: Pick<PreviewMesh, 'partList'>, object: number, tri: number): number | undefined {
  const list = preview.partList ?? new Int32Array();
  for (let k = 0; k + 3 < list.length; k += 4)
    if (list[k] === object && tri >= list[k + 2] && tri < list[k + 2] + list[k + 3]) return list[k + 1];
  return undefined;
}

/** Whether a volume can be deleted or made something other than a part: an object keeps one part. */
export function keepsAPart(volumes: VolumeInfo[], volume: number): boolean {
  return volumes[volume]?.kind !== 'part' || volumes.filter((v) => v.kind === 'part').length > 1;
}
