// Parses G-code into extrusion segments grouped by layer, for the Preview.
// Reads what Orca writes: ;LAYER_CHANGE / ;Z: markers, ;TYPE: feature
// comments (Bambu printers' G-code says ; CHANGE_LAYER / ; Z_HEIGHT: /
// ; FEATURE: / ; LINE_WIDTH: / ; LAYER_HEIGHT: instead), T<n> tool changes, G0/G1 and arcs (G2/G3, from arc fitting),
// absolute or relative extrusion, feedrates, fan (M106/M107) and nozzle
// temperatures (M104/M109), and the filament statistics Orca writes at the end.

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
  /** Speed per segment in 0.1 mm/s steps. */
  speeds: Uint16Array;
  /** Volumetric flow per segment in 0.01 mm³/s steps. */
  flows: Uint16Array;
  /** Part cooling fan per segment, 0..100 %. */
  fans: Uint8Array;
  /** Nozzle temperature per segment, °C. */
  temps: Uint16Array;
  /** Time per layer (s): the moves' own time, scaled so the layers add up to Orca's estimate. */
  layerTimes: Float32Array;
  stats: GcodeStats;
}

/** One filament's use, from the statistics Orca writes at the end of the G-code (prime tower included). */
export interface FilamentUse {
  mm: number;
  grams: number;
  cost: number;
}

export interface GcodeStats {
  /** By tool (0-based); tools the print doesn't use are zero. */
  filaments: FilamentUse[];
  totalGrams: number;
  totalCost: number;
  /** Switches from one filament to another between extrusions (desktop's "Filament change times"). */
  toolChanges: number;
  /** Orca's estimate (normal mode), seconds; 0 when the file has none. */
  seconds: number;
}

/** "1d 2h 3m 4s" -> seconds. */
function durationSeconds(text: string): number {
  let total = 0;
  for (const [, n, u] of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) total += Number(n) * { d: 86400, h: 3600, m: 60, s: 1 }[u as 'd' | 'h' | 'm' | 's'];
  return total;
}

const numbers = (text: string) => text.split(/[,;]/).map((v) => Number(v.trim()) || 0);

/** How much of the start and the end of the file `filamentDiameters` looks at. */
export const HEAD_BYTES = 64 * 1024;
export const TAIL_BYTES = 1024 * 1024;

/**
 * Filament diameters per tool: the header's "; filament_diameter: 1.75,1.75",
 * else the config block's. `head` and `tail` are the file's first HEAD_BYTES
 * and last TAIL_BYTES.
 */
export function filamentDiameters(head: string, tail: string): number[] {
  const m = /^; filament_diameter\s*[:=]\s*(.*)$/m.exec(head) ?? /^; filament_diameter\s*=\s*(.*)$/m.exec(tail);
  const d = m ? numbers(m[1]).filter((v) => v > 0) : [];
  return d.length ? d : [1.75];
}

const featureIndex = new Map<string, number>(FEATURES.map((f, i) => [f.toLowerCase(), i]));
const OTHER = FEATURES.length - 1;

/** `onProgress` gets the share of the text read so far (0..1), about every 2 MB. */
export function parseGcode(text: string, onProgress?: (done: number) => void): ParsedGcode {
  const reader = gcodeReader(filamentDiameters(text.slice(0, HEAD_BYTES), text.slice(Math.max(0, text.length - TAIL_BYTES))));
  const STEP = 2 << 20;
  for (let at = 0; at < text.length; at += STEP) {
    if (onProgress && at) onProgress(at / text.length);
    reader.read(text.slice(at, at + STEP));
  }
  return reader.finish();
}

export interface GcodeReader {
  /** The next piece of the file, cut anywhere (even mid-line). */
  read(chunk: string): void;
  /** The segments; the arrays are views of larger buffers (orderForPreview copies them out). */
  finish(): ParsedGcode;
}

/**
 * Reads G-code a piece at a time, so a file too big for one string (browsers
 * stop at about 512 MB) can be streamed in. `diameters` from filamentDiameters.
 */
