import { DEG } from './placement';

/** Desktop's rotate ring marks: one every 15°, a bigger one every 45°. */
export const MARK_STEP = 15 * DEG;
/** How close to a mark a drag must come for the ring to hold it there. */
export const MARK_REACH = 3 * DEG;

/** The angle turned, held on the nearest mark when it is within reach. */
export function holdOnMark(angle: number, reach = MARK_REACH): number {
  const mark = Math.round(angle / MARK_STEP) * MARK_STEP;
  return Math.abs(angle - mark) <= reach ? mark : angle;
}

/**
 * The marks as line segments (x, y, z pairs) round a ring of radius 1 in the
 * XY plane, pointing out from it: short ones every 15°, long ones every 45°.
 */
export function markSegments(short = 0.1, long = 0.22, gap = 0.03): Float32Array {
  const n = Math.round((2 * Math.PI) / MARK_STEP);
  const out = new Float32Array(n * 6);
  for (let k = 0; k < n; k++) {
    const a = k * MARK_STEP;
    const len = k % 3 === 0 ? long : short;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    out.set([c * (1 + gap), s * (1 + gap), 0, c * (1 + gap + len), s * (1 + gap + len), 0], k * 6);
  }
  return out;
}

/** The angle turned as people read it: whole degrees, "+" when it turns left. */
export function turnedText(angle: number): string {
  const d = Math.round(angle / DEG);
  return d > 0 ? `+${d}°` : `${d}°`;
}
