import { describe, expect, it } from 'vitest';
import { optionStates, reviewChange, type ToggleContext } from './option-toggles';

const ctx: ToggleContext = {
  flowVariant: 0,
  slots: 2,
  scope: 'global',
  options: {
    default_acceleration: { type: 'floats', flow: 'process' },
    z_hop_types: { type: 'enums' },
    retraction_length: { type: 'floats' },
    wipe: { type: 'bools' },
  },
};
const base = {
  wall_loops: '2',
  sparse_infill_density: '15%',
  sparse_infill_pattern: 'gyroid',
  top_shell_layers: '4',
  bottom_shell_layers: '3',
  enable_support: '0',
  raft_layers: '0',
  support_type: 'normal(auto)',
  support_style: 'default',
  brim_type: 'auto_brim',
  brim_width: '5',
  ironing_type: 'no ironing',
  spiral_mode: '0',
  default_acceleration: '10000,0',
  gcode_flavor: 'klipper',
  wall_generator: 'classic',
  fuzzy_skin_mode: 'displacement',
  layer_height: '0.2',
  retraction_length: '0.8,0.8',
  z_hop_types: 'Normal Lift,Normal Lift',
  wipe: '1,1',
  use_firmware_retraction: '0',
};

describe('optionStates', () => {
  it('greys support settings out while support is off, and back with it on', () => {
    expect(optionStates(base, ctx).disabled.has('support_top_z_distance')).toBe(true);
    expect(optionStates({ ...base, enable_support: '1' }, ctx).disabled.has('support_top_z_distance')).toBe(false);
    // A raft prints support material too.
    expect(optionStates({ ...base, raft_layers: '2' }, ctx).disabled.has('support_top_z_distance')).toBe(false);
  });

  it('hides lines that only apply to another choice', () => {
    expect(optionStates(base, ctx).hidden.has('ironing_flow')).toBe(true);
    expect(optionStates({ ...base, ironing_type: 'top' }, ctx).hidden.has('ironing_flow')).toBe(false);
    expect(optionStates(base, ctx).hidden.has('brim_ears_max_angle')).toBe(true);
    expect(optionStates({ ...base, brim_type: 'brim_ears' }, ctx).hidden.has('brim_ears_max_angle')).toBe(false);
  });

  it('greys brim width out for auto and painted brims', () => {
    expect(optionStates(base, ctx).disabled.has('brim_width')).toBe(true);
    expect(optionStates({ ...base, brim_type: 'outer_only' }, ctx).disabled.has('brim_width')).toBe(false);
  });

  it('lets the later toggle of a setting win, like desktop', () => {
    // detect_thin_wall: on with walls, then off with Arachne.
    expect(optionStates(base, ctx).disabled.has('detect_thin_wall')).toBe(false);
    expect(optionStates({ ...base, wall_generator: 'arachne' }, ctx).disabled.has('detect_thin_wall')).toBe(true);
  });

  it('reads flow-variant options at the flow variant on screen', () => {
    expect(optionStates(base, ctx).disabled.has('outer_wall_acceleration')).toBe(false);
    const cfg = { ...base, process_flow_support: 'standard;high_flow' };
    expect(optionStates(cfg, { ...ctx, flowVariant: 1 }).disabled.has('outer_wall_acceleration')).toBe(true);
  });

  it('reads list choices by their first entry', () => {
    expect(optionStates(base, ctx).disabled.has('travel_slope')).toBe(true);
    expect(optionStates({ ...base, z_hop_types: 'Slope Lift,Slope Lift' }, ctx).disabled.has('travel_slope')).toBe(false);
  });

  it('narrows support styles to the support type', () => {
    expect(optionStates(base, ctx).enumValues.support_style).toEqual(['default', 'grid', 'snug']);
    expect(optionStates({ ...base, support_type: 'tree(auto)' }, ctx).enumValues.support_style).toContain('organic');
  });

  it('shows the plate temperatures of the U1 plates only', () => {
    const u1 = optionStates({ ...base, printer_model: 'Snapmaker U1' }, ctx).hidden;
    expect(u1.has('textured_plate_temp')).toBe(false);
    expect(u1.has('cool_plate_temp')).toBe(true);
    expect(u1.has('graphic_effect_plate_temp_initial_layer')).toBe(false);
  });

  it('shows the flush into objects switch only in an object\'s settings', () => {
    expect(optionStates(base, ctx).hidden.has('flush_into_objects')).toBe(true);
    expect(optionStates(base, { ...ctx, scope: 'object' }).hidden.has('flush_into_objects')).toBe(false);
  });
});