export function gcodeReader(diameters: number[]): GcodeReader {
  let pos = new Float32Array(1 << 20);
  let feat = new Uint8Array(1 << 17);
  let tool = new Uint8Array(1 << 17);
  let size = new Float32Array(1 << 18);
  let speed = new Uint16Array(1 << 17);
  let flow = new Uint16Array(1 << 17);
  let fan = new Uint8Array(1 << 17);
  let temp = new Uint16Array(1 << 17);
  let n = 0;
  const layerStarts: number[] = [];
  const layerZ: number[] = [];
  const toolsUsed = new Set<number>();
  // Seconds of moves per layer as it was read (dropped empty layers fold into the one before).
  const layerSeconds: number[] = [];
  let preludeSeconds = 0;
  const areas = diameters.map((d) => (Math.PI * d * d) / 4);
  const area = (tool: number) => areas[tool] ?? areas[0];
  let feedrate = 0; // mm/min
  let fanPct = 0;
  const temps: number[] = [];
  let lastExtrudingTool = -1;
  let toolChanges = 0;
  const footer = { mm: [] as number[], grams: [] as number[], cost: [] as number[], totalGrams: 0, totalCost: 0, seconds: 0 };
  let segSpeed = 0, segFlow = 0;

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
  // A layer opened by extrusions before Orca's first ;LAYER_CHANGE (the start
  // G-code's purge line): it becomes part of the first layer, as on desktop.
  let startGcodeLayer = false;

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
      const grow16 = (a: Uint16Array) => {
        const b = new Uint16Array(a.length * 2);
        b.set(a);
        return b;
      };
      speed = grow16(speed);
      flow = grow16(flow);
      temp = grow16(temp);
      const fn = new Uint8Array(fan.length * 2);
      fn.set(fan);
      fan = fn;
    }
    pos.set([x1, y1, z1, x2, y2, z2], n * 6);
    feat[n] = feature;
    tool[n] = t;
    size[n * 2] = width;
    size[n * 2 + 1] = height;
    speed[n] = Math.min(65535, Math.round(segSpeed * 10));
    flow[n] = Math.min(65535, Math.round(segFlow * 100));
    fan[n] = fanPct;
    temp[n] = Math.min(65535, Math.round(temps[t] ?? 0));
    toolsUsed.add(t);
    n++;
  };

  const startLayer = (layerZValue: number) => {
    layerStarts.push(n);
    layerSeconds.push(0);
    layerZ.push(layerZValue);
    layerOpen = true;
  };

  const addSeconds = (sec: number) => {
    if (!(sec > 0) || !Number.isFinite(sec)) return;
    if (layerSeconds.length) layerSeconds[layerSeconds.length - 1] += sec;
    else preludeSeconds += sec;
  };
  const param = (word: string[], letter: number) => {
    for (let k = 1; k < word.length; k++) if ((word[k].charCodeAt(0) | 32) === letter) return parseFloat(word[k].slice(1));
    return NaN;
  };
  const readLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;

    if (line.charCodeAt(0) === 59 /* ; */) {
      if (line.startsWith(';LAYER_CHANGE') || line.startsWith('; CHANGE_LAYER')) {
        pendingZ = NaN;
      } else if (line.startsWith(';Z:') || line.startsWith('; Z_HEIGHT:')) {
        const v = parseFloat(line.slice(line.indexOf(':') + 1));
        if (pendingZ !== null) {
          if (startGcodeLayer) layerZ[layerZ.length - 1] = v;
          else startLayer(v);
          startGcodeLayer = false;
          pendingZ = null;
        }
      } else if (line.startsWith(';TYPE:') || line.startsWith('; FEATURE:')) {
        feature = featureIndex.get(line.slice(line.indexOf(':') + 1).trim().toLowerCase()) ?? OTHER;
      } else if (line.startsWith(';WIDTH:') || line.startsWith('; LINE_WIDTH:')) {
        const v = parseFloat(line.slice(line.indexOf(':') + 1));
        if (v > 0) width = v;
      } else if (line.startsWith(';HEIGHT:') || line.startsWith('; LAYER_HEIGHT:')) {
        const v = parseFloat(line.slice(line.indexOf(':') + 1));
        if (v > 0) height = v;
      } else if (line.startsWith('; filament used [mm] =')) footer.mm = numbers(line.slice(22));
      else if (line.startsWith('; filament used [g] =')) footer.grams = numbers(line.slice(21));
      else if (line.startsWith('; filament cost =')) footer.cost = numbers(line.slice(17));
      else if (line.startsWith('; total filament used [g] =')) footer.totalGrams = Number(line.slice(27)) || 0;
      else if (line.startsWith('; total filament cost =')) footer.totalCost = Number(line.slice(23)) || 0;
      else if (line.startsWith('; estimated printing time (normal mode) =')) footer.seconds = durationSeconds(line.slice(41));
      return;
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
        else if (c === 102 && v > 0) feedrate = v;
      }
      const arc = cmd === 'G2' || cmd === 'G3';
      // Arc around (x + i, y + j), clockwise for G2.
      const cx = x + i, cy = y + j;
      const r = Math.hypot(i, j);
      let a0 = 0, a1 = 0;
      if (arc) {
        a0 = Math.atan2(y - cy, x - cx);
        a1 = Math.atan2(ny - cy, nx - cx);
        if (cmd === 'G3' && a1 <= a0) a1 += 2 * Math.PI;
        if (cmd === 'G2' && a1 >= a0) a1 -= 2 * Math.PI;
      }
      const flat = arc ? Math.abs(a1 - a0) * r : Math.hypot(nx - x, ny - y);
      const length = Math.hypot(flat, nz - z);
      const mmPerS = feedrate / 60;
      // A move takes its length (or its retraction, when it only moves E) at the feedrate.
      if (mmPerS > 0) addSeconds((length > 0 ? length : Math.abs(ne - e)) / mmPerS);
      const extruding = hasE && ne > e + 1e-6 && (nx !== x || ny !== y);
      if (extruding) {
        if (pendingZ !== null || !layerOpen) {
          startGcodeLayer = !layerOpen && pendingZ === null;
          startLayer(nz);
          pendingZ = null;
        }
        if (lastExtrudingTool >= 0 && t !== lastExtrudingTool) toolChanges++;
        lastExtrudingTool = t;
        segSpeed = mmPerS;
        // Filament volume per mm of path times the speed, like Orca's flow view.
        segFlow = length > 0 ? (((ne - e) * area(t)) / length) * mmPerS : 0;
        if (arc) {
          // Split into ~1 mm chords.
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
    } else if (cmd === 'G4') {
      const ms = param(word, 112), sec = param(word, 115);
      addSeconds(Number.isFinite(ms) ? ms / 1000 : sec);
    } else if (cmd === 'M106' || cmd === 'M107') {
      // The part cooling fan: no P, or P0. P2 and up are the auxiliary and chamber fans.
      const p = param(word, 112);
      if (!(p > 0)) {
        const v = cmd === 'M107' ? 0 : param(word, 115);
        fanPct = Number.isFinite(v) ? Math.round(Math.max(0, Math.min(255, v)) / 2.55) : 100;
      }
    } else if (cmd === 'M104' || cmd === 'M109') {
      const v = param(word, 115);
      const tool = param(word, 116);
      if (Number.isFinite(v)) temps[Number.isFinite(tool) ? tool : t] = v;
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
    } else if (/^T\d+$/.test(cmd)) {
      // Bambu printers use T255, T1000, T1100 ... as control codes, not tools.
      const n = Number(cmd.slice(1));
      if (n < 255) t = n;
    }
  };

  // The end of the last piece when it stopped mid-line.
  let rest = '';
  const read = (chunk: string) => {
    let start = 0;
    let end = chunk.indexOf('\n');
    if (end >= 0 && rest) {
      readLine(rest + chunk.slice(0, end));
      rest = '';
      start = end + 1;
      end = chunk.indexOf('\n', start);
    }
    while (end >= 0) {
      readLine(chunk.slice(start, end));
      start = end + 1;
      end = chunk.indexOf('\n', start);
    }
    rest += chunk.slice(start);
  };

  const finish = (): ParsedGcode => {
    if (rest) readLine(rest);
    rest = '';
    // Drop layers that ended up empty.
    const starts: number[] = [];
    const zs: number[] = [];
    const secs: number[] = [];
    for (let k = 0; k < layerStarts.length; k++) {
      const next = k + 1 < layerStarts.length ? layerStarts[k + 1] : n;
      if (next > layerStarts[k]) {
        starts.push(layerStarts[k]);
        zs.push(layerZ[k]);
        secs.push(layerSeconds[k]);
      } else if (secs.length) secs[secs.length - 1] += layerSeconds[k];
      else preludeSeconds += layerSeconds[k];
    }
    starts.push(n);
    // Moves alone leave out acceleration; Orca's estimate has it, so the layers
    // share its total the way they share the moves' time.
    const moveSeconds = preludeSeconds + secs.reduce((a, b) => a + b, 0);
    const scale = footer.seconds > 0 && moveSeconds > 0 ? footer.seconds / moveSeconds : 1;
    const tools = Math.max(footer.mm.length, footer.grams.length, footer.cost.length);
    const filaments: FilamentUse[] = Array.from({ length: tools }, (_, k) => ({
      mm: footer.mm[k] ?? 0,
      grams: footer.grams[k] ?? 0,
      cost: footer.cost[k] ?? 0,
    }));
    // Views, not copies: a big print's arrays run to hundreds of MB each.
    return {
      positions: pos.subarray(0, n * 6),
      features: feat.subarray(0, n),
      tools: tool.subarray(0, n),
      sizes: size.subarray(0, n * 2),
      layerStarts: Uint32Array.from(starts),
      layerZ: Float32Array.from(zs),
      toolsUsed: [...toolsUsed].sort((a, b) => a - b),
      speeds: speed.subarray(0, n),
      flows: flow.subarray(0, n),
      fans: fan.subarray(0, n),
      temps: temp.subarray(0, n),
      layerTimes: Float32Array.from(secs, (v) => v * scale),
      stats: {
        filaments,
        totalGrams: footer.totalGrams || filaments.reduce((a, f) => a + f.grams, 0),
        totalCost: footer.totalCost || filaments.reduce((a, f) => a + f.cost, 0),
        toolChanges,
        seconds: footer.seconds,
      },
    };
  };
  return { read, finish };
}

