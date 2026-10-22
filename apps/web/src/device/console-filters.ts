// Which console lines to hide, like Fluidd's and Mainsail's console filters:
// the noisy replies Klipper repeats while heating or printing, plus words the
// user adds. Generic Klipper text, nothing printer-specific. What the user
// typed and errors always show.
import type { ConsoleLine } from './session';

export interface CustomFilter {
  text: string;
  on: boolean;
}

export interface ConsoleFilters {
  temps: boolean;
  timelapse: boolean;
  progress: boolean;
  ok: boolean;
  custom: CustomFilter[];
}

export const DEFAULT_CONSOLE_FILTERS: ConsoleFilters = { temps: true, timelapse: true, progress: true, ok: true, custom: [] };

export type BuiltInFilter = Exclude<keyof ConsoleFilters, 'custom'>;

export const BUILT_IN_FILTERS: { key: BuiltInFilter; label: string; example: string; match: RegExp }[] = [
  // M105 replies and the reports M109/M190 print while they wait.
  { key: 'temps', label: 'Temperatures', example: 'B:60.0 /60.0 T0:215.0 /215.0', match: /^(?:ok\s+)?(?:B|C|T\d*):\s*-?\d/i },
  { key: 'timelapse', label: 'Timelapse', example: 'timelapse frame messages', match: /timelapse/i },
  { key: 'progress', label: 'Print progress', example: 'SD printing byte 1234/5678', match: /^(?:ok\s+)?(?:SD printing byte|Not SD printing)/i },
  { key: 'ok', label: 'Plain "ok"', example: 'ok', match: /^ok\s*$/i },
];

/** Reads saved filters, keeping defaults for anything missing or malformed. */
export function readConsoleFilters(raw: unknown): ConsoleFilters {
  const o = raw && typeof raw === 'object' ? (raw as Partial<ConsoleFilters>) : {};
  const flag = (k: BuiltInFilter) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULT_CONSOLE_FILTERS[k]);
  const custom = Array.isArray(o.custom)
    ? o.custom.filter((c): c is CustomFilter => !!c && typeof c.text === 'string' && c.text.trim() !== '').map((c) => ({ text: c.text.trim(), on: c.on !== false }))
    : [];
  return { temps: flag('temps'), timelapse: flag('timelapse'), progress: flag('progress'), ok: flag('ok'), custom };
}

export function isHidden(line: ConsoleLine, f: ConsoleFilters): boolean {
  if (line.kind !== 'response') return false;
  const text = line.text.trim();
  if (BUILT_IN_FILTERS.some((b) => f[b.key] && b.match.test(text))) return true;
  const lower = text.toLowerCase();
  return f.custom.some((c) => c.on && lower.includes(c.text.toLowerCase()));
}

/** How many filters are switched on, for the card's Filter button. */
export function activeFilterCount(f: ConsoleFilters): number {
  return BUILT_IN_FILTERS.filter((b) => f[b.key]).length + f.custom.filter((c) => c.on).length;
}
