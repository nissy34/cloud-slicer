// Colour mixing, as Snapmaker Orca's Color Mixing panel and Add Mix dialog do
// it: virtual "mixed" filaments made of physical ones, numbered after them.
// The engine (Orca's MixedFilamentManager) owns the list and its colours; this
// file turns the dialog's four modes into a row's recipe the way desktop's
// MixedFilamentDialog::collect_result does, and labels rows like its panel.
import type { OrcaConfig } from '../engine/protocol';

/** Orca's MixedFilament::DistributionMode. */
export const LAYER_CYCLE = 0;
export const SIMPLE = 2;

/** The dialog's modes (MixedFilament::ui_mode). */
export type MixMode = 'ratio' | 'cycle' | 'match' | 'gradient';
export const MODES: MixMode[] = ['ratio', 'cycle', 'match', 'gradient'];
export const MODE_LABELS: Record<MixMode, string> = { ratio: 'Ratio', cycle: 'Cycle', match: 'Match', gradient: 'Gradient' };

/** What makes a mix, in the engine's field names (MixedFilament). */
export interface MixRecipe {
  componentA: number;
  componentB: number;
  mixBPercent: number;
  ratioA: number;
  ratioB: number;
  /** Cycle pattern: one digit per layer, "1122"; [10] for filaments past 9. */
  pattern: string;
  /** Encoded filament list for 3+ filament mixes ("123"). */
  gradientIds: string;
  /** Their weights, "50/25/25". */
  gradientWeights: string;
  distributionMode: number;
  gradientEnabled: boolean;
  /** Share of filament A at the bottom and top of a gradient. */
  gradientStart: number;
  gradientEnd: number;
  uiMode: number;
}

/** A row of the mix list as the engine returns it. */
export interface MixRow extends MixRecipe {
  /** Filament number when in use (5, 6, ... after 4 physical); 0 for deleted rows. */
  virtualId: number;
  stableId: string;
  gradientIdList: number[];
  localZMaxSublayers: number;
  enabled: boolean;
  deleted: boolean;
  custom: boolean;
  /** "#RRGGBB" the mix looks like. */
  colour: string;
  /** Its filaments' materials can be mixed (desktop's compatibility table). */
  compatible: boolean;
}

/** The dialog's state: which filaments, how much of each, per mode. */
export interface MixDraft {
  mode: MixMode;
  /** Ratio: 2 or 3 filaments (1-based). */
  filaments: number[];
  /** Ratio, 2 filaments: percent of the second. */
  percentB: number;
  /** Ratio, 3 filaments: percent of each, summing to 100. */
  weights: number[];
  /** Cycle: the layer pattern. */
  pattern: string;
  /** Match: target colour and the smallest share any filament may have. */
  target: string;
  minPercent: number;
  /** Match: the recipe found for the target. */
  match: MatchResult | null;
  /** Gradient: A at the bottom to B at the top, or the other way round. */
  reversed: boolean;
}

export interface MatchResult {
  valid: boolean;
  componentA: number;
  componentB: number;
  mixBPercent: number;
  gradientIds: string;
  gradientWeights: string;
  colour: string;
  deltaE: number;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** "123" or "1/12/3" -> [1, 2, 3] (MixedFilamentManager::decode_gradient_component_ids). */
export function decodeIds(ids: string): number[] {
  if (!ids) return [];
  if (ids.includes('/')) return ids.split('/').filter(Boolean).map(Number);
  return [...ids].map(Number);
}

/** [1, 2, 3] -> "123"; any id past 9 -> "1/12/3" (encode_gradient_component_ids). */
export function encodeIds(ids: number[]): string {
  if (ids.every((i) => i <= 9)) return ids.join('');
  return ids.length === 1 ? `/${ids[0]}` : ids.join('/');
}

export function decodeWeights(weights: string, n: number): number[] {
  const w = weights.split(/[^0-9]+/).filter(Boolean).map(Number);
  return w.length === n ? w : Array.from({ length: n }, () => Math.floor(100 / n));
}

/** Weights that sum to 100, largest remainders first (normalize_color_match_weights). */
export function normalizeWeights(weights: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const w = weights.map((v) => Math.max(0, v));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return w.map((_, i) => (i === 0 ? 100 : 0));
  const exact = w.map((v) => (100 * v) / sum);
  const out = exact.map(Math.floor);
  let missing = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; missing > 0; k++, missing--) out[order[k % n][1]]++;
  return out;
}

