// Which settings apply, and the checks desktop runs after a change: a port of
// desktop Orca's ConfigManipulation (toggle_print_fff_options,
// update_print_fff_config and the filament/printer checks) and the
// toggle_options of its filament and printer tabs.
//
// Desktop has two ways of switching a setting off: toggle_field greys it out
// (it still shows), toggle_line hides its row. Both are kept: `disabled` and
// `hidden` below. A later toggle of the same setting wins, like desktop.
import type { OrcaConfig } from '../engine/protocol';
import { isVectorType, processFlowModes, splitValues } from './flow-variants';
import { slotEntryIndex } from './slot-values';

export interface ToggleContext {
  /** The flow variant the settings show (standard / high flow). */
  flowVariant: number;
  /** The filament slot being edited, for filament settings. */
  slot?: number;
  /** Filament slots in the project. */
  slots: number;
  /** Global settings (process, printer, filament) or one object's own. */
  scope: 'global' | 'object';
  /** Option metadata, to find list options and flow-variant ones. */
  options: Record<string, { type?: string; flow?: 'process' | 'filament' } | undefined>;
  /** A Bambu Lab printer is selected (desktop hides some settings for them). */
  bambu?: boolean;
}

export interface OptionStates {
  /** Greyed out: shown but can't be changed (desktop's toggle_field). */
  disabled: Set<string>;
  /** Not shown at all (desktop's toggle_line). */
  hidden: Set<string>;
  /** Enum options whose list depends on another setting (support style follows support type). */
  enumValues: Record<string, string[]>;
}

/** Reads one config the way the settings show it: the entry for the flow variant or slot on screen. */
export function configReader(cfg: OrcaConfig, ctx: ToggleContext) {
  const index = (k: string): number => {
    const v = cfg[k] ?? '';
    const n = splitValues(v).length;
    if (n < 2) return 0;
    if (ctx.options[k]?.flow === 'process') return Math.min(ctx.flowVariant, processFlowModes(cfg).length - 1, n - 1);
    if (ctx.slot !== undefined) return slotEntryIndex(v, ctx.slot, ctx.slots, cfg, ctx.options[k]?.flow === 'filament', ctx.flowVariant) ?? 0;
    return 0;
  };
  const str = (k: string): string => {
    const v = cfg[k];
    if (v === undefined) return '';
    // Text options hold commas of their own; only lists (numbers, switches, choices) split.
    const type = ctx.options[k]?.type;
    if (type ? !isVectorType(type) : !/^[-\d.%,e+nil ]*$/i.test(v)) return v;
    return splitValues(v)[index(k)] ?? '';
  };
  const num = (k: string): number => {
    const n = parseFloat(str(k));
    return Number.isFinite(n) ? n : 0;
  };
  const bool = (k: string) => str(k) === '1' || str(k) === 'true';
  /** A float-or-percent value in mm, with percents of `of`. */
  const abs = (k: string, of: number) => (str(k).trim().endsWith('%') ? (num(k) * of) / 100 : num(k));
  return { has: (k: string) => k in cfg, str, num, bool, abs, index };
}

const isTree = (supportType: string) => supportType.startsWith('tree');
const isAuto = (supportType: string) => supportType.endsWith('(auto)');
const NORMAL_STYLES = ['default', 'grid', 'snug'];
const TREE_STYLES = ['default', 'tree_slim', 'tree_strong', 'tree_hybrid', 'organic'];
const MULTILINE_PATTERNS = new Set([
  'gyroid', 'grid', 'rectilinear', 'tpmsd', 'tpmsfk', 'crosshatch', 'honeycomb', 'lateral-lattice', 'lateral-honeycomb',
  'cubic', 'tri-hexagon', 'alignedrectilinear', 'lightning', '3dhoneycomb', 'adaptivecubic', 'supportcubic',
]);
// Bed type numbers in default_bed_type (desktop's BedType enum).
const BED_TYPES = ['', 'Cool Plate', 'Engineering Plate', 'High Temp Plate', 'Textured PEI Plate', 'Textured Cool Plate', 'Graphic Effect Plate', 'Supertack Plate'];
const PLATE_TEMPS: [string, string][] = [
  ['Supertack Plate', 'supertack_plate_temp'],
  ['Cool Plate', 'cool_plate_temp'],
  ['Textured Cool Plate', 'textured_cool_plate_temp'],
  ['Engineering Plate', 'eng_plate_temp'],
  ['High Temp Plate', 'hot_plate_temp'],
  ['Textured PEI Plate', 'textured_plate_temp'],
  ['Graphic Effect Plate', 'graphic_effect_plate_temp'],
];

