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