describe('reviewChange', () => {
  it('asks before turning on spiral vase, offering to change the settings it needs', () => {
    const after = { ...base, spiral_mode: '1' };
    const { prompts } = reviewChange(base, after, ['spiral_mode'], ctx);
    expect(prompts).toHaveLength(1);
    const [no, yes] = prompts[0].answers;
    expect(no.changes).toEqual({ spiral_mode: '0' });
    expect(yes.changes).toMatchObject({ wall_loops: '1', top_shell_layers: '0', sparse_infill_density: '0%', enable_support: '0' });
  });

  it('just changes the settings in an object, with OK only', () => {
    const { prompts } = reviewChange(base, { ...base, spiral_mode: '1' }, ['spiral_mode'], { ...ctx, scope: 'object' });
    expect(prompts[0].answers).toHaveLength(1);
    expect(prompts[0].answers[0].changes.wall_loops).toBe('1');
  });

  it('only checks combinations the edit touched', () => {
    const cfg = { ...base, spiral_mode: '1' };
    expect(reviewChange(cfg, { ...cfg, brim_width: '3' }, ['brim_width'], ctx).prompts).toEqual([]);
  });

  it('resets a zero layer height to 0.2', () => {
    const { prompts } = reviewChange(base, { ...base, layer_height: '0' }, ['layer_height'], ctx);
    expect(prompts[0].answers).toEqual([{ label: 'OK', changes: { layer_height: '0.2' } }]);
  });

  it('offers Arachne or Displacement for extrusion fuzzy skin', () => {
    const { prompts } = reviewChange(base, { ...base, fuzzy_skin_mode: 'extrusion' }, ['fuzzy_skin_mode'], ctx);
    expect(prompts[0].answers.map((a) => a.changes)).toEqual([{ fuzzy_skin_mode: 'displacement' }, { wall_generator: 'arachne' }]);
  });

  it('turns on overhang wall detection and fixes the support style without asking', () => {
    const before = { ...base, detect_overhang_wall: '0', support_type: 'normal(auto)', support_style: 'organic' };
    const { changes, prompts } = reviewChange(before, { ...before, enable_support: '1' }, ['enable_support'], ctx);
    expect(prompts).toEqual([]);
    expect(changes).toEqual({ detect_overhang_wall: '1', support_style: 'default' });
  });

  it('turns arc fitting off when extrusion rate smoothing is on', () => {
    const before = { ...base, enable_arc_fitting: '1', max_volumetric_extrusion_rate_slope: '0' };
    expect(reviewChange(before, { ...before, max_volumetric_extrusion_rate_slope: '300' }, ['max_volumetric_extrusion_rate_slope'], ctx).changes).toEqual({
      enable_arc_fitting: '0',
    });
  });

  it('warns about a nozzle temperature outside the filament range', () => {
    const before = { ...base, nozzle_temperature_range_low: '190', nozzle_temperature_range_high: '240', nozzle_temperature: '220' };
    const { prompts } = reviewChange(before, { ...before, nozzle_temperature: '280' }, ['nozzle_temperature'], ctx);
    expect(prompts[0].message).toMatch(/190 to 240/);
    expect(prompts[0].answers).toEqual([{ label: 'OK', changes: {} }]);
  });

  it('asks to turn Wipe off for firmware retraction, for every extruder', () => {
    const { prompts } = reviewChange(base, { ...base, use_firmware_retraction: '1' }, ['use_firmware_retraction'], ctx);
    expect(prompts[0].answers.map((a) => a.changes)).toEqual([{ use_firmware_retraction: '0' }, { wipe: '0,0' }]);
  });

  it('writes a reset into the flow variant on screen only', () => {
    const cfg = { ...base, process_flow_support: 'standard;high_flow', ironing_spacing: '0.1,0.1' };
    const c = { ...ctx, flowVariant: 1, options: { ...ctx.options, ironing_spacing: { type: 'floats', flow: 'process' as const } } };
    const { prompts } = reviewChange(cfg, { ...cfg, ironing_spacing: '0.1,0.01' }, ['ironing_spacing'], c);
    expect(prompts[0].answers[0].changes).toEqual({ ironing_spacing: '0.1,0.1' });
  });
});
