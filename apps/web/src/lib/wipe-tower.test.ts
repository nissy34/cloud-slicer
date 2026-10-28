import { describe, expect, it } from 'vitest';
import { DEFAULT_TOWER, dropPlateTower, moveTower, towerOptions, towersFromConfig } from './wipe-tower';

describe('prime tower spots', () => {
  it('reads one spot per plate from a project', () => {
    expect(towersFromConfig({ wipe_tower_x: '13,120.5', wipe_tower_y: '214.5,30' })).toEqual([[13, 214.5], [120.5, 30]]);
    expect(towersFromConfig({})).toEqual([]);
  });
  it('gives every plate a spot, the default where none was set', () => {
    expect(towerOptions([[100, 50]], 3)).toEqual({ wipe_tower_x: '100,13,13', wipe_tower_y: '50,214.5,214.5' });
    expect(towerOptions([], 0)).toEqual({ wipe_tower_x: String(DEFAULT_TOWER[0]), wipe_tower_y: String(DEFAULT_TOWER[1]) });
  });
  it('puts a new plate\'s tower at the left, halfway down the plate', () => {
    expect(towerOptions([], 2, 270)).toEqual({ wipe_tower_x: '13,13', wipe_tower_y: '135,135' });
    expect(moveTower([], 1, [40, 60], 270)).toEqual([[13, 135], [40, 60]]);
  });
  it('moves one plate and keeps the others', () => {
    expect(moveTower([], 1, [40, 60])).toEqual([DEFAULT_TOWER, [40, 60]]);
    expect(moveTower([[1, 2], [3, 4]], 0, [5, 6])).toEqual([[5, 6], [3, 4]]);
  });
  it('drops a deleted plate, moving later plates down', () => {
    expect(dropPlateTower([[1, 2], [3, 4], [5, 6]], 1)).toEqual([[1, 2], [5, 6]]);
  });
});