/** Layer-cycle ratio of a 2-filament mix: 25% B -> 3:1 (collect_result, Ratio mode). */
export function ratioFor(percentB: number): [number, number] {
  const b = Math.min(100, Math.max(0, Math.round(percentB)));
  if (b >= 100) return [0, 1];
  if (b <= 0) return [1, 0];
  const a = 100 - b;
  const g = gcd(Math.max(a, b), Math.min(a, b));
  return [a / g, b / g];
}

/** Normalized cycle pattern: digits and [N] tokens, commas between wall groups. */
export function normalizePattern(pattern: string): string {
  return pattern.replace(/[^0-9[\],]/g, '');
}

/** Filaments of a cycle pattern, in order ("1[10]2" -> [1, 10, 2]). */
export function patternIds(pattern: string): number[] {
  const out: number[] = [];
  for (const m of normalizePattern(pattern).matchAll(/\[(\d+)\]|(\d)/g)) out.push(Number(m[1] ?? m[2]));
  return out;
}

/**
 * The recipe a dialog state saves, as desktop's collect_result builds it.
 * Match mode needs `draft.match`; without one it saves a 50/50 of 1 and 2.
 */
export function recipeFromDraft(d: MixDraft): MixRecipe {
  const base: MixRecipe = {
    componentA: d.filaments[0] ?? 1,
    componentB: d.filaments[1] ?? 2,
    mixBPercent: 50,
    ratioA: 1,
    ratioB: 1,
    pattern: '',
    gradientIds: '',
    gradientWeights: '',
    distributionMode: SIMPLE,
    gradientEnabled: false,
    gradientStart: 0.8,
    gradientEnd: 0.2,
    uiMode: MODES.indexOf(d.mode),
  };
  switch (d.mode) {
    case 'ratio': {
      if (d.filaments.length >= 3) {
        const w = normalizeWeights(d.weights.slice(0, 3));
        return { ...base, distributionMode: LAYER_CYCLE, gradientIds: encodeIds(d.filaments.slice(0, 3)), gradientWeights: w.join('/') };
      }
      const [ratioA, ratioB] = ratioFor(d.percentB);
      return { ...base, mixBPercent: Math.round(d.percentB), ratioA, ratioB };
    }
    case 'cycle': {
      const pattern = normalizePattern(d.pattern) || '12';
      // Tokens 1 and 2 are components A and B; they are filaments 1 and 2.
      return { ...base, componentA: 1, componentB: 2, pattern };
    }
    case 'match': {
      const m = d.match;
      if (!m?.valid) return { ...base, componentA: 1, componentB: 2 };
      if (m.gradientIds) {
        const ids = decodeIds(m.gradientIds);
        return { ...base, componentA: m.componentA, componentB: m.componentB, mixBPercent: 50, distributionMode: ids.length >= 3 ? LAYER_CYCLE : SIMPLE, gradientIds: m.gradientIds, gradientWeights: m.gradientWeights };
      }
      // A pair keeps its two ids too, as desktop stores it.
      return { ...base, componentA: m.componentA, componentB: m.componentB, mixBPercent: m.mixBPercent, gradientIds: encodeIds([m.componentA, m.componentB]) };
    }
    case 'gradient':
      return {
        ...base,
        distributionMode: LAYER_CYCLE,
        gradientEnabled: true,
        gradientStart: d.reversed ? 0.2 : 0.8,
        gradientEnd: d.reversed ? 0.8 : 0.2,
      };
  }
}

