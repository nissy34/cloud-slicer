// Simplify (engine/src/simplify_api.cpp), like desktop Orca's Simplify tool.

/** Desktop's detail levels, most detail first (the largest error each allows grows from 0.001 to 1 mm). */
export const DETAIL_LEVELS = ['Extra high', 'High', 'Medium', 'Low', 'Extra low'] as const;

export type SimplifyBy = { level: number } | { ratio: number };
export type SimplifyRequest = { op: 'get' } | ({ op: 'preview' | 'apply' } & SimplifyBy);

export interface SimplifyResult {
  /** The object's triangles now. */
  triangles: number;
  /** Its triangles with the request applied (preview and apply). */
  after?: number;
  /** It has paint (remapped onto the simplified mesh). */
  painted: boolean;
}

/** What the panel's choice asks the engine for: a detail level (0..4) or a decimate ratio (% removed). */
export function simplifyBy(mode: 'level' | 'ratio', level: number, ratio: number): SimplifyBy {
  return mode === 'level' ? { level: Math.min(4, Math.max(0, Math.round(level))) } : { ratio: Math.min(100, Math.max(0, ratio)) };
}

/**
 * Above this many triangles a model makes slicing run short of memory: a
 * browser page gets at most 4 GB, on desktop as on a phone. Measured on a
 * 3.2 million triangle mask with tree supports, which needed 3.7 GB.
 */
export const HEAVY_TRIANGLES = 1_000_000;
/** What simplifying a heavy model aims for: plenty of detail for printing. */
export const LIGHT_TRIANGLES = 500_000;
/** Objects smaller than this are left alone (simplifying them saves little). */
const WORTH_SIMPLIFYING = 50_000;

export interface HeavyModel {
  /** The objects to simplify. */
  objects: number[];
  /** Triangles on the plate now. */
  triangles: number;
  /** The decimate ratio (% removed) for each of those objects. */
  ratio: number;
  /** Some of those objects have paint, which simplifying removes. */
  painted: boolean;
}

/**
 * Given each object's triangles and the objects on the plate being sliced,
 * what to simplify to bring that plate near LIGHT_TRIANGLES, or null when
 * it's light enough.
 */
export function heavyModel(triangles: number[], onPlate: number[] = triangles.map((_, o) => o)): HeavyModel | null {
  const total = onPlate.reduce((a, o) => a + (triangles[o] ?? 0), 0);
  if (total <= HEAVY_TRIANGLES) return null;
  const objects = onPlate.filter((o) => triangles[o] >= WORTH_SIMPLIFYING).sort((a, b) => a - b);
  const big = objects.reduce((a, o) => a + triangles[o], 0);
  const keep = Math.max(LIGHT_TRIANGLES - (total - big), big * 0.05);
  return { objects, triangles: total, ratio: Math.min(95, Math.round(100 * (1 - keep / big))), painted: false };
}

/** "3.2 million" or "800,000". */
export function triangleCount(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} million` : n.toLocaleString('en-US');
}

/** What simplifying a project's heavy plates takes, worked out when it opens. */
export interface HeavyProject {
  /** Each object to simplify, with its decimate ratio (% removed). */
  objects: { object: number; ratio: number }[];
  /** The plates over HEAVY_TRIANGLES and their triangles, heaviest first. */
  plates: { plate: number; triangles: number }[];
  /** Some of those objects have paint, which simplifying removes. */
  painted: boolean;
}

/**
 * Every plate of the project over HEAVY_TRIANGLES, each brought near
 * LIGHT_TRIANGLES as heavyModel does it; null when no plate is heavy.
 * `plates` lists the objects on each plate.
 */
export function heavyProject(counts: SimplifyResult[], plates: number[][]): HeavyProject | null {
  const triangles = counts.map((c) => c.triangles);
  const ratios = new Map<number, number>();
  const heavy: HeavyProject['plates'] = [];
  plates.forEach((objects, plate) => {
    const plan = heavyModel(triangles, objects);
    if (!plan) return;
    heavy.push({ plate, triangles: plan.triangles });
    for (const o of plan.objects) ratios.set(o, Math.max(ratios.get(o) ?? 0, plan.ratio));
  });
  if (!heavy.length) return null;
  const objects = [...ratios].sort(([a], [b]) => a - b).map(([object, ratio]) => ({ object, ratio }));
  return { objects, plates: heavy.sort((a, b) => b.triangles - a.triangles), painted: objects.some((o) => counts[o.object]?.painted) };
}

/** The question before a heavy project is drawn: what's heavy and what simplifying does. */
export function heavyQuestion(h: HeavyProject, plateCount: number): string {
  const light = triangleCount(LIGHT_TRIANGLES);
  const tooMuch = 'which can be more than this device can hold';
  if (h.plates.length > 1)
    return `${h.plates.length} plates have more than ${triangleCount(HEAVY_TRIANGLES)} triangles (up to ${triangleCount(h.plates[0].triangles)}), ${tooMuch}. Simplifying each to about ${light} keeps plenty of detail for printing.`;
  const what = plateCount > 1 ? `Plate ${h.plates[0].plate + 1}` : 'This model';
  return `${what} has ${triangleCount(h.plates[0].triangles)} triangles, ${tooMuch}. Simplifying it to about ${light} keeps plenty of detail for printing.`;
}

/**
 * A phone or tablet: the browser says it's a phone, or a touch screen is its
 * only pointer. Those run out of memory with a heavy model (a 1.8 million
 * triangle 3MF crashed the page on an 8 GB phone), where a computer opens
 * 1.5 million in 16 s using about 180 MB. Chrome reports at most 8 GB of
 * memory for any device, so that figure can't tell them apart.
 */
export function shortOfMemory(): boolean {
  if (typeof navigator === 'undefined' || typeof matchMedia === 'undefined') return false;
  const mobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  return mobile === true || (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);
}
