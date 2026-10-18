import type { PresetSummary } from '../engine/protocol';

export const DEFAULT_PRINTER = 'Snapmaker U1 (0.4 nozzle)';

/** Colours given to new filament slots, in order. */
export const SLOT_COLOURS = ['#F2F2F2', '#1E1E1E', '#E5383B', '#2F6FE4', '#2BB673', '#F4B400', '#8E44AD', '#FF7F2A'];

export const MODEL_EXTENSIONS = ['.stl', '.3mf', '.obj', '.amf', '.step', '.stp'];

/** Orca's list values ("a;b;c" or "a,b,c") -> ["a", "b", "c"]. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[;,]/).map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

/**
 * The words that tell filaments of one material apart: "Bambu PLA Silk+ @BBL X1C"
 * -> ["silk"]. Drops the printer suffix, the vendor (first word), the material
 * and "basic", which every vendor uses for its plain filament.
 */
function variantWords(name: string, type: string): string[] {
  const material = new Set(type.toLowerCase().split(/[^a-z0-9]+/));
  const words = shortName(name)
    .toLowerCase()
    .replace(/high[\s-]*flow/g, 'hf')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(1);
  return words.filter((w) => !material.has(w) && w !== 'basic');
}

/**
 * Closest compatible filament preset for a file filament of `type` (e.g. "PLA"),
 * using the file's preset name (`source`, e.g. "Bambu PLA Matte @BBL X1C") to
 * keep its kind: Matte -> Matte, Silk -> Silk, HF -> HF. Among equally close
 * ones the plainest wins, then the printer vendor's own preset, then a generic
 * one; else `fallback`.
 */
export function pickFilamentPreset(presets: PresetSummary[], type: string | undefined, fallback?: string, source?: string): string {
  const want = (type ?? '').toUpperCase();
  const same = presets.filter((p) => (p.filamentType ?? '').toUpperCase() === want);
  const wanted = new Set(source ? variantWords(source, want) : []);
  const vendorRank = (p: PresetSummary) =>
    p.vendor === 'Snapmaker' && /^Snapmaker /.test(p.name) ? 0 : /generic/i.test(p.name) ? 1 : 2;
  const ranked = same
    .map((p, i) => {
      const words = variantWords(p.name, want);
      const shared = words.filter((w) => wanted.has(w)).length;
      return { p, i, shared, extra: words.length - shared, vendor: vendorRank(p) };
    })
    .sort((a, b) => b.shared - a.shared || a.extra - b.extra || a.vendor - b.vendor || a.i - b.i);
  return ranked[0]?.p.name ?? fallback ?? presets[0]?.name ?? '';
}

/** Short name for a preset inside its printer's lists: "PLA @Snapmaker U1" -> "PLA". */
export function shortName(name: string): string {
  return name.replace(/\s*@.*$/, '');
}