/** The dialog state that edits an existing row (and a new one: `row` undefined). */
export function draftFromRow(row: MixRow | undefined, physical: number): MixDraft {
  const d: MixDraft = {
    mode: 'ratio',
    filaments: [1, Math.min(2, physical)],
    percentB: 50,
    weights: [34, 33, 33],
    pattern: '12',
    target: '#808080',
    minPercent: 15,
    match: null,
    reversed: false,
  };
  if (!row) return d;
  const mode = MODES[row.uiMode] ?? (row.pattern ? 'cycle' : row.gradientEnabled ? 'gradient' : 'ratio');
  d.mode = mode;
  d.filaments = [row.componentA, row.componentB];
  d.percentB = row.mixBPercent;
  if (row.pattern) d.pattern = row.pattern;
  if (row.gradientIdList.length >= 3) {
    d.filaments = row.gradientIdList.slice(0, 3);
    d.weights = normalizeWeights(decodeWeights(row.gradientWeights, row.gradientIdList.length).slice(0, 3));
  }
  d.reversed = row.gradientStart < row.gradientEnd;
  if (mode === 'match') {
    d.target = row.colour;
    d.match = {
      valid: true,
      componentA: row.componentA,
      componentB: row.componentB,
      mixBPercent: row.mixBPercent,
      gradientIds: row.gradientIdList.length >= 3 ? row.gradientIds : '',
      gradientWeights: row.gradientIdList.length >= 3 ? row.gradientWeights : '',
      colour: row.colour,
      deltaE: 0,
    };
  }
  return d;
}

/** Filaments a recipe uses (1-based), for the material check. */
export function recipeFilaments(r: MixRecipe): number[] {
  if (r.pattern) return [...new Set(patternIds(r.pattern))];
  return [...new Set([r.componentA, r.componentB, ...decodeIds(r.gradientIds)])].filter((i) => i > 0);
}

/** Filament numbers with each mix replaced by the filaments it prints with (desktop's expand_virtual_extruder_ids). */
export function physicalFilaments(ids: number[], rows: MixRow[]): number[] {
  const out = new Set<number>();
  for (const id of ids) {
    const row = rows.find((r) => r.enabled && r.virtualId === id);
    for (const f of row ? recipeFilaments(row) : [id]) out.add(f);
  }
  return [...out].sort((a, b) => a - b);
}

/** "F1 50% + F2 50%", "F1 → F2", "F1 F1 F2" ... the panel's text for a row. */
export function mixLabel(r: MixRecipe): string {
  if (r.pattern) {
    const ids = patternIds(r.pattern);
    const counts = new Map<number, number>();
    for (const i of ids) counts.set(i, (counts.get(i) ?? 0) + 1);
    return [...counts].map(([id, n]) => `F${id} ${Math.round((100 * n) / ids.length)}%`).join(' + ');
  }
  const ids = decodeIds(r.gradientIds);
  if (ids.length >= 3) {
    const w = normalizeWeights(decodeWeights(r.gradientWeights, ids.length));
    return ids.map((id, i) => `F${id} ${w[i]}%`).join(' + ');
  }
  if (r.gradientEnabled) {
    const [from, to] = r.gradientStart >= r.gradientEnd ? [r.componentA, r.componentB] : [r.componentB, r.componentA];
    return `F${from} → F${to}`;
  }
  const b = Math.min(100, Math.max(0, r.mixBPercent));
  return `F${r.componentA} ${100 - b}% + F${r.componentB} ${b}%`;
}

/** Filament colours by filament number: the physical ones, then each mix in use. */
export function palette(physical: string[], rows: MixRow[]): string[] {
  const out = [...physical];
  for (const r of rows) if (r.enabled && r.virtualId > 0) out[r.virtualId - 1] = r.colour;
  return out;
}

