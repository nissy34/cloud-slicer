// What the Preview colours toolpaths by, like desktop Orca's view types: line
// type, filament, or a value per segment (speed, layer height, ...) on Orca's
// blue-to-red scale.
import { rgb } from './colour';
import { FEATURE_COLOURS, type PreviewGcode } from './gcode';

export type ColourBy =
  | 'feature'
  | 'filament'
  | 'speed'
  | 'height'
  | 'width'
  | 'flow'
  | 'layerTime'
  | 'layerTimeLog'
  | 'fan'
  | 'temperature';

/** In desktop's order. */
export const VIEW_TYPES: { id: ColourBy; label: string; title?: string }[] = [
  { id: 'feature', label: 'Line type' },
  { id: 'filament', label: 'Filament' },
  { id: 'speed', label: 'Speed', title: 'Speed (mm/s)' },
  { id: 'height', label: 'Layer height', title: 'Layer height (mm)' },
  { id: 'width', label: 'Line width', title: 'Line width (mm)' },
  { id: 'flow', label: 'Flow', title: 'Volumetric flow (mm³/s)' },
  { id: 'layerTime', label: 'Layer time', title: 'Layer time' },
  { id: 'layerTimeLog', label: 'Layer time (log)', title: 'Layer time (log scale)' },
  { id: 'fan', label: 'Fan speed', title: 'Fan speed (%)' },
  { id: 'temperature', label: 'Temperature', title: 'Temperature (°C)' },
];

/** Orca's range colours (GCodeViewer::Range_Colors), low to high. */
export const RANGE_COLOURS = ['#0b2c7a', '#135985', '#1c8891', '#04d60f', '#aaf200', '#fcf903', '#f5ce0a', '#d16830', '#c2523c', '#942616'];

export interface ValueRange {
  min: number;
  max: number;
  log: boolean;
}

/** Whether the view colours by a value on a scale (not by line type or filament). */
export function isRangeView(by: ColourBy): boolean {
  return by !== 'feature' && by !== 'filament';
}

/** The value of segment `s` for a per-segment view. */
function segmentValue(p: PreviewGcode, by: ColourBy, s: number): number {
  switch (by) {
    case 'speed':
      return p.speeds[s] / 10;
    case 'height':
      return p.sizes[s * 2 + 1];
    case 'width':
      return p.sizes[s * 2];
    case 'flow':
      return p.flows[s] / 100;
    case 'fan':
      return p.fans[s];
    case 'temperature':
      return p.temps[s];
    default:
      return 0;
  }
}

/** Calls `fn(layer, from, to)` for each layer's shell and inner runs of segments. */
function eachLayerRun(p: PreviewGcode, fn: (layer: number, from: number, to: number) => void) {
  for (let k = 0; k < p.layerZ.length; k++) {
    fn(k, p.shellStarts[k], p.shellStarts[k + 1]);
    fn(k, p.innerStarts[k], p.innerStarts[k + 1]);
  }
}

/**
 * The lowest and highest value among the segments that are shown (hidden line
 * types left out, so hiding the prime tower, say, spreads the rest over the scale).
 */
export function valueRange(p: PreviewGcode, by: ColourBy, hidden: ReadonlySet<number>): ValueRange | null {
  if (!isRangeView(by)) return null;
  let min = Infinity, max = -Infinity;
  if (by === 'layerTime' || by === 'layerTimeLog') {
    eachLayerRun(p, (k, from, to) => {
      for (let s = from; s < to; s++)
        if (!hidden.has(p.features[s])) {
          const v = p.layerTimes[k];
          if (v < min) min = v;
          if (v > max) max = v;
          return;
        }
    });
  } else {
    for (let s = 0; s < p.features.length; s++) {
      if (hidden.has(p.features[s])) continue;
      const v = segmentValue(p, by, s);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) return null;
  return { min, max, log: by === 'layerTimeLog' };
}

/** 0..1 along the scale; a log scale needs values above zero. */
function position(range: ValueRange, v: number): number {
  if (range.max <= range.min) return 0;
  if (range.log) {
    const lo = Math.log(Math.max(range.min, 0.001));
    const hi = Math.log(Math.max(range.max, 0.001));
    return hi > lo ? Math.min(1, Math.max(0, (Math.log(Math.max(v, 0.001)) - lo) / (hi - lo))) : 0;
  }
  return Math.min(1, Math.max(0, (v - range.min) / (range.max - range.min)));
}

const RANGE_RGB = RANGE_COLOURS.map((c) => rgb(c));

/** The scale's colour at `t` (0..1), as RGB in 0..1, blending the two nearest of Orca's colours. */
export function rangeColour(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (RANGE_RGB.length - 1);
  const i = Math.min(RANGE_RGB.length - 2, Math.floor(x));
  const f = x - i;
  const a = RANGE_RGB[i], b = RANGE_RGB[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** The value at `t` (0..1) along the scale, for the legend's labels. */
export function valueAt(range: ValueRange, t: number): number {
  if (range.log) {
    const lo = Math.log(Math.max(range.min, 0.001));
    const hi = Math.log(Math.max(range.max, 0.001));
    return Math.exp(lo + (hi - lo) * t);
  }
  return range.min + (range.max - range.min) * t;
}

/** RGB bytes per segment, in the Preview's drawing order. */
export function segmentColours(p: PreviewGcode, by: ColourBy, filamentColours: string[], range: ValueRange | null): Uint8Array {
  const n = p.features.length;
  const col = new Uint8Array(n * 3);
  const byte = (c: [number, number, number]) => c.map((v) => Math.round(v * 255));
  // Writes palette entry `i` (RGB bytes) as segment `s`'s colour.
  const put = (palette: Uint8Array, i: number, s: number) => {
    col[s * 3] = palette[i * 3];
    col[s * 3 + 1] = palette[i * 3 + 1];
    col[s * 3 + 2] = palette[i * 3 + 2];
  };
  if (!isRangeView(by) || !range) {
    // RGB bytes per feature or per tool (256 entries, light grey past the known tools).
    const palette = new Uint8Array(256 * 3).fill(204);
    (by === 'feature' ? FEATURE_COLOURS : filamentColours).forEach((c, i) => palette.set(byte(rgb(c)), i * 3));
    const index = by === 'feature' ? p.features : p.tools;
    for (let s = 0; s < n; s++) put(palette, index[s], s);
    return col;
  }
  if (by === 'layerTime' || by === 'layerTimeLog') {
    eachLayerRun(p, (k, from, to) => {
      const c = Uint8Array.from(byte(rangeColour(position(range, p.layerTimes[k]))));
      for (let s = from; s < to; s++) put(c, 0, s);
    });
    return col;
  }
  // 256 steps along the scale are finer than the eye can tell apart.
  const steps = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) steps.set(byte(rangeColour(i / 255)), i * 3);
  for (let s = 0; s < n; s++) put(steps, Math.round(position(range, segmentValue(p, by, s)) * 255), s);
  return col;
}

/** "3m 05s", "42s", "1h 02m": desktop's short layer times. */
export function shortTime(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A legend label for a value of the view. */
export function formatValue(by: ColourBy, v: number): string {
  switch (by) {
    case 'speed':
    case 'fan':
    case 'temperature':
      return String(Math.round(v));
    case 'height':
    case 'width':
      return v.toFixed(2);
    case 'flow':
      return v < 10 ? v.toFixed(2) : v.toFixed(1);
    case 'layerTime':
    case 'layerTimeLog':
      return shortTime(v);
    default:
      return String(v);
  }
}
