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
//     Snapmaker's flow-variant lists keep their standard-flow value only. A
//     setting one engine keeps as one value and the other as a list (2.5's
//     flush_multiplier, one per nozzle) carries over too (listIn).
//   - G-code is not moved: each engine keeps its printer's own (Snapmaker's U1
//     G-code uses variables OrcaSlicer lacks). The pop-up says so (ownGcode).
//   - colour mixes (both engines have them, kept differently; experimental):
//     each is made again in the other engine with the same filaments and
//     shares, under the same filament number, so objects, parts, paint and
//     layer filament changes keep printing with it. OrcaSlicer has no Cycle
//     mode: a Cycle mix goes there as a Ratio mix of the same shares.
import type { OptionDef, OrcaConfig, ProjectInfo, Selection } from '../engine/protocol';
import { engineName, type EngineFlavor } from './engines';
import { splitValues, valueAt, withValueAt } from './flow-variants';
import { encodeIds, LAYER_CYCLE, MODES, mixLabel, normalizeWeights, patternIds, ratioFor, SIMPLE, type MixRecipe, type MixRow } from './mixing';
import { isShared, SHARED, standIn, type PresetType, type SharedTable } from './preset-engines';
import { splitList } from './presets';

export interface MixChange {
  /** Filament number of the mix (5, 6, ... on a 4-filament U1). */
  id: number;
  label: string;
  colour: string;
  /** How it is mixed in the other engine ("F1 50% + F2 50%"). */
  becomes: string;
}

