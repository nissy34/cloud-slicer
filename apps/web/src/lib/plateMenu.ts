// The plate menu's requests to the engine (engine/src/plate_api.cpp), and what
// desktop Orca's plate and empty-space menus offer besides.
import type { Shape } from './volumes';

export type PlateAction = { op: 'addShape'; shape: Shape } | { op: 'deleteAll' } | { op: 'rename'; name: string };

/**
 * Desktop's "Add Handy models" (MenuFactory::append_submenu_add_handy_model):
 * Orca's resources/handy_models, served from engine/handy_models/.
 */
export const HANDY_MODELS = [
  { label: 'Orca Cube', file: 'OrcaCube_v2.3mf' },
  { label: 'Orca Tolerance Test', file: 'OrcaToleranceTest.stl' },
  { label: '3DBenchy', file: '3DBenchy.3mf' },
  { label: 'Autodesk FDM Test', file: 'ksr_fdmtest_v4.3mf' },
  { label: 'Voron Cube', file: 'Voron_Design_Cube_v7.3mf' },
  { label: 'Stanford Bunny', file: 'Stanford_Bunny.3mf' },
  { label: 'Orca String Hell', file: 'Orca_stringhell.3mf' },
] as const;

/** Whether a point of the 3D view (the shown plate runs from (0, 0) to (w, d)) lies on the plate. */
export function onPlate(x: number, y: number, w: number, d: number): boolean {
  return x >= 0 && x <= w && y >= 0 && y <= d;
}
