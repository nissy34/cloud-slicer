// The objects of the running print, from Klipper's exclude_object module
// (EXCLUDE_OBJECT_DEFINE lines the slicer writes), for skipping one mid-print.
// Generic for any Klipper printer. Pure functions, unit tested in objects.test.ts.
import type { KlipperObjects } from './status';

export type Point = [number, number];

export interface PlateObject {
  /** The name the printer knows it by (Klipper upper-cases it). */
  name: string;
  /** "Benchy", "Benchy 2": the way the Prepare object list names it. */
  label: string;
  /** Outline seen from above, in printer millimetres; empty when the file gave none. */
  polygon: Point[];
  center: Point | null;
  skipped: boolean;
  current: boolean;
}

export interface PrintObjects {
  /** The printer has Klipper's exclude_object module. */
  supported: boolean;
  objects: PlateObject[];
}

const point = (v: unknown): Point | null =>
  Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null;

const MODEL_EXT = /\.(stl|3mf|obj|amf|step|stp|svg)$/i;

/** What a person calls an object the slicer named "Benchy.stl_id_0_copy_1" (copies are numbered by printObjects). */
export function cleanName(raw: string): string {
  const base = (/^(.*)_id_\d+_copy_\d+$/i.exec(raw)?.[1] ?? raw).replace(MODEL_EXT, '');
  let s = base.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || raw;
  // Klipper upper-cases names; "CALIBRATION CUBE" reads better as "Calibration cube".
  if (s === s.toUpperCase() && s !== s.toLowerCase()) s = s[0] + s.slice(1).toLowerCase();
  return s;
}

export function printObjects(o: KlipperObjects): PrintObjects {
  const ex = o.exclude_object;
  if (!ex) return { supported: false, objects: [] };
  const excluded = new Set((Array.isArray(ex.excluded_objects) ? ex.excluded_objects : []).map((n) => String(n).toUpperCase()));
  const current = typeof ex.current_object === 'string' ? ex.current_object.toUpperCase() : null;
  const seen = new Map<string, number>();
  const objects = (Array.isArray(ex.objects) ? ex.objects : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string')
    .map((x): PlateObject => {
      const name = x.name as string;
      const base = cleanName(name);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return {
        name,
        label: n > 1 ? `${base} ${n}` : base,
        polygon: Array.isArray(x.polygon) ? x.polygon.map(point).filter((p): p is Point => p != null) : [],
        center: point(x.center),
        skipped: excluded.has(name.toUpperCase()),
        current: current != null && current === name.toUpperCase(),
      };
    });
  return { supported: true, objects };
}

export interface MapBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The area the plate map shows: the printer's X/Y travel, else the objects with a margin. */
export function mapBox(objects: PlateObject[], axisMin: number[] | null, axisMax: number[] | null): MapBox {
  if (axisMin && axisMax && axisMax[0] > axisMin[0] && axisMax[1] > axisMin[1])
    return { x: axisMin[0], y: axisMin[1], w: axisMax[0] - axisMin[0], h: axisMax[1] - axisMin[1] };
  const pts = objects.flatMap((o) => (o.polygon.length ? o.polygon : o.center ? [o.center] : []));
  if (!pts.length) return { x: 0, y: 0, w: 100, h: 100 };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 20) + 20;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
}

/** SVG points for an outline, with Y flipped so the back of the bed is at the top. */
export function svgPoints(polygon: Point[], box: MapBox): string {
  return polygon.map(([x, y]) => `${+(x - box.x).toFixed(2)},${+(box.y + box.h - y).toFixed(2)}`).join(' ');
}
