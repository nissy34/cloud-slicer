import { describe, expect, it } from 'vitest';
import { defaultPair, pickerLabels } from './boolean';

const vols = (n: number) => Array.from({ length: n }, (_, k) => ({ name: `v${k}` }));

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
  });
});
