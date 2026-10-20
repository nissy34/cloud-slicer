// Parses G-code into extrusion segments grouped by layer, for the Preview.
// Reads what Orca writes: ;LAYER_CHANGE / ;Z: markers, ;TYPE: feature
// comments, T<n> tool changes, G0/G1 and arcs (G2/G3, from arc fitting),
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

/** Filament diameters per tool: the header's "; filament_diameter: 1.75,1.75", else the config block's. */
function filamentDiameters(text: string): number[] {
  const m = /^; filament_diameter\s*[:=]\s*(.*)$/m.exec(text.slice(0, 64 * 1024)) ??
    /^; filament_diameter\s*=\s*(.*)$/m.exec(text.slice(Math.max(0, text.length - 1024 * 1024)));
  const d = m ? numbers(m[1]).filter((v) => v > 0) : [];
  return d.length ? d : [1.75];
}

const featureIndex = new Map<string, number>(FEATURES.map((f, i) => [f.toLowerCase(), i]));
const OTHER = FEATURES.length - 1;

/** `onProgress` gets the share of the text read so far (0..1), about every 2 MB. */
export function parseGcode(text: string, onProgress?: (done: number) => void): ParsedGcode {
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
  const areas = filamentDiameters(text).map((d) => (Math.PI * d * d) / 4);
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

  let start = 0;
  const len = text.length;
  const STEP = 2 << 20;
  let nextReport = STEP;
  const addSeconds = (sec: number) => {
    if (!(sec > 0) || !Number.isFinite(sec)) return;
    if (layerSeconds.length) layerSeconds[layerSeconds.length - 1] += sec;
    else preludeSeconds += sec;
  };
  const param = (word: string[], letter: number) => {
    for (let k = 1; k < word.length; k++) if ((word[k].charCodeAt(0) | 32) === letter) return parseFloat(word[k].slice(1));
    return NaN;
  };
  while (start < len) {
    if (onProgress && start >= nextReport) {
      onProgress(start / len);
      nextReport = start + STEP;
    }
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
          if (startGcodeLayer) layerZ[layerZ.length - 1] = v;
          else startLayer(v);
          startGcodeLayer = false;
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
      } else if (line.startsWith('; filament used [mm] =')) footer.mm = numbers(line.slice(22));
      else if (line.startsWith('; filament used [g] =')) footer.grams = numbers(line.slice(21));
      else if (line.startsWith('; filament cost =')) footer.cost = numbers(line.slice(17));
      else if (line.startsWith('; total filament used [g] =')) footer.totalGrams = Number(line.slice(27)) || 0;
      else if (line.startsWith('; total filament cost =')) footer.totalCost = Number(line.slice(23)) || 0;
      else if (line.startsWith('; estimated printing time (normal mode) =')) footer.seconds = durationSeconds(line.slice(41));
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
    } else if (/^T\d+$/.test(cmd)) t = Number(cmd.slice(1));
  }

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
  return {
    positions: pos.slice(0, n * 6),
    features: feat.slice(0, n),
    tools: tool.slice(0, n),
    sizes: size.slice(0, n * 2),
    layerStarts: Uint32Array.from(starts),
    layerZ: Float32Array.from(zs),
    toolsUsed: [...toolsUsed].sort((a, b) => a - b),
    speeds: speed.slice(0, n),
    flows: flow.slice(0, n),
    fans: fan.slice(0, n),
    temps: temp.slice(0, n),
    layerTimes: Float32Array.from(secs, (v) => v * scale),
    stats: {
      filaments,
      totalGrams: footer.totalGrams || filaments.reduce((a, f) => a + f.grams, 0),
      totalCost: footer.totalCost || filaments.reduce((a, f) => a + f.cost, 0),
      toolChanges,
      seconds: footer.seconds,
    },
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
  const speeds = new Uint16Array(n);
  const flows = new Uint16Array(n);
  const fans = new Uint8Array(n);
  const temps = new Uint16Array(n);
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
      speeds[to] = p.speeds[s];
      flows[to] = p.flows[s];
      fans[to] = p.fans[s];
      temps[to] = p.temps[s];
    }
  }
  shellStarts[layers] = shell;
  innerStarts[layers] = inner;
  const { layerZ, toolsUsed, layerTimes, stats } = p;
  return { positions, features, tools, sizes, speeds, flows, fans, temps, shellStarts, innerStarts, layerZ, toolsUsed, layerTimes, stats };
}
