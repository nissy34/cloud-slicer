// Turning a 3MF's own settings (project_settings.config) into overrides on top
// of the selected presets, like desktop Orca's "project presets" when it opens
// a project. When the project was made for a printer we don't have, it can be
// converted: only its print (process) settings are carried over to a printer we
// do have, and its filaments are matched by material.
import type { OrcaConfig, PresetSummary, SettingsLayout } from '../engine/protocol';

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
]);

/**
 * The project's values that differ from `base` (the selected presets), limited
 * to options the engine knows and, when given, to `only`.
 */
export function projectOverrides(
  file: OrcaConfig,
  base: OrcaConfig,
  known: Record<string, unknown>,
  only?: Set<string>,
): OrcaConfig {
  const out: OrcaConfig = {};
  for (const [key, value] of Object.entries(file)) {
    if (NEVER.has(key) || !(key in known) || (only && !only.has(key))) continue;
    if (base[key] !== value) out[key] = value;
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
