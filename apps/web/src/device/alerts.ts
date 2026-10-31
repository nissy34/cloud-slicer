// Print alerts: which moments of a print are worth telling someone about, from
// the printer's standard Moonraker state (any Klipper printer, nothing U1-only).
//
// The same rules run in two places: in the bridge (apps/device-bridge/alerts.go),
// which watches its printers even with every browser closed, and here, for
// printers the browser reaches directly, which can only alert while a tab is
// open. Both are tested against the same cases (apps/device-bridge/testdata/alert-cases.json).
//
// Who gets what: each browser that turned alerts on keeps its choices (AlertPrefs)
// with the relay (bridge printers) or in this browser (direct printers).
import type { KlipperObjects } from './status';
import { job, remainingSeconds } from './status';

export type AlertEvent =
  | 'started'
  | 'layer1'
  | 'layer3'
  | 'layer'
  | 'progress'
  | 'almostDone'
  | 'stillPrinting'
  | 'finished'
  | 'resumed'
  | 'bedCooled'
  | 'failed'
  | 'paused'
  | 'error'
  | 'offline'
  | 'test';

/**
 * The switches on the Alerts card, in its order. `offline` is the relay's own (the bridge stopped answering).
 * Chosen layers (`layer`) are set by AlertPrefs.layers/layer, not here. `layer3` is no longer offered (it
 * became layers: [3]); the bridge still knows the rule.
 */
export const PROBLEM_EVENTS: AlertEvent[] = ['failed', 'paused', 'error'];
export const MILESTONE_EVENTS: AlertEvent[] = ['started', 'layer1', 'progress', 'almostDone', 'stillPrinting', 'finished', 'resumed', 'bedCooled'];

/** On until the person changes them: problems, and of the milestones only Finished. */
export const DEFAULT_EVENTS: AlertEvent[] = ['failed', 'paused', 'error', 'finished'];

/** The alerts that carry a camera picture until the person changes it: the key ones. */
export const PICTURE_EVENTS: AlertEvent[] = ['layer1', 'layer', 'paused', 'failed', 'error', 'almostDone', 'finished'];
/** Every alert that can carry a picture (not "bridge offline": the camera is behind the bridge). */
export const CAMERA_EVENTS: AlertEvent[] = [...PROBLEM_EVENTS, ...MILESTONE_EVENTS, 'layer'];
/** At most this many cameras in one alert: their pictures are joined into one (a notification shows one). */
export const MAX_ALERT_CAMERAS = 4;
/** Stands for "the printer's first camera" in the defaults, made before the printer's cameras are known. */
export const FIRST_CAMERA = '*';

/** "Almost done" this many seconds before the end. */
export const ALMOST_DONE_S = 600;
/** The bed counts as cooled down below this; it must have been this much warmer when the print finished. */
export const BED_COOL_C = 40;
const BED_WARM_MARGIN_C = 5;
/** Give up waiting for the bed to cool after this long. */
const BED_COOL_GIVE_UP_MS = 4 * 3600_000;

/** One browser's choices for one printer. */
export interface AlertPrefs {
  events: AlertEvent[];
  /** Progress alerts at these percentages (10..90). */
  percents: number[];
  /** "Still printing" every this many hours; 0 = off. */
  hours: number;
  /** After these layers, on every print. */
  layers: number[];
  /** "Alert me after layer N", for the current or next print; cleared when that print ends. */
  layer: number | null;
  /** The cameras each alert's picture comes from, by camera name; none = no picture. */
  cameras: Partial<Record<AlertEvent, string[]>>;
}

/** The first camera on the key alerts. */
const defaultCameras = (): AlertPrefs['cameras'] => Object.fromEntries(PICTURE_EVENTS.map((e) => [e, [FIRST_CAMERA]]));

export const defaultPrefs = (): AlertPrefs => ({ events: [...DEFAULT_EVENTS], percents: [], hours: 0, layers: [], layer: null, cameras: defaultCameras() });

/**
 * Which of the printer's cameras (`names`, in its order) an alert's picture comes
 * from. Names the printer no longer has are skipped; when none is left, its first
 * camera stands in (the defaults, or choices carried over from another printer).
 * The bridge does the same (cameraList in alerts.go; cases in testdata/camera-cases.json).
 */
export function camerasFor(chosen: string[] | undefined, names: string[]): string[] {
  if (!chosen?.length || !names.length) return [];
  const hit = names.filter((n) => chosen.includes(n));
  return (hit.length ? hit : names.slice(0, 1)).slice(0, MAX_ALERT_CAMERAS);
}

/** Names one choice of cameras, to match the bridge's pictures to who asked for them. */
export const cameraKey = (chosen: string[]) => chosen.join('\n');

