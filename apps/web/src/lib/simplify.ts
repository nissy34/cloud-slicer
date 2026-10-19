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
  /** It has paint, which simplifying removes. */
  painted: boolean;
}

/** What the panel's choice asks the engine for: a detail level (0..4) or a decimate ratio (% removed). */
export function simplifyBy(mode: 'level' | 'ratio', level: number, ratio: number): SimplifyBy {
  return mode === 'level' ? { level: Math.min(4, Math.max(0, Math.round(level))) } : { ratio: Math.min(100, Math.max(0, ratio)) };
}
