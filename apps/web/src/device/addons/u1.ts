// Snapmaker U1 extras. The U1 runs Snapmaker's own Klipper fork
// (github.com/Snapmaker/u1-klipper); the commands and objects below come from
// its klippy/extras: print_task_config (filament per tool head, print
// preferences, tool map), filament_feed (automatic load/unload), purifier
// (the top cover's air purifier), machine_state_manager and the cavity light.
import type { KlipperObjects } from '../status';
import type { PrinterAddon } from './types';
import { differenceCie76 } from 'culori';

export const U1_HEADS = 4;
export const U1_LIGHT = 'led cavity_led';

export const u1Addon: PrinterAddon = {
  id: 'u1',
  model: 'Snapmaker U1',
  detect: (f) => f.objects.includes('print_task_config'),
  objects: (f) =>
    f.objects.filter(
      (n) => ['print_task_config', 'purifier', 'machine_state_manager', 'filament_detect', U1_LIGHT].includes(n) || n.startsWith('filament_feed '),
    ),
  camera: {
    // The U1's camera service writes frames here while a monitor session is open.
    snapshotUrl: '/server/files/camera/monitor.jpg',
    keepalive: { method: 'camera.start_monitor', params: { domain: 'lan', interval: 0 }, everyMs: 2000 },
  },
  activity: (o) => u1Activity(o),
};

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown) => (typeof v === 'string' ? v : '');

export interface FeedChannel {
  module: string;
  channel: number;
  moduleExists: boolean;
  filamentDetected: boolean;
  auto: boolean;
  state: string;
  error: string;
}

export interface U1Head {
  index: number;
  label: string;
  /** #RRGGBB */
  colour: string;
  material: string;
  subType: string;
  vendor: string;
  loaded: boolean;
  /** Read from a Snapmaker RFID tag: the firmware won't let it be edited. */
  official: boolean;
  feed: FeedChannel | null;
  /** Whether the head is in its dock or on the carriage, from the dock sensors. */
  dock: 'parked' | 'attached' | 'unknown' | null;
  nozzle: { diameter: number; volumeType: string } | null;
  /** Pick-ups since the counter was reset on the printer, and failed ones. */
  switches: { count: number; errors: number; sinceMaintenance: number } | null;
}

/** "E72F1DFF" -> "#E72F1D". */
export function rgbaToHex(rgba: unknown): string {
  const c = s(rgba).replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}/.test(c) ? `#${c.slice(0, 6)}` : '#808080';
}

const NONE = (v: string) => (v === 'NONE' ? '' : v);

/** Which feed module and channel serves each tool head (filament_feed reports extruderN keys). */
export function feedChannels(o: KlipperObjects): Map<number, FeedChannel> {
  const out = new Map<number, FeedChannel>();
  for (const name of Object.keys(o)) {
    if (!name.startsWith('filament_feed ')) continue;
    const module = name.slice('filament_feed '.length);
    Object.entries(o[name] ?? {}).forEach(([key, v], channel) => {
      const m = /^extruder(\d+)$/.exec(key);
      if (!m || !v || typeof v !== 'object') return;
      const c = v as Record<string, unknown>;
      out.set(Number(m[1]), {
        module,
        channel,
        moduleExists: c.module_exist !== false,
        filamentDetected: c.filament_detected === true,
        auto: c.disable_auto !== true,
        state: s(c.channel_state),
        error: s(c.channel_error) === 'ok' ? '' : s(c.channel_error),
      });
    });
  }
  return out;
}

export function u1Heads(o: KlipperObjects): U1Head[] {
  const ptc = o.print_task_config ?? {};
  const feeds = feedChannels(o);
  return Array.from({ length: U1_HEADS }, (_, i) => ({
    index: i,
    label: `T${i + 1}`,
    colour: rgbaToHex(arr(ptc.filament_color_rgba)[i]),
    material: NONE(s(arr(ptc.filament_type)[i])),
    subType: NONE(s(arr(ptc.filament_sub_type)[i])),
    vendor: NONE(s(arr(ptc.filament_vendor)[i])),
    loaded: Boolean(arr(ptc.filament_exist)[i]),
    official: Boolean(arr(ptc.filament_official)[i]),
    feed: feeds.get(i) ?? null,
    ...headState(o[u1ExtruderName(i)]),
  }));
}

/** Klipper's name for head i: extruder, extruder1, extruder2, extruder3. */
export const u1ExtruderName = (i: number) => (i ? `extruder${i}` : 'extruder');