function cleanCameras(raw: unknown): AlertPrefs['cameras'] {
  const out: AlertPrefs['cameras'] = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const e of CAMERA_EVENTS) {
    const list = (raw as Record<string, unknown>)[e];
    if (!Array.isArray(list)) continue;
    const names = [...new Set(list.filter((n): n is string => typeof n === 'string' && n.length > 0 && n.length <= 64))].slice(0, MAX_ALERT_CAMERAS);
    if (names.length) out[e] = names;
  }
  return out;
}

/** What a device starts with when alerts are turned on: the choices last saved on any device, else the defaults. "After layer N" belongs to one print, so it never carries over. */
export function startingPrefs(last: unknown): AlertPrefs {
  const p = cleanPrefs(last);
  return p ? { ...p, layer: null } : defaultPrefs();
}

/** Cleans prefs that came from storage or the network. */
export function cleanPrefs(raw: unknown): AlertPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const known = new Set<string>([...PROBLEM_EVENTS, ...MILESTONE_EVENTS, 'offline']);
  const events = Array.isArray(r.events) ? [...new Set(r.events.filter((e): e is AlertEvent => typeof e === 'string' && known.has(e)))] : [];
  const percents = Array.isArray(r.percents) ? [...new Set(r.percents.filter((p): p is number => Number.isInteger(p) && p >= 1 && p <= 99))].sort((a, b) => a - b).slice(0, 20) : [];
  const hours = Number.isInteger(r.hours) && (r.hours as number) >= 0 && (r.hours as number) <= 24 ? (r.hours as number) : 0;
  const isLayer = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 100_000;
  const layer = isLayer(r.layer) ? r.layer : null;
  // "Third layer" was its own switch before layers could be chosen.
  const oldThird = Array.isArray(r.events) && r.events.includes('layer3') ? [3] : [];
  const layers = [...new Set([...(Array.isArray(r.layers) ? r.layers.filter(isLayer) : []), ...oldThird])].sort((a, b) => a - b).slice(0, 20);
  // Choices saved before cameras could be picked had one switch for the first camera.
  const cameras = r.cameras !== undefined ? cleanCameras(r.cameras) : r.pictures === false ? {} : defaultCameras();
  const rawCams = r.cameras as Record<string, unknown> | undefined;
  if (oldThird.length && !cameras.layer && rawCams?.layer3) cameras.layer = cleanCameras({ layer: rawCams.layer3 }).layer;
  return { events, percents, hours, layers, layer, cameras };
}

/**
 * Each printer's choices as kept by the relay, brought up to date: ones saved by an
 * older build lack newer fields (cameras), and rules that read them must not trip.
 */
export function cleanPrinterPrefs(raw: unknown): Record<string, AlertPrefs> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([id, p]) => {
    const prefs = cleanPrefs(p);
    return prefs ? [[id, prefs]] : [];
  }));
}

/** What the watcher needs to look for, merged over everyone watching one printer. */
export interface AlertWatch {
  /** The "after layer N" layers. */
  layers: number[];
  percents: number[];
  /** Report each hour printed when anyone wants "still printing". */
  hours: boolean;
}

/** The printer at one moment, reduced to what the rules look at. */
export interface PrintSnapshot {
  /** Klippy: ready, startup, shutdown, error. */
  klippy: string;
  klippyMessage: string;
  state: string;
  file: string;
  /** 0..1 */
  progress: number;
  /** Seconds actually printing. */
  duration: number;
  layer: number | null;
  totalLayers: number | null;
  /** The bed's temperature, when it has one. */
  bed: number | null;
  /** A filament sensor that is on says it has no filament. */
  noFilament: boolean;
  /** Seconds left, when known. */
  left: number | null;
  message: string;
}

export interface FiredAlert {
  event: AlertEvent;
  file: string;
  /** The layer for `layer` (the N asked for), or the current layer. */
  layer?: number;
  total?: number;
  percent?: number;
  /** Seconds left. */
  left?: number;
  /** Seconds printing so far (or in all, when finished). */
  duration?: number;
  /** Hours printed, for `stillPrinting`. */
  hours?: number;
  /** "filament", "cancelled", or the printer's own message. */
  reason?: string;
  /** Where the print is, added when the alert is sent (detailsOf). */
  details?: PrintDetails;
}

/** Where the print stands when an alert goes out: what the alert's text adds beyond the moment itself. */
export interface PrintDetails {
  /** 0..100 */
  percent?: number;
  layer?: number;
  total?: number;
  /** Seconds left. */
  left?: number;
  /** Seconds printing so far. */
  printed?: number;
  /** The slicer's estimate for the whole print, in seconds. */
  estimate?: number;
  /** Filament used so far, and in the whole file. */
  usedMm?: number;
  totalMm?: number;
  /** The whole file's filament weight in grams (to 0.1 g), from the slicer. */
  totalG?: number;
  /** What ran out of filament: a head ("T3") or a filament sensor's name. */
  runout?: string;
  /** The printer's own error in words (the U1's, from Snapmaker's list). */
  error?: { title: string; text: string; code?: string };
}

