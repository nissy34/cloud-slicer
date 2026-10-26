// Print history: which plates of a saved project were printed, and whether a
// plate changed since. Desktop Orca has nothing like it; the records live in
// the account (functions/_lib/prints.ts), this file is the logic around them.
//
// What a plate prints is summed up as a fingerprint when it is sent: the
// engine's fingerprints of the plate's objects and own settings
// (engine/src/fingerprint_api.cpp) plus every setting value it slices with.
// A plate whose fingerprint differs from the one it was printed with shows
// "Changed since printed"; the summary kept with the record says what changed.
import type { OrcaConfig } from '../engine/protocol';

/** What the engine says about one plate (engine/src/fingerprint_api.cpp). */
export interface PlateFingerprint {
  objects: { name: string; copies: number; shape: string; place: string; settings: string; paint: string }[];
  plate: string;
}

/** A plate's fingerprint with its settings: a short hash per setting, so a later look can name which changed. */
export interface PlateSummary extends PlateFingerprint {
  config: Record<string, string>;
}

/**
 * uploaded   on the printer, not started from here (a later start on the printer counts)
 * sent       started from the Send window
 * printing   the printer said it is printing it
 * printed / failed / cancelled   how the print ended, as the printer said
 * marked / unmarked              by hand, from the plate menu
 * unknown    no word from the printer: the same file was sent again, the plate
 *            was marked by hand, or a week went by
 */
export type PrintStatus = 'uploaded' | 'sent' | 'printing' | 'printed' | 'failed' | 'cancelled' | 'marked' | 'unmarked' | 'unknown';

export interface PrintRecord {
  id: string;
  projectId: string;
  /** 0-based plate index. */
  plate: number;
  status: PrintStatus;
  /** Unix ms of the send or mark. */
  at: number;
  endedAt: number | null;
  /** Seconds the printer spent printing, when it said. */
  duration: number | null;
  /** 0-1 when it ended (failed or cancelled). */
  progress: number | null;
  /** The saved printer's id and its name then. */
  printer: string | null;
  printerName: string | null;
  /** The file on the printer. */
  file: string | null;
  fingerprint: string | null;
  summary: PlateSummary | null;
}

/** The saved project's plate a sliced file came from, as the Send window gets it. */
export interface PrintOrigin {
  projectId: string;
  plate: number;
  fingerprint: string;
  summary: PlateSummary;
  /** The record the send makes (in the file's tag line). */
  printId: string;
}

/** Records still waiting for the printer to say how they went. */
export const OPEN_STATUSES: PrintStatus[] = ['uploaded', 'sent', 'printing'];
/** How long a record waits for the printer before it counts as "no word" (functions/_lib/prints.ts). */
export const OPEN_FOR_MS = 7 * 24 * 3600 * 1000;

/** Settings that are names, not values: renaming a preset doesn't change the print. */
const NAME_KEYS = new Set(['inherits', 'print_settings_id', 'filament_settings_id', 'printer_settings_id', 'printer_model', 'printer_variant', 'default_print_profile', 'default_filament_profile']);
/** Settings that hold one value per plate (comma-separated): only this plate's counts. */
const PER_PLATE_KEYS = new Set(['wipe_tower_x', 'wipe_tower_y']);

/** A short stable hash of a string (FNV-1a, 32-bit, 8 hex digits). */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The plate's summary from the engine's fingerprint and the settings it slices with. */
export function summarize(fp: PlateFingerprint, config: OrcaConfig, plate: number): PlateSummary {
  const hashed: Record<string, string> = {};
  for (const key of Object.keys(config).sort()) {
    if (NAME_KEYS.has(key)) continue;
    let value = config[key] ?? '';
    if (PER_PLATE_KEYS.has(key)) value = value.split(',')[plate] ?? '';
    hashed[key] = shortHash(value);
  }
  return { objects: fp.objects, plate: fp.plate, config: hashed };
}

/**
 * Whether a plate prints the same as it did: the same objects and plate
 * settings, and the same value for every setting both have. A setting only
 * one side has came with another engine version (or the other engine), not
 * from the person, so it doesn't count.
 */
export function samePrint(then: PlateSummary, now: PlateSummary): boolean {
  const objects = (s: PlateSummary) => s.objects.map((o) => [o.name, o.copies, o.shape, o.place, o.settings, o.paint].join('|')).sort().join(';');
  if (then.plate !== now.plate || objects(then) !== objects(now)) return false;
  return Object.keys(then.config).every((k) => !(k in now.config) || then.config[k] === now.config[k]);
}

/** One string for the whole summary: equal summaries, equal fingerprints. */
export function fingerprintOf(s: PlateSummary): string {
  const objects = s.objects.map((o) => [o.name, o.copies, o.shape, o.place, o.settings, o.paint].join('|')).join(';');
  const config = Object.keys(s.config)
    .sort()
    .map((k) => `${k}=${s.config[k]}`)
    .join(';');
  return shortHash(objects) + shortHash(s.plate) + shortHash(config) + shortHash(objects + s.plate + config);
}

