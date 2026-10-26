// The words of a print alert. Used by the relay (apps/device-relay), which sends
// bridge alerts as Web Push, and by the page for printers it reaches directly,
// so both read the same. Plain functions with no imports: the relay bundles this file.
import type { FiredAlert, PrintDetails } from './alerts';

export interface AlertText {
  title: string;
  body: string;
}

/** 5025 -> "1 h 24 min" (the same as formatDuration in lib/format). */
function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "models/Benchy_PLA.gcode" -> "Benchy_PLA". */
export function printName(file: string): string {
  const base = file.split('/').pop() ?? '';
  return base.replace(/\.(gcode|g|gco|bgcode)$/i, '') || 'The print';
}

const join = (...parts: (string | number | false | undefined | null)[]) => parts.filter(Boolean).join(' · ');
const lines = (...parts: (string | number | false | undefined | null)[]) => parts.filter(Boolean).join('\n');

/** How the reader's clock shows times: their time zone (no clock times without it), and 12 or 24 hours. */
export interface Clock {
  timeZone?: string;
  hour12?: boolean;
  /** Now, in ms (tests pass a fixed one). */
  now?: number;
}

/** "14:35" or "2:35 PM" in the reader's time zone; "" when that zone is unknown to this runtime. */
function clockTime(at: number, c: Clock): string {
  try {
    return new Intl.DateTimeFormat(c.hour12 ? 'en-US' : 'en-GB', { timeZone: c.timeZone, hour: 'numeric', minute: '2-digit', hour12: !!c.hour12 }).format(at);
  } catch {
    return '';
  }
}