function headState(e: Record<string, unknown> | undefined): Pick<U1Head, 'dock' | 'nozzle' | 'switches'> {
  if (!e) return { dock: null, nozzle: null, switches: null };
  const dock = e.state === 'PARKED' ? 'parked' : e.state === 'ACTIVATE' ? 'attached' : e.state === undefined ? null : 'unknown';
  const diameter = Number(e.nozzle_diameter);
  const count = Number(e.switch_count ?? NaN);
  return {
    dock,
    nozzle: Number.isFinite(diameter) && diameter > 0 ? { diameter, volumeType: s(e.nozzle_volume_type) || 'standard' } : null,
    switches: Number.isFinite(count)
      ? { count, errors: Number(e.error_count ?? 0), sinceMaintenance: count - Number(e.last_maintenance_count ?? 0) }
      : null,
  };
}

/** Takes head i from its dock (parking the head on the carriage first). The firmware homes X/Y if needed. */
export const pickHeadGcode = (i: number) => `PICK_${u1ExtruderName(i).toUpperCase()}`;
/** Puts head i back in its dock. */
export const parkHeadGcode = (i: number) => `PARK_${u1ExtruderName(i).toUpperCase()}`;

/** Nozzle sizes and kinds the U1 firmware accepts (VALID_NOZZLE_DIAMETERS / VOLUME_TYPES). */
export const U1_NOZZLE_DIAMETERS = [0.2, 0.4, 0.6, 0.8];
export const U1_NOZZLE_TYPES = [
  { id: 'standard', label: 'Standard' },
  { id: 'high_flow', label: 'High flow' },
];

/** Tells the printer which nozzle is fitted to head i. Refused while printing. */
export function nozzleGcode(i: number, diameter: number, volumeType: string): string {
  if (!U1_NOZZLE_DIAMETERS.includes(diameter)) throw new Error(`Unsupported nozzle size ${diameter} mm.`);
  if (!U1_NOZZLE_TYPES.some((t) => t.id === volumeType)) throw new Error(`Unsupported nozzle type ${volumeType}.`);
  return `SET_NOZZLE_PROPERTIES EXTRUDER=${u1ExtruderName(i)} DIAMETER=${diameter} VOLUME_TYPE=${volumeType}`;
}

/** Starts counting tool changes again for every head, after cleaning/servicing the docks. */
export const RESET_MAINTENANCE_GCODE = 'RESET_EXTRUDER_MAINTENANCE_COUNT';

/** Print options the U1 keeps between prints (print_task_config). */
export interface U1PrintOptions {
  bedLevel: boolean;
  flowCalibrate: boolean;
  timeLapse: boolean;
}

export function u1PrintOptions(o: KlipperObjects): U1PrintOptions {
  const ptc = o.print_task_config ?? {};
  return { bedLevel: ptc.auto_bed_leveling === true, flowCalibrate: ptc.flow_calibrate === true, timeLapse: ptc.time_lapse_camera === true };
}

