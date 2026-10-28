import * as THREE from 'three';
import type { InstanceChanges } from '../engine/client';
import type { PreviewMesh, ProjectInfo } from '../engine/protocol';
import { toDegrees, toQuat } from './placement';

// Several objects chosen together (desktop's multi-selection): what they are,
// where they are, and how a move, turn or scale of the group reaches each copy.

/** A copy of an object on a plate. */
export interface Item {
  object: number;
  instance: number;
}

/** What is chosen after Ctrl+click on `object`: it is added, or taken out when it was in. */
export function toggled(chosen: number[], object: number): number[] {
  return chosen.includes(object) ? chosen.filter((o) => o !== object) : [...chosen, object];
}

/** The copies of these objects on `plate`: a group works on all of them. */
export function itemsOnPlate(project: ProjectInfo, plate: number, objects: number[]): Item[] {
  return objects.flatMap((object) =>
    (project.objects[object]?.instances ?? []).flatMap((inst, instance) => (inst.plate === plate ? [{ object, instance }] : [])),
  );
}

/** The box around these objects on the plate, from the 3D view's mesh (one block of triangles per object). */
export function groupBox(preview: PreviewMesh, objects: number[]): THREE.Box3 {
  const box = new THREE.Box3();
  const p = preview.positions;
  const v = new THREE.Vector3();
  let tri = 0;
  preview.objectTriangles.forEach((count, object) => {
    if (objects.includes(object)) for (let k = tri * 9; k < (tri + count) * 9; k += 3) box.expandByPoint(v.set(p[k], p[k + 1], p[k + 2]));
    tri += count;
  });
  return box;
}

/**
 * What `m` (column-major, plate coordinates: a move, or a turn or even scale
 * about the group's middle) does to each copy: its new place, rotation and
 * scale, for the engine. A turn about X or Y leaves each copy where the engine
 * drops it, back on the bed.
 */
export function groupChanges(project: ProjectInfo, plate: number, items: Item[], m: number[]): (Item & { changes: InstanceChanges })[] {
  const matrix = new THREE.Matrix4().fromArray(m);
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  matrix.decompose(at, turn, size);
  const moveOnly = turn.angleTo(new THREE.Quaternion()) < 1e-6 && Math.abs(size.x - 1) < 1e-6;
  return items.map(({ object, instance }) => {
    const inst = project.objects[object].instances[instance];
    const offset = new THREE.Vector3(...inst.offset).applyMatrix4(matrix);
    const round = (x: number) => Math.round(x * 1e4) / 1e4;
    const changes: InstanceChanges = { offset: [round(offset.x), round(offset.y)], plate };
    if (!moveOnly) {
      changes.rotation = toDegrees(turn.clone().multiply(toQuat(inst.rotation)));
      // Even scaling only: a group has no axes of its own.
      changes.scale = inst.scale.map((s) => Math.max(0.001, round(s * size.x)));
    }
    return { object, instance, changes };
  });
}

/** One copy of each chosen object, the first on the plate: what Assemble joins. */
export function firstCopies(items: Item[]): Item[] {
  return items.filter((item, k) => items.findIndex((other) => other.object === item.object) === k);
}

/** Binary STLs as one: desktop's Export as one STL of several objects. */
export function joinStl(files: ArrayBuffer[]): ArrayBuffer {
  const counts = files.map((f) => (f.byteLength >= 84 ? new DataView(f).getUint32(80, true) : 0));
  const total = counts.reduce((a, b) => a + b, 0);
  const out = new Uint8Array(84 + total * 50);
  out.set(new TextEncoder().encode('cloud-slicer: several objects as one STL').subarray(0, 80));
  new DataView(out.buffer).setUint32(80, total, true);
  let at = 84;
  files.forEach((f, k) => {
    out.set(new Uint8Array(f, 84, counts[k] * 50), at);
    at += counts[k] * 50;
  });
  return out.buffer;
}

/** What the group's menu and keys do to all chosen objects (state/store.ts groupAction). */
export type GroupAction =
  | { op: 'delete' }
  | { op: 'printable'; value: boolean }
  | { op: 'center' }
  | { op: 'orient' }
  | { op: 'filament'; filament: number }
  | { op: 'copy' }
  | { op: 'cut' }
  | { op: 'moveToPlate'; plate: number | 'new' }
  | { op: 'clone'; count: number; arrange: boolean }
  | { op: 'exportStl' }
  | { op: 'arrange' }
  | { op: 'assemble' };
