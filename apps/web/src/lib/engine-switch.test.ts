import { describe, expect, it } from 'vitest';
import type { OptionDef, ProjectInfo } from '../engine/protocol';
import { carriedRecipe, flowFill, losesNothing, standardFlowValue, switchPlan, type PlanInput } from './engine-switch';
import type { MixRow } from './mixing';
import type { SharedTable } from './preset-engines';

const row = (r: Partial<MixRow>): MixRow => ({
  componentA: 1,
  componentB: 2,
  mixBPercent: 50,
  ratioA: 1,
  ratioB: 1,
  pattern: '',
  gradientIds: '',
  gradientWeights: '',
  distributionMode: 2,
  gradientEnabled: false,
  gradientStart: 0.8,
  gradientEnd: 0.2,
  uiMode: 0,
  virtualId: 5,
  stableId: '1',
  gradientIdList: [],
  localZMaxSublayers: 0,
  enabled: true,
  deleted: false,
  custom: true,
  colour: '#808080',
  compatible: true,
  ...r,
});

describe('carriedRecipe', () => {
  it('keeps Ratio, Match and Gradient mixes as they are, both ways', () => {
    for (const r of [row({ mixBPercent: 30 }), row({ gradientIds: '234', gradientWeights: '20/30/50', distributionMode: 0 }), row({ gradientEnabled: true, uiMode: 3 })])
      for (const to of ['orca', 'snapmaker'] as const) expect(carriedRecipe(r, to)).toMatchObject({ pattern: '', mixBPercent: r.mixBPercent, gradientIds: r.gradientIds, gradientWeights: r.gradientWeights, gradientEnabled: r.gradientEnabled, uiMode: r.uiMode });
  });
  it('keeps a Cycle mix for Snapmaker Orca', () => {
    expect(carriedRecipe(row({ pattern: '1222', uiMode: 1 }), 'snapmaker')).toMatchObject({ pattern: '1222', uiMode: 1 });
  });
  it('makes a Cycle mix a Ratio mix of the same shares for OrcaSlicer', () => {
    expect(carriedRecipe(row({ pattern: '1222', uiMode: 1, distributionMode: 0 }), 'orca')).toMatchObject({ pattern: '', uiMode: 0, componentA: 1, componentB: 2, mixBPercent: 75, ratioA: 1, ratioB: 3, distributionMode: 2, gradientEnabled: false });
    expect(carriedRecipe(row({ pattern: '1123', uiMode: 1 }), 'orca')).toMatchObject({ pattern: '', uiMode: 0, gradientIds: '123', gradientWeights: '50/25/25', distributionMode: 0 });
    expect(carriedRecipe(row({ pattern: '2[10]', componentA: 2, componentB: 10, uiMode: 1 }), 'orca')).toMatchObject({ componentA: 2, componentB: 10, mixBPercent: 50 });
  });
});

describe('flow-variant values', () => {
  const config = { process_flow_support: 'standard,high_flow', filament_flow_support: 'standard,high_flow;standard,high_flow', filament_flow_step_size: '2,2' };
  it('keeps the standard flow value', () => {
    expect(standardFlowValue('300,600', 'process', config)).toEqual({ value: '300', differs: true });
    expect(standardFlowValue('300,300', 'process', config)).toEqual({ value: '300', differs: false });
    expect(standardFlowValue('12,20,15,25', 'filament', config)).toEqual({ value: '12,15', differs: true });
    expect(standardFlowValue('300', 'process', { process_flow_support: 'high_flow,standard' })).toEqual({ value: '300', differs: false });
  });
  it('puts a plain value back at the standard entries', () => {
    expect(flowFill('250', 'process', '300,600', config)).toBe('250,600');
    expect(flowFill('10,11', 'filament', '12,20,15,25', config)).toBe('10,20,11,25');
    expect(flowFill('250', 'process', '', config)).toBe('250');
  });
});