/** What the G-code file says about the whole print (Moonraker's file metadata). */
export interface FileFacts {
  estimate: number | null;
  totalMm: number | null;
  totalG: number | null;
}

/** Reads FileFacts from server.files.metadata. */
export function fileFacts(m: Record<string, unknown> | null | undefined): FileFacts {
  const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return { estimate: pos(m?.estimated_time), totalMm: pos(m?.filament_total), totalG: pos(m?.filament_weight_total) };
}

/** What ran out: the active head on printers whose feeders report per head (U1), else the one sensor without filament. */
export function runoutOf(o: KlipperObjects): string | undefined {
  const ext = typeof o.toolhead?.extruder === 'string' ? /^extruder(\d*)$/.exec(o.toolhead.extruder) : null;
  const head = ext ? Number(ext[1] || 0) : null;
  if (head != null)
    for (const name of Object.keys(o).sort()) {
      if (!name.startsWith('filament_feed ')) continue;
      const ch = (o[name] ?? {})[`extruder${head}`] as Record<string, unknown> | undefined;
      if (ch && typeof ch === 'object' && ch.filament_detected === false) return `T${head + 1}`;
    }
  const empty = Object.keys(o)
    .filter((n) => (n.startsWith('filament_switch_sensor ') || n.startsWith('filament_motion_sensor ')) && o[n]?.enabled !== false && o[n]?.filament_detected === false)
    .sort();
  return empty.length === 1 ? empty[0].slice(empty[0].indexOf(' ') + 1).replace(/_/g, ' ') : undefined;
}

/** The details an alert carries, from the printer's objects and the file's facts (the bridge's detailsFrom does the same). */
export function detailsOf(o: KlipperObjects, f: FileFacts): PrintDetails {
  const j = job(o);
  const r = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
  const active = ACTIVE.has(j.state);
  const d: PrintDetails = {
    percent: j.state === 'standby' ? undefined : r(Math.min(1, j.progress) * 100),
    layer: r(j.layer),
    total: r(j.totalLayers),
    left: r(remainingSeconds(j, f.estimate)),
    printed: j.state === 'standby' ? undefined : r(j.printSeconds),
    estimate: r(f.estimate),
    usedMm: j.state === 'standby' || !(j.filamentMm > 0) ? undefined : r(j.filamentMm),
    totalMm: r(f.totalMm),
    totalG: f.totalG != null ? Math.round(f.totalG * 10) / 10 : undefined,
    runout: active ? runoutOf(o) : undefined,
  };
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as PrintDetails;
}

const ACTIVE = new Set(['printing', 'paused']);

/** Reads a snapshot from the Klipper objects the Device tab already keeps. `estimate` is the slicer's total time, when the file has one. */
export function snapshotOf(o: KlipperObjects, estimate: number | null): PrintSnapshot {
  const j = job(o);
  const bed = o.heater_bed && typeof o.heater_bed.temperature === 'number' ? o.heater_bed.temperature : null;
  const noFilament = Object.keys(o).some((n) => {
    if (!n.startsWith('filament_switch_sensor ') && !n.startsWith('filament_motion_sensor ')) return false;
    const s = o[n] ?? {};
    return s.enabled !== false && s.filament_detected === false;
  });
  return {
    klippy: typeof o.webhooks?.state === 'string' ? o.webhooks.state : 'ready',
    klippyMessage: typeof o.webhooks?.state_message === 'string' ? o.webhooks.state_message : '',
    state: j.state,
    file: j.filename,
    progress: j.progress,
    duration: j.printSeconds,
    layer: j.layer,
    totalLayers: j.totalLayers,
    bed,
    noFilament,
    left: remainingSeconds(j, estimate),
    message: j.message,
  };
}

/**
 * Follows one printer and says what just happened. The first snapshot only
 * sets the scene, so a watcher that starts mid-print (a bridge restart) never
 * repeats what already passed. Thresholds fire when crossed, never on the way back.
 */
export class AlertWatcher {
  private prev: PrintSnapshot | null = null;
  private almostDone = false;
  private cooling: { since: number; file: string } | null = null;
  private lastError = -Infinity;

