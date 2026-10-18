// Snapmaker Orca's flow variants. On printers with standard and high-flow
// nozzles (the U1) many speed, acceleration and filament options hold one
// value per flow variant, ordered like the preset's *_flow_support list:
// initial_layer_speed = "50,50" is 50 for standard flow and 50 for high flow.
// Desktop shows a [Standard flow] [High flow] switch above those settings and
// edits one variant at a time; these helpers do the same on the serialized
// values. In the full config the filament ones are per filament segments, one
// segment of filament_flow_step_size values per filament.
import type { OrcaConfig } from '../engine/protocol';
import { splitList } from './presets';

export type FlowDomain = 'process' | 'filament';

/** Orca's vector option types, serialized as comma separated values. */
export const isVectorType = (type: string) => /^(floats|ints|percents|floatsOrPercents|bools|enums)$/.test(type);

/** The type of one entry of a vector option ("floats" -> "float"). */
export const entryType = (type: string) => (type === 'floatsOrPercents' ? 'floatOrPercent' : type.replace(/s$/, ''));

export const splitValues = (value: string): string[] => (value === '' ? [] : value.split(','));

/** Entry `index` of a vector value; the first one when it has fewer (Orca's get_at). */
export function valueAt(value: string, index: number): string {
  const values = splitValues(value);
  return values[index] ?? values[0] ?? '';
}

/**
 * The vector value with entry `index` set to `entry`, padded to `size`
 * entries first by repeating its first one (Orca's resize).
 */
export function withValueAt(value: string, index: number, entry: string, size = 0): string {
  const values = splitValues(value);
  while (values.length < Math.max(size, index + 1)) values.push(values[0] ?? entry);
  values[index] = entry;
  return values.join(',');
}

/** The flow variants a process config has values for, standard first. */
export function processFlowModes(config: OrcaConfig): string[] {
  const modes = splitList(config.process_flow_support);
  return modes.length ? modes : ['standard'];
}

/** "high_flow" -> "High flow", as desktop's switch names them. */
export function flowModeLabel(mode: string): string {
  if (mode === 'standard') return 'Standard flow';
  if (mode === 'high_flow') return 'High flow';
  const text = mode.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Splits `values` into segments of `steps` sizes, or one value each when they don't add up. */
function segments<T>(values: T[], steps: number[]): T[][] {
  const sizes = steps.length && steps.every((n) => n > 0) && steps.reduce((a, b) => a + b, 0) === values.length ? steps : values.map(() => 1);
  const out: T[][] = [];
  let at = 0;
  for (const n of sizes) out.push(values.slice(at, (at += n)));
  return out;
}

/** Values of one variant list mapped onto another by mode name; missing ones take the first (standard) value. */
const remap = (values: string[], from: string[], to: string[]) => to.map((mode) => values[from.indexOf(mode)] ?? values[0]);

/**
 * A project's settings with every flow-variant value laid out like `base`
 * (the selected presets): the same variants, in the same order, and for
 * filaments the same segment per filament. A project from Snapmaker Orca 2.2
 * has one value ("50") where 2.4 has one per variant ("50,50"); like desktop,
 * the variants it lacks take its standard value. Without this, every one of
 * those options counted as changed, and the shorter vectors misaligned
 * the filament segments.
 */
export function alignFlowVariants(file: OrcaConfig, base: OrcaConfig, options: Record<string, { flow?: FlowDomain }>): OrcaConfig {
  const out: OrcaConfig = { ...file };
  const fileProcess = splitList(file.process_flow_support);
  const baseProcess = processFlowModes(base);
  const ints = (v: string | undefined) => splitValues(v ?? '').map(Number).filter((n) => Number.isInteger(n));
  const fileSteps = ints(file.filament_flow_step_size);
  const baseSteps = ints(base.filament_flow_step_size);
  const fileSupport = segments(splitList(file.filament_flow_support), fileSteps);
  const baseSupport = segments(splitList(base.filament_flow_support), baseSteps);

  for (const [key, value] of Object.entries(file)) {
    const flow = options[key]?.flow;
    if (!flow || base[key] === undefined) continue;
    const values = splitValues(value);
    if (flow === 'process') {
      // As many entries as the presets' value has (some presets have more than
      // their process_flow_support lists); ones without a named variant take the standard value.
      const to = splitValues(base[key]).map((_, i) => baseProcess[i] ?? `#${i}`);
      const from = fileProcess.length === values.length ? fileProcess : values.length === 1 ? ['standard'] : to;
      out[key] = remap(values, from, to).join(',');
      continue;
    }
    const baseSegs = segments(splitValues(base[key]), baseSteps);
    const fileSegs = segments(values, fileSteps);
    out[key] = baseSegs
      .map((seg, f) => {
        const own = fileSegs[f];
        if (!own?.length) return seg; // a filament the project doesn't have
        const to = baseSupport[f]?.length === seg.length ? baseSupport[f] : seg.map((_, i) => String(i));
        // Without its own list a project's values are in the order of ours.
        const from = fileSupport[f]?.length === own.length ? fileSupport[f] : own.length === 1 ? ['standard'] : to;
        return remap(own, from, to);
      })
      .flat()
      .join(',');
  }
  return out;
}
