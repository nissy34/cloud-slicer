// Turning the current settings into an Orca user preset: a diff over the
// system preset it inherits, the way desktop Orca's "Save preset" does.
import type { OptionDef, OrcaConfig, PresetSummary } from '../engine/protocol';
import { slotPart, splitStrings } from '../lib/slot-values';

/** Preset bookkeeping, never part of a diff. */
export const META = new Set([
  'name',
  'inherits',
  'from',
  'is_custom_defined',
  'version',
  'setting_id',
  'instantiation',
  'print_settings_id',
  'filament_settings_id',
  'printer_settings_id',
  'compatible_printers',
  'compatible_printers_condition',
  'compatible_prints',
  'compatible_prints_condition',
]);

/** The system preset a user preset saved from `preset` inherits (Orca allows one level). */
export function systemParent(preset: Pick<PresetSummary, 'name' | 'system' | 'inherits'>): string {
  return preset.system ? preset.name : preset.inherits || preset.name;
}

/** Splits a serialized list value ("1,2", "\"a\";\"b c\"") into its items, as Orca writes them. */
export function splitValues(value: string, type: string | undefined): string[] {
  return type === 'strings' ? splitStrings(value) : value.split(',');
}

/**
 * The value a filament preset gets from a full-config value that holds one
 * item (or, for a flow-variant option, one segment) per filament slot;
 * anything else is taken as is. `config` is the full config, for its
 * filament_flow_step_size segments.
 */
export function slotValue(value: string, type: string | undefined, slot: number, slots: number, config: OrcaConfig = {}, flow = false): string {
  return slotPart(value, type, slot, slots, config, flow);
}

/**
 * The preset's own settings with the user's changes (`overrides`, full-config
 * keys) on top. For a filament, `slot` picks that slot's values.
 */
export function presetEdited(args: {
  own: OrcaConfig;
  overrides: OrcaConfig;
  options: Record<string, OptionDef>;
  slot?: { index: number; count: number; config?: OrcaConfig };
}): OrcaConfig {
  const { own, overrides, options, slot } = args;
  const edited: OrcaConfig = {};
  for (const [key, value] of Object.entries(own)) {
    if (META.has(key)) continue;
    const o = overrides[key];
    edited[key] = o === undefined ? value : slot ? slotValue(o, options[key]?.type, slot.index, slot.count, slot.config, options[key]?.flow === 'filament') : o;
  }
  return edited;
}

/**
 * The diff a user preset saves: the preset's own settings with the user's
 * changes (`overrides`, full-config keys) on top, minus what the system
 * parent already has. For a filament, `slot` picks that slot's values.
 */
export function presetDiff(args: {
  own: OrcaConfig;
  parent: OrcaConfig;
  overrides: OrcaConfig;
  options: Record<string, OptionDef>;
  slot?: { index: number; count: number; config?: OrcaConfig };
}): OrcaConfig {
  const edited = presetEdited(args);
  return Object.fromEntries(Object.entries(edited).filter(([k, v]) => v !== args.parent[k]));
}

/** How many of the user's changes belong to a preset with these settings. */
export function changesFor(own: OrcaConfig, overrides: OrcaConfig): number {
  return Object.keys(overrides).filter((k) => k in own && !META.has(k)).length;
}

/** A free name for a copy of `name` ("PLA - Copy", "PLA - Copy 2", ...). */
export function copyName(name: string, taken: (n: string) => boolean): string {
  const base = `${name.replace(/\s*@.*$/, '')} - Copy`;
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base} ${i}`)) return `${base} ${i}`;
}
