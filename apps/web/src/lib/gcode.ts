// Parses G-code into extrusion segments grouped by layer, for the Preview.
// Reads what Orca writes: ;LAYER_CHANGE / ;Z: markers, ;TYPE: feature
// comments, T<n> tool changes, G0/G1 and arcs (G2/G3, from arc fitting),
// absolute or relative extrusion.

export const FEATURES = [
  'Outer wall', 'Inner wall', 'Overhang wall', 'Sparse infill', 'Internal solid infill', 'Top surface',
  'Bottom surface', 'Bridge', 'Internal Bridge', 'Gap infill', 'Skirt', 'Brim', 'Support', 'Support interface',
  'Support transition', 'Prime tower', 'Ironing', 'Custom', 'Other',
] as const;

/** Orca's default feature colours (GCodeViewer), by FEATURES index. */
export const FEATURE_COLOURS = [
  '#FF7D38', '#FFE64D', '#0000FF', '#B03029', '#9654CC', '#FF1A1A', '#668C29', '#4D80BA', '#4D80BA', '#FFFFFF',
  '#00876E', '#00876E', '#00FF00', '#008000', '#00FF00', '#E6B34D', '#FF8C69', '#5ECCF6', '#808080',
];

export interface ParsedGcode {
  /** Segment endpoints: x1 y1 z1 x2 y2 z2 per segment. */
  positions: Float32Array;
  /** FEATURES index per segment. */
  features: Uint8Array;
  /** Tool (0-based) per segment. */
  tools: Uint8Array;
  /** Extrusion width and height (mm) per segment, from ;WIDTH: / ;HEIGHT:. */
  sizes: Float32Array;
  /** Index of the first segment of each layer, plus a final end index. */
  layerStarts: Uint32Array;
  layerZ: Float32Array;
  toolsUsed: number[];
}

const featureIndex = new Map<string, number>(FEATURES.map((f, i) => [f.toLowerCase(), i]));
const OTHER = FEATURES.length - 1;

export function parseGcode(text: string): ParsedGcode {
  let pos = new Float32Array(1 << 20);
  let feat = new Uint8Array(1 << 17);
  let tool = new Uint8Array(1 << 17);
  let size = new Float32Array(1 << 18);
  let n = 0;
  const layerStarts: number[] = [];
  const layerZ: number[] = [];
  const toolsUsed = new Set<number>();

  let x = 0, y = 0, z = 0, e = 0;
  // Like Orca's GCodeProcessor (and Klipper): G90/G91 set the XYZ mode, M82/M83
  // the extruder's own mode, and E is relative if either says so. A G90 after
  // M83 must not make E absolute (U1 start G-code does exactly that).
  let absXYZ = true, relE = false;
  let feature = OTHER;
  let t = 0;
  let width = 0.45, height = 0.2;
  let pendingZ: number | null = null;
  let layerOpen = false;

  const push = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    if (n * 6 + 6 > pos.length) {
      const p = new Float32Array(pos.length * 2);
      p.set(pos);
      pos = p;
    }
    if (n + 1 > feat.length) {
      const f = new Uint8Array(feat.length * 2);
      f.set(feat);
      feat = f;
      const tt = new Uint8Array(tool.length * 2);
      tt.set(tool);
      tool = tt;
      const sz = new Float32Array(size.length * 2);
      sz.set(size);
      size = sz;
    }
    pos.set([x1, y1, z1, x2, y2, z2], n * 6);
    feat[n] = feature;
    tool[n] = t;
    size[n * 2] = width;
    size[n * 2 + 1] = height;
    toolsUsed.add(t);
    n++;
  };

  const startLayer = (layerZValue: number) => {
    layerStarts.push(n);
    layerZ.push(layerZValue);
    layerOpen = true;
  };

  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = len;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line) continue;

    if (line.charCodeAt(0) === 59 /* ; */) {
      if (line.startsWith(';LAYER_CHANGE')) {
        pendingZ = NaN;
      } else if (line.startsWith(';Z:')) {
        const v = parseFloat(line.slice(3));
        if (pendingZ !== null) {
          startLayer(v);
          pendingZ = null;
        }
      } else if (line.startsWith(';TYPE:')) {
        feature = featureIndex.get(line.slice(6).trim().toLowerCase()) ?? OTHER;
      } else if (line.startsWith(';WIDTH:')) {
        const v = parseFloat(line.slice(7));
        if (v > 0) width = v;
      } else if (line.startsWith(';HEIGHT:')) {
        const v = parseFloat(line.slice(8));
        if (v > 0) height = v;
      }
      continue;
    }

    const semi = line.indexOf(';');
    const code = semi >= 0 ? line.slice(0, semi).trim() : line;
    const word = code.split(/\s+/);
    const cmd = word[0].toUpperCase();

    if (cmd === 'G1' || cmd === 'G0' || cmd === 'G2' || cmd === 'G3') {
      let nx = x, ny = y, nz = z, ne = e, i = 0, j = 0;
      let hasE = false;
      for (let k = 1; k < word.length; k++) {
        const c = word[k].charCodeAt(0) | 32;
        const v = parseFloat(word[k].slice(1));
        if (Number.isNaN(v)) continue;
        if (c === 120) nx = absXYZ ? v : x + v;
        else if (c === 121) ny = absXYZ ? v : y + v;
        else if (c === 122) nz = absXYZ ? v : z + v;
        else if (c === 101) { ne = absXYZ && !relE ? v : e + v; hasE = true; }
        else if (c === 105) i = v;
        else if (c === 106) j = v;
      }
      const extruding = hasE && ne > e + 1e-6 && (nx !== x || ny !== y);
      if (extruding) {
        if (pendingZ !== null || !layerOpen) {
          startLayer(nz);
          pendingZ = null;
        }
        if (cmd === 'G2' || cmd === 'G3') {
          // Arc around (x + i, y + j); split into ~1 mm chords.
          const cx = x + i, cy = y + j;
          const r = Math.hypot(i, j);
          let a0 = Math.atan2(y - cy, x - cx);
          let a1 = Math.atan2(ny - cy, nx - cx);
          if (cmd === 'G3' && a1 <= a0) a1 += 2 * Math.PI;
          if (cmd === 'G2' && a1 >= a0) a1 -= 2 * Math.PI;
          const steps = Math.max(2, Math.min(64, Math.ceil((Math.abs(a1 - a0) * r) / 1)));
          let px = x, py = y, pz = z;
          for (let s = 1; s <= steps; s++) {
            const a = a0 + ((a1 - a0) * s) / steps;
            const qx = s === steps ? nx : cx + r * Math.cos(a);
            const qy = s === steps ? ny : cy + r * Math.sin(a);
            const qz = z + ((nz - z) * s) / steps;
            push(px, py, pz, qx, qy, qz);
            px = qx; py = qy; pz = qz;
          }
        } else {
          push(x, y, z, nx, ny, nz);
        }
      }
      x = nx; y = ny; z = nz; e = ne;
    } else if (cmd === 'G90') absXYZ = true;
    else if (cmd === 'G91') absXYZ = false;
    else if (cmd === 'M82') relE = false;
    else if (cmd === 'M83') relE = true;
    else if (cmd === 'G92') {
      for (let k = 1; k < word.length; k++) {
        const c = word[k].charCodeAt(0) | 32;
        const v = parseFloat(word[k].slice(1));
        if (c === 101 && !Number.isNaN(v)) e = v;
      }
    } else if (/^T\d+$/.test(cmd)) t = Number(cmd.slice(1));
  }

  // Drop layers that ended up empty.
  const starts: number[] = [];
  const zs: number[] = [];
  for (let k = 0; k < layerStarts.length; k++) {
    const next = k + 1 < layerStarts.length ? layerStarts[k + 1] : n;
    if (next > layerStarts[k]) {
      starts.push(layerStarts[k]);
      zs.push(layerZ[k]);
    }
  }
  starts.push(n);
  return {
    positions: pos.slice(0, n * 6),
    features: feat.slice(0, n),
    tools: tool.slice(0, n),
    sizes: size.slice(0, n * 2),
    layerStarts: Uint32Array.from(starts),
    layerZ: Float32Array.from(zs),
    toolsUsed: [...toolsUsed].sort((a, b) => a - b),
  };
}

