// Printing object by object (desktop's By object print sequence): the tool
// head's clearance round each object. The engine works it out after each edit
// (clearanceJson in engine/src/slice_api.cpp); while an object is dragged the
// page moves its outline and checks the overlaps itself, as desktop's
// GLCanvas3D does while objects move.
import type { PlatePoint } from '../engine/protocol';

/** Whether two convex outlines overlap (separating axis test); touching edges don't count. */
export function convexOverlap(a: PlatePoint[], b: PlatePoint[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y1 - y2;
      const ny = x2 - x1;
      let [minA, maxA, minB, maxB] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const [x, y] of a) {
        const p = x * nx + y * ny;
        minA = Math.min(minA, p);
        maxA = Math.max(maxA, p);
      }
      for (const [x, y] of b) {
        const p = x * nx + y * ny;
        minB = Math.min(minB, p);
        maxB = Math.max(maxB, p);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  return true;
}

/** An outline moved by `delta` (mm). */
export const moved = (points: PlatePoint[], delta: [number, number]): PlatePoint[] => points.map(([x, y]) => [x + delta[0], y + delta[1]]);

/** Which of `outlines` overlap another one (their indices). */
export function overlapping(outlines: PlatePoint[][]): Set<number> {
  const hit = new Set<number>();
  for (let i = 0; i < outlines.length; i++)
    for (let j = i + 1; j < outlines.length; j++)
      if (convexOverlap(outlines[i], outlines[j])) {
        hit.add(i);
        hit.add(j);
      }
  return hit;
}

/** The front middle of an outline (smallest y), where its print order number goes. */
export function frontMiddle(points: PlatePoint[]): PlatePoint {
  const xs = points.map((p) => p[0]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...points.map((p) => p[1]))];
}

/**
 * The slice's message as the notice lists it: one line per object, desktop's
 * "X is too close to others, and collisions may be caused." and so on.
 */
export const clearanceProblems = (error: string) =>
  error
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
