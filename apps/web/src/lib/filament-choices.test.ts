import { describe, expect, it } from 'vitest';
import { FILAMENT_LIST_KEYS, filamentChoices } from './filament-choices';

describe('filamentChoices', () => {
  it('lists each filament with its colour and preset name', () => {
    expect(filamentChoices(['#f00', '#0f0'], ['Snapmaker PLA @U1', 'Generic PETG'], 2)).toEqual([
      { value: '1', label: 'Snapmaker PLA', swatch: '#f00', swatchNumber: '1', group: undefined },
      { value: '2', label: 'Generic PETG', swatch: '#0f0', swatchNumber: '2', group: undefined },
    ]);
  });
  it('reaches a picked number with no filament, so it still shows', () => {
    const rows = filamentChoices(['#f00'], ['PLA'], 1, 3);
    expect(rows.map((r) => r.value)).toEqual(['1', '2', '3']);
    expect(rows[2]).toMatchObject({ label: 'Mix', swatchNumber: '3', group: 'Mixes' });
  });
  it('covers desktop’s filament lists in both engines', () => {
    for (const k of ['wall_filament', 'sparse_infill_filament', 'solid_infill_filament', 'wipe_tower_filament', 'support_filament', 'outer_wall_filament_id'])
      expect(FILAMENT_LIST_KEYS.has(k)).toBe(true);
    expect(FILAMENT_LIST_KEYS.has('support_interface_top_layers')).toBe(false);
  });
});
