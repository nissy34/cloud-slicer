// Turns the raw Klipper objects Moonraker reports into what the Device screen
// shows. Generic for any Klipper printer; printer-specific extras live in
// addons/. Pure functions, unit tested in status.test.ts.

export type KlipperObjects = Record<string, Record<string, unknown> | undefined>;

export type PrintState = 'standby' | 'printing' | 'paused' | 'complete' | 'cancelled' | 'error';

export interface Heater {
  /** Klipper object name, e.g. "extruder1", "heater_bed", "heater_generic chamber". */
  name: string;
  label: string;
  kind: 'nozzle' | 'bed' | 'chamber' | 'other';
  temp: number;
  target: number;
  /** 0..1 heater duty, when reported. */
  power: number | null;
  /** Highest target the UI offers. */
  max: number;
}

export interface Sensor {
  name: string;
  label: string;
  temp: number;
}

export interface Fan {
  name: string;
  label: string;
  /** 0..1 */
  speed: number;
  rpm: number | null;
  /** Only the part fan and fan_generic accept speed commands. */
  settable: boolean;
}

export interface Light {
  name: string;
  label: string;
  on: boolean;
}

export interface Job {
  state: PrintState;
  filename: string;
  /** 0..1 */
  progress: number;
  printSeconds: number;
  layer: number | null;
  totalLayers: number | null;
  message: string;
  filamentMm: number;
}

