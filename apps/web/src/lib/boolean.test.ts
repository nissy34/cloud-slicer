import { describe, expect, it } from 'vitest';
import { booleanChoices, booleanRequest, defaultPair, pickerLabels } from './boolean';

const vols = (n: number, o = 0) => Array.from({ length: n }, (_, k) => ({ object: o, volume: k }));
const object = (name: string, parts: number, plates: number[]) => ({
  volumes: Array.from({ length: parts }, (_, k) => ({ name: `${name}${k}`, kind: 'part' as const })),
  instances: plates.map((plate) => ({ plate })),
});

describe('mesh boolean', () => {
  it('uses desktop captions', () => {
    expect(pickerLabels('difference')).toEqual(['Subtract from', 'Subtract with']);
    expect(pickerLabels('union')).toEqual(['Part 1', 'Part 2']);
  });
  it('starts from the picked volume and the next one', () => {
    expect(defaultPair(vols(3))).toEqual([0, 1]);
    expect(defaultPair(vols(3), 1)).toEqual([1, 2]);
    expect(defaultPair(vols(3), 2)).toEqual([2, 0]);
    expect(defaultPair(vols(3), 7)).toEqual([0, 1]);
    expect(defaultPair(vols(1))).toEqual([0, 0]);
    expect(defaultPair([...vols(1), ...vols(1, 1)])).toEqual([0, 1]);
  });
  it('offers the selected object first, then the other objects on its plate', () => {
    const project = { objects: [object('a', 1, [0]), object('b', 2, [1]), object('c', 1, [1, 0])] } as never;
    const choices = booleanChoices(project, 1, 0);
    expect(choices.map((c) => [c.object, c.instance, c.volume, c.name])).toEqual([
      [1, 0, 0, 'b0'],
      [1, 0, 1, 'b1'],
      [2, 0, 0, 'c0'],
    ]);
    expect(booleanChoices(project, 0, 0).map((c) => [c.object, c.instance])).toEqual([
      [0, 0],
      [2, 1],
    ]);
  });
  it('joins another object into the request', () => {
    const project = { objects: [object('a', 1, [0]), object('c', 1, [1, 0])] } as never;
    const [a, c] = booleanChoices(project, 0, 0);
    expect(booleanRequest('union', a, c, true)).toEqual({
      object: 0,
      request: { op: 'union', a: 0, b: 0, deleteInput: false, bObject: 1, aInstance: 0, bInstance: 1 },
    });
    expect(booleanRequest('difference', c, a, true).request).toEqual({ op: 'difference', a: 0, b: 0, deleteInput: true, bObject: 0, aInstance: 1, bInstance: 0 });
  });
});
