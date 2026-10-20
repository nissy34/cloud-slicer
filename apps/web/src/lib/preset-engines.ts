// One user preset for both engines (engine/README.md, "Two engines"). A preset
// keeps:
//   - inherits + config: what Snapmaker Orca loads, exactly as before there were
//     two engines. `config` holds the shared settings and Snapmaker's own ones.
//   - engines.orca: OrcaSlicer's own part, its base preset and the settings only
//     it has (or that mean something else in it, like its G-code).
// The shared settings (src/lib/shared-settings.json, made by
// scripts/shared-settings.mjs) mean the same in both engines, so a change made
// in either engine shows in the other. Saving in one engine never touches the
// other engine's own part. Snapmaker's flow-variant settings (one value per
// standard / high flow) are shared on their standard value.
import type { OptionDef, OrcaConfig } from '../engine/protocol';
import type { EngineFlavor } from './engines';
import { splitValues, valueAt, withValueAt } from './flow-variants';
import table from './shared-settings.json';

export type PresetType = 'printer' | 'filament' | 'process';

/** What a preset keeps per engine beyond Snapmaker Orca's inherits + config. */
export interface PresetEngines {
  /** The shared-settings version the preset was last saved with. */
  shared?: number;
  /** OrcaSlicer's part: its base preset (when not the stand-in for Snapmaker's) and its own settings. */
  orca?: { inherits?: string; config: OrcaConfig };
  /**
   * Standard-flow values changed in OrcaSlicer for flow-variant settings this
   * preset had no Snapmaker list for yet; Snapmaker fills in the rest of the
   * list from its base preset when it loads the preset.
   */
  pending?: OrcaConfig;
  /** Where the standard value sits in Snapmaker's flow-variant lists, when not first. */
  flowIndex?: number;
  /** Settings that became shared after this preset was saved, with a different value in each engine. */
  apart?: string[];
}

export interface StoredPreset {
  type: PresetType;
  name: string;
  inherits: string;
  config: OrcaConfig;
  engines?: PresetEngines;
}

export interface SharedTable {
  version: number;
  shared: string[];
  flow: Record<string, string>;
  names: Record<string, Partial<Record<PresetType, Record<string, string>>>>;
  history: { version: number; shared: string[] }[];
}
export const SHARED = table as SharedTable;

const sharedSet = new Map<SharedTable, Set<string>>();
function sharedKeys(t: SharedTable): Set<string> {
  let s = sharedSet.get(t);
  if (!s) sharedSet.set(t, (s = new Set(t.shared)));
  return s;
}

/** Whether a setting of `p` is the same in both engines. */
export const isShared = (key: string, p?: Pick<StoredPreset, 'engines'>, t: SharedTable = SHARED) =>
  sharedKeys(t).has(key) && !p?.engines?.apart?.includes(key);

/** The system preset of engine `to` that stands in for `from`'s preset `name`. */
export function standIn(type: PresetType, name: string, from: EngineFlavor, to: EngineFlavor, t: SharedTable = SHARED): string {
  if (from === to) return name;
  return t.names[`${from}>${to}`]?.[type]?.[name] ?? name;
}

/**
 * Moves a preset saved with an older shared-settings list to the current one.
 * A setting no longer shared keeps its value in both engines; one newly shared
 * is merged only when both engines have the same value, else kept apart until
 * the user picks one (useSameValues). `notes` says what changed, once.
 */
export function upgradePreset(p: StoredPreset, t: SharedTable = SHARED): { preset: StoredPreset; notes: string[] } {
  const saved = p.engines?.shared ?? t.history[0]?.version ?? t.version;
  if (saved === t.version) return { preset: p, notes: [] };
  const before = new Set(t.history.find((h) => h.version === saved)?.shared ?? t.history[0]?.shared ?? []);
  const now = sharedKeys(t);
  const config = { ...p.config };
  const orca = { ...p.engines?.orca, config: { ...p.engines?.orca?.config } };
  const apart = new Set(p.engines?.apart ?? []);
  let split = 0;
  let separate = 0;
  for (const key of before)
    if (!now.has(key) && key in config && !(key in orca.config)) {
      orca.config[key] = t.flow[key] ? valueAt(config[key], p.engines?.flowIndex ?? 0) : config[key];
      split++;
    }
  for (const key of now) {
    if (before.has(key)) continue;
    const a = config[key];
    const b = orca.config[key];
    if (a === undefined && b === undefined) continue;
    if (a === b) delete orca.config[key];
    else (apart.add(key), separate++);
  }
  const notes: string[] = [];
  if (split) notes.push(`${split} setting${split === 1 ? ' is' : 's are'} no longer the same in both engines; "${p.name}" keeps its values in each.`);
  if (separate) notes.push(`${separate} setting${separate === 1 ? '' : 's'} of "${p.name}" can now be the same in both engines but differ; "Use the same values in both engines" in its menu makes them match.`);
  return {
    preset: { ...p, config, engines: { ...p.engines, shared: t.version, orca, apart: apart.size ? [...apart] : undefined } },
    notes,
  };
}