const clean = (v: string) => v.replace(/['"\r\n;#*]/g, '').trim();

export function filamentConfigGcode(head: number, f: { material: string; subType: string; vendor: string; colour: string }): string {
  const hex = f.colour.replace('#', '').toUpperCase();
  const rgba = /^[0-9A-F]{6}$/.test(hex) ? `${hex}FF` : 'FFFFFFFF';
  return [
    'SET_PRINT_FILAMENT_CONFIG',
    `CONFIG_EXTRUDER=${head}`,
    `FILAMENT_TYPE='${clean(f.material) || 'PLA'}'`,
    `FILAMENT_SUBTYPE='${clean(f.subType)}'`,
    `VENDOR='${clean(f.vendor) || 'Generic'}'`,
    `FILAMENT_COLOR_RGBA='${rgba}'`,
  ].join(' ');
}

/** Automatic load or unload through the head's feed module. */
export function feedGcode(feed: FeedChannel, action: 'load' | 'unload'): string {
  if (!/^\w+$/.test(feed.module)) throw new Error(`Unexpected feed module: ${feed.module}`);
  return `FEED_AUTO MODULE=${feed.module} CHANNEL=${feed.channel} ${action === 'load' ? 'LOAD' : 'UNLOAD'}=1`;
}

export const u1LightGcode = (on: boolean) => `SET_LED LED=cavity_led WHITE=${on ? 1 : 0} RED=0 GREEN=0 BLUE=0`;

export interface U1Purifier {
  exhaust: number | null;
  inner: number | null;
  mode: string;
}

/** The top cover's purifier, or null when no cover is fitted. */
export function u1Purifier(o: KlipperObjects): U1Purifier | null {
  const p = o.purifier;
  if (!p || p.power_detected !== true) return null;
  const speed = (f: unknown) => (f && typeof f === 'object' && typeof (f as { speed?: unknown }).speed === 'number' ? (f as { speed: number }).speed : null);
  return { exhaust: speed(p.exhaust_fan), inner: speed(p.inner_fan), mode: s(p.mode) };
}

export function purifierGcode(fan: 'exhaust' | 'inner', speed: number): string {
  return `SET_PURIFIER FAN=${fan} SPEED=${Math.min(1, Math.max(0, speed)).toFixed(2)}`;
}

// machine_state_manager.main_state is an IntEnum; Moonraker sends its number.
const MAIN_STATES = [
  'IDLE',
  'PRINTING',
  'XYZ_OFFSET_CALIBRATE',
  'BED_LEVELING',
  'FLOW_CALIBRATION',
  'SHAPER_CALIBRATE',
  'UPGRADING',
  'ABNORMAL',
  'SCREWS_TILT_ADJUST',
  'AUTO_LOAD',
  'AUTO_UNLOAD',
  'MANUAL_LOAD',
  'PARK_POINT_MANUAL_CALIBRATION',
  'HOMING_ORIGIN_CALIBRATION',
];

const ACTIVITIES: Record<string, string> = {
  XYZ_OFFSET_CALIBRATE: 'Calibrating tool offsets',
  BED_LEVELING: 'Levelling the bed',
  FLOW_CALIBRATION: 'Calibrating flow',
  SHAPER_CALIBRATE: 'Calibrating input shaping',
  UPGRADING: 'Updating firmware',
  ABNORMAL: 'Needs attention on the printer screen',
  SCREWS_TILT_ADJUST: 'Adjusting bed screws',
  AUTO_LOAD: 'Loading filament',
  AUTO_UNLOAD: 'Unloading filament',
  MANUAL_LOAD: 'Loading filament',
  PARK_POINT_MANUAL_CALIBRATION: 'Calibrating park position',
  HOMING_ORIGIN_CALIBRATION: 'Calibrating home position',
};

export function u1MainState(o: KlipperObjects): string {
  const v = o.machine_state_manager?.main_state;
  return typeof v === 'number' ? (MAIN_STATES[v] ?? String(v)) : s(v);
}

export function u1Activity(o: KlipperObjects): string | null {
  const st = u1MainState(o);
  if (!st || st === 'IDLE' || st === 'PRINTING') return null;
  return ACTIVITIES[st] ?? st.charAt(0) + st.slice(1).toLowerCase().replace(/_/g, ' ');
}

/**
 * Commands run before a print starts: the print preferences, then which tool
 * head prints each of the file's filaments. The firmware applies the map to
 * every T, M104 and M109 in the file and resets it when the print ends.
 */
export function u1PrintPrepGcode(options: U1PrintOptions, toolMap: Record<number, number>): string[] {
  const out = [
    `SET_PRINT_PREFERENCES BED_LEVEL=${options.bedLevel ? 1 : 0} FLOW_CALIBRATE=${options.flowCalibrate ? 1 : 0} TIME_LAPSE_CAMERA=${options.timeLapse ? 1 : 0}`,
  ];
  for (const [file, head] of Object.entries(toolMap)) {
    const f = Number(file);
    if (!Number.isInteger(f) || f < 0 || f > 31 || !Number.isInteger(head) || head < 0 || head >= U1_HEADS) continue;
    out.push(`SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=${f} MAP_EXTRUDER=${head}`);
  }
  return out;
}

const cie76 = differenceCie76();

/** CIE76 distance between two #RRGGBB colours, for suggesting a head per filament. */
export function colourDistance(a: string, b: string): number {
  return cie76(a, b);
}

/**
 * Suggested head for each file filament: a loaded head of the same material
 * and the closest colour, each head used once while there are spares; the
 * file's own tool number when nothing fits.
 */
export function suggestToolMap(filaments: { index: number; colour: string; material: string }[], heads: U1Head[]): Record<number, number> {
  const map: Record<number, number> = {};
  const used = new Set<number>();
  for (const f of filaments) {
    const candidates = heads
      .filter((h) => h.loaded && (!f.material || !h.material || h.material.toUpperCase() === f.material.toUpperCase()))
      .map((h) => ({ h, d: colourDistance(f.colour, h.colour) + (used.has(h.index) ? 1000 : 0) }))
      .sort((a, b) => a.d - b.d);
    const pick = candidates[0]?.h.index ?? (f.index < U1_HEADS ? f.index : 0);
    map[f.index] = pick;
    used.add(pick);
  }
  return map;
}
