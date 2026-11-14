// The words of a print alert. Used by the relay (apps/device-relay), which sends
// bridge alerts as Web Push, and by the page for printers it reaches directly,
// so both read the same. Plain functions; the words come through say.ts, which has
// no i18next: the relay bundles this file and writes in English.
import type { FiredAlert, PrintDetails } from './alerts';
import { say } from './say';

export interface AlertText {
  title: string;
  body: string;
}

/** 5025 -> "1 h 24 min" (the same as formatDuration in lib/format). */
function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return say('deviceAlertText.min', { m });
  return m === 0 ? say('deviceAlertText.hours', { h }) : say('deviceAlertText.hoursMin', { h, m });
}

/** "models/Benchy_PLA.gcode" -> "Benchy_PLA". */
export function printName(file: string): string {
  const base = file.split('/').pop() ?? '';
  return base.replace(/\.(gcode|g|gco|bgcode)$/i, '') || say('deviceAlertText.thePrint');
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
    return ofTotal ? say('deviceAlertText.filamentOf', { used: grams(g), total: grams(d.totalG) }) : say('deviceAlertText.filamentUsed', { used: grams(g) });
  }
  const m = (mm: number) => `${(mm / 1000).toFixed(mm < 10_000 ? 1 : 0)} m`;
  return ofTotal && d.totalMm
    ? say('deviceAlertText.filamentOf', { used: m(d.usedMm), total: m(d.totalMm) })
    : ofTotal
      ? say('deviceAlertText.filamentSoFar', { used: m(d.usedMm) })
      : say('deviceAlertText.filamentUsed', { used: m(d.usedMm) });
}

/** "layer 120 of 250" */
const layerOf = (layer: number | undefined, total: number | undefined) =>
  layer != null ? (total ? say('deviceAlertText.layerOf', { layer, total }) : say('deviceAlertText.layer', { layer })) : null;

