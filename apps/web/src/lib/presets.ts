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
 * Closest compatible filament preset for a file filament of `type` (e.g. "PLA"):
 * the printer vendor's own preset of that material first, then a generic one,
 * then any of that material, else `fallback`.
 */
export function pickFilamentPreset(presets: PresetSummary[], type: string | undefined, fallback?: string): string {
  const want = (type ?? '').toUpperCase();
  const same = presets.filter((p) => (p.filamentType ?? '').toUpperCase() === want);
  const pick =
    same.find((p) => p.vendor === 'Snapmaker' && /^Snapmaker /.test(p.name)) ??
    same.find((p) => /generic/i.test(p.name)) ??
    same[0];
  return pick?.name ?? fallback ?? presets[0]?.name ?? '';
}

/** Short name for a preset inside its printer's lists: "PLA @Snapmaker U1" -> "PLA". */
export function shortName(name: string): string {
  return name.replace(/\s*@.*$/, '');
}
