import { describe, expect, it } from 'vitest';
import type { PresetSummary } from '../engine/protocol';
// The bundler's encoder, so the page reads exactly what it writes.
import { encodeBedMesh } from '../../../../engine/scripts/bed-mesh.mjs';
import { bedModelOffset, bedVendor, decodeBedMesh, gridLines, gridStep, parsePoints, texturePolygon, textureSize, type Point } from './bed';
import type { PrinterCatalog } from './printer-catalog';

const U1: Point[] = [
  [0, 0],
  [270, 0],
  [270, 270],
  [0, 270],
];

const catalog: PrinterCatalog = {
  version: '1',
  vendors: [
    { id: 'BBL', name: 'Bambu Lab', file: 'BBL.json', bytes: 1, beds: 'BBL.json', models: [{ model: 'Bambu Lab A1', cover: '', send: false, nozzles: [{ name: 'Bambu Lab A1 0.4 nozzle', nozzle: '0.4' }] }] },
    { id: 'Snapmaker', name: 'Snapmaker', file: '', bytes: 0, beds: 'Snapmaker.json', models: [{ model: 'Snapmaker U1', cover: '', send: true, nozzles: [{ name: 'Snapmaker U1 (0.4 nozzle)', nozzle: '0.4' }] }] },
  ],
};

describe('printer bed', () => {
  it('reads points options', () => {
    expect(parsePoints('0x0,270x0,270x270,0x270')).toEqual(U1);
    expect(parsePoints('')).toEqual([]);
    expect(parsePoints('-5x-2.5, 10x3')).toEqual([
      [-5, -2.5],
      [10, 3],
    ]);
  });

  it("finds the bed's brand from the printer preset or a user printer's base, else by printer model", () => {
    const user = { name: 'My A1', inherits: 'Bambu Lab A1 0.4 nozzle', user: true } as PresetSummary;
    expect(bedVendor(catalog, 'Snapmaker U1 (0.4 nozzle)', [], 'Snapmaker U1')?.id).toBe('Snapmaker');
    expect(bedVendor(catalog, 'My A1', [user], 'Bambu Lab A1')?.id).toBe('BBL');
    expect(bedVendor(catalog, 'Imported printer', [], 'Bambu Lab A1')?.id).toBe('BBL');
    expect(bedVendor(catalog, 'Custom', [], '')).toBeNull();
    expect(bedVendor(null, 'Snapmaker U1 (0.4 nozzle)', [], 'Snapmaker U1')).toBeNull();
  });

  it('reads back the bundled bed shape within a 16-bit step', () => {
    const corners = new Float32Array([-138, -146.5, -0.4, 138, -146.5, -0.4, 138, 146.5, 0.1, -138, -146.5, -0.4, 138, 146.5, 0.1, -138, 146.5, 0.1]);
    const buf = encodeBedMesh(corners) as Uint8Array;
    const { positions, index } = decodeBedMesh(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(positions.length).toBe(4 * 3); // shared corners stored once
    expect(index.length).toBe(6);
    for (let c = 0; c < 6; c++) for (let a = 0; a < 3; a++) expect(positions[index[c] * 3 + a]).toBeCloseTo(corners[c * 3 + a], 2);
    expect(() => decodeBedMesh(new ArrayBuffer(40))).toThrow();
  });

  it('puts the shape under the middle of the plate, lowered when it rises above its origin', () => {
    expect(bedModelOffset(U1, 0.1)).toEqual([135, 135, -0.53]);
    expect(bedModelOffset(U1, -1)).toEqual([135, 135, -0.43]);
  });

  it("stretches a Bambu Lab picture over the sheet's front lip", () => {
    expect(texturePolygon(U1, true)).toEqual([
      [0, -12],
      [270, -12],
      [270, 270],
      [0, 270],
    ]);
    expect(texturePolygon(U1, false)).toBe(U1);
  });

  it("draws desktop's grid inside the area, bold every fifth line", () => {
    expect(gridStep(U1)).toBe(10);
    expect(
      gridStep([
        [0, 0],
        [1000, 0],
        [1000, 700],
        [0, 700],
      ]),
    ).toBe(20);
    const { thin, bold } = gridLines(U1);
    // 28 lines each way (0..270), 6 of them bold (0, 50 ... 250), plus the 4 outline edges.
    expect(bold.length / 4).toBe(12);
    expect(thin.length / 4).toBe(56 - 12 + 4);
    expect(Math.max(...thin, ...bold)).toBe(270);
  });

  it('clips the grid to a round bed', () => {
    const circle: Point[] = Array.from({ length: 64 }, (_, i) => [100 * Math.cos((i / 64) * 2 * Math.PI), 100 * Math.sin((i / 64) * 2 * Math.PI)]);
    const { thin, bold } = gridLines(circle);
    for (let i = 0; i < thin.length; i += 2) expect(Math.hypot(thin[i], thin[i + 1])).toBeLessThanOrEqual(100.01);
    // The bold lines through the origin span the circle.
    expect(bold).toContain(-100);
  });

  it('draws the picture at the bed proportions', () => {
    expect(textureSize(U1, 2048)).toEqual([2048, 2048]);
    expect(
      textureSize(
        [
          [0, 0],
          [350, 0],
          [350, 175],
          [0, 175],
        ],
        1024,
      ),
    ).toEqual([1024, 512]);
  });
});