export function isSnapmakerU1(cfg: OrcaConfig): boolean {
  const model = cfg.printer_model ?? '';
  return /snapmaker u1/i.test(cfg.printer_settings_id ?? '') || (/snapmaker/i.test(model) && /u1/i.test(model));
}

/** Which settings are greyed out or hidden for this config, like desktop's settings tabs. */
export function optionStates(cfg: OrcaConfig, ctx: ToggleContext): OptionStates {
  const c = configReader(cfg, ctx);
  const field = new Map<string, boolean>();
  const line = new Map<string, boolean>();
  const toggleField = (k: string | string[], on: boolean) => [k].flat().forEach((key) => field.set(key, on));
  const toggleLine = (k: string | string[], on: boolean) => [k].flat().forEach((key) => line.set(key, on));
  const global = ctx.scope === 'global';

  const gcflavor = c.str('gcode_flavor');
  const bSEMM = c.bool('single_extruder_multi_material');
  const isBBL = ctx.bambu ?? false;

  // ---- Process (ConfigManipulation::toggle_print_fff_options) ----
  const haveSlope = c.num('max_volumetric_extrusion_rate_slope') > 0;
  toggleField('enable_arc_fitting', !haveSlope);
  toggleLine(['max_volumetric_extrusion_rate_slope_segment_length', 'extrusion_rate_smoothing_external_perimeter_only'], haveSlope);

  const havePerimeters = c.num('wall_loops') > 0;
  toggleField(
    ['extra_perimeters_on_overhangs', 'ensure_vertical_shell_thickness', 'detect_thin_wall', 'detect_overhang_wall', 'seam_position',
      'staggered_inner_seams', 'wall_sequence', 'outer_wall_line_width', 'inner_wall_speed', 'outer_wall_speed', 'small_perimeter_speed',
      'small_perimeter_threshold'],
    havePerimeters,
  );

  const haveInfill = c.num('sparse_infill_density') > 0;
  toggleLine(
    ['sparse_infill_pattern', 'infill_combination', 'minimum_sparse_infill_area', 'infill_anchor_max', 'infill_shift_step',
      'sparse_infill_rotate_template', 'symmetric_infill_y_axis'],
    haveInfill,
  );
  toggleLine('infill_combination_max_layer_height', c.bool('infill_combination') && haveInfill);

  const pattern = c.str('sparse_infill_pattern');
  toggleLine('fill_multiline', MULTILINE_PATTERNS.has(pattern));
  const infillAnchor = pattern !== 'line';
  toggleField('infill_anchor_max', infillAnchor);
  toggleField('infill_anchor', haveInfill && c.num('infill_anchor_max') > 0 && infillAnchor);
  const crossZag = pattern === 'crosszag';
  const lockedZag = pattern === 'lockedzag';
  toggleLine('infill_shift_step', crossZag || lockedZag);
  toggleLine(['skeleton_infill_density', 'skin_infill_density', 'infill_lock_depth', 'skin_infill_depth', 'skin_infill_line_width', 'skeleton_infill_line_width'], lockedZag);
  toggleLine('symmetric_infill_y_axis', pattern === 'zigzag' || crossZag || lockedZag);

  const spiral = c.bool('spiral_mode');
  toggleLine(['spiral_mode_smooth', 'spiral_starting_flow_ratio', 'spiral_finishing_flow_ratio'], spiral);
  toggleLine('spiral_mode_max_xy_smoothing', spiral && c.bool('spiral_mode_smooth'));
  const hasTopShell = c.num('top_shell_layers') > 0 || (spiral && c.num('bottom_shell_layers') > 1);
  const hasBottomShell = c.num('bottom_shell_layers') > 0;
  const hasSolidInfill = hasTopShell || hasBottomShell;
  toggleField(['top_surface_pattern', 'top_surface_density'], hasTopShell);
  toggleField(['bottom_surface_pattern', 'bottom_surface_density'], hasBottomShell);
  toggleField(
    ['infill_direction', 'sparse_infill_line_width', 'fill_multiline', 'gap_fill_target', 'filter_out_gap_fill', 'infill_wall_overlap',
      'sparse_infill_speed', 'bridge_speed', 'internal_bridge_speed', 'bridge_angle', 'internal_bridge_angle', 'solid_infill_direction',
      'solid_infill_rotate_template', 'internal_solid_infill_pattern', 'solid_infill_filament'],
    haveInfill || hasSolidInfill,
  );
  toggleField('top_shell_thickness', !spiral && hasTopShell);
  toggleField('bottom_shell_thickness', !spiral && hasBottomShell);
  toggleField('wall_direction', !spiral);
  toggleField('gap_infill_speed', havePerimeters);
  toggleField(['top_surface_line_width', 'top_surface_speed'], hasTopShell);

  toggleField(
    ['outer_wall_acceleration', 'inner_wall_acceleration', 'initial_layer_acceleration', 'top_surface_acceleration', 'travel_acceleration',
      'bridge_acceleration', 'sparse_infill_acceleration', 'internal_solid_infill_acceleration'],
    c.num('default_acceleration') > 0,
  );
  toggleField(['outer_wall_jerk', 'inner_wall_jerk', 'initial_layer_jerk', 'top_surface_jerk', 'travel_jerk', 'infill_jerk'], c.num('default_jerk') > 0);
  toggleLine('default_junction_deviation', gcflavor === 'marlin2');

  const haveSkirt = c.num('skirt_loops') > 0;
  const draftShield = c.str('draft_shield') === 'enabled';
  toggleField('skirt_height', haveSkirt && !draftShield);
  toggleLine('single_loop_draft_shield', haveSkirt);
  toggleField(['skirt_type', 'min_skirt_length', 'skirt_distance', 'skirt_start_angle', 'skirt_speed', 'draft_shield'], haveSkirt);

  const brimType = c.str('brim_type');
  const haveBrim = brimType !== 'no_brim';
  toggleField('brim_object_gap', haveBrim);
  toggleField('brim_width', haveBrim && brimType !== 'auto_brim' && brimType !== 'painted');
  toggleField('wall_filament', havePerimeters || haveBrim);
  toggleField(['brim_ears_max_angle', 'brim_ears_detection_length'], c.num('brim_width') > 0);
  toggleLine(['brim_ears_max_angle', 'brim_ears_detection_length'], brimType === 'brim_ears');
  toggleLine('elefant_foot_compensation_layers', c.num('elefant_foot_compensation') > 0);

  const haveRaft = c.num('raft_layers') > 0;
  const haveSupport = c.bool('enable_support') || haveRaft;
  const supportType = c.str('support_type');
  const haveInterface = c.num('support_interface_top_layers') > 0 || c.num('support_interface_bottom_layers') > 0;
  const haveSoluble = haveSupport && c.num('support_top_z_distance') === 0;
  const supportStyle = c.str('support_style');
  toggleField(
    ['support_style', 'support_base_pattern', 'support_base_pattern_spacing', 'support_expansion', 'support_angle', 'support_interface_pattern',
      'support_interface_top_layers', 'support_interface_bottom_layers', 'bridge_no_support', 'max_bridge_length', 'support_top_z_distance',
      'support_bottom_z_distance', 'support_type', 'support_on_build_plate_only', 'support_critical_regions_only', 'support_interface_not_for_body',
      'support_object_xy_distance', 'support_object_first_layer_gap'],
    haveSupport,
  );
  toggleField('support_threshold_angle', haveSupport && isAuto(supportType));
  toggleField('support_threshold_overlap', c.num('support_threshold_angle') === 0 && haveSupport && isAuto(supportType));
  const supportIsTree = c.bool('enable_support') && isTree(supportType);
  // Orca treats "default" as organic.
  const normalTree = supportIsTree && supportStyle !== 'organic' && supportStyle !== 'default';
  const organic = supportIsTree && !normalTree;
  toggleLine(['tree_support_branch_angle', 'tree_support_branch_distance', 'tree_support_branch_diameter'], normalTree);
  toggleLine(['tree_support_auto_brim', 'tree_support_brim_width', 'tree_support_adaptive_layer_height'], normalTree);
  toggleLine(
    ['tree_support_branch_angle_organic', 'tree_support_branch_distance_organic', 'tree_support_branch_diameter_organic', 'tree_support_angle_slow',
      'tree_support_tip_diameter', 'tree_support_top_rate', 'tree_support_branch_diameter_angle'],
    organic,
  );
  toggleField('tree_support_brim_width', supportIsTree && !c.bool('tree_support_auto_brim'));
  toggleLine('max_bridge_length', normalTree);
  toggleLine('bridge_no_support', !normalTree);
  toggleLine('support_critical_regions_only', isAuto(supportType) && supportIsTree);
  toggleField(['support_interface_filament', 'support_interface_loop_pattern', 'support_bottom_interface_spacing'], haveSupport && haveInterface);

  const canIronSupport = haveRaft || (haveSupport && c.num('support_interface_top_layers') > 0);
  toggleField('support_ironing', canIronSupport);
  const supportIroning = canIronSupport && c.bool('support_ironing');
  toggleLine(['support_ironing_pattern', 'support_ironing_flow', 'support_ironing_spacing'], supportIroning);
  toggleField('support_interface_spacing', haveSupport && haveInterface && !supportIroning);
  const haveSkirtHeight = haveSkirt && (c.num('skirt_height') > 1 || !draftShield);
  toggleLine('support_speed', haveSupport || haveSkirtHeight);
  toggleLine('support_interface_speed', haveSupport && haveInterface);
  toggleField('inner_wall_line_width', havePerimeters || haveSkirt || haveBrim);
  toggleField('support_filament', haveSupport || haveSkirt);
  toggleLine('raft_contact_distance', haveRaft && !haveSoluble);
  toggleField(['raft_first_layer_expansion', 'raft_first_layer_density'], haveSupport && !(normalTree && !haveRaft));

  const ironing = c.str('ironing_type') !== 'no ironing';
  toggleLine(['ironing_pattern', 'ironing_flow', 'ironing_spacing', 'ironing_angle', 'ironing_inset'], ironing);
  toggleLine('ironing_speed', ironing || supportIroning);

  toggleField('print_order', c.str('print_sequence') !== 'by object');
  toggleField('single_extruder_multi_material', !isBBL);
  toggleField('ooze_prevention', !bSEMM);
  const ooze = c.bool('ooze_prevention');
  toggleLine(['standby_temperature_delta', 'preheat_time'], ooze);
  toggleLine('preheat_steps', ooze && c.num('preheat_steps') > 0);

  const primeTower = c.bool('enable_prime_tower');
  toggleLine(['prime_tower_width', 'prime_tower_brim_width'], primeTower);
  toggleLine(['wall_filament', 'sparse_infill_filament', 'solid_infill_filament', 'wipe_tower_filament'], !bSEMM);
  toggleLine(
    ['wipe_tower_cone_angle', 'wipe_tower_extra_spacing', 'wipe_tower_max_purge_speed', 'wipe_tower_wall_type', 'wipe_tower_extra_rib_length',
      'wipe_tower_rib_width', 'wipe_tower_fillet_wall', 'wipe_tower_bridging', 'wipe_tower_extra_flow', 'wipe_tower_no_sparse_layers'],
    primeTower && !isBBL,
  );
  const localZ = c.bool('dithering_local_z_mode');
  toggleLine(['dithering_local_z_whole_objects', 'dithering_local_z_infill', 'dithering_local_z_direct_multicolor'], localZ);
  const wallType = c.str('wipe_tower_wall_type');
  toggleLine('wipe_tower_cone_angle', primeTower && !isBBL && wallType === 'cone');
  toggleLine(['wipe_tower_extra_rib_length', 'wipe_tower_rib_width', 'wipe_tower_fillet_wall'], primeTower && !isBBL && wallType === 'rib');
  toggleField('prime_tower_width', primeTower && wallType !== 'rib');
  toggleLine('single_extruder_multi_material_priming', !bSEMM && primeTower && !isBBL);
  toggleLine('prime_volume', primeTower && (!c.bool('purge_in_prime_tower') || !bSEMM));
  toggleField(['flush_into_infill', 'flush_into_support', 'flush_into_objects'], primeTower);

  toggleLine('max_travel_detour_distance', c.bool('reduce_crossing_wall'));
  const overhangSpeed = c.bool('enable_overhang_speed');
  toggleLine(['overhang_1_4_speed', 'overhang_2_4_speed', 'overhang_3_4_speed', 'overhang_4_4_speed', 'slowdown_for_curled_perimeters'], overhangSpeed);
  toggleLine('flush_into_objects', !global);
  toggleLine('support_interface_not_for_body', c.num('support_interface_filament') > 0 && c.num('support_filament') === 0);

  const noise = c.str('fuzzy_skin_noise_type');
  toggleLine('fuzzy_skin_scale', noise !== 'classic');
  toggleLine('fuzzy_skin_octaves', noise !== 'classic' && noise !== 'voronoi');
  toggleLine('fuzzy_skin_persistence', noise === 'perlin' || noise === 'billow');

  const arachne = c.str('wall_generator') === 'arachne';
  toggleLine(
    ['wall_transition_length', 'wall_transition_filter_deviation', 'wall_transition_angle', 'min_feature_size', 'min_length_factor',
      'min_bead_width', 'wall_distribution_count', 'initial_layer_min_bead_width'],
    arachne,
  );
  toggleField('detect_thin_wall', !arachne);
  toggleField('wipe_speed', !c.bool('role_based_wipe_speed'));
  toggleLine(['accel_to_decel_enable', 'accel_to_decel_factor'], gcflavor === 'klipper');
  if (gcflavor === 'klipper') toggleField('accel_to_decel_factor', c.bool('accel_to_decel_enable'));
  const printableOverhang = c.bool('make_overhang_printable');
  toggleLine(['make_overhang_printable_angle', 'make_overhang_printable_hole_size'], printableOverhang);
  toggleLine('min_width_top_surface', c.bool('only_one_wall_top') || (c.num('min_length_factor') > 0.5 && arachne));
  toggleLine(['hole_to_polyhole_threshold', 'hole_to_polyhole_twisted'], c.bool('hole_to_polyhole'));

  const allowOverhangReverse = !spiral && c.str('wall_direction') === 'auto';
  const overhangReverse = c.bool('overhang_reverse');
  toggleLine('overhang_reverse', allowOverhangReverse);
  toggleLine('overhang_reverse_internal_only', allowOverhangReverse && overhangReverse);
  toggleLine('overhang_reverse_threshold', c.bool('detect_overhang_wall') && allowOverhangReverse && overhangReverse && !c.bool('overhang_reverse_internal_only'));
  toggleLine('timelapse_type', isBBL);
  toggleLine('small_area_infill_flow_compensation_model', c.bool('small_area_infill_flow_compensation'));

  toggleField('seam_slope_type', !spiral);
  const seamSlope = !spiral && c.str('seam_slope_type') !== 'none';
  toggleLine(
    ['seam_slope_conditional', 'seam_slope_start_height', 'seam_slope_entire_loop', 'seam_slope_min_length', 'seam_slope_steps',
      'seam_slope_inner_walls', 'scarf_joint_speed', 'scarf_joint_flow_ratio'],
    seamSlope,
  );
  toggleField('seam_slope_min_length', !c.bool('seam_slope_entire_loop'));
  toggleLine(['scarf_angle_threshold', 'scarf_overhang_threshold'], seamSlope && c.bool('seam_slope_conditional'));

  const beam = c.bool('interlocking_beam');
  toggleLine('mmu_segmented_region_interlocking_depth', !beam);
  toggleLine(['interlocking_beam_width', 'interlocking_orientation', 'interlocking_beam_layer_count', 'interlocking_depth', 'interlocking_boundary_avoidance'], beam);
  toggleLine(['lateral_lattice_angle_1', 'lateral_lattice_angle_2'], pattern === 'lateral-lattice');
  toggleField('infill_direction', c.str('sparse_infill_rotate_template') === '');
  toggleField('solid_infill_direction', c.str('solid_infill_rotate_template') === '');
  toggleLine('infill_overhang_angle', pattern === 'lateral-honeycomb');

  // ---- Filament (TabFilament::toggle_options) ----
  toggleField(['overhang_fan_speed', 'overhang_fan_threshold', 'internal_bridge_fan_speed'], c.bool('enable_overhang_bridge_fan'));
  toggleField('additional_cooling_fan_speed', c.bool('auxiliary_fan'));
  toggleField('dont_slow_down_outer_wall', c.bool('slow_down_for_layer_cooling'));
  toggleField('pressure_advance', c.bool('enable_pressure_advance'));
  const u1 = isSnapmakerU1(cfg);
  const multiBed = isBBL || c.bool('support_multi_bed_types');
  const defaultBed = BED_TYPES[parseInt(cfg.default_bed_type ?? '', 10)] || (u1 ? 'Textured PEI Plate' : 'High Temp Plate');
  for (const [bed, key] of PLATE_TEMPS) {
    let on: boolean;
    if (u1 && !multiBed) on = bed === 'High Temp Plate' || bed === 'Textured PEI Plate' || bed === 'Graphic Effect Plate';
    else if (multiBed) on = bed !== 'Graphic Effect Plate' || u1;
    else on = bed === defaultBed;
    toggleLine([key, `${key}_initial_layer`], on);
  }
  const pellet = c.bool('pellet_modded_printer');
  toggleLine('pellet_flow_coefficient', pellet);
  toggleLine('filament_diameter', !pellet);
  toggleLine('chamber_temperatures', c.bool('support_chamber_temp_control'));
  const ramming = c.bool('filament_multitool_ramming');
  toggleField(['filament_multitool_ramming_volume', 'filament_multitool_ramming_flow'], ramming);

  // ---- Printer (TabPrinter::toggle_options) ----
  toggleLine(['scan_first_layer', 'bbl_calib_mark_logo', 'bbl_use_printhost'], isBBL);
  toggleLine('parallel_printheads_count', c.bool('support_parallel_printheads'));
  toggleField('extruders_count', !bSEMM);
  toggleField('manual_filament_change', bSEMM);
  toggleField('purge_in_prime_tower', bSEMM && !isBBL);
  const firmwareRetraction = c.bool('use_firmware_retraction');
  const retraction = c.num('retraction_length') > 0 || firmwareRetraction;
  toggleField('retraction_minimum_travel', retraction);
  toggleField(['z_hop', 'retract_when_changing_layer'], retraction);
  toggleField(['retract_lift_above', 'retract_lift_below', 'retract_lift_enforce'], retraction && c.num('z_hop') > 0);
  toggleField(['retraction_speed', 'deretraction_speed', 'retract_before_wipe', 'retract_restart_extra', 'wipe', 'wipe_distance'], retraction && !firmwareRetraction);
  const wipe = retraction && c.bool('wipe');
  toggleField(['retract_before_wipe', 'wipe_distance'], wipe);
  toggleField('retract_restart_extra_toolchange', c.num('retract_length_toolchange') > 0);
  toggleField('long_retractions_when_cut', !firmwareRetraction && c.num('enable_long_retraction_when_cut') > 0);
  toggleLine('retraction_distances_when_cut', c.bool('long_retractions_when_cut'));
  toggleField('travel_slope', c.str('z_hop_types') !== 'Normal Lift');
  toggleLine('machine_max_acceleration_travel', gcflavor !== 'marlin' && gcflavor !== 'klipper');
  toggleLine('machine_max_junction_deviation', gcflavor === 'marlin2');
  toggleField(['min_resonance_avoidance_speed', 'max_resonance_avoidance_speed'], c.bool('resonance_avoidance'));

  const disabled = new Set([...field].filter(([, on]) => !on).map(([k]) => k));
  const hidden = new Set([...line].filter(([, on]) => !on).map(([k]) => k));
  return { disabled, hidden, enumValues: { support_style: isTree(supportType) ? TREE_STYLES : NORMAL_STYLES } };
}