/** The first line of a printer message, without Klipper's "!! " and its "Once the underlying issue is corrected…" advice. */
export function readable(message: string | undefined): string {
  const first = (message ?? '').split('\n').map((l) => l.replace(/^(!!|\/\/)\s*/, '').trim()).find(Boolean) ?? '';
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

/** "38 g of 81 g", or metres when the file has no weight. */
/** "38 g", "3.2 g" */
const grams = (g: number) => `${g < 10 ? Math.round(g * 10) / 10 : Math.round(g)} g`;

function filament(d: PrintDetails, ofTotal = true): string | null {
  if (d.usedMm == null) return null;
  if (d.totalG && d.totalMm) {
    const g = (d.usedMm / d.totalMm) * d.totalG;
    return ofTotal ? `filament ${grams(g)} of ${grams(d.totalG)}` : `${grams(g)} filament used`;
  }
  const m = (mm: number) => `${(mm / 1000).toFixed(mm < 10_000 ? 1 : 0)} m`;
  return ofTotal && d.totalMm ? `filament ${m(d.usedMm)} of ${m(d.totalMm)}` : ofTotal ? `filament ${m(d.usedMm)}` : `${m(d.usedMm)} filament used`;
}

/** "layer 120 of 250" */
const layerOf = (layer: number | undefined, total: number | undefined) => (layer != null ? `layer ${layer}${total ? ` of ${total}` : ''}` : null);

/** `printer` is the printer's name; `bridge` the bridge's, for the offline alert; `clock` how the reader shows times. */
export function alertText(a: Partial<FiredAlert> & { event: FiredAlert['event'] }, printer: string, bridge = 'The bridge', clock: Clock = {}): AlertText {
  const name = printName(a.file ?? '');
  const d: PrintDetails = a.details ?? {};
  const leftS = a.left ?? d.left;
  const total = a.total ?? d.total;
  // Only in the reader's own time zone: a relay's clock would be hours off.
  const doneAt = leftS != null && leftS > 0 && clock.timeZone ? clockTime((clock.now ?? Date.now()) + leftS * 1000, clock) : '';
  const left = leftS != null && leftS > 0 ? join(`${duration(leftS)} left`, doneAt && `done about ${doneAt}`) : null;
  // "47% · layer 120 of 250"
  const where = join(d.percent != null && `${d.percent}%`, layerOf(d.layer, total));
  // "stopped at 47%, layer 120 of 250"
  const stopLayer = layerOf(d.layer ?? a.layer, total);
  const stoppedAt = d.percent != null ? `stopped at ${d.percent}%${stopLayer ? `, ${stopLayer}` : ''}` : stopLayer ? `stopped at ${stopLayer}` : '';
  const used = filament(d, false);
  const err = d.error;
  switch (a.event) {
    case 'started':
      return {
        title: `Printing ${name}`,
        body: lines(join(printer, total && `${total} layers`), leftS ? join(`about ${duration(leftS)}`, doneAt && `done about ${doneAt}`) : null, d.totalG ? `${grams(d.totalG)} filament` : null),
      };
    case 'layer1':
      return { title: 'First layer done', body: lines(join(printer, where || layerOf(1, total)), left) };
    case 'layer3':
      return { title: 'Layer 3 done', body: lines(join(printer, where || layerOf(3, total)), left) };
    case 'layer':
      return { title: `Layer ${a.layer}${total ? ` of ${total}` : ''} done`, body: lines(join(printer, name, d.percent != null && `${d.percent}%`), left) };
    case 'progress':
      return { title: `${name} ${a.percent}% done`, body: lines(join(printer, layerOf(d.layer, total)), left, filament(d)) };
    case 'almostDone':
      return { title: `${name} almost done`, body: lines(join(printer, where), leftS ? join(`about ${duration(leftS)} left`, doneAt && `done about ${doneAt}`) : null) };
    case 'stillPrinting':
      return { title: `Still printing ${name}`, body: lines(join(printer, where), join((a.duration ?? d.printed) && `printing ${duration((a.duration ?? d.printed)!)}`, leftS && leftS > 0 && `${duration(leftS)} left`)) };
    case 'finished': {
      const took = a.duration ?? d.printed;
      return {
        title: `${name} finished`,
        body: lines(
          join(printer, took && `${duration(took)}${d.estimate ? ` (estimate ${duration(d.estimate)})` : ''}`),
          join(d.totalG ? `${grams(d.totalG)} filament` : filament(d, false), total && `${total} layers`),
        ),
      };
    }
    case 'resumed':
      return { title: `${name} resumed`, body: lines(join(printer, where), left) };
    case 'bedCooled':
      return { title: `Bed cooled down: ${name} can come off`, body: printer };
    case 'failed': {
      const spent = join(d.printed && `after ${duration(d.printed)}`, used);
      return a.reason === 'cancelled'
        ? { title: `${name} was cancelled`, body: lines(join(printer, stoppedAt), spent) }
        : { title: `${name} failed`, body: lines(join(printer, stoppedAt), spent, err ? err.text : readable(a.reason), err?.code && `Code ${err.code}`) };
    }
    case 'paused':
      if (a.reason === 'filament') {
        const what = d.runout ? `${d.runout} ran out of filament` : 'filament ran out';
        return { title: `Print paused: ${what}`, body: lines(join(printer, name, where), `Load filament${d.runout ? ` in ${d.runout}` : ''}, then resume in the Device tab.`) };
      }
      return { title: err ? `Print paused: ${err.title}` : 'Print paused', body: lines(join(printer, name, where), err ? err.text : readable(a.reason), err?.code && `Code ${err.code}`) };
    case 'error':
      return {
        title: err ? `Printer error: ${err.title}` : 'Printer error',
        body: lines(join(printer, a.file && `${name} ${stoppedAt || 'stopped'}`), err ? err.text : readable(a.reason) || 'Check the printer’s screen.', err?.code && `Code ${err.code}`),
      };
    case 'offline':
      return { title: `${bridge} is offline`, body: 'It stopped answering 10 minutes ago, so its printers can’t send alerts until it’s back.' };
    case 'test':
      return { title: 'Test alert', body: `Alerts from ${printer} will look like this.` };
  }
}

/** What a push message carries; the service worker (public/sw.js) shows it. */
export interface AlertPush {
  title: string;
  body: string;
  /** A camera picture to show with it. */
  image?: string;
  /** Replaces the last alert with the same tag (one per printer and print). */
  tag: string;
  /** Opens the Device tab on this printer: "<bridgeId>.<printerId>" or "direct.<saved id>". */
  printer: string;
}
