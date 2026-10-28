import { shortName } from './presets';
import type { PickerOption } from '../components/Picker';

/**
 * The settings desktop draws as a list of the project's filaments instead of a
 * number box (Plater.cpp's `Choice::register_dynamic_list` calls, both
 * engines). Whether the list starts with "Default" (0) comes from the option's
 * own minimum, as desktop's two lists do: Snapmaker's walls and infills start
 * at filament 1, the support and wipe tower ones, and upstream's, at 0.
 */
export const FILAMENT_LIST_KEYS = new Set([
  // Both engines.
  'support_filament',
  'support_interface_filament',
  'wipe_tower_filament',
  // Snapmaker Orca.
  'wall_filament',
  'sparse_infill_filament',
  'solid_infill_filament',
  // Upstream Orca.
  'outer_wall_filament_id',
  'inner_wall_filament_id',
  'sparse_infill_filament_id',
  'internal_solid_filament_id',
  'top_surface_filament_id',
  'bottom_surface_filament_id',
]);

/**
 * Filaments 1..N as picker rows, like desktop's: the filament's swatch with its
 * number inside, then the preset's name. Rows past the physical filaments are
 * colour mixes; the list reaches `upTo` so a number with no filament still
 * shows as picked.
 */
export function filamentChoices(colours: readonly string[], presets: readonly string[], physical: number, upTo = 0): PickerOption[] {
  const count = Math.max(colours.length, physical, upTo);
  return Array.from({ length: count }, (_, i) => ({
    value: String(i + 1),
    label: i < physical ? shortName(presets[i] ?? '') || `Filament ${i + 1}` : 'Mix',
    swatch: colours[i] ?? '#888888',
    swatchNumber: String(i + 1),
    group: i < physical ? undefined : 'Mixes',
  }));
}
