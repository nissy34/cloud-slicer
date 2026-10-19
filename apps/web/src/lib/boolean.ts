// Mesh boolean of two volumes of one object (engine/src/boolean_api.cpp),
// like desktop Orca's Mesh Boolean tool.
import type { VolumeInfo } from '../engine/protocol';

export type BooleanOp = 'union' | 'difference' | 'intersection';
export const BOOLEAN_OPS: { op: BooleanOp; label: string }[] = [
  { op: 'union', label: 'Union' },
  { op: 'difference', label: 'Difference' },
  { op: 'intersection', label: 'Intersection' },
];

export interface BooleanRequest {
  op: BooleanOp;
  /** The volume kept (subtracted from, for a difference). */
  a: number;
  b: number;
  /** Drop the second volume too (a union always does). */
  deleteInput?: boolean;
}

/** Desktop's captions for the two pickers. */
export function pickerLabels(op: BooleanOp): [string, string] {
  return op === 'difference' ? ['Subtract from', 'Subtract with'] : ['Part 1', 'Part 2'];
}

/** The starting pair: the picked volume (else the first) and the next one along. */
export function defaultPair(volumes: Pick<VolumeInfo, 'name'>[], picked?: number): [number, number] {
  if (volumes.length < 2) return [0, 0];
  const a = picked !== undefined && picked >= 0 && picked < volumes.length ? picked : 0;
  return [a, a === volumes.length - 1 ? 0 : a + 1];
}
