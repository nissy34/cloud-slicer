// The plate menu's requests to the engine (engine/src/plate_api.cpp), and what
// desktop Orca's plate and empty-space menus offer besides.
import type { LayerCode } from '../engine/protocol';
import type { Shape } from './volumes';

export type PlateAction =
  | { op: 'addShape'; shape: Shape }
  | { op: 'deleteAll' }
  | { op: 'rename'; name: string }
  /** The plate's layer slider items, all of them (lib/layerCodes.ts); filaments: how many the project has. */
  | { op: 'layerCodes'; codes: LayerCode[]; filaments: number }
  /** Ctrl+C and Ctrl+V: the engine keeps the copy, so it pastes after the original is gone. */
  | { op: 'copy'; object: number; instance: number }
  /** Several copies chosen together: they paste as a block, keeping where they stood from each other. */
  | { op: 'copy'; items: { object: number; instance: number }[] }
  | { op: 'paste' }
  /** Desktop's Arrange selection: these objects each on a free spot, around the ones that stay put. */
  | { op: 'arrangeSelection'; objects: number[] };

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