/** Features that outer walls and the layers above hide; on big prints the Preview leaves them out while the view moves. */
export const INNER_FEATURES = new Set(
  ['Inner wall', 'Sparse infill', 'Internal solid infill', 'Internal Bridge', 'Gap infill'].map((f) =>
    FEATURES.indexOf(f as (typeof FEATURES)[number]),
  ),
);

/**
 * Segments in the Preview's drawing order, packed small for the graphics card
 * (a big print has tens of millions): every layer's shell (what can be seen
 * from outside) first, then every layer's inner segments, so each group up to
 * a layer is one contiguous run that one draw call covers.
 *
 * Segment s is drawn from point s to point s + 1, so a path's segments share
 * their corners. Where one path ends and the next starts elsewhere, a gap
 * segment joins them; it has height 0 (`isGap`) and isn't drawn.
 */
export interface PreviewGcode extends Omit<ParsedGcode, 'layerStarts' | 'positions' | 'sizes'> {
  /** Corners as x y z steps from `origin`, `step` mm apiece: segments + 1 of them. */
  points: Uint16Array;
  origin: [number, number, number];
  step: [number, number, number];
  /** Width and height per segment in SIZE_UNIT steps (0.1 µm, up to 6.5 mm); height 0 for a gap. */
  sizes: Uint16Array;
  /** Bounding box (minX minY minZ maxX maxY maxZ) of each line type's segments, by FEATURES index; empty ones are Infinity/-Infinity. */
  featureBoxes: Float64Array;
  /** Index of the first shell segment of each layer, plus a final end index (= innerStarts[0]). */
  shellStarts: Uint32Array;
  /** Index of the first inner segment of each layer, plus a final end index. */
  innerStarts: Uint32Array;
}