export type PlateMark =
  | { state: 'none' }
  /** Started and not finished yet (or the printer never said). */
  | { state: 'sent'; record: PrintRecord }
  | { state: 'printed'; record: PrintRecord }
  /** Printed, but the plate is different now. */
  | { state: 'changed'; record: PrintRecord };

const decides = (s: PrintStatus) => s === 'printed' || s === 'marked' || s === 'unmarked';

/** Whether a printed record is for something other than what the plate prints now. */
function changedSince(r: PrintRecord, now: PlateSummary): boolean {
  if (r.summary) return !samePrint(r.summary, now);
  return Boolean(r.fingerprint && r.fingerprint !== fingerprintOf(now));
}

/**
 * The plate's mark from its records (any order) and what it prints now
 * (undefined: not known yet, so a printed plate shows as printed).
 * The newest started print that hasn't ended shows first (for a week at
 * most); otherwise the newest print or mark decides. A failed or cancelled
 * print doesn't take an earlier good one away.
 */
export function plateMark(records: PrintRecord[], now: PlateSummary | undefined, at = Date.now()): PlateMark {
  const newest = [...records].sort((a, b) => b.at - a.at);
  const started = newest.find((r) => r.status !== 'uploaded');
  if (started && (started.status === 'sent' || started.status === 'printing') && at - started.at < OPEN_FOR_MS) return { state: 'sent', record: started };
  const last = newest.find((r) => decides(r.status));
  if (!last || last.status === 'unmarked') return { state: 'none' };
  if (now && changedSince(last, now)) return { state: 'changed', record: last };
  return { state: 'printed', record: last };
}

/** Each plate's mark: records grouped by plate, what each plate prints now by plate. */
export function plateMarks(records: PrintRecord[], plates: number, now: Record<number, PlateSummary | undefined>): PlateMark[] {
  return Array.from({ length: plates }, (_, p) =>
    plateMark(
      records.filter((r) => r.plate === p),
      now[p],
    ),
  );
}

/** For "Printed 6 of 10": printed (green or amber), of those changed, and the first plate with nothing. */
export function progressOf(marks: PlateMark[], empty: (plate: number) => boolean) {
  let printed = 0;
  let changed = 0;
  let next: number | null = null;
  let total = 0;
  marks.forEach((m, p) => {
    if (empty(p)) return;
    total++;
    if (m.state === 'printed' || m.state === 'changed') printed++;
    if (m.state === 'changed') changed++;
    if (next === null && m.state !== 'printed' && m.state !== 'sent') next = p;
  });
  return { printed, changed, total, next: next as number | null };
}

/** What changed between the summary a plate was printed with and now, in plain words. */
export function changesBetween(then: PlateSummary, now: PlateSummary, label: (key: string) => string | undefined): string[] {
  const out: string[] = [];
  const byName = (s: PlateSummary) => {
    const m = new Map<string, PlateSummary['objects']>();
    for (const o of s.objects) m.set(o.name, [...(m.get(o.name) ?? []), o]);
    return m;
  };
  const a = byName(then);
  const b = byName(now);
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const reshaped: string[] = [];
  const own: string[] = [];
  const painted: string[] = [];
  const copies: string[] = [];
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    const was = a.get(name) ?? [];
    const is = b.get(name) ?? [];
    for (let i = Math.min(was.length, is.length); i < was.length; i++) removed.push(name);
    for (let i = Math.min(was.length, is.length); i < is.length; i++) added.push(name);
    for (let i = 0; i < Math.min(was.length, is.length); i++) {
      const x = was[i];
      const y = is[i];
      if (x.copies !== y.copies) copies.push(name);
      else if (x.place !== y.place) moved.push(name);
      if (x.shape !== y.shape) reshaped.push(name);
      if (x.settings !== y.settings) own.push(name);
      if (x.paint !== y.paint) painted.push(name);
    }
  }
  const list = (names: string[]) => [...new Set(names)].join(', ');
  if (added.length) out.push(`Added: ${list(added)}`);
  if (removed.length) out.push(`Removed: ${list(removed)}`);
  if (copies.length) out.push(`Number of copies: ${list(copies)}`);
  if (moved.length) out.push(`Moved: ${list(moved)}`);
  if (reshaped.length) out.push(`Shape changed: ${list(reshaped)}`);
  if (own.length) out.push(`Object settings: ${list(own)}`);
  if (painted.length) out.push(`Paint: ${list(painted)}`);
  if (then.plate !== now.plate) out.push('Plate settings, pauses or custom G-code');
  // Settings only one side has came with another engine version: not a change (samePrint).
  const keys = Object.keys(then.config)
    .filter((k) => k in now.config && then.config[k] !== now.config[k])
    .sort();
  if (keys.length) {
    const names = [...new Set(keys.map((k) => label(k) || k))];
    const shown = names.slice(0, 4).join(', ');
    out.push(`Settings: ${shown}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`);
  }
  return out;
}

