import { describe, expect, it } from 'vitest';
import { flushNote, flushShown, outOfRange, parseMatrix, parseMultipliers, remapMatrix, serializeMatrix, serializeMultipliers, shown, stored } from './flush';

const info = { flushes: true, bambu: false, nozzles: 1, min: [107], max: 800 };

describe('flushing volumes', () => {
  it('reads the table row by row (from) and column by column (to), one block per nozzle', () => {
    const m = parseMatrix('0,100,200,0, 0,300,400,0', 2, 2);
    expect(m).toEqual([
      [
        [0, 100],
        [200, 0],
      ],
      [
        [0, 300],
        [400, 0],
      ],
    ]);
    expect(serializeMatrix(m)).toBe('0,100,200,0,0,300,400,0');
  });

  it('fills a short table with desktop defaults: 0 on the diagonal, 280 elsewhere', () => {
    expect(parseMatrix('0,50,60,0', 3, 1)[0]).toEqual([
      [0, 50, 280],
      [60, 0, 280],
      [280, 280, 0],
    ]);
  });

  it('shows the table value times the multiplier and stores what is typed divided by it', () => {
    expect(shown(280, 0.3)).toBe(84);
    expect(stored(84, 0.3)).toBeCloseTo(280);
    expect(stored(84, 0)).toBe(84);
  });

  it('keeps one multiplier for Snapmaker Orca and one per nozzle for OrcaSlicer', () => {
    expect(parseMultipliers('1', 2)).toEqual([1, 1]);
    expect(parseMultipliers('0.5,1.2', 2)).toEqual([0.5, 1.2]);
    expect(serializeMultipliers([0.5, 1.2], false)).toBe('0.5');
    expect(serializeMultipliers([0.5, 1.2], true)).toBe('0.5,1.2');
  });

  describe('keeping typed values when filaments change', () => {
    // The engine's automatic table for the new filaments.
    const auto3 = '0,10,20, 30,0,40, 50,60,0';
    it('keeps pairs of unchanged filaments and takes the new values for a changed one', () => {
      const own = '0,111,222, 333,0,444, 555,666,0';
      // Filament 2 changed colour.
      expect(remapMatrix(own, 3, auto3, [0, null, 2], 1)).toBe('0,10,222,30,0,40,555,60,0');
    });
    it('follows a removed filament', () => {
      const own = '0,111,222, 333,0,444, 555,666,0';
      // Filament 2 removed: 1 and 3 remain.
      expect(remapMatrix(own, 3, '0,1,2,0', [0, 2], 1)).toBe('0,222,555,0');
    });
    it('gives an added filament the automatic values', () => {
      expect(remapMatrix('0,7,8,0', 2, auto3, [0, 1, null], 1)).toBe('0,7,20,8,0,40,50,60,0');
    });
    it('drops the setting when nothing typed is left', () => {
      expect(remapMatrix('0,7,8,0', 2, '0,1,2,0', [null, 1], 1)).toBeNull();
    });
  });

  it('is offered only for a printer that flushes, with more than one filament', () => {
    expect(flushShown(info, 2)).toBe(true);
    expect(flushShown(info, 1)).toBe(false);
    expect(flushShown({ ...info, flushes: false }, 4)).toBe(false);
    expect(flushShown(null, 4)).toBe(false);
  });

  it('says when the prime tower purges the prime volume instead (desktop WipeTower2 rule)', () => {
    expect(flushNote({ purge_in_prime_tower: '0', prime_volume: '45' }, info)).toMatch(/prime volume \(45 mm³\)/);
    expect(flushNote({ purge_in_prime_tower: '1' }, info)).toBe('');
    expect(flushNote({ purge_in_prime_tower: '0' }, { ...info, bambu: true })).toBe('');
  });

  it('flags amounts outside the suggested range', () => {
    expect(outOfRange(50, 107, 800)).toBe(true);
    expect(outOfRange(900, 107, 800)).toBe(true);
    expect(outOfRange(300, 107, 800)).toBe(false);
  });
});