/** What the engine needs to colour the mixes, from the slicing config. */
export function mixSettings(config: OrcaConfig) {
  const bool = (k: string) => config[k] === '1' || config[k] === 'true';
  const num = (k: string, d: number) => (Number.isFinite(Number(config[k])) && config[k] !== undefined && config[k] !== '' ? Number(config[k]) : d);
  return {
    nozzles: (config.nozzle_diameter ?? '').split(',').filter(Boolean).map(Number),
    settings: {
      lowerBound: num('mixed_filament_height_lower_bound', 0.04),
      upperBound: num('mixed_filament_height_upper_bound', 0.16),
      localZ: bool('dithering_local_z_mode'),
      bias: bool('mixed_filament_component_bias_enabled'),
      heightWeighted: bool('mixed_filament_gradient_mode'),
      advancedDithering: bool('mixed_filament_advanced_dithering'),
    },
  };
}

/** Desktop's warnings for a mix (MixedFilamentDialog::update_compatibility_warning). */
export function mixWarning(r: MixRecipe, colours: string[]): string {
  const ids = recipeFilaments(r);
  const hex = new Set(ids.map((i) => (colours[i - 1] ?? '').slice(0, 7).toUpperCase()));
  if (ids.length >= 2 && hex.size === 1) return 'Same filament colours cannot produce new colours. Please select different colours for mixing.';
  return '';
}

/** Black or white text for a swatch: whichever stands out more from the colour (WCAG contrast). */
export function textOn(colour: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(colour);
  if (!m) return '#000';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  // Above this brightness black has more contrast than white.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
}

// ---------------------------------------------------------------------------
// Mixing Recommendations: the swatch grid under desktop's Add Mix dialog
// (MixedFilamentDialog::build_swatch_grid and build_color_match_presets).

/** One recommended mix. Tapping it fills the dialog with it. */
export interface MixSuggestion {
  /** Filaments in the order the dialog's rows take them (1-based); a gradient's first is where it starts. */
  filaments: number[];
  /** Percent of each filament, same order, summing to 100. */
  weights: number[];
  /** Desktop's tooltip: "F1(50%) + F2(50%)", "F1 → F2". */
  label: string;
}

/** Desktop only offers three-filament mixes of the first six filaments (kMaxSwatchFilaments). */
export const SUGGEST_TRIPLE_LIMIT = 6;

const pairs = (n: number) => {
  const out: [number, number][] = [];
  for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) out.push([i, j]);
  return out;
};

/** Each triple of the first six filaments: equal shares, then each one at 50% with the others at 25%. */
function triples(n: number): MixSuggestion[] {
  const out: MixSuggestion[] = [];
  const m = Math.min(n, SUGGEST_TRIPLE_LIMIT);
  const eq = normalizeWeights([1, 1, 1]);
  for (let i = 1; i <= m; i++)
    for (let j = i + 1; j <= m; j++)
      for (let k = j + 1; k <= m; k++)
        for (const w of [eq, [50, 25, 25], [25, 50, 25], [25, 25, 50]])
          out.push({ filaments: [i, j, k], weights: w, label: `F${i}(${w[0]}%)+F${j}(${w[1]}%)+F${k}(${w[2]}%)` });
  return out;
}

/**
 * The recommendations for a mode, before colours: Ratio with two rows offers
 * every pair at 50:50, with three rows every triple; Match offers both; Gradient
 * every pair in both directions. Cycle has none (desktop hides the card).
 */
export function mixSuggestions(mode: MixMode, rows: number, physical: number): MixSuggestion[] {
  const half = ([i, j]: [number, number]): MixSuggestion => ({ filaments: [i, j], weights: [50, 50], label: `F${i}(50%) + F${j}(50%)` });
  switch (mode) {
    case 'ratio':
      return rows >= 3 ? triples(physical) : pairs(physical).map(half);
    case 'match':
      return [...pairs(physical).map(half), ...triples(physical)];
    case 'gradient':
      return pairs(physical).flatMap(([i, j]) => [
        { filaments: [i, j], weights: [50, 50], label: `F${i} → F${j}` },
        { filaments: [j, i], weights: [50, 50], label: `F${j} → F${i}` },
      ]);
    case 'cycle':
      return [];
  }
}

/** The smallest share in a suggestion: Match hides those below its Min share. */
export const minShare = (s: MixSuggestion) => Math.min(...s.weights);

