import { describe, expect, it } from 'vitest';
import { optionStates, reviewChange, usesPlaAndPetg, type ToggleContext } from './option-toggles';

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

  it('shows parallel printheads only for printers that have them', () => {
    expect(optionStates(base, ctx).hidden.has('parallel_printheads_count')).toBe(true);
    expect(optionStates({ ...base, support_parallel_printheads: '1' }, ctx).hidden.has('parallel_printheads_count')).toBe(false);
  });

  it('shows the prime tower interface boost on a U1 with a prime tower only', () => {
    const u1 = { ...base, printer_model: 'Snapmaker U1', enable_prime_tower: '1', enable_tower_interface_features: '0' };
    expect(optionStates(u1, ctx).hidden.has('enable_tower_interface_features')).toBe(false);
    expect(optionStates(u1, ctx).hidden.has('enable_tower_interface_cooldown_during_tower')).toBe(true);
    expect(optionStates({ ...u1, enable_tower_interface_features: '1' }, ctx).hidden.has('enable_tower_interface_cooldown_during_tower')).toBe(false);
    expect(optionStates({ ...u1, printer_model: 'Bambu Lab X1 Carbon' }, ctx).hidden.has('enable_tower_interface_features')).toBe(true);
    expect(optionStates({ ...u1, enable_prime_tower: '0' }, ctx).hidden.has('enable_tower_interface_features')).toBe(true);
  });

  it('uses max bridge length for every tree support, bridge no support otherwise', () => {
    const organic = { ...base, enable_support: '1', support_type: 'tree(auto)', support_style: 'organic' };
    expect(optionStates(organic, ctx).hidden.has('max_bridge_length')).toBe(false);
    expect(optionStates(organic, ctx).hidden.has('bridge_no_support')).toBe(true);
    expect(optionStates({ ...base, enable_support: '1' }, ctx).hidden.has('max_bridge_length')).toBe(true);
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

  it('offers rectilinear when a sparse pattern can\'t fill 100%', () => {
    const withEnums: ToggleContext = {
      ...ctx,
      options: {
        ...ctx.options,
        top_surface_pattern: { type: 'enum', enumValues: ['monotonic', 'rectilinear', 'concentric'] },
        sparse_infill_pattern: { type: 'enum', enumValues: ['rectilinear', 'gyroid'], enumLabels: ['Rectilinear', 'Gyroid'] },
      },
    };
    const after = { ...base, sparse_infill_density: '100%' };
    const { prompts } = reviewChange(base, after, ['sparse_infill_density'], withEnums);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].message).toContain("Gyroid infill pattern doesn't support 100% density.");
    const [no, yes] = prompts[0].answers;
    expect(no.changes).toEqual({ sparse_infill_density: '15%' });
    expect(yes.changes).toEqual({ sparse_infill_pattern: 'rectilinear', sparse_infill_density: '100%' });
    // A pattern that can fill solid is left alone.
    const fine = { ...after, sparse_infill_pattern: 'rectilinear' };
    expect(reviewChange(base, fine, ['sparse_infill_density'], withEnums).prompts).toEqual([]);
  });

  describe('support filaments', () => {
    // Filament 1 PETG (the model), 2 PLA, 3 a support material.
    const fil: ToggleContext = { ...ctx, slots: 3, modelFilaments: [1], options: { ...ctx.options, filament_type: { type: 'strings' }, filament_is_support: { type: 'bools' } } };
    const cfg = {
      ...base,
      filament_type: '"PETG";"PLA";"PLA"',
      filament_is_support: '0,0,1',
      filament_soluble: '0,0,0',
      support_filament: '0',
      support_interface_filament: '0',
      support_top_z_distance: '0.2',
      support_interface_spacing: '0.5',
      support_interface_pattern: 'auto',
      support_interface_top_layers: '2',
      support_base_pattern: 'rectilinear',
      independent_support_layer_height: '1',
    };
    const snap: ToggleContext = { ...fil, flavor: 'snapmaker' };
    const orca: ToggleContext = { ...fil, flavor: 'orca' };

    it('Snapmaker: PLA under a PETG model offers the five settings that separate them', () => {
      const { prompts } = reviewChange(cfg, { ...cfg, support_interface_filament: '2' }, ['support_interface_filament'], snap);
      expect(prompts).toHaveLength(1);
      expect(prompts[0].message).toContain('Detected PLA as support interface material for PETG models.');
      expect(prompts[0].message).toContain('Top Z distance: 0.20 → 0 mm');
      expect(prompts[0].answers[1].changes).toEqual({
        support_top_z_distance: '0',
        support_base_pattern: 'default',
        support_interface_top_layers: '3',
        support_interface_pattern: 'rectilinear_interlaced',
        support_interface_spacing: '0',
      });
      expect(prompts[0].answers[0].changes).toEqual({});
    });

    it('Snapmaker: only asks for the settings not set that way yet', () => {
      const tuned = { ...cfg, support_top_z_distance: '0', support_base_pattern: 'default', support_interface_top_layers: '3', support_interface_spacing: '0' };
      const { prompts } = reviewChange(tuned, { ...tuned, support_interface_filament: '2' }, ['support_interface_filament'], snap);
      expect(prompts[0].answers[1].changes).toEqual({ support_interface_pattern: 'rectilinear_interlaced' });
      const done = { ...tuned, support_interface_pattern: 'rectilinear_interlaced' };
      expect(reviewChange(done, { ...done, support_interface_filament: '2' }, ['support_interface_filament'], snap).prompts).toEqual([]);
    });

    it('Snapmaker: a support material for the interface offers its four settings', () => {
      const { prompts } = reviewChange(cfg, { ...cfg, support_interface_filament: '3' }, ['support_interface_filament'], snap);
      expect(prompts[0].message).toContain('When using support material for the support interface');
      expect(prompts[0].answers[1].changes).toEqual({
        support_top_z_distance: '0',
        support_interface_spacing: '0',
        support_interface_pattern: 'rectilinear_interlaced',
        independent_support_layer_height: '0',
      });
    });

    it('Snapmaker: PLA as the support base under PETG asks, No puts Default back', () => {
      const { prompts } = reviewChange(cfg, { ...cfg, support_filament: '2' }, ['support_filament'], snap);
      expect(prompts[0].message).toContain('Non-soluble support materials are not recommended for support base.');
      expect(prompts[0].answers.map((a) => a.changes)).toEqual([{ support_filament: '0' }, {}]);
      // The model's own filament for the base: nothing to say.
      expect(reviewChange(cfg, { ...cfg, support_filament: '1' }, ['support_filament'], snap).prompts).toEqual([]);
    });

    it('Snapmaker: a PLA model with PLA support asks nothing', () => {
      const pla = { ...cfg, filament_type: '"PLA";"PLA";"PLA"' };
      expect(reviewChange(pla, { ...pla, support_interface_filament: '2' }, ['support_interface_filament'], snap).prompts).toEqual([]);
    });

    it('OrcaSlicer: its own question, the four settings, for PLA under PETG too', () => {
      const { prompts } = reviewChange(cfg, { ...cfg, support_interface_filament: '2' }, ['support_interface_filament'], orca);
      expect(prompts[0].message).toContain('When using support material for the support interface');
      expect(prompts[0].answers[1].changes).toEqual({
        support_top_z_distance: '0',
        support_interface_spacing: '0',
        support_interface_pattern: 'rectilinear_interlaced',
        independent_support_layer_height: '0',
      });
      const base2 = reviewChange(cfg, { ...cfg, support_filament: '2' }, ['support_filament'], orca).prompts;
      expect(base2[0].answers.map((a) => a.changes)).toEqual([{ support_filament: '0' }, {}]);
    });

    it('knows a plate printing PLA and PETG', () => {
      expect(usesPlaAndPetg(cfg, [1, 2])).toBe(true);
      expect(usesPlaAndPetg(cfg, [2, 3])).toBe(false);
      expect(usesPlaAndPetg({ filament_type: '"PETG"' }, [1, 2])).toBe(true);
    });

    it('object settings are not asked about, like desktop', () => {
      expect(reviewChange(cfg, { ...cfg, support_filament: '2' }, ['support_filament'], { ...snap, scope: 'object' }).prompts).toEqual([]);
    });
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
