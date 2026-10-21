import { describe, expect, it } from 'vitest';
import type { ObjectInfo, PreviewMesh } from '../engine/protocol';
import { printableLabel, unprintableTriangles } from './printable';

const object = (printable: boolean[], parts = 1, plate = 0) =>
  ({
    name: 'o',
    volumes: Array.from({ length: parts }, () => ({ kind: 'part' })),
    instances: printable.map((p) => ({ plate, printable: p })),
  }) as unknown as ObjectInfo;

const preview = (partList: number[], triangles: number) =>
  ({ filaments: new Uint8Array(triangles), partList: Int32Array.from(partList) }) as unknown as PreviewMesh;

describe('unprintableTriangles', () => {
  it('is null when everything on the plate prints', () => {
    expect(unprintableTriangles(preview([0, 0, 0, 4], 4), [object([true])], 0)).toBeNull();
  });

  it('marks the triangles of instances that are not printed', () => {
    // Object 0: one printed instance of 2 parts (2 + 1 triangles); object 1: two instances, the second not printed.
    const p = preview([0, 0, 0, 2, 0, 1, 2, 1, 1, 0, 3, 2, 1, 0, 5, 2], 7);
    expect([...unprintableTriangles(p, [object([true], 2), object([true, false])], 0)!]).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });

  it('only counts instances on the plate', () => {
    const objects = [{ ...object([false]), instances: [{ plate: 1, printable: true }, { plate: 0, printable: false }] } as unknown as ObjectInfo];
    expect([...unprintableTriangles(preview([0, 0, 0, 3], 3), objects, 0)!]).toEqual([1, 1, 1]);
    expect(unprintableTriangles(preview([0, 0, 0, 3], 3), objects, 1)).toBeNull();
  });
});

describe('printableLabel', () => {
  it('says how much of the object is left out', () => {
    expect(printableLabel(object([true, true]), 0)).toBe('');
    expect(printableLabel(object([false]), 0)).toBe('Not printed');
    expect(printableLabel(object([true, false]), 0)).toBe('Some copies not printed');
  });
});
