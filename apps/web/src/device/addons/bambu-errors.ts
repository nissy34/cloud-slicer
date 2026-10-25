// Bambu Lab printers' errors in words. The printer's own report (passed on by
// the bridge as the `bambu` object) lists its current health messages ("HMS",
// `hms`: each an `attr` and a `code`, joined as sixteen hex digits) and, when a
// print stopped on a problem, `print_error` (eight hex digits). Bambu's texts
// for both come from the lists OrcaSlicer ships (scripts/bambu-errors.mjs) and
// load only when an error turns up. The code is shown the way Bambu's own apps
// and wiki write it ("0300_0100_0001_0007").
import type { KlipperObjects } from '../status';
import type { PrinterError } from './types';

export interface BambuWords {
  hms: Record<string, string>;
  error: Record<string, string>;
}

let words: Promise<BambuWords> | null = null;
export const loadBambuWords = () => (words ??= import('./bambu-errors.json').then((m) => m.default as unknown as BambuWords));

const hex8 = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 0xffffffff ? v.toString(16).toUpperCase().padStart(8, '0') : '');
const show = (code: string) => code.match(/.{4}/g)!.join('_');

/** The part of the printer a code is about (its first byte), as Bambu's HMS pages name them. */
const PARTS: Record<string, string> = {
  '03': 'Motion system',
  '05': 'Mainboard',
  '07': 'AMS',
  '08': 'Toolhead',
  '0C': 'Camera',
  '12': 'AMS',
  '18': 'AMS',
};
const title = (code: string) => `${PARTS[code.slice(0, 2)] ?? 'Printer'} problem`;
const UNKNOWN = 'The printer reported this problem. Check its screen for details.';

/** The raw error fields of a report, for the relay and for noticing a change. */
export function bambuErrorFields(report: unknown): { print_error?: unknown; hms?: unknown } {
  const r = report && typeof report === 'object' ? (report as Record<string, unknown>) : {};
  return { print_error: r.print_error, hms: r.hms };
}

/** The report's current errors: the stopped print's first, then its health messages. */
export function describeBambuErrors(report: unknown, w: BambuWords): PrinterError[] {
  const { print_error, hms } = bambuErrorFields(report);
  const out = new Map<string, PrinterError>();
  const pe = hex8(print_error);
  if (pe) out.set(pe, { id: pe, code: show(pe), title: title(pe), text: w.error[pe] || UNKNOWN, once: false });
  for (const m of Array.isArray(hms) ? hms : []) {
    const attr = (m as Record<string, unknown>)?.attr;
    const c = (m as Record<string, unknown>)?.code;
    if (!hex8(attr) || typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 0xfffff) continue;
    // As Bambu's apps join them (DevHMSItem::get_long_error_code): the attr's last byte is left out.
    const code = hex8(attr).slice(0, 6) + '00' + c.toString(16).toUpperCase().padStart(8, '0');
    out.set(code, { id: code, code: show(code), title: title(code), text: w.hms[code] || UNKNOWN, once: false });
  }
  return [...out.values()];
}

/** What the Print card shows, from the report the session already has. */
export const bambuErrors = {
  key: (o: KlipperObjects) => JSON.stringify(bambuErrorFields(o.bambu)),
  read: async (o: KlipperObjects) => {
    const { print_error, hms } = bambuErrorFields(o.bambu);
    if (!hex8(print_error) && !(Array.isArray(hms) && hms.length)) return [];
    return describeBambuErrors(o.bambu, await loadBambuWords());
  },
};
