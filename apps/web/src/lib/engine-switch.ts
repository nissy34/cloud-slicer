// Switching an open project to the other engine (engine/README.md, "Two
// engines"), the way desktop OrcaSlicer handles a printer change: the model,
// plates, positions and painting stay; what the other engine can't take is
// listed in the "Switch this project to <engine>?" pop-up first, and is gone
// for good (switching back brings nothing back).
//
// What carries over:
//   - presets: user presets keep their name (they exist in both engines,
//     lib/preset-engines.ts); system presets move to their stand-in
//     (standIn), the nearest match by printer, layer height or material.
//   - changed settings: those both engines share (shared-settings.json).
//     Snapmaker's flow-variant lists keep their standard-flow value only.
//   - colour mixes (Snapmaker Orca only): each becomes the filament it uses
//     most, on objects, parts, paint and layer filament changes.
import type { OptionDef, OrcaConfig, ProjectInfo, Selection } from '../engine/protocol';
import { engineName, type EngineFlavor } from './engines';
import { splitValues, valueAt, withValueAt } from './flow-variants';
import { decodeIds, decodeWeights, mixLabel, normalizeWeights, patternIds, type MixRow } from './mixing';
import { isShared, SHARED, standIn, type PresetType, type SharedTable } from './preset-engines';
import { splitList } from './presets';

export interface MixChange {
  /** Filament number of the mix (5, 6, ... on a 4-filament U1). */
  id: number;
  label: string;
  colour: string;
  /** The physical filament (1-based) it becomes. */
  becomes: number;
}

export interface DroppedSetting {
  key: string;
  label: string;
  /** Set for an object's or part's own setting: its name. */
  where?: string;
}

export interface PresetMove {
  type: PresetType;
  from: string;
  to: string;
}

export interface SwitchPlan {
  from: EngineFlavor;
  to: EngineFlavor;
  mixes: MixChange[];
  /** Changed settings whose high-flow value differs from the standard one, which carries over alone (untouched presets lose nothing worth a word). */
  highFlowChanged: DroppedSetting[];
  /** Changed settings, and objects' own settings, the other engine doesn't have. */
  dropped: DroppedSetting[];
  /**
   * Presets whose stand-in prints differently: a process of another layer
   * height. A built-in that moves to the other engine's matching built-in
   * (same layer height, the same filament) is not worth a word.
   */
  presets: PresetMove[];
  /** The selection to make in the other engine (its preset names). */
  selection: Selection;
  /** Changed settings as the other engine takes them; flow-variant ones still need flowFill there. */
  overrides: OrcaConfig;
  /** Per object (and part, volume >= 0): settings to remove before the project leaves the engine, and flow lists cut to their standard value. */
  objectEdits: { object: number; volume: number; values: Record<string, string | null> }[];
}

/** "0.20mm Standard @U1" -> 0.2 (NaN for a name without one). */
const layerHeight = (process: string) => parseFloat(/^\s*(\d+(?:\.\d+)?)/.exec(process)?.[1] ?? 'NaN');

/** The filament a mix uses most (the first of them on a tie), 1-based. */
export function mainFilament(row: MixRow): number {
  const shares = new Map<number, number>();
  const add = (id: number, w: number) => id > 0 && shares.set(id, (shares.get(id) ?? 0) + w);
  if (row.pattern) for (const id of patternIds(row.pattern)) add(id, 1);
  else {
    const ids = decodeIds(row.gradientIds);
    if (ids.length >= 3) {
      const w = normalizeWeights(decodeWeights(row.gradientWeights, ids.length));
      ids.forEach((id, i) => add(id, w[i]));
    } else if (row.gradientEnabled) {
      // A gradient: half of each, from A at one end to B at the other.
      add(row.componentA, 50);
      add(row.componentB, 50);
    } else {
      const b = Math.min(100, Math.max(0, row.mixBPercent));
      add(row.componentA, 100 - b);
      add(row.componentB, b);
    }
  }
  let best = row.componentA || 1;
  let most = -1;
  for (const [id, w] of shares) if (w > most) (best = id), (most = w);
  return best;
}

/** Splits `values` into one segment per filament, `steps` long each (one value each when they don't add up). */
function segments(values: string[], steps: number[]): string[][] {
  const sizes = steps.length && steps.every((n) => n > 0) && steps.reduce((a, b) => a + b, 0) === values.length ? steps : values.map(() => 1);
  const out: string[][] = [];
  let at = 0;
  for (const n of sizes) out.push(values.slice(at, (at += n)));
  return out;
}

const standardAt = (modes: string[]) => Math.max(0, modes.findIndex((m) => m === 'standard'));
const ints = (v: string | undefined) => splitValues(v ?? '').map(Number).filter((n) => Number.isInteger(n));

/**
 * A Snapmaker Orca flow-variant value as one value per filament (or one for a
 * process setting): the standard-flow entries. `config` is the full config the
 * value belongs to. `differs` says whether any high-flow entry was different.
 */
export function standardFlowValue(value: string, domain: 'process' | 'filament', config: OrcaConfig): { value: string; differs: boolean } {
  const values = splitValues(value);
  if (domain === 'process') {
    const i = standardAt(splitList(config.process_flow_support));
    const std = valueAt(value, i);
    return { value: std, differs: values.some((v) => v !== std) };
  }
  const steps = ints(config.filament_flow_step_size);
  const supports = segments(splitList(config.filament_flow_support), steps);
  let differs = false;
  const out = segments(values, steps).map((seg, f) => {
    const std = seg[standardAt(supports[f] ?? [])] ?? seg[0] ?? '';
    differs ||= seg.some((v) => v !== std);
    return std;
  });
  return { value: out.join(','), differs };
}

