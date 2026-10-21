// Objects marked "not printable" (the object menu's Printable, or a 3MF's
// printable="0"): the slice leaves them out, and desktop draws them in its
// UNPRINTABLE_COLOR, black at half opacity, so you can see that before slicing.
import type { ObjectInfo, PreviewMesh } from '../engine/protocol';

/** Desktop's GLVolume::UNPRINTABLE_COLOR. */
export const UNPRINTABLE = { colour: [0, 0, 0] as [number, number, number], opacity: 0.5 };

/**
 * For each triangle of the plate's preview, 1 when it belongs to an instance
 * that won't be printed; null when every instance on the plate prints.
 * The preview lists each model part of each instance on the plate, instances
 * in their object's order (engine previewMesh's partList).
 */
export function unprintableTriangles(preview: PreviewMesh, objects: ObjectInfo[], plate: number): Uint8Array | null {
  const skipped = objects.map((o) => o.instances.filter((i) => i.plate === plate).map((i) => !i.printable));
  if (!skipped.some((s) => s.some(Boolean))) return null;
  const total = preview.filaments.length;
  const out = new Uint8Array(total);
  const seen = new Map<number, number>();
  const list = preview.partList;
  for (let k = 0; k + 3 < list.length; k += 4) {
    const [object, , first, count] = [list[k], list[k + 1], list[k + 2], list[k + 3]];
    const parts = objects[object]?.volumes.filter((v) => v.kind === 'part').length || 1;
    const n = seen.get(object) ?? 0;
    seen.set(object, n + 1);
    if (skipped[object]?.[Math.floor(n / parts)]) out.fill(1, first, Math.min(total, first + count));
  }
  return out;
}

/** How the object list marks an object on `plate`: '' when all of it prints. */
export function printableLabel(object: ObjectInfo, plate: number): '' | 'Not printed' | 'Some copies not printed' {
  const here = object.instances.filter((i) => i.plate === plate);
  const skipped = here.filter((i) => !i.printable).length;
  if (!skipped) return '';
  return skipped === here.length ? 'Not printed' : 'Some copies not printed';
}
