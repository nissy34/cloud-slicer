// Turning a 3MF's own settings (project_settings.config) into overrides on top
// of the selected presets, like desktop Orca's "project presets" when it opens
// a project. When the project was made for a printer we don't have, it can be
// converted: only its print (process) settings are carried over to a printer we
// do have, and its filaments are matched by material.
import type { OrcaConfig, PresetSummary, SettingsLayout } from '../engine/protocol';
import { alignFlowVariants, type FlowDomain } from './flow-variants';

/**
 * Keys that describe presets or a specific machine rather than a setting the
 * user chose; never copied from a project.
 */
const NEVER = new Set([
  'inherits', 'name', 'from', 'version', 'different_settings_to_system',
  'print_settings_id', 'printer_settings_id', 'filament_settings_id',
  'compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition',
  'print_compatible_printers', 'printer_model', 'printer_variant', 'printer_technology', 'upward_compatible_machine',
  'default_print_profile', 'default_filament_profile', 'filament_ids', 'filament_vendor', 'is_custom_defined',
  'print_host', 'print_host_webui', 'printhost_apikey', 'printhost_cafile', 'host_type',
  // Prime tower position is per plate and per bed; Orca re-places it.
  'wipe_tower_x', 'wipe_tower_y',
  // Which flow variants the presets have values for; alignFlowVariants lays
  // the project's values out like the presets'.
  'process_flow_support', 'filament_flow_support', 'printer_flow_support', 'filament_flow_step_size',
]);

/**
 * Whether every plain number in `value` ("3", "0.2,0.2") is within the
 * option's range. Other slicers write values Orca doesn't accept, e.g. Bambu
 * Studio's wall_filament = 0 for "default", where Orca's minimum is 1.
 */
function inRange(value: string, def: { min?: number; max?: number }): boolean {
  return value.split(',').every((v) => {
    if (!/^\s*-?\d+(\.\d+)?\s*$/.test(v)) return true;
    const n = Number(v);
    return (def.min === undefined || n >= def.min) && (def.max === undefined || n <= def.max);
  });
}

/**
 * The project's values that differ from `base` (the selected presets), limited
 * to options the engine knows (and values in their range) and, when given, to
 * `only`.
 */
export function projectOverrides(
  file: OrcaConfig,
  base: OrcaConfig,
  known: Record<string, { min?: number; max?: number; flow?: FlowDomain }>,
  only?: Set<string>,
): OrcaConfig {
  const out: OrcaConfig = {};
  for (const [key, value] of Object.entries(alignFlowVariants(file, base, known))) {
    if (NEVER.has(key) || !(key in known) || (only && !only.has(key))) continue;
    if (base[key] !== value && inRange(value, known[key])) out[key] = value;
  }
  return out;
}

/** Every option on the process (print) tabs of the settings layout. */
export function processKeys(layout: SettingsLayout | null): Set<string> {
  const keys = new Set<string>();
  for (const page of layout?.print ?? []) for (const g of page.groups) for (const k of g.options) keys.add(k);
  return keys;
}

/**
 * Process settings that belong to the machine rather than the model: when a
 * project moves to another printer these come from that printer's own
 * profile. Speeds, acceleration and jerk follow its motion system; line
 * widths its nozzle; flow ratios and XY / elephant-foot compensation its
 * calibration; the prime tower and ooze prevention how it changes filament
 * (AMS vs tool changer); G-code output its firmware.
 */
const MACHINE_PAGES = new Set(['Speed']);
const MACHINE_GROUPS = new Set(['Line width', 'Prime tower', 'Ooze prevention', 'G-code output', 'Post-processing Scripts']);
const MACHINE_KEYS = new Set([
  'resolution', 'enable_arc_fitting', 'xy_hole_compensation', 'xy_contour_compensation',
  'elefant_foot_compensation', 'elefant_foot_compensation_layers',
  'print_flow_ratio', 'top_solid_infill_flow_ratio', 'bottom_solid_infill_flow_ratio',
  'small_area_infill_flow_compensation', 'small_area_infill_flow_compensation_model',
  'scarf_joint_speed', 'role_based_wipe_speed', 'wipe_speed', 'skirt_speed', 'timelapse_type',
  'skin_infill_line_width', 'skeleton_infill_line_width',
]);

/**
 * The process options a converted project keeps: what describes how the model
 * should print (layers, walls, infill, supports, seams, ironing, brim, ...),
 * without the machine's own settings.
 */
export function modelProcessKeys(layout: SettingsLayout | null): Set<string> {
  const keys = new Set<string>();
  for (const page of layout?.print ?? []) {
    if (MACHINE_PAGES.has(page.page)) continue;
    for (const g of page.groups) {
      if (MACHINE_GROUPS.has(g.title)) continue;
      for (const k of g.options) if (!MACHINE_KEYS.has(k)) keys.add(k);
    }
  }
  return keys;
}

/**
 * Process preset for a converted project: same layer height as the project,
 * preferring a "Standard" one, else `fallback` (the printer's default).
 */
export function pickProcess(processes: PresetSummary[], layerHeight: string | undefined, fallback: string): string {
  const h = Number(layerHeight);
  const same = processes.filter((p) => p.compatible !== false && Number(p.layerHeight) === h);
  return (same.find((p) => /standard/i.test(p.name)) ?? same[0])?.name ?? fallback;
}

/** Printer name for display: "Bambu Lab A1 mini 0.4 nozzle". */
export function printerLabel(file: OrcaConfig): string {
  return file.printer_settings_id || file.printer_model || 'another printer';
}