/**
 * The other way: a plain value (one per filament for filament settings) put
 * into Snapmaker Orca's flow-variant list `base` (the selected presets'
 * value) at the standard entries, keeping the high-flow entries of `base`.
 */
export function flowFill(value: string, domain: 'process' | 'filament', base: string, config: OrcaConfig): string {
  if (base === undefined || base === '') return value;
  if (domain === 'process') return withValueAt(base, standardAt(splitList(config.process_flow_support)), value);
  const steps = ints(config.filament_flow_step_size);
  const supports = segments(splitList(config.filament_flow_support), steps);
  const plain = splitValues(value);
  return segments(splitValues(base), steps)
    .map((seg, f) => {
      const out = [...seg];
      const v = plain[f] ?? plain[plain.length - 1];
      if (v !== undefined && out.length) out[standardAt(supports[f] ?? [])] = v;
      return out;
    })
    .flat()
    .join(',');
}

export interface PlanInput {
  from: EngineFlavor;
  to: EngineFlavor;
  selection: Selection;
  /** Names of the user's own presets, which keep their name in the other engine. */
  userPresets: { type: PresetType; name: string }[];
  overrides: OrcaConfig;
  /** The full config before overrides (for the flow-variant layout). */
  baseConfig: OrcaConfig;
  /** The running engine's options: labels and flow-variant domains. */
  options: Record<string, OptionDef>;
  mixes: MixRow[];
  project: ProjectInfo | null;
}

/** What switching the open project to engine `to` keeps, changes and drops. */
export function switchPlan(p: PlanInput, t: SharedTable = SHARED): SwitchPlan {
  const { from, to, options } = p;
  const label = (key: string) => options[key]?.label || key;
  const mine = (type: PresetType, name: string) => p.userPresets.some((u) => u.type === type && u.name === name);
  const move = (type: PresetType, name: string) => (mine(type, name) ? name : standIn(type, name, from, to, t));
  const presets: PresetMove[] = [];
  const moved = (type: PresetType, name: string) => {
    const next = move(type, name);
    if (type === 'process' && next !== name && !Object.is(layerHeight(next), layerHeight(name)) && !presets.some((m) => m.from === name)) presets.push({ type, from: name, to: next });
    return next;
  };
  const selection: Selection = {
    printer: moved('printer', p.selection.printer),
    process: moved('process', p.selection.process),
    filaments: p.selection.filaments.map((f) => moved('filament', f)),
    colours: [...p.selection.colours],
  };

  const config = { ...p.baseConfig, ...p.overrides };
  const leavingFlow = from === 'snapmaker';
  const flowOf = (key: string) => (leavingFlow ? options[key]?.flow : undefined);
  const dropped: DroppedSetting[] = [];
  const highFlowChanged: DroppedSetting[] = [];
  const overrides: OrcaConfig = {};
  for (const [key, value] of Object.entries(p.overrides)) {
    if (!isShared(key, undefined, t)) {
      dropped.push({ key, label: label(key) });
      continue;
    }
    const flow = flowOf(key);
    if (flow) {
      const std = standardFlowValue(value, flow, config);
      if (std.differs) highFlowChanged.push({ key, label: label(key) });
      overrides[key] = std.value;
    } else overrides[key] = value;
  }

  const objectEdits: SwitchPlan['objectEdits'] = [];
  (p.project?.objects ?? []).forEach((o, object) => {
    const own = (settings: OrcaConfig, volume: number, where: string) => {
      const values: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(settings)) {
        if (key === 'extruder') continue;
        if (!isShared(key, undefined, t)) {
          values[key] = null;
          dropped.push({ key, label: label(key), where });
          continue;
        }
        const flow = flowOf(key);
        if (!flow) continue;
        const std = standardFlowValue(value, flow, config);
        if (std.differs) highFlowChanged.push({ key, label: label(key), where });
        if (std.value !== value) values[key] = std.value;
      }
      if (Object.keys(values).length) objectEdits.push({ object, volume, values });
    };
    own(o.settings, -1, o.name);
    o.volumes.forEach((v, volume) => own(v.settings, volume, `${o.name}, ${v.name}`));
  });

  const mixes = to === 'snapmaker' ? [] : p.mixes.filter((r) => r.enabled && r.virtualId > 0).map((r) => ({ id: r.virtualId, label: mixLabel(r), colour: r.colour, becomes: mainFilament(r) }));
  return { from, to, mixes, highFlowChanged, dropped, presets, selection, overrides, objectEdits };
}

/** Nothing to tell: everything that matters carries over, so the switch needs no question. */
export const losesNothing = (plan: SwitchPlan) =>
  !plan.mixes.length && !plan.highFlowChanged.length && !plan.dropped.length && !plan.presets.length;

/** The notice after a switch (`model` false: an empty plate, only the settings moved). */
export function switchedText(plan: SwitchPlan, model = true): string {
  const parts = [model ? `This project now slices with ${engineName(plan.to)}.` : `Now slicing with ${engineName(plan.to)}.`];
  if (!model && Object.keys(plan.overrides).length) parts.push('Your changed settings came along.');
  if (plan.mixes.length) parts.push(plan.mixes.length === 1 ? 'Its colour mix is now a plain filament.' : `Its ${plan.mixes.length} colour mixes are now plain filaments.`);
  if (plan.dropped.length) parts.push(`${plan.dropped.length} setting${plan.dropped.length === 1 ? '' : 's'} ${engineName(plan.to)} doesn't have were left out.`);
  if (model) parts.push('Slice again before printing.');
  return parts.join(' ');
}