/** A mix made again in the other engine, under the same filament number. */
export interface MixCarry {
  id: number;
  recipe: MixRecipe;
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
  /** Mixes that carry over mixed another way (a Cycle mix going to OrcaSlicer). */
  mixes: MixChange[];
  /** Every mix in use, in filament-number order, as the other engine makes it. */
  carried: MixCarry[];
  /** Changed settings whose high-flow value differs from the standard one, which carries over alone (untouched presets lose nothing worth a word). */
  highFlowChanged: DroppedSetting[];
  /** Changed settings, and objects' own settings, the other engine doesn't have. */
  dropped: DroppedSetting[];
  /** Changed G-code: the other engine has it, but uses its own printer's. */
  ownGcode: DroppedSetting[];
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

/**
 * Colour mixing settings that are the same thing under another name: Snapmaker's
 * Subdivide Mix Layer and OrcaSlicer 2.5's Mixed color sublayer both split the
 * layers of mixed areas into thinner ones.
 */
const MIX_SAME: Record<string, string> = { dithering_local_z_mode: 'enable_mixed_color_sublayer' };
const MIX_NAME = { ...MIX_SAME, ...Object.fromEntries(Object.entries(MIX_SAME).map(([a, b]) => [b, a])) };

/**
 * What desktop's filament swatches show (a multi-colour filament's colours);
 * slicing doesn't read it, the page doesn't show it, and each engine names it
 * differently. Not worth a word when it stays behind.
 */
const SWATCH_ONLY = new Set(['filament_multi_colors', 'filament_multi_colour', 'filament_colour_type']);

/** A value for engine `to` of a setting one engine keeps as a list (listIn): one value is a list of one. */
const listValue = (value: string, listIn: EngineFlavor, to: EngineFlavor) => (listIn === to ? value : (value.split(',')[0] ?? value));

/** "0.20mm Standard @U1" -> 0.2 (NaN for a name without one). */
const layerHeight = (process: string) => parseFloat(/^\s*(\d+(?:\.\d+)?)/.exec(process)?.[1] ?? 'NaN');

/**
 * A mix's recipe as `to` makes it. Ratio, Match and Gradient mixes are the
 * same in both engines. OrcaSlicer mixes by ratio or gradient, not by a layer
 * pattern: a Cycle mix goes there as a Ratio mix of the filaments in the
 * pattern, each with its share of the layers.
 */
export function carriedRecipe(row: MixRecipe, to: EngineFlavor): MixRecipe {
  const recipe: MixRecipe = {
    componentA: row.componentA,
    componentB: row.componentB,
    mixBPercent: row.mixBPercent,
    ratioA: row.ratioA,
    ratioB: row.ratioB,
    pattern: row.pattern,
    gradientIds: row.gradientIds,
    gradientWeights: row.gradientWeights,
    distributionMode: row.distributionMode,
    gradientEnabled: row.gradientEnabled,
    gradientStart: row.gradientStart,
    gradientEnd: row.gradientEnd,
    uiMode: row.uiMode,
  };
  if (to !== 'orca' || !row.pattern) return recipe;
  const counts = new Map<number, number>();
  for (const id of patternIds(row.pattern)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ids = [...counts.keys()];
  const shares = normalizeWeights([...counts.values()]);
  const ratio = { ...recipe, pattern: '', gradientEnabled: false, uiMode: MODES.indexOf('ratio') };
  if (ids.length >= 3) return { ...ratio, componentA: ids[0], componentB: ids[1], mixBPercent: 50, distributionMode: LAYER_CYCLE, gradientIds: encodeIds(ids), gradientWeights: shares.join('/') };
  const [a, b] = ids.length === 2 ? ids : [ids[0] ?? row.componentA, ids[0] === row.componentA ? row.componentB : row.componentA];
  const percentB = ids.length === 2 ? shares[1] : 0;
  const [ratioA, ratioB] = ratioFor(percentB);
  return { ...ratio, componentA: a, componentB: b, mixBPercent: percentB, ratioA, ratioB, distributionMode: SIMPLE, gradientIds: '', gradientWeights: '' };
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
  const ownGcode: DroppedSetting[] = [];
  const highFlowChanged: DroppedSetting[] = [];
  const overrides: OrcaConfig = {};
  for (const [key, value] of Object.entries(p.overrides)) {
    if (!isShared(key, undefined, t)) {
      if (t.listIn?.[key]) overrides[key] = listValue(value, t.listIn[key], to);
      else if (MIX_NAME[key]) overrides[MIX_NAME[key]] = value;
      else if (t.gcode?.includes(key)) ownGcode.push({ key, label: label(key) });
      else if (!SWATCH_ONLY.has(key)) dropped.push({ key, label: label(key) });
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
          if (t.listIn?.[key]) {
            const v = listValue(value, t.listIn[key], to);
            if (v !== value) values[key] = v;
            continue;
          }
          values[key] = null;
          if (t.gcode?.includes(key)) ownGcode.push({ key, label: label(key), where });
          else if (!SWATCH_ONLY.has(key)) dropped.push({ key, label: label(key), where });
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

  // The two engines keep mixes differently: each is made again there, under the same number.
  const inUse = p.mixes.filter((r) => r.enabled && r.virtualId > 0).sort((a, b) => a.virtualId - b.virtualId);
  const carried = inUse.map((r) => ({ id: r.virtualId, recipe: carriedRecipe(r, to) }));
  const mixes = inUse
    .filter((r) => r.pattern && to === 'orca')
    .map((r) => ({ id: r.virtualId, label: `Cycle: ${mixLabel(r)}`, colour: r.colour, becomes: `Ratio: ${mixLabel(carriedRecipe(r, to))}` }));
  return { from, to, mixes, carried, highFlowChanged, dropped, ownGcode, presets, selection, overrides, objectEdits };
}

/** Nothing to tell: everything that matters carries over, so the switch needs no question. */
export const losesNothing = (plan: SwitchPlan) =>
  !plan.mixes.length && !plan.highFlowChanged.length && !plan.dropped.length && !plan.ownGcode.length && !plan.presets.length;

/** The notice after a switch (`model` false: an empty plate, only the settings moved). */
export function switchedText(plan: SwitchPlan, model = true): string {
  const parts = [model ? `This project now slices with ${engineName(plan.to)}.` : `Now slicing with ${engineName(plan.to)}.`];
  if (!model && Object.keys(plan.overrides).length) parts.push('Your changed settings came along.');
  if (plan.carried.length) parts.push(plan.carried.length === 1 ? 'Its colour mix came along.' : `Its ${plan.carried.length} colour mixes came along.`);
  if (plan.mixes.length) parts.push(plan.mixes.length === 1 ? 'Its Cycle mix is now a Ratio mix.' : `Its ${plan.mixes.length} Cycle mixes are now Ratio mixes.`);
  if (plan.dropped.length) parts.push(`${plan.dropped.length} setting${plan.dropped.length === 1 ? '' : 's'} ${engineName(plan.to)} doesn't have were left out.`);
  if (model) parts.push('Slice again before printing.');
  return parts.join(' ');
}
