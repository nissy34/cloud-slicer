// What the print dialog needs from a sliced G-code file: the filaments it
// uses (colour, material, grams) and the time estimate. Orca writes these as
// comments in the header and in the config block at the end, so only the
// first and last few hundred kilobytes are read, never the whole file.
import { unzipSync } from 'fflate';

export interface FileFilament {
  /** Tool index in the file (T0, T1, ...). */
  index: number;
  colour: string;
  material: string;
  grams: number;
  /** Nozzle diameter the file was sliced for this filament, in mm. */
  nozzle?: number;
  /** Sliced for a high-flow nozzle (Snapmaker Orca's filament_volume_type). */
  highFlow?: boolean;
}

export interface GcodeMeta {
  /** The filaments it prints with (unused ones left out). */
  filaments: FileFilament[];
  /** How many filaments the project had, used or not. */
  filamentCount: number;
  estimatedSeconds: number | null;
  layers: number | null;
  /** The printer profile the file was sliced with (Orca's printer_settings_id). */
  printer?: string;
  /** The plate type it was sliced for (Orca's curr_bed_type, "Textured PEI Plate"). */
  bedType?: string;
}

const HEAD = 256 * 1024;
const TAIL = 512 * 1024;

/** "1d 2h 3m 4s" -> seconds. */
export function parseDuration(text: string | undefined): number | null {
  if (!text) return null;
  let total = 0;
  let any = false;
  for (const [, n, u] of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) {
    any = true;
    total += Number(n) * { d: 86400, h: 3600, m: 60, s: 1 }[u as 'd' | 'h' | 'm' | 's'];
  }
  return any ? Math.round(total) : null;
}

/** Reads "; key = value" and "; key: value" comment lines; the first one wins. */
export function commentValues(text: string): Map<string, string> {
  const kv = new Map<string, string>();
  for (const m of text.matchAll(/^;\s*([^=:\n]+?)\s*[=:]\s*(.*?)\s*$/gm)) {
    if (!kv.has(m[1])) kv.set(m[1], m[2]);
  }
  return kv;
}

export function parseGcodeMeta(text: string): GcodeMeta {
  const kv = commentValues(text);
  const list = (k: string, sep: string | RegExp) =>
    (kv.get(k) ?? '')
      .split(sep)
      .map((s) => s.trim())
      .filter(Boolean);
  const grams = list('filament used [g]', ',').map(Number);
  const colours = list('filament_colour', ';').length ? list('filament_colour', ';') : list('extruder_colour', ';');
  const materials = list('filament_type', ';');
  const nozzles = list('nozzle_diameter', /[,;]/).map(Number);
  const flows = list('filament_volume_type', /[,;]/);
  const count = Math.max(grams.length, colours.length, materials.length);
  const filaments: FileFilament[] = [];
  for (let i = 0; i < count; i++) {
    const g = grams[i];
    // A filament with a known weight of zero isn't printed; leave it out of the mapping.
    if (grams.length && !(g > 0)) continue;
    filaments.push({
      index: i,
      colour: /^#[0-9a-f]{6}/i.test(colours[i] ?? '') ? colours[i].slice(0, 7).toUpperCase() : '#888888',
      material: materials[i] ?? '',
      grams: Number.isFinite(g) ? g : 0,
      ...nozzleFacts(nozzles[i] ?? nozzles[0], flows[i]),
    });
  }
  const layers = Number(kv.get('total layer number') ?? kv.get('total layers count'));
  return {
    filaments,
    filamentCount: count,
    estimatedSeconds: parseDuration(kv.get('estimated printing time (normal mode)') ?? kv.get('model printing time')),
    layers: Number.isFinite(layers) && layers > 0 ? layers : null,
    ...(kv.get('printer_settings_id') && { printer: kv.get('printer_settings_id')!.replace(/^"|"$/g, '') }),
    ...(kv.get('curr_bed_type') && { bedType: kv.get('curr_bed_type')!.replace(/^"|"$/g, '') }),
  };
}