/** Drops values the engine has no use for: options it lacks, and choices it doesn't offer. */
function fits(config: OrcaConfig, options: Record<string, OptionDef>): OrcaConfig {
  const out: OrcaConfig = {};
  for (const [key, value] of Object.entries(config)) {
    const o = options[key];
    if (!o) continue;
    if (o.enumValues?.length && !splitValues(value).every((v) => o.enumValues!.includes(v.replace(/^"|"$/g, '')))) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The preset as engine `flavor` loads it: its base preset there and its
 * settings. For Snapmaker Orca, `pending` lists standard-flow values to fill
 * in with expandPending once its base preset's lists are known.
 */
export function presetForEngine(
  p: StoredPreset,
  flavor: EngineFlavor,
  options: Record<string, OptionDef>,
  t: SharedTable = SHARED,
): { type: PresetType; name: string; inherits: string; config: OrcaConfig; pending?: OrcaConfig } {
  const { preset } = upgradePreset(p, t);
  const e = preset.engines ?? {};
  if (flavor === 'snapmaker') {
    const pending = e.pending && Object.keys(e.pending).length ? e.pending : undefined;
    return { type: p.type, name: p.name, inherits: preset.inherits, config: fits(preset.config, options), pending };
  }
  const config: OrcaConfig = {};
  for (const [key, value] of Object.entries(preset.config))
    if (isShared(key, preset, t)) config[key] = t.flow[key] ? valueAt(value, e.flowIndex ?? 0) : value;
  Object.assign(config, e.pending, e.orca?.config);
  return {
    type: p.type,
    name: p.name,
    inherits: e.orca?.inherits ?? standIn(p.type, preset.inherits, 'snapmaker', 'orca', t),
    config: fits(config, options),
  };
}

/** Snapmaker's flow-variant lists for `pending` standard values, from the base preset's lists. */
export function expandPending(config: OrcaConfig, pending: OrcaConfig, base: OrcaConfig, flowIndex = 0): OrcaConfig {
  const out = { ...config };
  for (const [key, value] of Object.entries(pending)) {
    const list = out[key] ?? base[key];
    out[key] = list === undefined ? value : withValueAt(list, flowIndex, value);
  }
  return out;
}

/** Where "standard" is in a Snapmaker preset's *_flow_support list (0 when it isn't there). */
export function standardIndex(type: PresetType, config: OrcaConfig): number {
  const list = config[type === 'filament' ? 'filament_flow_support' : 'process_flow_support'];
  const i = (list ?? '').split(/[;,]/).findIndex((m) => m.replace(/"/g, '').trim() === 'standard');
  return Math.max(i, 0);
}

/**
 * What saving engine `flavor`'s settings into a preset stores. `edited` is the
 * preset's settings with the user's changes, `own` the same before the
 * changes (what the engine loaded), `parent` the base preset's, `inherits`
 * that base's name. Without `prev` (a new preset, or an import), every
 * setting that differs from the base is saved; with it, a shared setting is
 * only rewritten when the user changed it, so values that came from the other
 * engine stay as they are.
 */
export function presetFromEngine(
  prev: StoredPreset | undefined,
  flavor: EngineFlavor,
  args: { type: PresetType; inherits: string; edited: OrcaConfig; own: OrcaConfig; parent: OrcaConfig; meta?: Set<string> },
  t: SharedTable = SHARED,
): { inherits: string; config: OrcaConfig; engines: PresetEngines } {
  const { type, inherits, edited, own, parent, meta } = args;
  const old = prev ? upgradePreset(prev, t).preset : undefined;
  const e: PresetEngines = { ...old?.engines, shared: t.version };
  const pending: OrcaConfig = { ...e.pending };
  const shared = (key: string) => isShared(key, old, t);
  const changed = (key: string) => !old || edited[key] !== own[key];
  const keys = Object.keys(edited).filter((k) => !meta?.has(k));

  if (flavor === 'snapmaker') {
    // Shared values from before stay unless changed here; Snapmaker's own are the diff.
    const config: OrcaConfig = {};
    for (const [key, value] of Object.entries(old?.config ?? {})) if (shared(key)) config[key] = value;
    for (const key of keys) {
      if (shared(key) && !changed(key)) continue;
      delete pending[key];
      if (edited[key] !== parent[key]) config[key] = edited[key];
      else delete config[key];
    }
    e.flowIndex = standardIndex(type, parent) || undefined;
    e.pending = Object.keys(pending).length ? pending : undefined;
    return { inherits, config, engines: e };
  }

  const config: OrcaConfig = { ...old?.config };
  const orca: OrcaConfig = {};
  for (const key of keys) {
    if (!shared(key)) {
      if (edited[key] !== parent[key]) orca[key] = edited[key];
      continue;
    }
    if (!changed(key) || (!old && edited[key] === parent[key])) continue;
    if (t.flow[key]) {
      // Snapmaker keeps one value per flow variant: set the standard one.
      if (config[key] !== undefined) config[key] = withValueAt(config[key], e.flowIndex ?? 0, edited[key]);
      else pending[key] = edited[key];
    } else if (old && edited[key] === parent[key]) delete config[key];
    else config[key] = edited[key];
  }
  e.orca = { inherits, config: orca };
  e.pending = Object.keys(pending).length ? pending : undefined;
  return { inherits: old?.inherits ?? standIn(type, inherits, 'orca', 'snapmaker', t), config, engines: e };
}

/**
 * Makes the settings kept apart (upgradePreset) the same in both engines,
 * taking engine `flavor`'s values.
 */
export function useSameValues(p: StoredPreset, flavor: EngineFlavor, t: SharedTable = SHARED): StoredPreset {
  const { preset } = upgradePreset(p, t);
  const apart = preset.engines?.apart ?? [];
  if (!apart.length) return preset;
  const config = { ...preset.config };
  const orca = { ...preset.engines?.orca, config: { ...preset.engines?.orca?.config } };
  for (const key of apart) {
    if (flavor === 'orca') {
      const v = orca.config[key];
      if (v === undefined) delete config[key];
      else config[key] = t.flow[key] && config[key] !== undefined ? withValueAt(config[key], preset.engines?.flowIndex ?? 0, v) : v;
    }
    delete orca.config[key];
  }
  return { ...preset, config, engines: { ...preset.engines, orca, apart: undefined } };
}
