import { describe, expect, it } from 'vitest';
import { fitOrder, hasPlateSettings, LAYER_END, parseOtherLayers, plateSettingsRequest, readPlateSettings, serializeOtherLayers, tidyRanges, vaseDiffer } from './plate-settings';

describe('plate settings', () => {
  it('reads nothing of its own as the project settings', () => {
    expect(readPlateSettings({}, 3)).toEqual({ bedType: null, sequence: null, spiral: null, firstLayer: null, otherLayers: null });
    expect(hasPlateSettings({})).toBe(false);
    expect(hasPlateSettings(undefined)).toBe(false);
  });

  it('reads and writes what desktop stores in the plate config', () => {
    const own = {
      curr_bed_type: 'Textured PEI Plate',
      print_sequence: 'by object',
      spiral_mode: '0',
      first_layer_print_sequence: '2,1,3',
      other_layers_print_sequence: `2,10,3,2,1,11,${LAYER_END},1,3,2`,
      other_layers_print_sequence_nums: '2',
    };
    const s = readPlateSettings(own, 3);
    expect(s).toEqual({
      bedType: 'Textured PEI Plate',
      sequence: 'by object',
      spiral: false,
      firstLayer: [2, 1, 3],
      otherLayers: [
        { from: 2, to: 10, order: [3, 2, 1] },
        { from: 11, to: LAYER_END, order: [1, 3, 2] },
      ],
    });
    expect(hasPlateSettings(own)).toBe(true);
    expect(plateSettingsRequest(s, 3)).toEqual(own);
  });

  it('asks the engine to drop every setting left to the project', () => {
    expect(plateSettingsRequest(readPlateSettings({}, 2), 2)).toEqual({
      curr_bed_type: null,
      print_sequence: null,
      spiral_mode: null,
      first_layer_print_sequence: null,
      other_layers_print_sequence: null,
      other_layers_print_sequence_nums: null,
    });
  });

  it('treats a stored [0] first layer order as Auto, like desktop', () => {
    expect(readPlateSettings({ first_layer_print_sequence: '0' }, 2).firstLayer).toBeNull();
  });

  it('keeps every order to the project filaments (PartPlate::update_first_layer_print_sequence)', () => {
    expect(fitOrder([3, 1, 5, 1], 3)).toEqual([3, 1, 2]);
    expect(fitOrder([4, 2], 2)).toEqual([2, 1]);
    expect(readPlateSettings({ first_layer_print_sequence: '4,2,1,3' }, 2).firstLayer).toEqual([2, 1]);
  });

  it('refuses a malformed other layers order', () => {
    expect(parseOtherLayers('2,5,1', '2')).toBeNull();
    expect(parseOtherLayers('', '0')).toBeNull();
    expect(parseOtherLayers('2,5', '1')).toBeNull();
  });

  it('sorts ranges and keeps them from layer 2 on', () => {
    expect(
      tidyRanges([
        { from: 20, to: 10, order: [1] },
        { from: 0, to: 5, order: [1] },
      ]),
    ).toEqual([
      { from: 2, to: 5, order: [1] },
      { from: 20, to: 20, order: [1] },
    ]);
    expect(serializeOtherLayers([{ from: 2, to: 3, order: [2] }], 2)).toEqual({ flat: '2,3,2,1', nums: '1' });
  });

  it('turns spiral vase on per plate with only the settings the project lacks', () => {
    const project = { wall_loops: '1', top_shell_layers: '4', sparse_infill_density: '15%', enable_support: '0', wall_direction: 'auto' };
    expect(vaseDiffer(project)).toEqual(['top_shell_layers', 'sparse_infill_density']);
  });
});
