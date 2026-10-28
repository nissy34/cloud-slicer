// Where the prime (wipe) tower stands on each plate. Orca keeps one position
// per plate in the project options wipe_tower_x / wipe_tower_y (front-left
// corner, mm from the plate's corner); the page keeps them next to the
// settings, like the colour mixes, and hands them to the engine with them.
import type { OrcaConfig } from '../engine/protocol';

export type TowerSpot = [x: number, y: number];

/** Desktop's spot for the tower on a new plate when the plate's depth isn't known. */
export const DEFAULT_TOWER: TowerSpot = [13, 214.5];

/**
 * Desktop's spot for the tower on a new plate (Snapmaker Orca 2.4.1,
 * PartPlateList::set_default_wipe_tower_pos_for_plate): at the left, halfway
 * down the plate.
 */
export function defaultTower(plateDepth?: number): TowerSpot {
  return plateDepth && plateDepth > 0 ? [13, plateDepth / 2] : DEFAULT_TOWER;
}

/** The plates' spots from a project's wipe_tower_x / wipe_tower_y ("13,120"). */
export function towersFromConfig(config: OrcaConfig): TowerSpot[] {
  const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const xs = list(config.wipe_tower_x);
  const ys = list(config.wipe_tower_y);
  return xs.slice(0, ys.length).map((x, i): TowerSpot => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

/** wipe_tower_x / wipe_tower_y for `plates` plates; plates without a spot get desktop's default. */
export function towerOptions(towers: TowerSpot[], plates: number, plateDepth?: number): OrcaConfig {
  const spots = Array.from({ length: Math.max(1, plates) }, (_, i) => towers[i] ?? defaultTower(plateDepth));
  const num = (n: number) => String(Math.round(n * 1000) / 1000);
  return { wipe_tower_x: spots.map((s) => num(s[0])).join(','), wipe_tower_y: spots.map((s) => num(s[1])).join(',') };
}

/** The spots with plate `plate` moved to `spot`. */
export function moveTower(towers: TowerSpot[], plate: number, spot: TowerSpot, plateDepth?: number): TowerSpot[] {
  const out = Array.from({ length: Math.max(towers.length, plate + 1) }, (_, i) => towers[i] ?? defaultTower(plateDepth));
  out[plate] = spot;
  return out;
}

/** The spots once plate `plate` is deleted: later plates move down one, as desktop does. */
export function dropPlateTower(towers: TowerSpot[], plate: number): TowerSpot[] {
  return towers.filter((_, i) => i !== plate);
}
