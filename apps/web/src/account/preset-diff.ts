// Turning the current settings into an Orca user preset: a diff over the
// system preset it inherits, the way desktop Orca's "Save preset" does.
import type { OptionDef, OrcaConfig, PresetSummary } from '../engine/protocol';

/** Preset bookkeeping, never part of a diff. */
const META = new Set([
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
  if (type === 'strings') {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === '\\' && quoted && i + 1 < value.length) cur += c + value[++i];
      else if (c === '"') ((quoted = !quoted), (cur += c));
      else if (c === ';' && !quoted) (out.push(cur), (cur = ''));
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  return value.split(',');
}

const isList = (type: string | undefined) => !!type && type.endsWith('s') && type !== 'points';

/**
 * The value a filament preset gets from a full-config value that holds one
 * item per filament slot; anything else is taken as is.
 */
export function slotValue(value: string, type: string | undefined, slot: number, slots: number): string {
  if (!isList(type) || slots < 2) return value;
  const items = splitValues(value, type);
  return items.length === slots ? (items[slot] ?? value) : value;
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
  slot?: { index: number; count: number };
}): OrcaConfig {
  const { own, parent, overrides, options, slot } = args;
  const diff: OrcaConfig = {};
  for (const [key, value] of Object.entries(own)) {
    if (META.has(key)) continue;
    let edited = value;
    const o = overrides[key];
    if (o !== undefined) edited = slot ? slotValue(o, options[key]?.type, slot.index, slot.count) : o;
    if (edited !== parent[key]) diff[key] = edited;
  }
  return diff;
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
