import { extruderIndex, type KlipperObjects } from './status';

/**
 * How a tool head is doing, in one word for its face on the Tool heads card:
 * any Klipper printer has the temperatures; the U1 also knows the dock, the
 * filament and the feeder.
 */
export type HeadMood = 'worried' | 'hungry' | 'printing' | 'heating' | 'hot' | 'cooling' | 'ready' | 'napping';

export interface HeadMoodInput {
  temp: number;
  target: number;
  /** On the carriage (U1) or Klipper's active extruder. */
  inUse: boolean;
  /** A print is running or paused. */
  printing: boolean;
  /** Filament in the head; null when the printer doesn't say. */
  loaded: boolean | null;
  dock?: 'parked' | 'attached' | 'unknown' | null;
  feedError?: string | null;
}

/** Warm enough not to touch: the face sweats until the nozzle is below this. */
export const STILL_HOT = 50;

export function headMood(h: HeadMoodInput): HeadMood {
  if (h.dock === 'unknown' || h.feedError) return 'worried';
  if (h.loaded === false) return 'hungry';
  if (h.printing && h.inUse) return 'printing';
  if (h.target > 0) return h.temp < h.target - 3 ? 'heating' : 'hot';
  if (h.temp >= STILL_HOT) return 'cooling';
  return h.inUse ? 'ready' : 'napping';
}

/** What the speech bubble says. */
export const MOOD_WORDS: Record<HeadMood, string> = {
  worried: 'Check me',
  hungry: 'Feed me',
  printing: 'Printing!',
  heating: 'Heating up',
  hot: 'Hot',
  cooling: 'Cooling down',
  ready: 'Ready',
  napping: 'Napping',
};

const SENSOR_PREFIXES = ['filament_switch_sensor ', 'filament_motion_sensor '];

/**
 * Which extruder a filament sensor watches, from its name in printer.cfg:
 * "e1_filament", "extruder2_runout", "T3", "tool0" name one. A printer with
 * one extruder has every sensor on it. null when the name doesn't say.
 */
export function sensorExtruder(name: string, extruders: number): number | null {
  const own = name.slice(name.indexOf(' ') + 1);
  const m = /(?:^|[^a-z0-9])(?:extruder|tool|head|e|t)_?(\d+)(?![0-9])/i.exec(own);
  if (m && Number(m[1]) < extruders) return Number(m[1]);
  if (extruders === 1) return 0;
  return /(?:^|[^a-z0-9])extruder(?![0-9])/i.test(own) ? 0 : null;
}

/**
 * Whether there is filament in each extruder, from Klipper's own filament
 * sensors, so it works on any printer that has them. A switch sensor feels
 * the filament itself. Plain Klipper's motion sensor only notices filament
 * that moves (it reads "no filament" after a restart until something
 * extrudes), so it counts only when the printer's add-on says its motion
 * sensors feel filament standing still. With two sensors on one extruder
 * (one at the spool, one in the head) both must feel it. Extruders without a
 * sensor that counts are left out: the printer doesn't say.
 */
export function filamentInExtruders(o: KlipperObjects, opts: { motionSensorsFeelFilament?: boolean } = {}): Map<number, boolean> {
  const extruders = Object.keys(o).filter((n) => extruderIndex(n) != null).length;
  const out = new Map<number, boolean>();
  for (const [name, v] of Object.entries(o)) {
    const prefix = SENSOR_PREFIXES.find((p) => name.startsWith(p));
    if (!prefix || !v || v.enabled === false || typeof v.filament_detected !== 'boolean') continue;
    if (prefix === 'filament_motion_sensor ' && !opts.motionSensorsFeelFilament) continue;
    const i = sensorExtruder(name, extruders);
    if (i == null) continue;
    out.set(i, (out.get(i) ?? true) && v.filament_detected);
  }
  return out;
}
