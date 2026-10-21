// The words of a print alert. Used by the relay (apps/device-relay), which sends
// bridge alerts as Web Push, and by the page for printers it reaches directly,
// so both read the same. Plain functions with no imports: the relay bundles this file.
import type { FiredAlert } from './alerts';

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

const join = (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(' · ');

/** `printer` is the printer's name; `bridge` the bridge's, for the offline alert. */
export function alertText(a: Partial<FiredAlert> & { event: FiredAlert['event'] }, printer: string, bridge = 'The bridge'): AlertText {
  const name = printName(a.file ?? '');
  const left = a.left != null && a.left > 0 ? `${duration(a.left)} left` : null;
  const of = a.total ? ` of ${a.total}` : '';
  switch (a.event) {
    case 'started':
      return { title: `Printing ${name}`, body: join(printer, a.left ? `about ${duration(a.left)}` : null) };
    case 'layer1':
      return { title: 'First layer done: check it stuck', body: join(printer, name, left) };
    case 'layer3':
      return { title: 'Layer 3 done: check the first layers', body: join(printer, name, left) };
    case 'layer':
      return { title: `Layer ${a.layer}${of} done`, body: join(printer, name, left) };
    case 'progress':
      return { title: `${name} ${a.percent}% done`, body: join(printer, left) };
    case 'almostDone':
      return { title: `${name} almost done`, body: join(printer, a.left ? `about ${duration(a.left)} left` : null) };
    case 'stillPrinting':
      return { title: `Still printing ${name}`, body: join(printer, a.duration ? `${duration(a.duration)} so far` : null, left) };
    case 'finished':
      return { title: `${name} finished`, body: join(printer, a.duration ? duration(a.duration) : null) };
    case 'resumed':
      return { title: `${name} resumed`, body: join(printer, left) };
    case 'bedCooled':
      return { title: `Bed cooled down: ${name} can come off`, body: printer };
    case 'failed':
      return a.reason === 'cancelled'
        ? { title: `${name} was cancelled`, body: join(printer, a.layer ? `at layer ${a.layer}` : null) }
        : { title: `${name} failed`, body: join(printer, a.reason) };
    case 'paused':
      return a.reason === 'filament'
        ? { title: 'Print paused: filament ran out', body: join(printer, name) }
        : { title: 'Print paused', body: join(printer, name, a.reason) };
    case 'error':
      return { title: 'Printer error', body: join(printer, a.reason) };
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
