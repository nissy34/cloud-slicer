// Desktop's Plate settings window (PlateSettingsDialog, Plater::open_platesettings_dialog):
// the settings a plate has of its own instead of the project's. The engine keeps
// them in the plate's config (engine/src/plate_api.cpp) and lays them over the
// project's when it slices the plate.
import type { OrcaConfig } from '../engine/protocol';

/** The settings the window sets. Each one a plate leaves out uses the project's. */
export const PLATE_KEYS = ['curr_bed_type', 'print_sequence', 'spiral_mode', 'first_layer_print_sequence', 'other_layers_print_sequence', 'other_layers_print_sequence_nums'] as const;

/** Those the sidebar has a field for; it says when the shown plate has its own. */
export const PLATE_SIDEBAR_KEYS = ['curr_bed_type', 'print_sequence', 'spiral_mode'];

/** Desktop's "End" of a layer range (MAX_LAYER_VALUE), and the first layer a range may start at. */
export const LAYER_END = 2147483646;
export const FIRST_OTHER_LAYER = 2;

/** One row of "Other layers filament sequence": layers from..to (1-based) print the filaments in this order. */
export interface LayerRange {
  from: number;
  to: number;
  order: number[];
}

/** What the window edits; null = the project's. */
export interface PlateSettings {
  bedType: string | null;
  sequence: string | null;
  spiral: boolean | null;
  firstLayer: number[] | null;
  otherLayers: LayerRange[] | null;
}

const ints = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));

/** Filaments 1..count in order. */
export const defaultOrder = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

/**
 * `order` with exactly the filaments 1..count, as desktop's
 * PartPlate::update_first_layer_print_sequence keeps it when filaments come
 * and go: ones past the count dropped, missing ones added at the end.
 */
export function fitOrder(order: number[], count: number): number[] {
  const kept = order.filter((f, i) => f >= 1 && f <= count && order.indexOf(f) === i);
  for (let f = 1; f <= count; f++) if (!kept.includes(f)) kept.push(f);
  return kept;
}

/** Orca's flat other_layers_print_sequence (from, to, order... per range) as ranges. */
export function parseOtherLayers(flat: string | undefined, nums: string | undefined): LayerRange[] | null {
  const n = Number(nums);
  const v = ints(flat);
  if (!n || !v.length || v.length % n !== 0) return null;
  const size = v.length / n;
  if (size < 3) return null;
  return Array.from({ length: n }, (_, i) => {
    const row = v.slice(i * size, (i + 1) * size);
    return { from: row[0], to: row[1], order: row.slice(2) };
  });
}

/** Ranges as Orca stores them; every range's order lists every filament. */
export function serializeOtherLayers(ranges: LayerRange[], count: number): { flat: string; nums: string } {
  return {
    flat: ranges.flatMap((r) => [r.from, r.to, ...fitOrder(r.order, count)]).join(','),
    nums: String(ranges.length),
  };
}

/** Ranges sorted as desktop sorts them (LayerSeqInfo::operator<), each from ≥ 2 and to ≥ from. */
export function tidyRanges(ranges: LayerRange[]): LayerRange[] {
  return ranges
    .map((r) => {
      const from = Math.max(FIRST_OTHER_LAYER, Math.round(r.from) || FIRST_OTHER_LAYER);
      return { ...r, from, to: Math.max(from, Math.round(r.to) || from) };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The plate's own settings (ProjectInfo plates[].settings) as the window shows them. */
export function readPlateSettings(own: OrcaConfig | undefined, count: number): PlateSettings {
  const o = own ?? {};
  const first = o.first_layer_print_sequence !== undefined ? ints(o.first_layer_print_sequence) : null;
  const other = parseOtherLayers(o.other_layers_print_sequence, o.other_layers_print_sequence_nums);
  return {
    bedType: o.curr_bed_type ?? null,
    sequence: o.print_sequence ?? null,
    spiral: o.spiral_mode === undefined ? null : o.spiral_mode === '1',
    // Desktop stores [0] for "Auto" in a process; on a plate it means the same.
    firstLayer: first && first.length && first[0] !== 0 ? fitOrder(first, count) : null,
    otherLayers: other ? other.map((r) => ({ ...r, order: fitOrder(r.order, count) })) : null,
  };
}

/** The engine's request: each window setting as a value, or null for the project's. */
export function plateSettingsRequest(s: PlateSettings, count: number): Record<string, string | null> {
  const other = s.otherLayers?.length ? serializeOtherLayers(tidyRanges(s.otherLayers), count) : null;
  return {
    curr_bed_type: s.bedType,
    print_sequence: s.sequence,
    spiral_mode: s.spiral === null ? null : s.spiral ? '1' : '0',
    first_layer_print_sequence: s.firstLayer ? fitOrder(s.firstLayer, count).join(',') : null,
    other_layers_print_sequence: other?.flat ?? null,
    other_layers_print_sequence_nums: other?.nums ?? null,
  };
}

/** Whether a plate has any setting of its own the window shows. */
export const hasPlateSettings = (own: OrcaConfig | undefined) => PLATE_KEYS.some((k) => own?.[k] !== undefined);

/**
 * The settings spiral vase needs (PartPlate::set_vase_mode_related_object_config),
 * as Orca serializes them. Desktop sets them on the plate's objects when the
 * plate's own spiral vase is turned on.
 */
export const VASE_SETTINGS: OrcaConfig = {
  wall_loops: '1',
  top_shell_layers: '0',
  sparse_infill_density: '0%',
  enable_support: '0',
  enforce_support_layers: '0',
  detect_thin_wall: '0',
  timelapse_type: '0',
  overhang_reverse: '0',
  wall_direction: 'auto',
};

/** Those of VASE_SETTINGS the project's settings `config` don't already have (desktop's global_config->diff). */
export const vaseDiffer = (config: OrcaConfig) => Object.keys(VASE_SETTINGS).filter((k) => config[k] !== undefined && config[k] !== VASE_SETTINGS[k]);