function nozzleFacts(diameter: number | undefined, flow: string | undefined): Pick<FileFilament, 'nozzle' | 'highFlow'> {
  return {
    ...(diameter && diameter > 0 && { nozzle: diameter }),
    ...(flow && { highFlow: flow.toLowerCase().replace(/[-_ ]/g, '') === 'highflow' }),
  };
}

export async function readGcodeMeta(blob: Blob): Promise<GcodeMeta> {
  const head = await blob.slice(0, HEAD).text();
  const tail = blob.size > HEAD ? await blob.slice(Math.max(HEAD, blob.size - TAIL)).text() : '';
  return parseGcodeMeta(`${head}\n${tail}`);
}

/**
 * Moonraker's filament_type: one material as is ("PLA"), several as a JSON
 * list in a string ('["PLA", "PETG"]'), or the slicer's own "PLA;PETG".
 */
function materialList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((s) => String(s).trim());
  if (typeof v !== 'string') return [];
  if (v.trim().startsWith('[')) {
    try {
      const list: unknown = JSON.parse(v);
      if (Array.isArray(list)) return list.map((s) => String(s).trim());
    } catch {
      // Not JSON after all: read it as the slicer wrote it.
    }
  }
  return v.split(';').map((s) => s.trim());
}

/** Moonraker's own file metadata (server.files.metadata) in the same shape. */
export function metaFromMoonraker(m: Record<string, unknown> | null): GcodeMeta {
  if (!m) return { filaments: [], filamentCount: 0, estimatedSeconds: null, layers: null };
  const colours = Array.isArray(m.filament_colors) ? (m.filament_colors as string[]) : [];
  const types = materialList(m.filament_type);
  const weights = Array.isArray(m.filament_weights) ? (m.filament_weights as number[]) : [];
  const count = Math.max(colours.length, types.length, weights.length);
  const filaments: FileFilament[] = [];
  for (let i = 0; i < count; i++) {
    if (weights.length && !(weights[i] > 0)) continue;
    const c = String(colours[i] ?? '');
    filaments.push({
      index: i,
      colour: /^#?[0-9a-f]{6}/i.test(c) ? `#${c.replace('#', '').slice(0, 6).toUpperCase()}` : '#888888',
      material: types[i] ?? '',
      grams: weights[i] ?? 0,
      ...nozzleFacts(typeof m.nozzle_diameter === 'number' ? m.nozzle_diameter : undefined, undefined),
    });
  }
  return {
    filaments,
    filamentCount: count,
    estimatedSeconds: typeof m.estimated_time === 'number' ? m.estimated_time : null,
    layers: typeof m.layer_count === 'number' ? m.layer_count : null,
  };
}

/**
 * The address of a file's slicer thumbnail on the printer, from Moonraker's
 * metadata: the smallest one at least `min` px wide (else the largest), so a
 * list row fetches a few kilobytes, not the 300 px preview.
 * Thumbnail paths are relative to the G-code file's folder.
 */
export function thumbnailUrl(m: Record<string, unknown> | null, path: string, min = 64): string | null {
  const thumbs = (Array.isArray(m?.thumbnails) ? m.thumbnails : []) as { width?: number; relative_path?: string }[];
  const usable = thumbs.filter((t) => typeof t.relative_path === 'string' && t.relative_path).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const pick = usable.find((t) => (t.width ?? 0) >= min) ?? usable[usable.length - 1];
  if (!pick) return null;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  return `/server/files/gcodes/${`${dir}${pick.relative_path}`.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * What a .gcode.3mf holds for printing: the plate (Metadata/plate_<n>.gcode,
 * 1-based) and that plate's G-code. Null when it isn't one.
 */
export async function readGcode3mf(blob: Blob): Promise<{ plate: number; gcode: Blob } | null> {
  let plate: number | null = null;
  try {
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
      filter: (f) => {
        const m = /^Metadata\/plate_(\d+)\.gcode$/.exec(f.name);
        if (!m || plate != null) return false;
        plate = Number(m[1]);
        return true;
      },
    });
    if (plate == null) return null;
    return { plate, gcode: new Blob([files[`Metadata/plate_${plate}.gcode`] as Uint8Array<ArrayBuffer>]) };
  } catch {
    return null;
  }
}
