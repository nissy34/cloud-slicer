import { describe, expect, it } from 'vitest';
import { alignFlowVariants, entryType, flowModeLabel, isVectorType, processFlowModes, valueAt, withValueAt } from './flow-variants';
import { projectOverrides } from './project-import';

describe('vector values', () => {
  it('reads one entry, the first when there are fewer', () => {
    expect(valueAt('50,105', 0)).toBe('50');
    expect(valueAt('50,105', 1)).toBe('105');
    expect(valueAt('50', 1)).toBe('50');
    expect(valueAt('100%,80%', 1)).toBe('80%');
  });

  it('round-trips an edit of one entry without touching the others', () => {
    const edited = withValueAt('50,50', 1, '70');
    expect(edited).toBe('50,70');
    expect(valueAt(edited, 0)).toBe('50');
    expect(valueAt(edited, 1)).toBe('70');
    expect(withValueAt(edited, 1, '50')).toBe('50,50');
    expect(withValueAt('1,0', 0, '0')).toBe('0,0');
  });

  it('pads a short value like Orca, repeating its first entry', () => {
    expect(withValueAt('50', 0, '40', 2)).toBe('40,50');
    expect(withValueAt('50', 1, '70')).toBe('50,70');
  });

  it('knows the vector types and their entry types', () => {
    expect(['floats', 'floatsOrPercents', 'ints', 'bools', 'percents', 'enums'].every(isVectorType)).toBe(true);
    expect(isVectorType('float')).toBe(false);
    expect(isVectorType('strings')).toBe(false);
    expect(entryType('floatsOrPercents')).toBe('floatOrPercent');
    expect(entryType('bools')).toBe('bool');
  });
});

describe('flow modes', () => {
  it('lists the process variants, standard alone by default', () => {
    expect(processFlowModes({ process_flow_support: 'standard;high_flow' })).toEqual(['standard', 'high_flow']);
    expect(processFlowModes({ process_flow_support: '"standard";"high_flow"' })).toEqual(['standard', 'high_flow']);
    expect(processFlowModes({})).toEqual(['standard']);
  });
  it('names them like desktop', () => {
    expect(['standard', 'high_flow', 'ultra_flow'].map(flowModeLabel)).toEqual(['Standard flow', 'High flow', 'Ultra flow']);
  });
});

const options = {
  initial_layer_speed: { flow: 'process' as const },
  initial_layer_travel_speed: { flow: 'process' as const },
  outer_wall_speed: { flow: 'process' as const },
  nozzle_temperature: { flow: 'filament' as const },
  layer_height: {},
  process_flow_support: {},
  filament_flow_support: {},
  filament_flow_step_size: {},
};
// The selected U1 presets: two process variants, two filaments with two variants each.
const base = {
  process_flow_support: 'standard;high_flow',
  initial_layer_speed: '50,50',
  initial_layer_travel_speed: '100%,100%',
  outer_wall_speed: '200,500',
  filament_flow_support: 'standard;high_flow;standard;high_flow',
  filament_flow_step_size: '2,2',
  nozzle_temperature: '220,230,250,260',
  layer_height: '0.2',
};

describe('alignFlowVariants', () => {
  it('spreads a Snapmaker Orca 2.2 project value over every variant', () => {
    const file = { initial_layer_speed: '50', initial_layer_travel_speed: '100%', outer_wall_speed: '200', nozzle_temperature: '220,250' };
    expect(alignFlowVariants(file, base, options)).toMatchObject({
      initial_layer_speed: '50,50',
      initial_layer_travel_speed: '100%,100%',
      outer_wall_speed: '200,200',
      nozzle_temperature: '220,220,250,250',
    });
  });

  it('maps variants by name when the project lists them', () => {
    const file = { process_flow_support: 'high_flow;standard', outer_wall_speed: '450,180' };
    expect(alignFlowVariants(file, base, options).outer_wall_speed).toBe('180,450');
  });

  it('gives a value as many entries as the presets value has', () => {
    // 0.08mm Standard @U1 lists only standard flow but inherits two-entry speeds.
    const single = { ...base, process_flow_support: 'standard', outer_wall_speed: '90,90', initial_layer_speed: '50' };
    expect(alignFlowVariants({ outer_wall_speed: '90', initial_layer_speed: '50' }, single, options)).toMatchObject({ outer_wall_speed: '90,90', initial_layer_speed: '50' });
  });

  it('keeps the presets segment of a filament the project lacks', () => {
    expect(alignFlowVariants({ nozzle_temperature: '215' }, base, options).nozzle_temperature).toBe('215,215,250,260');
  });
});

describe('projectOverrides with flow variants', () => {
  it('does not count a 2.2 project matching the presets as changed', () => {
    const file = { initial_layer_speed: '50', initial_layer_travel_speed: '100%', layer_height: '0.2', process_flow_support: 'standard' };
    expect(projectOverrides(file, base, options)).toEqual({});
  });
  it('keeps real changes in the presets layout', () => {
    const file = { initial_layer_speed: '40', outer_wall_speed: '200,500', nozzle_temperature: '225,250' };
    expect(projectOverrides(file, base, options)).toEqual({ initial_layer_speed: '40,40', nozzle_temperature: '225,225,250,250' });
  });
});
