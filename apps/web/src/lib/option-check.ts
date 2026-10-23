/**
 * Checks a value typed into a settings box against the engine's own
 * description of the option (its type, lowest and highest value, unit), the
 * way desktop Orca's fields do (Field::get_value_by_opt_type), so no setting
 * needs a rule of its own:
 *
 * - not a number (or a % where the option takes none): refused, the box keeps
 *   its old value;
 * - below the lowest or above the highest value: set to the nearest one;
 * - a comma works as a decimal point, and "mm or %" boxes take "0.4mm";
 * - a "mm or %" value over 100 (and over the option's maxLiteral), or a
 *   "mm/s or %" one over its highest value, is probably meant as a
 *   percentage, so the box asks which one.
 *
 * A list typed whole ("0.2,0.3", one value per extruder) has each value
 * checked; text, lists of names and G-code are not checked.
 */
import { entryType, isVectorType, splitValues } from './flow-variants';

export interface CheckedOption {
  type: string;
  min?: number;
  max?: number;
  maxLiteral?: number;
  sidetext?: string;
  nullable?: boolean;
}

export type CheckResult =
  | { kind: 'ok'; value: string }
  /** Refused: `problem` says why, the old value stays. */
  | { kind: 'invalid'; problem: string }
  /** Out of range: `value` is the nearest allowed one, `note` says so. */
  | { kind: 'clamped'; value: string; note: string }
  /** Percent or mm: `number` is the typed number, `unit` mm or mm/s. */
  | { kind: 'ask'; number: string; unit: string };

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const WHOLE = /^[-+]?\d+$/;

/** How a number is written back: no trailing zeros, no exponent for ordinary values. */
const format = (n: number) => String(Number(n.toPrecision(12)));

/** The unit to show beside a number in a note ("mm", "°C"), none for "mm or %" or "%". */
function unitOf(def: CheckedOption): string {
  const s = def.sidetext?.trim() ?? '';
  return !s || s.includes(' or ') || s === '%' ? '' : ` ${s}`;
}

function range(def: CheckedOption, n: number, unit: string, percent: boolean): CheckResult | null {
  const min = def.min ?? -Infinity;
  const max = def.max ?? Infinity;
  if (n >= min && n <= max) return null;
  const nearest = n < min ? min : max;
  const value = format(nearest) + (percent ? '%' : '');
  const show = (v: number) => format(v) + (percent ? '%' : unit);
  const allowed =
    Number.isFinite(min) && Number.isFinite(max)
      ? `Allowed ${show(min)} to ${show(max)}`
      : Number.isFinite(min)
        ? `Lowest allowed is ${show(min)}`
        : `Highest allowed is ${show(max)}`;
  return { kind: 'clamped', value, note: `${allowed}, set to ${show(nearest)}.` };
}

/** One value of the option's single-value type (float, int, percent, floatOrPercent). */
function checkOne(def: CheckedOption, type: string, raw: string, ask: boolean): CheckResult {
  let text = raw.trim();
  if (def.nullable && text === 'nil') return { kind: 'ok', value: text };
  if (type !== 'int' && type !== 'float' && type !== 'percent' && type !== 'floatOrPercent') return { kind: 'ok', value: raw };
  if (text === '') return { kind: 'invalid', problem: 'A value is needed.' };
  text = text.replace(',', '.');
  const percent = text.endsWith('%');
  if (percent && (type === 'int' || type === 'float')) return { kind: 'invalid', problem: "This setting can't be a percentage." };
  if (percent) text = text.slice(0, -1).trim();
  // Desktop drops spaces and an "mm" after a "mm or %" value.
  if (type === 'floatOrPercent' && !percent) text = text.replace(/\s+/g, '').replace(/mm$/i, '');
  if (type === 'int' ? !WHOLE.test(text) : !NUMBER.test(text)) {
    return { kind: 'invalid', problem: type === 'int' && NUMBER.test(text) ? `“${raw.trim()}” is not a whole number.` : `“${raw.trim()}” is not a number.` };
  }
  const n = Number(text);
  const number = format(n);
  if (type === 'floatOrPercent') {
    if (percent) return { kind: 'ok', value: `${number}%` };
    const side = def.sidetext ?? '';
    const speed = side.includes('mm/s');
    const big = n > 100 && (speed ? n > (def.max ?? Infinity) : side.includes('mm ') && n > (def.maxLiteral ?? 1));
    if (ask && big) return { kind: 'ask', number, unit: speed ? 'mm/s' : 'mm' };
    return { kind: 'ok', value: number };
  }
  const isPercent = type === 'percent';
  return range(def, n, unitOf(def), isPercent) ?? { kind: 'ok', value: number + (isPercent ? '%' : '') };
}

/**
 * Checks `raw` typed into a box showing `type` (the option's own type, or one
 * entry's type when the box edits one entry of a list).
 */
export function checkOptionValue(def: CheckedOption, type: string, raw: string): CheckResult {
  if (!isVectorType(type)) return checkOne(def, type, raw, true);
  const one = entryType(type);
  const values: string[] = [];
  const notes: string[] = [];
  if (raw.trim() === '') return { kind: 'invalid', problem: 'A value is needed.' };
  // In a whole list the comma separates values, so it isn't a decimal point here.
  for (const part of splitValues(raw)) {
    const r = checkOne(def, one, part, false);
    if (r.kind === 'invalid') return r;
    if (r.kind === 'ask') continue; // not asked for a list
    values.push(r.value);
    if (r.kind === 'clamped' && !notes.includes(r.note)) notes.push(r.note);
  }
  const value = values.join(',');
  return notes.length ? { kind: 'clamped', value, note: notes.join(' ') } : { kind: 'ok', value };
}
