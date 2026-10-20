// The printer's own bed under the plate, as desktop Orca draws it: the brand's
// bed shape (bed_model, an STL) below the plate, its print sheet picture
// (bed_texture, SVG or PNG) over the printable area, the grid, the exclusion
// areas and the origin. engine/scripts/bundle-profiles.mjs writes each brand's
// beds to profiles/beds/; the page fetches only the selected printer's.
import type { PresetSummary } from '../engine/protocol';
import { engineFolder, type EngineFlavor } from './engines';
import { catalogIndex, type CatalogVendor, type PrinterCatalog } from './printer-catalog';

export type Point = [number, number];

/** Points of an Orca points option ("0x0,270x0,270x270,0x270"). */
export function parsePoints(value: string | undefined): Point[] {
  return String(value ?? '')
    .split(',')
    .map((p) => p.trim().split('x').map(Number) as Point)
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
}

/** The brand whose bed the printer shows: the system printer it is or is built on, else any brand with its printer_model. */
export function bedVendor(catalog: PrinterCatalog | null, printer: string | undefined, printers: PresetSummary[], printerModel: string | undefined): CatalogVendor | null {
  if (!catalog) return null;
  const index = catalogIndex(catalog);
  const seen = new Set<string>();
  for (let n = printer; n && !seen.has(n); n = printers.find((p) => p.name === n)?.inherits) {
    seen.add(n);
    const hit = index.get(n);
    if (hit && (!printerModel || hit.model.model === printerModel)) return hit.vendor;
  }
  // Desktop finds a user printer's bed by its printer_model.
  return (printerModel && catalog.vendors.find((v) => v.models.some((m) => m.model === printerModel))) || null;
}

export interface BedFiles {
  /** Addresses of the bed's shape (bed-mesh file) and picture, when the model has them. */
  model?: string;
  texture?: string;
}

const indexes = new Map<string, Promise<Record<string, { model?: string; texture?: string }> | null>>();

/** A printer model's bed files, or null when the brand ships none for it. */
export async function bedFiles(flavor: EngineFlavor, vendor: CatalogVendor, model: string): Promise<BedFiles | null> {
  if (!vendor.beds) return null;
  const base = `/${engineFolder(flavor)}/profiles/beds/`;
  const v = `?v=${import.meta.env.VITE_ENGINE_VERSION}`;
  const key = base + vendor.beds;
  if (!indexes.has(key))
    indexes.set(
      key,
      fetch(key + v)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  const bed = (await indexes.get(key))?.[model];
  if (!bed) return null;
  const dir = base + vendor.beds.replace(/\.json$/, '/');
  return {
    model: bed.model ? dir + bed.model + v : undefined,
    texture: bed.texture ? dir + bed.texture + v : undefined,
  };
}

/** The triangles of a bed-mesh file (engine/scripts/bed-mesh.mjs). */
export function decodeBedMesh(buf: ArrayBuffer): { positions: Float32Array; index: Uint16Array | Uint32Array } {
  const view = new DataView(buf);
  if (buf.byteLength < 36 || String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'BED1') throw new Error('not a bed mesh');
  const f = (i: number) => view.getFloat32(4 + i * 4, true);
  const min = [f(0), f(1), f(2)];
  const step = [f(3), f(4), f(5)];
  const vertices = view.getUint32(28, true);
  const triangles = view.getUint32(32, true);
  const positions = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices * 3; i++) positions[i] = min[i % 3] + view.getUint16(36 + i * 2, true) * step[i % 3];
  const at = 36 + Math.ceil((vertices * 6) / 4) * 4;
  const index = vertices > 65536 ? new Uint32Array(buf.slice(at, at + triangles * 12)) : new Uint16Array(buf.slice(at, at + triangles * 6));
  return { positions, index };
}

/**
 * Where the bed shape goes: its own origin at the middle of the printable area
 * and its top just under the plate, as desktop's Bed3D::update_model_offset
 * (a shape that rises above its origin is lowered so the plate stays on top).
 */
export function bedModelOffset(area: Point[], topZ: number): [number, number, number] {
  const b = bounds(area);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, -0.43 - Math.max(0, topZ)];
}

export function bounds(pts: Point[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * The polygon the bed picture is stretched over, as desktop's
 * PartPlate::generate_logo_polygon: the printable area, reaching 12 mm further
 * forward on a Bambu Lab printer (its sheet's front lip).
 */
export function texturePolygon(area: Point[], bambu: boolean): Point[] {
  if (!bambu || area.length !== 4) return area;
  return area.map(([x, y], i) => [x, i < 2 ? y - 12 : y]);
}

/** Desktop's grid spacing for a bed (Bed_2D::calculate_grid_step); every fifth line is bold. */
export function gridStep(area: Point[]): number {
  const b = bounds(area);
  const edge = Math.min(b.maxX - b.minX, b.maxY - b.minY);
  return edge >= 6000 ? 100 : edge >= 1200 ? 50 : edge >= 600 ? 20 : 10;
}

/**
 * The grid inside the printable area, counted from the origin as desktop does,
 * with the area's outline among the thin lines: x0, y0, x1, y1 per line.
 */
export function gridLines(area: Point[]): { thin: number[]; bold: number[] } {
  const thin: number[] = [];
  const bold: number[] = [];
  if (area.length < 3) return { thin, bold };
  const step = gridStep(area);
  const b = bounds(area);
  const eps = 1e-6;
  // The parts of the line at `at` (x when vertical) that are inside the area.
  const inside = (at: number, vertical: boolean) => {
    const hits: number[] = [];
    area.forEach((p, i) => {
      const q = area[(i + 1) % area.length];
      const [a0, b0] = vertical ? p : [p[1], p[0]];
      const [a1, b1] = vertical ? q : [q[1], q[0]];
      if ((a0 <= at && a1 > at) || (a1 <= at && a0 > at)) hits.push(b0 + ((at - a0) / (a1 - a0)) * (b1 - b0));
    });
    hits.sort((x, y) => x - y);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i], hits[i + 1]]);
    return out;
  };
  const add = (vertical: boolean, lo: number, hi: number) => {
    const first = Math.ceil((lo - eps) / step);
    for (let k = first; k * step <= hi + eps; k++) {
      // On the edge itself the line would only double the outline.
      const at = Math.min(Math.max(k * step, lo + eps), hi - eps);
      for (const [s, e] of inside(at, vertical)) (k % 5 ? thin : bold).push(...(vertical ? [k * step, s, k * step, e] : [s, k * step, e, k * step]));
    }
  };
  add(true, b.minX, b.maxX);
  add(false, b.minY, b.maxY);
  area.forEach((p, i) => thin.push(p[0], p[1], ...area[(i + 1) % area.length]));
  return { thin, bold };
}

/** The pixel size to draw a bed picture at: the bed's proportions, at most `max` on its long side. */
export function textureSize(area: Point[], max: number): [number, number] {
  const b = bounds(area);
  const w = b.maxX - b.minX || 1;
  const d = b.maxY - b.minY || 1;
  return w >= d ? [max, Math.max(1, Math.round((max * d) / w))] : [Math.max(1, Math.round((max * w) / d)), max];
}
