import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PreviewMesh, ProjectInfo } from '../engine/protocol';
import { firstCopies, groupBox, groupChanges, itemsOnPlate, joinStl, toggled } from './group';

const inst = (plate: number, offset: [number, number, number], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) => ({
  plate,
  offset,
  rotation,
  scale,
  printable: true,
});
const project = {
  objects: [
    { instances: [inst(0, [10, 10, 0]), inst(1, [50, 50, 0])] },
    { instances: [inst(0, [30, 10, 0], [0, 0, 90], [2, 2, 2])] },
  ],
} as unknown as ProjectInfo;

describe('toggled', () => {
  it('adds a model that was not chosen and takes out one that was', () => {
    expect(toggled([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggled([1, 2, 3], 2)).toEqual([1, 3]);
    expect(toggled([], 0)).toEqual([0]);
  });
});

describe('itemsOnPlate', () => {
  it("lists only the chosen objects' copies on this plate", () => {
    expect(itemsOnPlate(project, 0, [0, 1])).toEqual([
      { object: 0, instance: 0 },
      { object: 1, instance: 0 },
    ]);
    expect(itemsOnPlate(project, 1, [0, 1])).toEqual([{ object: 0, instance: 1 }]);
  });
});

describe('firstCopies', () => {
  it('keeps one copy of each object, the first', () => {
    expect(
      firstCopies([
        { object: 2, instance: 1 },
        { object: 0, instance: 0 },
        { object: 2, instance: 3 },
      ]),
    ).toEqual([
      { object: 2, instance: 1 },
      { object: 0, instance: 0 },
    ]);
  });
});

describe('groupChanges', () => {
  const items = itemsOnPlate(project, 0, [0, 1]);
  it('moves every copy by as much, and leaves rotation and scale alone', () => {
    const m = new THREE.Matrix4().makeTranslation(5, -2, 0).elements;
    const out = groupChanges(project, 0, items, m);
    expect(out.map((c) => c.changes)).toEqual([
      { offset: [15, 8], plate: 0 },
      { offset: [35, 8], plate: 0 },
    ]);
  });
  it('turns the copies about the middle and adds the turn to each', () => {
    // 90° about (20, 10): (10, 10) goes to (20, 0), (30, 10) to (20, 20).
    const m = new THREE.Matrix4()
      .makeTranslation(20, 10, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeTranslation(-20, -10, 0)).elements;
    const [a, b] = groupChanges(project, 0, items, m).map((c) => c.changes);
    expect(a.offset!.map((v) => Math.round(v))).toEqual([20, 0]);
    expect(b.offset!.map((v) => Math.round(v))).toEqual([20, 20]);
    expect(Math.round(a.rotation![2])).toBe(90);
    expect(Math.round(b.rotation![2])).toBe(180);
    expect(a.scale).toEqual([1, 1, 1]);
  });
  it('scales evenly: places spread out and each copy grows', () => {
    const m = new THREE.Matrix4()
      .makeTranslation(20, 10, 0)
      .multiply(new THREE.Matrix4().makeScale(2, 2, 2))
      .multiply(new THREE.Matrix4().makeTranslation(-20, -10, 0)).elements;
    const [a, b] = groupChanges(project, 0, items, m).map((c) => c.changes);
    expect(a.offset).toEqual([0, 10]);
    expect(b.offset).toEqual([40, 10]);
    expect(a.scale).toEqual([2, 2, 2]);
    expect(b.scale).toEqual([4, 4, 4]);
  });
});

describe('groupBox', () => {
  it("covers the chosen objects' triangles only", () => {
    const preview = {
      // One triangle for object 0, one for object 1.
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 10, 0, 12, 10, 3, 10, 14, 0]),
      objectTriangles: new Int32Array([1, 1]),
    } as unknown as PreviewMesh;
    const box = groupBox(preview, [1]);
    expect(box.min.toArray()).toEqual([10, 10, 0]);
    expect(box.max.toArray()).toEqual([12, 14, 3]);
  });
});

describe('joinStl', () => {
  const stl = (triangles: number, fill: number) => {
    const b = new Uint8Array(84 + triangles * 50).fill(fill, 84);
    new DataView(b.buffer).setUint32(80, triangles, true);
    return b.buffer;
  };
  it('puts the triangles of several binary STLs into one', () => {
    const out = new Uint8Array(joinStl([stl(2, 7), stl(1, 9)]));
    expect(new DataView(out.buffer).getUint32(80, true)).toBe(3);
    expect(out.length).toBe(84 + 150);
    expect(out[84]).toBe(7);
    expect(out[84 + 100]).toBe(9);
  });
});
