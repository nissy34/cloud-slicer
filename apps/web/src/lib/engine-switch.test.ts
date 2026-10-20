import { describe, expect, it } from 'vitest';
import type { OptionDef, ProjectInfo } from '../engine/protocol';
import { flowFill, losesNothing, mainFilament, standardFlowValue, switchPlan, type PlanInput } from './engine-switch';
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

describe('mainFilament', () => {
  it('is the filament a mix uses most', () => {
    expect(mainFilament(row({ mixBPercent: 30 }))).toBe(1);
    expect(mainFilament(row({ mixBPercent: 70 }))).toBe(2);
    expect(mainFilament(row({ mixBPercent: 50 }))).toBe(1);
    expect(mainFilament(row({ pattern: '1222' }))).toBe(2);
    expect(mainFilament(row({ gradientIds: '234', gradientWeights: '20/30/50' }))).toBe(4);
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
    expect(plan.mixes).toEqual([{ id: 3, label: 'F1 20% + F2 80%', colour: '#808080', becomes: 2 }]);
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