/** A segment that only joins two paths and isn't drawn. */
export const isGap = (p: Pick<PreviewGcode, 'sizes'>, s: number) => p.sizes[s * 2 + 1] === 0;

/** Corner i in mm: segment s runs from corner s to corner s + 1. */
export const pointAt = (p: Pick<PreviewGcode, 'points' | 'origin' | 'step'>, i: number): [number, number, number] => [
  p.origin[0] + p.points[i * 3] * p.step[0],
  p.origin[1] + p.points[i * 3 + 1] * p.step[1],
  p.origin[2] + p.points[i * 3 + 2] * p.step[2],
];

/** Segment s's width and height (mm). */
export const SIZE_UNIT = 1e-4;
export const segmentWidth = (p: Pick<PreviewGcode, 'sizes'>, s: number) => p.sizes[s * 2] * SIZE_UNIT;
export const segmentHeight = (p: Pick<PreviewGcode, 'sizes'>, s: number) => p.sizes[s * 2 + 1] * SIZE_UNIT;

export function orderForPreview(p: ParsedGcode): PreviewGcode {
  const n = p.features.length;
  const layers = p.layerZ.length;
  const pos = p.positions;
  // The corners' box sets the steps: 65535 of them across it (~0.004 mm on a 270 mm bed).
  const featureBoxes = new Float64Array(FEATURES.length * 6);
  for (let f = 0; f < FEATURES.length; f++) featureBoxes.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], f * 6);
  for (let s = 0; s < n; s++) {
    const b = p.features[s] * 6;
    for (let i = s * 6; i < s * 6 + 6; i += 3)
      for (let a = 0; a < 3; a++) {
        const v = pos[i + a];
        if (v < featureBoxes[b + a]) featureBoxes[b + a] = v;
        if (v > featureBoxes[b + 3 + a]) featureBoxes[b + 3 + a] = v;
      }
  }
  const origin: [number, number, number] = [Infinity, Infinity, Infinity];
  const top = [-Infinity, -Infinity, -Infinity];
  for (let f = 0; f < FEATURES.length; f++)
    for (let a = 0; a < 3; a++) {
      origin[a] = Math.min(origin[a], featureBoxes[f * 6 + a]);
      top[a] = Math.max(top[a], featureBoxes[f * 6 + 3 + a]);
    }
  if (!n) origin.fill(0), top.fill(0);
  const step = origin.map((o, a) => (top[a] > o ? (top[a] - o) / 65535 : 1)) as [number, number, number];
  const q = (v: number, a: number) => Math.round((v - origin[a]) / step[a]);

  // The drawing order: each layer's shell, then each layer's inner segments.
  const inOrder = (fn: (s: number) => void) => {
    for (const inner of [false, true])
      for (let k = 0; k < layers; k++)
        for (let s = p.layerStarts[k]; s < p.layerStarts[k + 1]; s++) if (INNER_FEATURES.has(p.features[s]) === inner) fn(s);
  };
  // Whether segment s starts where the last one drawn ended.
  let lx = -1, ly = -1, lz = -1;
  const follows = (s: number) => q(pos[s * 6], 0) === lx && q(pos[s * 6 + 1], 1) === ly && q(pos[s * 6 + 2], 2) === lz;
  const endAt = (s: number) => {
    lx = q(pos[s * 6 + 3], 0);
    ly = q(pos[s * 6 + 4], 1);
    lz = q(pos[s * 6 + 5], 2);
  };
  let count = 0;
  inOrder((s) => {
    if (count && !follows(s)) count++;
    count++;
    endAt(s);
  });

  const points = new Uint16Array((count + 1) * 3);
  const features = new Uint8Array(count);
  const tools = new Uint8Array(count);
  const sizes = new Uint16Array(count * 2);
  const speeds = new Uint16Array(count);
  const flows = new Uint16Array(count);
  const fans = new Uint8Array(count);
  const temps = new Uint16Array(count);
  const shellStarts = new Uint32Array(layers + 1);
  const innerStarts = new Uint32Array(layers + 1);
  const um = (mm: number) => Math.max(1, Math.min(65535, Math.round(mm / SIZE_UNIT)));
  // Segment `to` takes segment s's values; a gap before s takes them too, at height 0.
  const copy = (to: number, s: number, gap: boolean) => {
    features[to] = p.features[s];
    tools[to] = p.tools[s];
    sizes[to * 2] = gap ? 0 : um(p.sizes[s * 2]);
    sizes[to * 2 + 1] = gap ? 0 : um(p.sizes[s * 2 + 1]);
    speeds[to] = p.speeds[s];
    flows[to] = p.flows[s];
    fans[to] = p.fans[s];
    temps[to] = p.temps[s];
  };
  let at = 0; // segments written
  lx = ly = lz = -1;
  for (const inner of [false, true]) {
    const starts = inner ? innerStarts : shellStarts;
    for (let k = 0; k < layers; k++) {
      // A run starts at its first segment written, a gap before it included.
      starts[k] = at;
      for (let s = p.layerStarts[k]; s < p.layerStarts[k + 1]; s++) {
        if (INNER_FEATURES.has(p.features[s]) !== inner) continue;
        if (at === 0) {
          for (let a = 0; a < 3; a++) points[a] = q(pos[s * 6 + a], a);
        } else if (!follows(s)) {
          for (let a = 0; a < 3; a++) points[(at + 1) * 3 + a] = q(pos[s * 6 + a], a);
          copy(at++, s, true);
        }
        for (let a = 0; a < 3; a++) points[(at + 1) * 3 + a] = q(pos[s * 6 + 3 + a], a);
        copy(at++, s, false);
        endAt(s);
      }
    }
    starts[layers] = at;
  }
  const { layerZ, toolsUsed, layerTimes, stats } = p;
  return {
    points, origin, step, featureBoxes,
    features, tools, sizes, speeds, flows, fans, temps,
    shellStarts, innerStarts, layerZ, toolsUsed, layerTimes, stats,
  };
}