describe('switchPlan', () => {
  const table: SharedTable = {
    version: 1,
    shared: ['sparse_infill_density', 'outer_wall_speed', 'wall_loops'],
    flow: { outer_wall_speed: 'process' },
    listIn: { flush_multiplier: 'orca' },
    gcode: ['change_filament_gcode'],
    names: { 'snapmaker>orca': { process: { '0.20mm Standard @U1': '0.20 Standard @U1', '0.10mm Color Mixing @U1': '0.12 Fine @U1' }, filament: { 'Snapmaker PLA': 'Generic PLA @U1' } } },
    history: [],
  };
  const options: Record<string, OptionDef> = {
    sparse_infill_density: { label: 'Sparse infill density' } as OptionDef,
    outer_wall_speed: { label: 'Outer wall', flow: 'process' } as OptionDef,
    mixed_filament_height_lower_bound: { label: 'Lower bound' } as OptionDef,
    wall_loops: { label: 'Wall loops' } as OptionDef,
  };
  const project = {
    objects: [{ name: 'Cube', settings: { wall_loops: '3', dithering_z_step_size: '0.1', extruder: '5' }, volumes: [{ name: 'Part', settings: { outer_wall_speed: '100,200' } }] }],
  } as unknown as ProjectInfo;
  const input: PlanInput = {
    from: 'snapmaker',
    to: 'orca',
    selection: { printer: 'Snapmaker U1', process: '0.20mm Standard @U1', filaments: ['Snapmaker PLA', 'My PLA'], colours: ['#FF0000', '#0000FF'] },
    userPresets: [{ type: 'filament', name: 'My PLA' }],
    overrides: { sparse_infill_density: '20%', outer_wall_speed: '120,300', mixed_filament_height_lower_bound: '0.05' },
    baseConfig: { process_flow_support: 'standard,high_flow' },
    options,
    mixes: [row({ virtualId: 3, mixBPercent: 80 }), row({ virtualId: 0, enabled: false, deleted: true })],
    project,
  };

  it('lists what switching to OrcaSlicer loses, and what carries over', () => {
    const plan = switchPlan(input, table);
    expect(plan.mixes).toEqual([]);
    expect(plan.carried).toEqual([{ id: 3, recipe: expect.objectContaining({ componentA: 1, componentB: 2, mixBPercent: 80 }) }]);
    expect(plan.highFlowChanged.map((d) => [d.key, d.where])).toEqual([
      ['outer_wall_speed', undefined],
      ['outer_wall_speed', 'Cube, Part'],
    ]);
    expect(plan.dropped.map((d) => [d.label, d.where])).toEqual([
      ['Lower bound', undefined],
      ['dithering_z_step_size', 'Cube'],
    ]);
    // Built-ins moving to the matching built-in are not worth a word.
    expect(plan.presets).toEqual([]);
    expect(plan.selection.process).toBe('0.20 Standard @U1');
    expect(plan.selection.filaments).toEqual(['Generic PLA @U1', 'My PLA']);
    expect(plan.overrides).toEqual({ sparse_infill_density: '20%', outer_wall_speed: '120' });
    expect(plan.objectEdits).toEqual([
      { object: 0, volume: -1, values: { dithering_z_step_size: null } },
      { object: 0, volume: 0, values: { outer_wall_speed: '100' } },
    ]);
    expect(losesNothing(plan)).toBe(false);
  });

  it('back to Snapmaker Orca has no mixes or high flow to lose', () => {
    const plan = switchPlan({ ...input, from: 'orca', to: 'snapmaker', overrides: { outer_wall_speed: '120' }, mixes: [], project: null, selection: { ...input.selection, process: 'Mine', filaments: ['My PLA'] }, userPresets: [{ type: 'process', name: 'Mine' }, { type: 'filament', name: 'My PLA' }] }, table);
    expect(plan.overrides).toEqual({ outer_wall_speed: '120' });
    expect(losesNothing(plan)).toBe(true);
  });

  it("back to Snapmaker Orca, OrcaSlicer's own mixes come along with nothing to tell", () => {
    const plan = switchPlan({ ...input, from: 'orca', to: 'snapmaker', overrides: {}, mixes: [row({ virtualId: 4, mixBPercent: 30 }), row({ virtualId: 3, mixBPercent: 60 })], project: null }, table);
    expect(plan.mixes).toEqual([]);
    expect(plan.carried.map((m) => [m.id, m.recipe.mixBPercent])).toEqual([
      [3, 60],
      [4, 30],
    ]);
    expect(losesNothing(plan)).toBe(true);
  });

  it('carries what OrcaSlicer has under another shape or name, and says G-code stays the printer\'s own', () => {
    const overrides = { flush_multiplier: '0.8', change_filament_gcode: 'T[next_extruder]', filament_multi_colors: '"#FF0000|#00FF00"', dithering_local_z_mode: '1', dithering_local_z_infill: '1' };
    const plan = switchPlan({ ...input, overrides, project: null }, table);
    expect(plan.overrides).toEqual({ flush_multiplier: '0.8', enable_mixed_color_sublayer: '1' });
    expect(plan.ownGcode.map((d) => d.key)).toEqual(['change_filament_gcode']);
    // Swatch colours desktop shows aren't worth a word; Snapmaker's Local-Z infill has no OrcaSlicer setting.
    expect(plan.dropped.map((d) => d.key)).toEqual(['dithering_local_z_infill']);
    const back = switchPlan({ ...input, from: 'orca', to: 'snapmaker', overrides: { flush_multiplier: '0.7,0.9', enable_mixed_color_sublayer: '1' }, mixes: [], project: null }, table);
    expect(back.overrides).toEqual({ flush_multiplier: '0.7', dithering_local_z_mode: '1' });
  });

  it('a Cycle mix going to OrcaSlicer is worth a word', () => {
    const plan = switchPlan({ ...input, overrides: {}, project: null, mixes: [row({ virtualId: 3, pattern: '1222', uiMode: 1 })] }, table);
    expect(plan.mixes).toEqual([{ id: 3, label: 'Cycle: F1 25% + F2 75%', colour: '#808080', becomes: 'Ratio: F1 25% + F2 75%' }]);
    expect(losesNothing(plan)).toBe(false);
  });

  it('a plain model on built-in presets loses nothing, so the switch asks nothing', () => {
    const plain = { ...input, overrides: { sparse_infill_density: '20%' }, mixes: [], project: { objects: [{ name: 'Cube', settings: {}, volumes: [] }] } as unknown as ProjectInfo };
    expect(losesNothing(switchPlan(plain, table))).toBe(true);
    // High flow values only count when they were changed apart from the standard ones.
    expect(losesNothing(switchPlan({ ...plain, overrides: { outer_wall_speed: '120,120' } }, table))).toBe(true);
  });

  it('a process with no match of its layer height is worth a word', () => {
    const plan = switchPlan({ ...input, selection: { ...input.selection, process: '0.10mm Color Mixing @U1' } }, table);
    expect(plan.presets).toEqual([{ type: 'process', from: '0.10mm Color Mixing @U1', to: '0.12 Fine @U1' }]);
  });
});
