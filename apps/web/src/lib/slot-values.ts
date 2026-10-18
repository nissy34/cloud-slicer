// One filament slot's value inside the full config. The full config holds a
// filament option once per filament: "220,230" for two filaments, and for a
// flow-variant option one segment of filament_flow_step_size values per
// filament ("220,225,230,235" = two filaments x standard/high flow). Text
// options are Orca's quoted lists ("\"G1 X0\";\"M117\""). The Filament tab
// edits the slot it shows, the way desktop's filament tab edits the one
// filament it has open.
import type { OrcaConfig } from '../engine/protocol';
import { processFlowModes, splitValues } from './flow-variants';
import { splitList } from './presets';

/** Orca's C-style escaping of one string in a quoted list (escape_string_cstyle). */
export function encodeString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

/** The text of one quoted list item; an unquoted item is taken as is. */
export function decodeString(item: string): string {
  const m = /^"([\s\S]*)"$/.exec(item);
  if (!m) return item;
  return m[1].replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c));
}

/** The items of an Orca quoted list ("\"a\";\"b;c\""), quotes kept. */
export function splitStrings(value: string): string[] {
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

const ints = (v: string | undefined) => splitValues(v ?? '').map(Number).filter((n) => Number.isInteger(n) && n > 0);

/**
 * Where slot `slot`'s entries are in a filament vector of `count` entries:
 * [start, size]. Flow-variant options use filament_flow_step_size segments;
 * any vector with one entry per slot uses one entry. Null when the value
 * isn't laid out per slot.
 */
export function slotSegment(count: number, slot: number, slots: number, config: OrcaConfig, flow: boolean): [number, number] | null {
  if (flow) {
    const steps = ints(config.filament_flow_step_size);
    if (steps.length === slots && steps.reduce((a, b) => a + b, 0) === count) {
      const start = steps.slice(0, slot).reduce((a, b) => a + b, 0);
      return [start, steps[slot]];
    }
  }
  return count === slots ? [slot, 1] : null;
}

/** Flow variant names of one filament slot, standard first. */
function slotFlowModes(config: OrcaConfig, slot: number, slots: number): string[] {
  const all = splitList(config.filament_flow_support);
  const seg = slotSegment(all.length, slot, slots, config, true);
  return seg ? all.slice(seg[0], seg[0] + seg[1]) : all;
}

/**
 * The entry of `value` that slot `slot` shows: for a flow-variant option the
 * one of the variant the settings show (by name, like desktop), else the
 * slot's only entry. Null when the value isn't laid out per slot.
 */
export function slotEntryIndex(
  value: string,
  slot: number,
  slots: number,
  config: OrcaConfig,
  flow: boolean,
  flowVariant: number,
): number | null {
  const seg = slotSegment(splitValues(value).length, slot, slots, config, flow);
  if (!seg) return null;
  if (seg[1] === 1) return seg[0];
  const mode = processFlowModes(config)[flowVariant] ?? 'standard';
  const at = slotFlowModes(config, slot, slots).indexOf(mode);
  return seg[0] + Math.max(0, Math.min(at, seg[1] - 1));
}

/** The part of a full-config filament value that belongs to one slot (for saving that slot's preset). */
export function slotPart(value: string, type: string | undefined, slot: number, slots: number, config: OrcaConfig, flow: boolean): string {
  if (slots < 2) return value;
  if (type === 'strings') {
    const items = splitStrings(value);
    return items.length === slots ? (items[slot] ?? value) : value;
  }
  if (!type || !type.endsWith('s') || type === 'points') return value;
  const entries = splitValues(value);
  const seg = slotSegment(entries.length, slot, slots, config, flow);
  return seg ? entries.slice(seg[0], seg[0] + seg[1]).join(',') : value;
}
