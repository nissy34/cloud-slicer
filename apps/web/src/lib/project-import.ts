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
  // Prime tower spots are per plate; the page keeps them apart (lib/wipe-tower.ts).
  'wipe_tower_x', 'wipe_tower_y',
  // Desktop's post-processing scripts: a browser can't run them (lib/settings-pages.ts).
  'post_process',
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

/**
 * Printer and filament G-code: start, end, filament change, layer change,
 * pause, time-lapse...
 */
export const isGcodeKey = (key: string) => key.endsWith('_gcode');

/**
 * A project from another slicer (Bambu Studio, say) keeps its own G-code, as
 * desktop does, but that G-code is written for the other slicer's variables
 * (Bambu Studio 2.5's flush_volumetric_speeds), which an engine may not have.
 * Returns the project's G-code settings: when slicing can't fill one of them
 * in, the store puts back the printer's own (see `fallBackGcode`).
 */
export function gcodeOverrides(overrides: OrcaConfig): OrcaConfig {
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => isGcodeKey(key)));
}

/**
 * The overrides without the other slicer's G-code that is still as the file
 * had it (what the user changed since stays), and how many went.
 */
export function fallBackGcode(overrides: OrcaConfig, fromFile: OrcaConfig): { overrides: OrcaConfig; dropped: number } {
  const kept: OrcaConfig = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(overrides)) {
    if (key in fromFile && fromFile[key] === value) dropped++;
    else kept[key] = value;
  }
  return { overrides: kept, dropped };
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
 * The settings the project's author changed on purpose: Bambu Studio and Orca
 * save, in different_settings_to_system, the keys that differ from the system
 * presets the project came from (one entry for the process, one per filament,
 * one for the printer; the engine hands them over joined by ';', so they're
 * read together, and the caller keeps only process keys). A value the author
 * never touched is just the old printer's default, so a converted project takes
 * the new printer's default instead (Bambu's 0.2 mm first layer becomes the
 * U1's 0.25). The layer height always counts: the new process is picked by it.
 * Null when the file doesn't say (older or hand-made files).
 */
export function changedOnPurpose(file: OrcaConfig): Set<string> | null {
  const list = file.different_settings_to_system;
  if (list === undefined) return null;
  const keys = new Set(list.split(';').map((k) => k.trim().replace(/^"|"$/g, '')).filter(Boolean));
  keys.add('layer_height');
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

/**
 * Why a 3MF opened with no objects. A sliced export (".gcode.3mf") keeps only
 * the G-code of its plates, not the models, so it can't be re-sliced.
 */
export function emptyProjectMessage(fileName: string): string {
  return /\.gcode\.3mf$/i.test(fileName)
    ? `${fileName} is a sliced file: it holds G-code for another printer but no models. Open the original project (.3mf) instead.`
    : `${fileName} has no objects to print.`;
}
