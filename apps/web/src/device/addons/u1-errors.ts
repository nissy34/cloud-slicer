// The Snapmaker U1's errors in words. Snapmaker's Moonraker keeps the current
// errors ("exceptions"): server.exception.query returns them, and
// notify_exception_status sends the whole list again whenever it changes;
// notify_exception_notification announces one-off ones. Each is four numbers
// (level, id, index, code); Snapmaker's own device page joins them, four
// digits each, into the key for its title and description, and falls back to
// the printer's own message. The words come from that page via
// scripts/u1-errors.mjs and load only when an error turns up.
import type { PrinterError, PrinterErrorSource } from './types';

export interface Words {
  titles: string[];
  errors: Record<string, [number, string]>;
}

let words: Promise<Words> | null = null;
const loadWords = () => (words ??= import('./u1-errors.json').then((m) => m.default as unknown as Words));

const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const pad = (v: number) => String(v).padStart(4, '0');

/** "0002 0523 0000 0000": level, id, index, code, as Snapmaker's app shows it. */
export function u1ErrorCode(raw: Record<string, unknown>): string {
  return [raw.level, raw.id, raw.index, raw.code].map((v) => pad(num(v))).join(' ');
}

export function describeU1Error(raw: unknown, w: Words, once = false): PrinterError | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const code = u1ErrorCode(r);
  const [title, text] = w.errors[code.replace(/ /g, '')] ?? [-1, ''];
  const message = typeof r.message === 'string' ? r.message.trim() : '';
  return {
    id: code,
    code,
    title: w.titles[title] ?? 'Printer error',
    text: text || message || 'The printer reported an error. Check its screen for details.',
    once,
  };
}

async function describeAll(list: unknown, once = false): Promise<PrinterError[]> {
  if (!Array.isArray(list) || !list.length) return [];
  const w = await loadWords();
  const out = new Map<string, PrinterError>();
  for (const raw of list) {
    const e = describeU1Error(raw, w, once);
    if (e) out.set(e.id, e);
  }
  return [...out.values()];
}

export const u1Errors: PrinterErrorSource = {
  query: 'server.exception.query',
  read: (result) => describeAll((result as { exceptions?: unknown } | null)?.exceptions),
  notified(method, params) {
    if (method === 'notify_exception_status') {
      const first = Array.isArray(params) ? (params[0] as { exceptions?: unknown } | undefined) : undefined;
      return describeAll(first?.exceptions).then((current) => ({ current }));
    }
    if (method === 'notify_exception_notification') return describeAll(params, true).then((once) => ({ once }));
    return null;
  },
};
