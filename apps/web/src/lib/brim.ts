// Brim ears (engine/src/brim_api.cpp), like desktop Orca's Brim Ears tool:
// round pads of brim on the bed under an object's corners.

export interface BrimEar {
  /** Centre on the plate, mm. */
  x: number;
  y: number;
  diameter: number;
  /** Touches the object's first layer (directly or through other ears); a loose ear prints as a lone pad. */
  attached: boolean;
}

export interface BrimEars {
  ears: BrimEar[];
  /** The object's brim type; the ears print only when it is "painted". */
  brimType: string;
  /** Desktop's default ear size: 16 first-layer lines across. */
  defaultDiameter: number;
}

export type BrimRequest =
  | { op: 'get' }
  /** Ears on the sharp corners of the first layer: corners sharper than maxAngle (degrees), after smoothing the outline by `detection` mm. */
  | { op: 'auto'; diameter: number; maxAngle: number; detection: number }
  | { op: 'add'; x: number; y: number; diameter: number }
  | { op: 'remove'; indices: number[] }
  | { op: 'resize'; indices: number[]; diameter: number }
  | { op: 'clear' };

/** The brim type that prints the ears, as Orca names it. */
export const PAINTED = 'painted';

/** The ear at plate point x, y (the topmost when they overlap), or -1. */
export function earAt(ears: BrimEar[], x: number, y: number): number {
  for (let i = ears.length - 1; i >= 0; i--) {
    const e = ears[i];
    if (Math.hypot(x - e.x, y - e.y) <= e.diameter / 2) return i;
  }
  return -1;
}