/** `printer` is the printer's name; `bridge` the bridge's, for the offline alert; `clock` how the reader shows times. */
export function alertText(a: Partial<FiredAlert> & { event: FiredAlert['event'] }, printer: string, bridge = say('deviceAlertText.theBridge'), clock: Clock = {}): AlertText {
  const name = printName(a.file ?? '');
  const d: PrintDetails = a.details ?? {};
  const leftS = a.left ?? d.left;
  const total = a.total ?? d.total;
  // Only in the reader's own time zone: a relay's clock would be hours off.
  const doneAt = leftS != null && leftS > 0 && clock.timeZone ? clockTime((clock.now ?? Date.now()) + leftS * 1000, clock) : '';
  const doneAbout = doneAt && say('deviceAlertText.doneAbout', { time: doneAt });
  const left = leftS != null && leftS > 0 ? join(say('deviceAlertText.left', { time: duration(leftS) }), doneAbout) : null;
  // "47% · layer 120 of 250"
  const where = join(d.percent != null && `${d.percent}%`, layerOf(d.layer, total));
  // "stopped at 47%, layer 120 of 250"
  const stopLayer = layerOf(d.layer ?? a.layer, total);
  const stoppedAt =
    d.percent != null
      ? stopLayer
        ? say('deviceAlertText.stoppedAtPercentLayer', { percent: d.percent, layer: stopLayer })
        : say('deviceAlertText.stoppedAtPercent', { percent: d.percent })
      : stopLayer
        ? say('deviceAlertText.stoppedAtLayer', { layer: stopLayer })
        : '';
  const used = filament(d, false);
  const err = d.error;
  switch (a.event) {
    case 'started':
      return {
        title: say('deviceAlertText.printing', { name }),
        body: lines(
          join(printer, total && say('deviceAlertText.layers', { count: total })),
          leftS ? join(say('deviceAlertText.about', { time: duration(leftS) }), doneAbout) : null,
          d.totalG ? say('deviceAlertText.filamentTotal', { amount: grams(d.totalG) }) : null,
        ),
      };
    case 'layer1':
      return { title: say('deviceAlertText.firstLayerDone'), body: lines(join(printer, where || layerOf(1, total)), left) };
    case 'layer3':
      return { title: say('deviceAlertText.layer3Done'), body: lines(join(printer, where || layerOf(3, total)), left) };
    case 'layer':
      return { title: total ? say('deviceAlertText.layerOfDone', { layer: a.layer ?? '', total }) : say('deviceAlertText.layerDone', { layer: a.layer ?? '' }), body: lines(join(printer, name, d.percent != null && `${d.percent}%`), left) };
    case 'progress':
      return { title: say('deviceAlertText.percentDone', { name, percent: a.percent ?? '' }), body: lines(join(printer, layerOf(d.layer, total)), left, filament(d)) };
    case 'almostDone':
      return { title: say('deviceAlertText.almostDone', { name }), body: lines(join(printer, where), leftS ? join(say('deviceAlertText.aboutLeft', { time: duration(leftS) }), doneAbout) : null) };
    case 'stillPrinting':
      return {
        title: say('deviceAlertText.stillPrinting', { name }),
        body: lines(
          join(printer, where),
          join((a.duration ?? d.printed) && say('deviceAlertText.printingFor', { time: duration((a.duration ?? d.printed)!) }), leftS && leftS > 0 && say('deviceAlertText.left', { time: duration(leftS) })),
        ),
      };
    case 'finished': {
      const took = a.duration ?? d.printed;
      return {
        title: say('deviceAlertText.finished', { name }),
        body: lines(
          join(printer, took && (d.estimate ? say('deviceAlertText.tookEstimate', { time: duration(took), estimate: duration(d.estimate) }) : duration(took))),
          join(d.totalG ? say('deviceAlertText.filamentTotal', { amount: grams(d.totalG) }) : filament(d, false), total && say('deviceAlertText.layers', { count: total })),
        ),
      };
    }
    case 'resumed':
      return { title: say('deviceAlertText.resumed', { name }), body: lines(join(printer, where), left) };
    case 'bedCooled':
      return { title: say('deviceAlertText.bedCooled', { name }), body: printer };
    case 'failed': {
      const spent = join(d.printed && say('deviceAlertText.after', { time: duration(d.printed) }), used);
      const code = err?.code && say('deviceAlertText.code', { code: err.code });
      return a.reason === 'cancelled'
        ? { title: say('deviceAlertText.cancelled', { name }), body: lines(join(printer, stoppedAt), spent) }
        : { title: say('deviceAlertText.failed', { name }), body: lines(join(printer, stoppedAt), spent, err ? err.text : readable(a.reason), code) };
    }
    case 'paused': {
      if (a.reason === 'filament') {
        const what = d.runout ? say('deviceAlertText.ranOut', { head: d.runout }) : say('deviceAlertText.filamentRanOut');
        return {
          title: say('deviceAlertText.pausedWhat', { what }),
          body: lines(join(printer, name, where), d.runout ? say('deviceAlertText.loadIn', { head: d.runout }) : say('deviceAlertText.load')),
        };
      }
      const code = err?.code && say('deviceAlertText.code', { code: err.code });
      return { title: err ? say('deviceAlertText.pausedWhat', { what: err.title }) : say('deviceAlertText.paused'), body: lines(join(printer, name, where), err ? err.text : readable(a.reason), code) };
    }
    case 'error': {
      const code = err?.code && say('deviceAlertText.code', { code: err.code });
      return {
        title: err ? say('deviceAlertText.errorWhat', { what: err.title }) : say('deviceAlertText.error'),
        body: lines(
          join(printer, a.file && say('deviceAlertText.nameWhere', { name, where: stoppedAt || say('deviceAlertText.stopped') })),
          err ? err.text : readable(a.reason) || say('deviceAlertText.checkScreen'),
          code,
        ),
      };
    }
    case 'offline':
      return { title: say('deviceAlertText.offline', { bridge }), body: say('deviceAlertText.offlineBody') };
    case 'test':
      return { title: say('deviceAlertText.test'), body: say('deviceAlertText.testBody', { printer }) };
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
