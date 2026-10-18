// What the print dialog needs from a sliced G-code file: the filaments it
// uses (colour, material, grams) and the time estimate. Orca writes these as
// comments in the header and in the config block at the end, so only the
// first and last few hundred kilobytes are read, never the whole file.

export interface FileFilament {
  /** Tool index in the file (T0, T1, ...). */
  index: number;
  colour: string;
  material: string;
  grams: number;
}

export interface GcodeMeta {
  filaments: FileFilament[];
  estimatedSeconds: number | null;
  layers: number | null;
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
    });
  }
  const layers = Number(kv.get('total layer number') ?? kv.get('total layers count'));
  return {
    filaments,
    estimatedSeconds: parseDuration(kv.get('estimated printing time (normal mode)') ?? kv.get('model printing time')),
    layers: Number.isFinite(layers) && layers > 0 ? layers : null,
  };
}

export async function readGcodeMeta(blob: Blob): Promise<GcodeMeta> {
  const head = await blob.slice(0, HEAD).text();
  const tail = blob.size > HEAD ? await blob.slice(Math.max(HEAD, blob.size - TAIL)).text() : '';
  return parseGcodeMeta(`${head}\n${tail}`);
}

/** Moonraker's own file metadata (server.files.metadata) in the same shape. */
export function metaFromMoonraker(m: Record<string, unknown> | null): GcodeMeta {
  if (!m) return { filaments: [], estimatedSeconds: null, layers: null };
  const colours = Array.isArray(m.filament_colors) ? (m.filament_colors as string[]) : [];
  const types = typeof m.filament_type === 'string' ? m.filament_type.split(';').map((s) => s.trim()) : [];
  const weights = Array.isArray(m.filament_weights) ? (m.filament_weights as number[]) : [];
  const count = Math.max(colours.length, types.length, weights.length);
  const filaments: FileFilament[] = [];
  for (let i = 0; i < count; i++) {
    if (weights.length && !(weights[i] > 0)) continue;
    const c = String(colours[i] ?? '');
    filaments.push({ index: i, colour: /^#?[0-9a-f]{6}/i.test(c) ? `#${c.replace('#', '').slice(0, 6).toUpperCase()}` : '#888888', material: types[i] ?? '', grams: weights[i] ?? 0 });
  }
  return {
    filaments,
    estimatedSeconds: typeof m.estimated_time === 'number' ? m.estimated_time : null,
    layers: typeof m.layer_count === 'number' ? m.layer_count : null,
  };
}