/** A suggestion's weights over all `physical` filaments (0 for the rest), for one blend call. */
export function spreadWeights(s: MixSuggestion, physical: number): number[] {
  const w = Array.from({ length: physical }, () => 0);
  s.filaments.forEach((f, i) => (w[f - 1] = s.weights[i]));
  return w;
}

/** The dialog after tapping a suggestion (desktop's badge click handler). */
export function applySuggestion(d: MixDraft, s: MixSuggestion, colour: string): MixDraft {
  if (d.mode === 'match') return { ...d, match: matchFromSuggestion(s, colour) };
  if (d.mode === 'gradient') return { ...d, filaments: s.filaments.slice(0, 2), reversed: false };
  if (s.filaments.length >= 3) return { ...d, filaments: s.filaments.slice(0, 3), weights: [...s.weights] };
  return { ...d, filaments: s.filaments.slice(0, 2), percentB: s.weights[1] };
}

/**
 * Match recipe of a suggestion, as build_multi_color_match_candidate stores it:
 * filaments ordered by share (largest first, then lowest number).
 */
export function matchFromSuggestion(s: MixSuggestion, colour: string): MatchResult {
  const order = s.filaments.map((f, i) => ({ f, w: s.weights[i] })).sort((a, b) => b.w - a.w || a.f - b.f);
  const [a, b] = order;
  const mixBPercent = Math.round((100 * b.w) / (a.w + b.w));
  if (order.length < 3) return { valid: true, componentA: s.filaments[0], componentB: s.filaments[1], mixBPercent: s.weights[1], gradientIds: '', gradientWeights: '', colour, deltaE: -1 };
  return {
    valid: true,
    componentA: a.f,
    componentB: b.f,
    mixBPercent,
    gradientIds: encodeIds(order.map((o) => o.f)),
    gradientWeights: order.map((o) => o.w).join('/'),
    colour,
    deltaE: -1,
  };
}

// ---------------------------------------------------------------------------
// The Ratio triangle for three filaments (MixedFilamentDialog::build_tri_picker).

export type Point = { x: number; y: number };

/** Corners of the triangle in a size×size box: top = first row, bottom left = second, bottom right = third. */
export function triangleCorners(size: number, margin = 3): [Point, Point, Point] {
  const side = size - 2 * margin;
  const h = (side * Math.sqrt(3)) / 2;
  const top = (size - h) / 2;
  return [
    { x: size / 2, y: top },
    { x: size / 2 - side / 2, y: top + h },
    { x: size / 2 + side / 2, y: top + h },
  ];
}

const area2 = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);

/** Barycentric weights of p (tri_bary); negative outside the triangle. */
export function barycentric(p: Point, [v0, v1, v2]: [Point, Point, Point]): [number, number, number] {
  const total = area2(v0, v1, v2);
  if (Math.abs(total) < 1e-9) return [1 / 3, 1 / 3, 1 / 3];
  const w0 = area2(p, v1, v2) / total;
  const w1 = area2(v0, p, v2) / total;
  return [w0, w1, 1 - w0 - w1];
}

/** Shares for a point dragged anywhere: each held between 10% and 90%, as desktop does (4 passes). */
export function triangleWeights(p: Point, corners: [Point, Point, Point]): number[] {
  let w = barycentric(p, corners);
  for (let pass = 0; pass < 4; pass++) {
    w = w.map((v) => Math.min(0.9, Math.max(0.1, v))) as [number, number, number];
    const sum = w[0] + w[1] + w[2];
    w = w.map((v) => v / sum) as [number, number, number];
  }
  return normalizeWeights(w.map((v) => v * 100));
}

/** Where the handle sits for these shares. */
export function trianglePoint(weights: number[], [v0, v1, v2]: [Point, Point, Point]): Point {
  const sum = weights[0] + weights[1] + weights[2] || 1;
  const [a, b, c] = weights.map((w) => w / sum);
  return { x: a * v0.x + b * v1.x + c * v2.x, y: a * v0.y + b * v1.y + c * v2.y };
}
