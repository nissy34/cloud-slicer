import { DEG } from './placement';

/*
 * Desktop's rotate ring (Orca's GLGizmoRotate): a scale of marks round the
 * ring, one every 5° and a longer one every 10°, and eight spokes in the
 * middle third. The turn follows the pointer round the ring; on the marks it
 * steps in 5°, on the spokes in 45°, anywhere else it turns freely.
 */

/** One mark every 5° (desktop's ScaleStepsCount 72). */
export const MARK_STEP = 5 * DEG;
/** Every second mark is longer (desktop's ScaleLongEvery). */
export const LONG_EVERY = 2;
/** The middle third's spokes, every 45° (desktop's SnapRegionsCount 8). */
export const SPOKE_STEP = 45 * DEG;
/** How long the long marks are, as part of the ring's radius (desktop's ScaleLongTooth). */
export const LONG_TOOTH = 0.1;
/**
 * Where on the ring the pointer steps along the marks, as parts of the radius.
 * Desktop's band is the marks alone (1 to 1.1); it is wider here so the ring
 * itself, where a drag starts, and a finger on a phone land in it too.
 */
export const MARKS_BAND: [number, number] = [0.85, 1.25];
/** Where the pointer steps along the spokes: the middle third, like desktop. */
export const SPOKES_BAND: [number, number] = [1 / 3, 2 / 3];

/**
 * The turn as the ring gives it: `angle` is the pointer's turn round the ring
 * since it was pressed, `reach` how far out from the middle it is (1 = on the
 * ring). With `step` (Shift or the snap setting) it always steps by that.
 */
export function ringTurn(angle: number, reach: number, step: number | null = null): number {
  const by = step ?? (inBand(reach, SPOKES_BAND) ? SPOKE_STEP : inBand(reach, MARKS_BAND) ? MARK_STEP : 0);
  if (!by) return angle;
  const turned = Math.round(angle / by) * by;
  return Object.is(turned, -0) ? 0 : turned;
}

function inBand(reach: number, [from, to]: [number, number]) {
  return reach >= from && reach <= to;
}

/** The signed angle from one direction to another round the ring (x, y in the ring's plane). */
export function turnBetween(from: [number, number], to: [number, number]): number {
  return Math.atan2(from[0] * to[1] - from[1] * to[0], from[0] * to[0] + from[1] * to[1]);
}

/**
 * The scale as line segments (x, y, z pairs) round a ring of radius 1 in the
 * XY plane, starting at +X: marks pointing out from the ring every 5° (long
 * every 10°, like desktop), and spokes in the middle third every 45°.
 */
export function ringScale(): Float32Array {
  const marks = Math.round((2 * Math.PI) / MARK_STEP);
  const spokes = Math.round((2 * Math.PI) / SPOKE_STEP);
  const out = new Float32Array((marks + spokes) * 6);
  for (let k = 0; k < marks; k++) {
    const a = k * MARK_STEP;
    const len = k % LONG_EVERY === 0 ? LONG_TOOTH : LONG_TOOTH / 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    out.set([c, s, 0, c * (1 + len), s * (1 + len), 0], k * 6);
  }
  for (let k = 0; k < spokes; k++) {
    const a = k * SPOKE_STEP;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const [r0, r1] = SPOKES_BAND;
    out.set([c * r0, s * r0, 0, c * r1, s * r1, 0], (marks + k) * 6);
  }
  return out;
}

/** The turn drawn like desktop: a line to where it started, one to where it is, and the arc between (radius 1, XY plane). */
export function turnLines(angle: number, arcRadius = 0.5): Float32Array {
  const steps = Math.max(1, Math.ceil(Math.abs(angle) / (5 * DEG)));
  const out: number[] = [0, 0, 0, 1, 0, 0, 0, 0, 0, Math.cos(angle), Math.sin(angle), 0];
  for (let k = 0; k < steps; k++) {
    const [a, b] = [(angle * k) / steps, (angle * (k + 1)) / steps];
    out.push(Math.cos(a) * arcRadius, Math.sin(a) * arcRadius, 0, Math.cos(b) * arcRadius, Math.sin(b) * arcRadius, 0);
  }
  return new Float32Array(out);
}

/** The angle turned as people read it: whole degrees, "+" when it turns left. */
export function turnedText(angle: number): string {
  const d = Math.round(angle / DEG);
  return d > 0 ? `+${d}°` : `${d}°`;
}
