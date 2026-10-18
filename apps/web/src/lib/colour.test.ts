import { describe, expect, it } from 'vitest';
import { bedSize, rgb } from './colour';

describe('rgb', () => {
  it('parses Orca colours', () => {
    expect(rgb('#FF0000')).toEqual([1, 0, 0]);
    expect(rgb('#00ff00ff')).toEqual([0, 1, 0]);
    expect(rgb(undefined)).toEqual([0.8, 0.8, 0.8]);
  });
});

describe('bedSize', () => {
  it('reads printable_area', () => {
    expect(bedSize('0x0,270x0,270x270,0x270')).toEqual({ x0: 0, y0: 0, w: 270, d: 270 });
    expect(bedSize('-5x-5,250x-5,250x250,-5x250')).toEqual({ x0: -5, y0: -5, w: 255, d: 255 });
  });
});
