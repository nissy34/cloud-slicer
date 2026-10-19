// The Measure tool's data (engine/src/measure_api.cpp) and the figures its
// panel shows, like desktop Orca's Measure gizmo. All positions are plate
// coordinates in mm.

export type Vec3 = [number, number, number];

interface FeatureBase {
  /** Pass back to measureBetween. */
  id: number;
  object: number;
}
export type MeasureFeature = FeatureBase &
  (
    | { type: 'point'; point: Vec3 }
    | { type: 'edge'; start: Vec3; end: Vec3 }
    | { type: 'circle'; centre: Vec3; radius: number; normal: Vec3 }
    | { type: 'plane'; normal: Vec3; origin: Vec3; triangles: number[] }
  );

export interface MeasureDistance {
  distance: number;
  from: Vec3;
  to: Vec3;
}

export interface Measurement {
  /** Shortest distance between the two features. */
  distance?: MeasureDistance;
  /** Distance between their infinite lines or planes (desktop's "Perpendicular distance"). */
  perpendicular?: MeasureDistance;
  angle?: { degrees: number; centre: Vec3; e1: [Vec3, Vec3]; e2: [Vec3, Vec3]; radius: number };
  /** Distance along X, Y and Z. */
  xyz?: Vec3;
  /** What the Assemble tool can do with the two (Orca's Measure::get_assembly_action). */
  assembly?: {
    parallel: boolean;
    centre: boolean;
    aroundCentre: boolean;
    /** Distance between two parallel faces. */
    parallelDistance?: number;
    sameObject: boolean;
    samePart: boolean;
  };
}

/** An Assemble step on the two picks: the second one's part (or object) moves. */
export type AssembleRequest =
  | { op: 'parallel' | 'centre' | 'flip' | 'join' }
  | { op: 'distance'; value: number }
  | { op: 'rotate'; degrees: number }
  | { op: 'move'; by: Vec3 };

export type AssembleResult = Measurement & { first: MeasureFeature; second: MeasureFeature; object?: number };

/** Hovered, first and second picked features (the --measure-* colours in styles.css). */
export const MEASURE_COLOURS = { hover: '#f5c542', first: '#ff6b4a', second: '#3fa7ff' } as const;

const NAMES = { point: 'Point', edge: 'Edge', circle: 'Circle', plane: 'Plane' } as const;

const mm = (n: number) => `${n.toFixed(3)} mm`;
const xyz = (v: Vec3) => v.map((n) => n.toFixed(3)).join(', ');
const length = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A feature's name and the figures desktop lists for it on its own. */
export function describeFeature(f: MeasureFeature): { name: string; rows: [string, string][] } {
  switch (f.type) {
    case 'point':
      return { name: NAMES.point, rows: [['Position', xyz(f.point)]] };
    case 'edge':
      return {
        name: NAMES.edge,
        rows: [
          ['Length', mm(length(f.start, f.end))],
          ['From', xyz(f.start)],
          ['To', xyz(f.end)],
        ],
      };
    case 'circle':
      return {
        name: NAMES.circle,
        rows: [
          ['Diameter', mm(f.radius * 2)],
          ['Radius', mm(f.radius)],
          ['Centre', xyz(f.centre)],
        ],
      };
    case 'plane':
      return { name: NAMES.plane, rows: [['Normal', xyz(f.normal)]] };
  }
}

/** The rows the panel shows for two features, in desktop's order. */
export function measurementRows(m: Measurement): [string, string][] {
  const rows: [string, string][] = [];
  if (m.angle) rows.push(['Angle', `${m.angle.degrees.toFixed(2)}°`]);
  if (m.distance) rows.push(['Distance', mm(m.distance.distance)]);
  if (m.perpendicular && (!m.distance || Math.abs(m.perpendicular.distance - m.distance.distance) > 1e-6))
    rows.push(['Perpendicular distance', mm(m.perpendicular.distance)]);
  if (m.xyz) (['X', 'Y', 'Z'] as const).forEach((axis, i) => rows.push([`Along ${axis}`, mm(m.xyz![i])]));
  return rows;
}

/** Whether two picks are the same feature (the engine gives each hover a new id). */
export function sameFeature(a: MeasureFeature | null, b: MeasureFeature | null): boolean {
  if (!a || !b || a.type !== b.type || a.object !== b.object) return false;
  const close = (p: Vec3, q: Vec3) => length(p, q) < 1e-4;
  switch (a.type) {
    case 'point':
      return close(a.point, (b as typeof a).point);
    case 'edge': {
      const e = b as typeof a;
      return (close(a.start, e.start) && close(a.end, e.end)) || (close(a.start, e.end) && close(a.end, e.start));
    }
    case 'circle': {
      const c = b as typeof a;
      return close(a.centre, c.centre) && Math.abs(a.radius - c.radius) < 1e-4;
    }
    case 'plane': {
      const p = b as typeof a;
      return close(a.normal, p.normal) && close(a.origin, p.origin);
    }
  }
}
