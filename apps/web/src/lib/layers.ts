// Variable layer height (engine/src/layers_api.cpp), like desktop Orca's
// layer height editing: the profile of an object, the requests that edit it,
// and the colours the 3D view and the profile chart draw it with.

/** What desktop's mouse buttons do on the profile: add detail (thinner layers), remove it, back to the base height, smooth. */
export type LayerAction = 'decrease' | 'increase' | 'reduce' | 'smooth';

export type LayerRequest =
  | { op: 'get' }
  | { op: 'reset' }
  /** 0 = quality (thin layers), 1 = speed, like desktop's Quality / Speed slider. */
  | { op: 'adaptive'; quality: number }
  | { op: 'smooth'; radius: number; keepMin: boolean }
  /** One step of `strength` mm per z, over a band `band` mm high, like a moment of desktop's drag. */
  | { op: 'adjust'; action: LayerAction; zs: number[]; strength?: number; band?: number };

export interface LayerProfile {
  /** The object has its own profile (else it prints at the plain layer height). */
  custom: boolean;
  /** [z, layer height, z, layer height, ...] from the bottom of the object. */
  profile: number[];
  /** [bottom, top, bottom, top, ...] of each layer a slice prints. */
  layers: number[];
  layerHeight: number;
  minLayerHeight: number;
  maxLayerHeight: number;
  firstLayerHeight: number;
  /** Object height, mm. */
  height: number;
}

/** Layer height at z, read off the profile like desktop's chart (linear between points). */
export function heightAt(profile: number[], z: number): number {
  if (profile.length < 2) return 0;
  if (z <= profile[0]) return profile[1];
  for (let i = 2; i < profile.length; i += 2) {
    const z0 = profile[i - 2];
    const z1 = profile[i];
    if (z <= z1) {
      const t = z1 > z0 ? (z - z0) / (z1 - z0) : 1;
      return profile[i - 1] + (profile[i + 1] - profile[i - 1]) * t;
    }
  }
  return profile[profile.length - 1];
}

// Thin layers cool, thick layers warm: blue -> green -> yellow -> orange.
const STOPS: [number, [number, number, number]][] = [
  [0, [0.16, 0.42, 0.95]],
  [0.35, [0.1, 0.75, 0.55]],
  [0.65, [0.95, 0.85, 0.2]],
  [1, [0.98, 0.45, 0.15]],
];

/** Colour of a layer height between min and max (0..1 RGB). */
export function layerColour(h: number, min: number, max: number): [number, number, number] {
  const t = max > min ? Math.min(1, Math.max(0, (h - min) / (max - min))) : 0.5;
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    if (t <= t1) {
      const [t0, c0] = STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * f) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/**
 * The layers as a column of `rows` RGBA texels over the object's height, the
 * way desktop paints them on the object: each layer in its height's colour,
 * every other layer a little darker so the layers show.
 */
export function layerTexture(p: LayerProfile, rows: number): Uint8Array {
  const out = new Uint8Array(rows * 4);
  const { layers, height } = p;
  let layer = 0;
  for (let r = 0; r < rows; r++) {
    const z = ((r + 0.5) / rows) * height;
    while (layer * 2 + 2 < layers.length && layers[layer * 2 + 1] < z) layer++;
    const h = layers.length ? layers[layer * 2 + 1] - layers[layer * 2] : p.layerHeight;
    const shade = layer % 2 ? 0.82 : 1;
    const c = layerColour(h, p.minLayerHeight, p.maxLayerHeight);
    out.set([c[0] * shade * 255, c[1] * shade * 255, c[2] * shade * 255, 255], r * 4);
  }
  return out;
}