/** Features that outer walls and the layers above hide; the Preview leaves them out while the view moves. */
export const INNER_FEATURES = new Set(
  ['Inner wall', 'Sparse infill', 'Internal solid infill', 'Internal Bridge', 'Gap infill'].map((f) =>
    FEATURES.indexOf(f as (typeof FEATURES)[number]),
  ),
);

/**
 * Segments in the Preview's drawing order: every layer's shell (what can be
 * seen from outside) first, then every layer's inner segments, so each group
 * up to a layer is one contiguous run that one draw call covers.
 */
export interface PreviewGcode extends Omit<ParsedGcode, 'layerStarts'> {
  /** Index of the first shell segment of each layer, plus a final end index (= innerStarts[0]). */
  shellStarts: Uint32Array;
  /** Index of the first inner segment of each layer, plus a final end index. */
  innerStarts: Uint32Array;
}

export function orderForPreview(p: ParsedGcode): PreviewGcode {
  const n = p.features.length;
  const layers = p.layerZ.length;
  const positions = new Float32Array(n * 6);
  const features = new Uint8Array(n);
  const tools = new Uint8Array(n);
  const sizes = new Float32Array(n * 2);
  const shellStarts = new Uint32Array(layers + 1);
  const innerStarts = new Uint32Array(layers + 1);
  let shellCount = 0;
  for (let s = 0; s < n; s++) if (!INNER_FEATURES.has(p.features[s])) shellCount++;
  let shell = 0, inner = shellCount;
  for (let k = 0; k < layers; k++) {
    shellStarts[k] = shell;
    innerStarts[k] = inner;
    for (let s = p.layerStarts[k]; s < p.layerStarts[k + 1]; s++) {
      const to = INNER_FEATURES.has(p.features[s]) ? inner++ : shell++;
      positions.set(p.positions.subarray(s * 6, s * 6 + 6), to * 6);
      sizes[to * 2] = p.sizes[s * 2];
      sizes[to * 2 + 1] = p.sizes[s * 2 + 1];
      features[to] = p.features[s];
      tools[to] = p.tools[s];
    }
  }
  shellStarts[layers] = shell;
  innerStarts[layers] = inner;
  return { positions, features, tools, sizes, shellStarts, innerStarts, layerZ: p.layerZ, toolsUsed: p.toolsUsed };
}