/**
 * The line each G-code sent or downloaded from a saved project carries near
 * its top, so the file says which plate it is wherever it goes
 * (renamed, started from the printer's screen, copied to an SD card):
 *   ; cloud_slicer_print = <project id>/<plate number, from 1>/<fingerprint>/<print id>
 * The print id is the record this send makes, so whatever the printer then
 * says (the bridge reads the line) lands on that record, in whichever order
 * the page and the printer are heard. Only the account that owns the project
 * can do anything with it.
 */
export const PRINT_TAG = 'cloud_slicer_print';

export interface PrintTag {
  projectId: string;
  plate: number;
  fingerprint: string;
  printId: string;
}

/** A new record's id, made before the file is sent so the file can carry it. */
export const newPrintId = (): string => crypto.randomUUID();

export function printTagLine(o: PrintTag): string {
  return `; ${PRINT_TAG} = ${o.projectId}/${o.plate + 1}/${o.fingerprint}/${o.printId}\n`;
}

/** The plate and record a G-code's text (its first few KB are enough) says it is, or null. */
export function readPrintTag(text: string): PrintTag | null {
  const m = new RegExp(`^; ${PRINT_TAG} = ([A-Za-z0-9_-]{1,64})/(\\d{1,4})/([0-9a-f]{8,64})/([A-Za-z0-9_-]{8,64})\\s*$`, 'm').exec(text);
  return m && Number(m[2]) >= 1 ? { projectId: m[1], plate: Number(m[2]) - 1, fingerprint: m[3], printId: m[4] } : null;
}

/**
 * The G-code with its tag line after Orca's header block (the printer's screen
 * reads that block, so the tag stays out of it), or after the first line when
 * there is none. The rest is not copied, only referenced.
 */
export async function withPrintTag(gcode: Blob, o: PrintTag): Promise<Blob> {
  const head = await gcode.slice(0, 16384).text();
  const block = head.indexOf('; HEADER_BLOCK_END');
  const end = head.indexOf('\n', block < 0 ? 0 : block);
  const at = end < 0 ? 0 : new TextEncoder().encode(head.slice(0, end + 1)).length;
  return new Blob([gcode.slice(0, at), printTagLine(o), gcode.slice(at)], { type: gcode.type });
}

/** A file name as the printer reports it, for comparing with what was sent ("gcodes/a.gcode" = "a.gcode"). */
export function sameFile(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^gcodes\//i, '').toLowerCase();
  return norm(a) !== '' && norm(a) === norm(b);
}

/** The printer's job state as a record status: printing, or how it ended; null for standby. */
export function statusFromJob(state: string): PrintStatus | null {
  if (state === 'printing' || state === 'paused') return 'printing';
  if (state === 'complete') return 'printed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'error') return 'failed';
  return null;
}

/**
 * What a printer's job means for an open record: the new status, or null when
 * nothing changes. An end only counts after the record was seen printing, so
 * an older finished print of the same file name never marks a new one.
 * One exception: a print started from the Send window that ended while no
 * page watched. It counts when the job took no longer than the time since the
 * send (`totalSeconds`: start to end, as Klipper reports it), so the job must
 * have run after the send, not before.
 */
export function nextStatus(
  record: PrintRecord,
  printer: string,
  job: { state: string; filename: string; totalSeconds?: number },
  at = Date.now(),
): PrintStatus | null {
  if (!OPEN_STATUSES.includes(record.status) || record.printer !== printer || !record.file || !sameFile(record.file, job.filename)) return null;
  const s = statusFromJob(job.state);
  if (!s) return null;
  if (s === 'printing') return record.status === 'printing' ? null : 'printing';
  if (record.status === 'printing') return s;
  const total = job.totalSeconds ?? 0;
  return record.status === 'sent' && total > 0 && at - record.at >= total * 1000 ? s : null;
}

/** Short words for a record in the history list. */
export function statusWords(r: PrintRecord): string {
  switch (r.status) {
    case 'uploaded':
      return 'Uploaded, not started';
    case 'sent':
      return 'Sent';
    case 'printing':
      return 'Printing';
    case 'printed':
      return 'Printed';
    case 'failed':
      return r.progress != null ? `Failed at ${Math.round(r.progress * 100)}%` : 'Failed';
    case 'cancelled':
      return r.progress != null ? `Cancelled at ${Math.round(r.progress * 100)}%` : 'Cancelled';
    case 'marked':
      return 'Marked as printed';
    case 'unmarked':
      return 'Marked as not printed';
    case 'unknown':
      return 'No word from the printer';
  }
}