export interface Motion {
  homed: string;
  position: [number, number, number];
  activeExtruder: string;
  speedFactor: number;
  extrudeFactor: number;
  speed: number | null;
  axisMin: [number, number, number] | null;
  axisMax: [number, number, number] | null;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

const PRINT_STATES: PrintState[] = ['standby', 'printing', 'paused', 'complete', 'cancelled', 'error'];

/** Words for an object's own name: "chamber_temp" -> "Chamber temp". */
export function humanize(name: string): string {
  const s = name.replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : name;
}

/** "extruder" -> 0, "extruder3" -> 3, anything else -> null. */
export function extruderIndex(name: string): number | null {
  const m = /^extruder(\d*)$/.exec(name);
  return m ? (m[1] ? Number(m[1]) : 0) : null;
}

export function heaterLabel(name: string, nozzleCount: number): string {
  const ex = extruderIndex(name);
  if (ex != null) return nozzleCount > 1 ? `Nozzle ${ex + 1}` : 'Nozzle';
  if (name === 'heater_bed') return 'Bed';
  const [, own = name] = name.split(' ');
  return humanize(own);
}

/** Objects every Klipper printer gets subscribed to, chosen from printer.objects.list. */
export function genericObjects(available: string[]): string[] {
  const fixed = [
    'webhooks',
    'print_stats',
    'virtual_sdcard',
    'display_status',
    'toolhead',
    'gcode_move',
    'idle_timeout',
    'heaters',
    'fan',
    'motion_report',
    'exclude_object',
    'heater_bed',
  ];
  const prefixes = ['heater_generic ', 'temperature_sensor ', 'temperature_fan ', 'fan_generic ', 'heater_fan ', 'controller_fan ', 'led ', 'neopixel ', 'dotstar '];
  return available.filter((n) => fixed.includes(n) || extruderIndex(n) != null || prefixes.some((p) => n.startsWith(p)));
}

export function heaters(o: KlipperObjects): Heater[] {
  const listed = (o.heaters?.available_heaters as string[] | undefined) ?? Object.keys(o).filter((n) => extruderIndex(n) != null || n === 'heater_bed' || n.startsWith('heater_generic '));
  const nozzles = listed.filter((n) => extruderIndex(n) != null).length;
  const out = listed
    .filter((n) => o[n])
    .map((n): Heater => {
      const h = o[n]!;
      const kind: Heater['kind'] = extruderIndex(n) != null ? 'nozzle' : n === 'heater_bed' ? 'bed' : /chamber/i.test(n) ? 'chamber' : 'other';
      return {
        name: n,
        label: heaterLabel(n, nozzles),
        kind,
        temp: num(h.temperature),
        target: num(h.target),
        power: typeof h.power === 'number' ? h.power : null,
        max: kind === 'nozzle' ? 300 : kind === 'bed' ? 120 : 80,
      };
    });
  const order = { nozzle: 0, bed: 1, chamber: 2, other: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function sensors(o: KlipperObjects): Sensor[] {
  return Object.keys(o)
    .filter((n) => n.startsWith('temperature_sensor ') || n.startsWith('temperature_fan '))
    .filter((n) => typeof o[n]?.temperature === 'number')
    .map((n) => ({ name: n, label: humanize(n.split(' ')[1]), temp: num(o[n]!.temperature) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function fans(o: KlipperObjects): Fan[] {
  const out: Fan[] = [];
  if (o.fan) out.push({ name: 'fan', label: 'Part cooling', speed: num(o.fan.speed), rpm: typeof o.fan.rpm === 'number' ? o.fan.rpm : null, settable: true });
  for (const n of Object.keys(o)) {
    const [kind, own] = n.split(' ');
    if (!own || !['fan_generic', 'heater_fan', 'controller_fan', 'temperature_fan'].includes(kind)) continue;
    const f = o[n]!;
    out.push({ name: n, label: humanize(own), speed: num(f.speed), rpm: typeof f.rpm === 'number' ? f.rpm : null, settable: kind === 'fan_generic' });
  }
  return out;
}

/** True when an LED's colour data has any channel lit. */
export function ledIsOn(led: Record<string, unknown> | undefined): boolean {
  const cd = led?.color_data;
  if (!Array.isArray(cd)) return false;
  return cd.some((c) => Array.isArray(c) && c.some((v) => num(v) > 0));
}

export function lights(o: KlipperObjects): Light[] {
  return Object.keys(o)
    .filter((n) => /^(led|neopixel|dotstar) /.test(n))
    .map((n) => ({ name: n, label: humanize(n.split(' ')[1]), on: ledIsOn(o[n]) }));
}

export function job(o: KlipperObjects): Job {
  const ps = o.print_stats ?? {};
  const vsd = o.virtual_sdcard ?? {};
  const raw = str(ps.state, 'standby') as PrintState;
  const info = (ps.info ?? {}) as Record<string, unknown>;
  return {
    state: PRINT_STATES.includes(raw) ? raw : 'standby',
    filename: str(ps.filename),
    // virtual_sdcard tracks the file position; display_status only follows M73.
    progress: num(vsd.progress, num(o.display_status?.progress)),
    printSeconds: num(ps.print_duration),
    layer: typeof info.current_layer === 'number' ? info.current_layer : null,
    totalLayers: typeof info.total_layer === 'number' ? info.total_layer : null,
    message: str(ps.message),
    filamentMm: num(ps.filament_used),
  };
}

/**
 * Seconds left: the slicer's estimate scaled by progress when the file has one,
 * otherwise extrapolated from the time printed so far. Null before it starts.
 */
export function remainingSeconds(j: Job, estimatedTotal: number | null): number | null {
  if (j.state !== 'printing' && j.state !== 'paused') return null;
  if (!(j.progress > 0)) return estimatedTotal;
  if (j.progress >= 1) return 0;
  if (estimatedTotal && estimatedTotal > 0) return Math.max(0, estimatedTotal * (1 - j.progress));
  if (j.printSeconds > 0) return Math.max(0, j.printSeconds / j.progress - j.printSeconds);
  return null;
}

export function motion(o: KlipperObjects): Motion {
  const th = o.toolhead ?? {};
  const gm = o.gcode_move ?? {};
  const pos = (Array.isArray(gm.gcode_position) ? gm.gcode_position : Array.isArray(th.position) ? th.position : []) as number[];
  const triple = (v: unknown): [number, number, number] | null =>
    Array.isArray(v) && v.length >= 3 ? [num(v[0]), num(v[1]), num(v[2])] : null;
  const live = o.motion_report?.live_velocity;
  return {
    homed: str(th.homed_axes),
    position: [num(pos[0]), num(pos[1]), num(pos[2])],
    activeExtruder: str(th.extruder, 'extruder'),
    speedFactor: num(gm.speed_factor, 1),
    extrudeFactor: num(gm.extrude_factor, 1),
    speed: typeof live === 'number' ? live : null,
    axisMin: triple(th.axis_minimum),
    axisMax: triple(th.axis_maximum),
  };
}

/** Klippy's own state: ready, startup, shutdown, error. */
export function klippyState(o: KlipperObjects): string {
  return str(o.webhooks?.state, 'ready');
}

export function klippyMessage(o: KlipperObjects): string {
  return str(o.webhooks?.state_message);
}

/** Deep-merges a notify_status_update diff, returning new top-level objects for changed keys. */
export function mergeStatus(prev: KlipperObjects, diff: KlipperObjects): KlipperObjects {
  const next: KlipperObjects = { ...prev };
  for (const [k, v] of Object.entries(diff)) {
    next[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(prev[k] ?? {}), ...v } : v;
  }
  return next;
}