/** One of desktop's "this combination doesn't work" messages, with its answers. */
export interface SettingsPrompt {
  message: string;
  /** Each answer and the settings it changes; one answer means just OK. */
  answers: { label: string; changes: OrcaConfig }[];
}

export interface ChangeReview {
  /** Settings changed by themselves after the edit, like desktop does without asking. */
  changes: OrcaConfig;
  /** Messages to show, in order, each with its answers. */
  prompts: SettingsPrompt[];
}

const SPIRAL_KEYS = ['spiral_mode', 'wall_loops', 'top_shell_layers', 'sparse_infill_density', 'enable_support', 'enforce_support_layers', 'detect_thin_wall', 'overhang_reverse', 'wall_direction', 'timelapse_type'];
const RESET_SMALL_TUNING = 'This setting is only for fine tuning a model\'s size by a small amount, for example when a model is slightly off and hard to assemble. For large changes use the model\'s scale.\n\nThe value will be reset to 0.';

/**
 * The checks desktop runs after a setting changes (update_print_fff_config and
 * the filament and printer tabs' checks), for the settings `changed` touched.
 * `before` and `after` are the whole config before and after the edit.
 */
export function reviewChange(before: OrcaConfig, after: OrcaConfig, changed: string[], ctx: ToggleContext): ChangeReview {
  const c = configReader(after, ctx);
  const was = configReader(before, ctx);
  const touched = (...keys: string[]) => keys.some((k) => changed.includes(k));
  const global = ctx.scope === 'global';
  const changes: OrcaConfig = {};
  const prompts: SettingsPrompt[] = [];
  // A new value for the entry on screen (flow variant or slot), the rest kept.
  const entry = (k: string, v: string): string => {
    const all = splitValues(after[k] ?? '');
    if (all.length < 2) return v;
    const i = c.index(k);
    return all.map((e, j) => (j === i ? v : e)).join(',');
  };
  const reset = (message: string, k: string, v: string) => prompts.push({ message, answers: [{ label: 'OK', changes: { [k]: entry(k, v) } }] });
  const warn = (message: string) => prompts.push({ message, answers: [{ label: 'OK', changes: {} }] });
  const yesNo = (message: string, yes: OrcaConfig, no: OrcaConfig, yesLabel = 'Yes', noLabel = 'No') =>
    prompts.push({ message, answers: [{ label: noLabel, changes: no }, { label: yesLabel, changes: yes }] });

  // ---- Process (update_print_fff_config) ----
  const layerHeight = c.num('layer_height');
  if (c.has('layer_height') && touched('layer_height')) {
    const maxLh = c.num('max_layer_height');
    if (layerHeight < 1e-6) reset('Too small layer height.\nReset to 0.2.', 'layer_height', '0.2');
    else if (maxLh > 0.2 && layerHeight > maxLh + 1e-6) reset(`Too large layer height.\nReset to ${maxLh.toFixed(3)}.`, 'layer_height', String(maxLh));
  }
  for (const k of ['ironing_spacing', 'support_ironing_spacing'])
    if (c.has(k) && touched(k) && c.num(k) < 0.05) reset('Too small ironing spacing.\nReset to 0.1.', k, '0.1');
  if (c.has('initial_layer_print_height') && touched('initial_layer_print_height') && c.num('initial_layer_print_height') < 1e-6)
    reset('Zero initial layer height is invalid.\n\nThe first layer height will be reset to 0.2.', 'initial_layer_print_height', '0.2');
  for (const k of ['xy_hole_compensation', 'xy_contour_compensation'])
    if (c.has(k) && touched(k) && Math.abs(c.num(k)) > 2) reset(RESET_SMALL_TUNING, k, '0');
  if (c.has('elefant_foot_compensation') && touched('elefant_foot_compensation') && c.num('elefant_foot_compensation') > 1)
    reset(
      'Too large elephant foot compensation is unreasonable.\nIf the first layers really spread a lot, check other settings, for example whether the bed temperature is too high.\n\nThe value will be reset to 0.',
      'elefant_foot_compensation',
      '0',
    );

  if (
    c.bool('spiral_mode') &&
    touched(...SPIRAL_KEYS) &&
    !(
      c.num('wall_loops') === 1 &&
      c.num('top_shell_layers') === 0 &&
      c.num('sparse_infill_density') === 0 &&
      !c.bool('enable_support') &&
      c.num('enforce_support_layers') === 0 &&
      !c.bool('detect_thin_wall') &&
      !c.bool('overhang_reverse') &&
      (c.str('wall_direction') || 'auto') === 'auto' &&
      (c.str('timelapse_type') || '0') === '0'
    )
  ) {
    const fix: OrcaConfig = {
      wall_loops: '1',
      top_shell_layers: '0',
      sparse_infill_density: '0%',
      enable_support: '0',
      enforce_support_layers: '0',
      detect_thin_wall: '0',
      overhang_reverse: '0',
      wall_direction: 'auto',
      timelapse_type: '0',
    };
    for (const k of Object.keys(fix)) if (!c.has(k)) delete fix[k];
    const message = 'Spiral vase only works when wall loops is 1, support is off, top shell layers is 0, sparse infill density is 0 and timelapse type is traditional.';
    if (global) yesNo(`${message}\n\nChange these settings automatically?`, fix, { spiral_mode: '0' }, 'Change them', 'Turn spiral vase off');
    else prompts.push({ message, answers: [{ label: 'OK', changes: fix }] });
  }

  if (touched('alternate_extra_wall', 'ensure_vertical_shell_thickness') && c.bool('alternate_extra_wall') && c.str('ensure_vertical_shell_thickness') === 'ensure_all') {
    const message = "Alternate extra wall doesn't work well when ensure vertical shell thickness is set to All.";
    const yes = { ensure_vertical_shell_thickness: 'ensure_moderate', alternate_extra_wall: '1' };
    if (global)
      yesNo(`${message}\n\nChange these settings automatically?`, yes, { ensure_vertical_shell_thickness: 'ensure_all', alternate_extra_wall: '0' }, 'Use Moderate', "Don't use alternate extra wall");
    else prompts.push({ message, answers: [{ label: 'OK', changes: yes }] });
  }

  // Turning support on turns on overhang wall detection, without asking.
  if (global && touched('enable_support') && c.bool('enable_support') && !was.bool('enable_support') && c.has('detect_overhang_wall') && !c.bool('detect_overhang_wall'))
    changes.detect_overhang_wall = '1';
  if (touched('enable_support', 'support_type', 'support_style') && c.bool('enable_support') && c.has('support_style')) {
    const styles = isTree(c.str('support_type')) ? TREE_STYLES : NORMAL_STYLES;
    if (!styles.includes(c.str('support_style'))) changes.support_style = 'default';
  }
  for (const k of ['support_filament', 'support_interface_filament'])
    if (c.has(k) && touched(k) && c.num(k) > ctx.slots) changes[k] = '0';

  if (touched('seam_slope_type', 'seam_slope_start_height', 'layer_height') && c.has('seam_slope_type') && c.str('seam_slope_type') !== 'none' && c.abs('seam_slope_start_height', layerHeight) >= layerHeight)
    reset('The scarf start height needs to be smaller than the layer height.\nReset to 0.', 'seam_slope_start_height', '0');
  if (touched('infill_lock_depth', 'skin_infill_depth') && c.has('infill_lock_depth') && c.num('infill_lock_depth') > c.num('skin_infill_depth'))
    reset('Lock depth should be smaller than skin depth.\nReset to 50% of skin depth.', 'infill_lock_depth', String(c.num('skin_infill_depth') / 2));

  if (touched('fuzzy_skin_mode', 'wall_generator') && c.has('fuzzy_skin_mode') && c.str('fuzzy_skin_mode') !== 'displacement' && c.str('wall_generator') !== 'arachne')
    yesNo(
      'Both the Extrusion and Combined fuzzy skin modes need the Arachne wall generator.\n\nChange these settings automatically?',
      { wall_generator: 'arachne' },
      { fuzzy_skin_mode: 'displacement' },
      'Use Arachne',
      'Use Displacement',
    );

  // Fixes toggle_print_fff_options makes while greying settings out.
  if (touched('max_volumetric_extrusion_rate_slope') && c.num('max_volumetric_extrusion_rate_slope') > 0 && c.bool('enable_arc_fitting')) changes.enable_arc_fitting = '0';
  if (touched('max_volumetric_extrusion_rate_slope_segment_length') && c.has('max_volumetric_extrusion_rate_slope_segment_length')) {
    const all = splitValues(after.max_volumetric_extrusion_rate_slope_segment_length);
    if (all.some((v) => parseFloat(v) < 0.5)) changes.max_volumetric_extrusion_rate_slope_segment_length = all.map((v) => (parseFloat(v) < 0.5 ? '1' : v)).join(',');
  }
  if (touched('sparse_infill_pattern', 'fill_multiline') && c.has('fill_multiline') && !MULTILINE_PATTERNS.has(c.str('sparse_infill_pattern')) && c.num('fill_multiline') !== 1)
    changes.fill_multiline = '1';
  if (touched('overhang_reverse_internal_only') && c.bool('overhang_reverse_internal_only') && c.has('overhang_reverse_threshold') && c.num('overhang_reverse_threshold') !== 0)
    changes.overhang_reverse_threshold = '0%';

  // ---- Filament (TabFilament::update) ----
  const low = c.num('nozzle_temperature_range_low');
  const high = c.num('nozzle_temperature_range_high');
  const hasRange = c.has('nozzle_temperature_range_low') && c.has('nozzle_temperature_range_high');
  if (hasRange && touched('nozzle_temperature_range_low', 'nozzle_temperature_range_high')) {
    let msg = '';
    if (low < 190 || high > 300) msg += 'The recommended minimum temperature is less than 190°C or the recommended maximum temperature is greater than 300°C.\n';
    if (low > high) msg += 'The recommended minimum temperature cannot be higher than the recommended maximum temperature.\n';
    if (msg) warn(`${msg}Please check.`);
  }
  for (const k of ['nozzle_temperature', 'nozzle_temperature_initial_layer'])
    if (hasRange && c.has(k) && touched(k) && (c.num(k) < low || c.num(k) > high))
      warn(
        `The nozzle may clog when the temperature is outside the recommended range.\nMake sure you want to print at this temperature.\n\nThe recommended nozzle temperature for this filament type is ${low} to ${high}°C.`,
      );
  if (touched('filament_max_volumetric_speed') && c.has('filament_max_volumetric_speed')) {
    const all = splitValues(after.filament_max_volumetric_speed);
    if (all.some((v) => parseFloat(v) < 0.5))
      prompts.push({ message: 'Too small max volumetric speed.\nReset to 0.5.', answers: [{ label: 'OK', changes: { filament_max_volumetric_speed: all.map((v) => (parseFloat(v) < 0.5 ? '0.5' : v)).join(',') } }] });
  }
  if (touched('chamber_temperatures', 'filament_type') && c.bool('support_chamber_temp_control') && c.has('chamber_temperatures')) {
    const safe: Record<string, number> = { PLA: 45, 'PLA-CF': 45, PVA: 45, TPU: 50, PETG: 55, PCTG: 55, 'PETG-CF': 55 };
    const type = (after.filament_type ?? '').split(';')[ctx.slot ?? 0]?.replace(/"/g, '') ?? '';
    if (safe[type] !== undefined && safe[type] < c.num('chamber_temperatures'))
      warn(`The chamber temperature is higher than this material's safe temperature, which may soften the filament and clog the nozzle. The highest safe temperature for this material is ${safe[type]}°C.`);
  }

  // ---- Printer (TabPrinter::toggle_options) ----
  if (touched('single_extruder_multi_material', 'manual_filament_change') && !c.bool('single_extruder_multi_material') && c.bool('manual_filament_change'))
    changes.manual_filament_change = '0';
  if (touched('use_firmware_retraction', 'wipe', 'retraction_length') && c.bool('use_firmware_retraction') && c.bool('wipe')) {
    const wipeOff = splitValues(after.wipe ?? '0').map(() => '0').join(',');
    yesNo(
      'The Wipe option is not available when using firmware retraction.\n\nTurn Wipe off to use firmware retraction?',
      { wipe: wipeOff },
      { use_firmware_retraction: '0' },
      'Turn Wipe off',
      'Keep Wipe',
    );
  }
  return { changes, prompts };
}
