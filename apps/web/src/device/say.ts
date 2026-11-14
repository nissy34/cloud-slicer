// Words for code the relay shares with the page (alert-text.ts, the printers'
// error lists): no i18next here, so the relay (apps/device-relay) can bundle it.
// The page plugs in i18n.t (state/device.ts), so these read in the reader's
// language; the relay, which doesn't know it, uses the English word files as they are.
import alertWords from '../i18n/en/deviceAlertText.json';
import errorWords from '../i18n/en/devicePrinterErrors.json';

export type SayVars = Record<string, string | number>;
export type Say = (key: string, vars?: SayVars) => string;

const EN: Record<string, Record<string, string>> = { ...alertWords, ...errorWords };

/** The English word for "area.word", blanks filled, "_one"/"_other" picked by `count`. */
export function english(key: string, vars: SayVars = {}): string {
  const [area, word] = key.split('.');
  const words = EN[area] ?? {};
  const count = vars.count;
  const text = (typeof count === 'number' && words[`${word}_${count === 1 ? 'one' : 'other'}`]) || words[word] || key;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(vars[k] ?? ''));
}

let current: Say = english;

/** The word in the reader's language (English until the page plugs in its translator). */
export const say: Say = (key, vars) => current(key, vars);

export function setSay(fn: Say): void {
  current = fn;
}
