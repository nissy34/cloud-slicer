import { describe, expect, it } from 'vitest';
import type { VolumeInfo } from '../engine/protocol';
import { keepsAPart, partRanges, volumeMeshes } from './volumes';

const vol = (kind: VolumeInfo['kind']): VolumeInfo => ({ name: kind, kind, extruder: 0, painted: false, paint: { support: false, seam: false, fuzzy: false }, settings: {} });

describe('volumes', () => {
  it('splits the see-through volumes out of a preview', () => {
    const volumePositions = new Float32Array(9 * 3).map((_, i) => i);
    const meshes = volumeMeshes({ volumePositions, volumeList: new Int32Array([0, 1, 2, 1, 3, 2, 4, 2]) });
    expect(meshes.map((m) => [m.object, m.volume, m.kind, m.positions.length])).toEqual([
      [0, 1, 2, 9],
      [3, 2, 4, 18],
    ]);
    expect(meshes[1].positions[0]).toBe(9);
  });

  it('finds a part in every instance', () => {
    expect(partRanges({ partList: new Int32Array([0, 0, 0, 12, 0, 1, 12, 4, 0, 0, 16, 12, 1, 0, 28, 6]) }, 0, 0)).toEqual([
      [0, 12],
      [16, 12],
    ]);
  });

  it('keeps one part on an object', () => {
    expect(keepsAPart([vol('part'), vol('modifier')], 0)).toBe(false);
    expect(keepsAPart([vol('part'), vol('modifier')], 1)).toBe(true);
    expect(keepsAPart([vol('part'), vol('part')], 0)).toBe(true);
  });
});