  update(s: PrintSnapshot, w: AlertWatch, now: number): FiredAlert[] {
    const p = this.prev;
    this.prev = s;
    if (!p) return [];
    const out: FiredAlert[] = [];
    const base = { file: s.file };

    if (p.klippy === 'ready' && (s.klippy === 'shutdown' || s.klippy === 'error')) {
      out.push({ ...base, event: 'error', reason: s.klippyMessage || undefined });
      this.lastError = now;
    }

    const was = ACTIVE.has(p.state);
    if (s.state === 'printing' && !was) {
      this.almostDone = false;
      this.cooling = null;
      out.push({ ...base, event: 'started', left: s.left ?? undefined, total: s.totalLayers ?? undefined });
    } else if (s.state === 'printing' && p.state === 'paused') {
      out.push({ ...base, event: 'resumed', left: s.left ?? undefined });
    } else if (s.state === 'paused' && p.state === 'printing') {
      out.push({ ...base, event: 'paused', layer: s.layer ?? undefined, reason: s.noFilament ? 'filament' : s.message || undefined });
    } else if (was && s.state === 'complete') {
      out.push({ ...base, event: 'finished', duration: s.duration });
      if (s.bed != null && s.bed >= BED_COOL_C + BED_WARM_MARGIN_C) this.cooling = { since: now, file: s.file };
    } else if (was && s.state === 'cancelled') {
      out.push({ ...base, event: 'failed', reason: 'cancelled', layer: s.layer ?? undefined });
    } else if (was && s.state === 'error' && now - this.lastError > 60_000) {
      out.push({ ...base, event: 'failed', reason: s.message || undefined, layer: s.layer ?? undefined });
    }

    if (s.state === 'printing' && p.state === 'printing' && s.file === p.file) {
      const left = s.left ?? undefined;
      if (p.layer != null && s.layer != null) {
        const crossed = (t: number) => p.layer! < t && s.layer! >= t;
        const total = s.totalLayers ?? undefined;
        // Layer N is done once layer N + 1 starts.
        if (crossed(2)) out.push({ ...base, event: 'layer1', layer: 1, total, left });
        if (crossed(4)) out.push({ ...base, event: 'layer3', layer: 3, total, left });
        for (const n of [...new Set(w.layers)].sort((a, b) => a - b)) if (crossed(n + 1)) out.push({ ...base, event: 'layer', layer: n, total, left });
      }
      const pc = w.percents.filter((x) => p.progress * 100 < x && s.progress * 100 >= x).sort((a, b) => b - a)[0];
      if (pc !== undefined) out.push({ ...base, event: 'progress', percent: pc, left });
      if (w.hours) {
        const h = Math.floor(s.duration / 3600);
        if (h >= 1 && h > Math.floor(p.duration / 3600)) out.push({ ...base, event: 'stillPrinting', hours: h, duration: s.duration, left });
      }
      if (!this.almostDone && s.left != null && p.left != null && s.left <= ALMOST_DONE_S && p.left > ALMOST_DONE_S && s.progress >= 0.5) {
        this.almostDone = true;
        out.push({ ...base, event: 'almostDone', left: s.left });
      }
    }

    if (this.cooling) {
      if (ACTIVE.has(s.state) || now - this.cooling.since > BED_COOL_GIVE_UP_MS) this.cooling = null;
      else if (s.bed != null && s.bed < BED_COOL_C) {
        out.push({ event: 'bedCooled', file: this.cooling.file });
        this.cooling = null;
      }
    }
    return out;
  }

  /** Starts over, as after a lost connection: the next snapshot only sets the scene again. */
  reset() {
    this.prev = null;
  }
}

/** Merges everyone's choices for one printer into what its watcher looks for. */
export function watchFor(all: AlertPrefs[]): AlertWatch {
  const layers = new Set<number>();
  const percents = new Set<number>();
  let hours = false;
  for (const p of all) {
    if (p.layer != null) layers.add(p.layer);
    for (const n of p.layers) layers.add(n);
    if (p.events.includes('progress')) for (const x of p.percents) percents.add(x);
    if (p.events.includes('stillPrinting') && p.hours > 0) hours = true;
  }
  return { layers: [...layers].sort((a, b) => a - b), percents: [...percents].sort((a, b) => a - b), hours };
}

/** Whether one person's choices want this alert. */
export function wants(p: AlertPrefs, a: Pick<FiredAlert, 'event' | 'layer' | 'percent' | 'hours'>): boolean {
  if (a.event === 'test') return true;
  if (a.event === 'layer') return a.layer != null && (a.layer === p.layer || p.layers.includes(a.layer));
  if (!p.events.includes(a.event)) return false;
  if (a.event === 'progress') return a.percent != null && p.percents.includes(a.percent);
  if (a.event === 'stillPrinting') return p.hours > 0 && a.hours != null && a.hours % p.hours === 0;
  return true;
}

/** The alerts that end a print, after which "after layer N" is cleared. */
export const ENDS_PRINT: AlertEvent[] = ['finished', 'failed'];
