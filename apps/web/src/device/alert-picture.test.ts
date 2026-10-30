import { describe, expect, it } from 'vitest';
import { fitIn, pictureGrid } from './alert-picture';

describe('joining camera pictures (as the bridge does)', () => {
  it('two side by side, three or four in a 2×2 grid', () => {
    expect(pictureGrid(1)).toEqual({ cols: 1, rows: 1 });
    expect(pictureGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(pictureGrid(3)).toEqual({ cols: 2, rows: 2 });
    expect(pictureGrid(4)).toEqual({ cols: 2, rows: 2 });
  });
  it('fits each picture in its cell, keeping its shape', () => {
    const cell = { x: 640, y: 0, w: 640, h: 480 };
    expect(fitIn(1920, 1080, cell)).toEqual({ x: 640, y: 60, w: 640, h: 360 });
    expect(fitIn(480, 640, cell)).toEqual({ x: 780, y: 0, w: 360, h: 480 });
  });
});
