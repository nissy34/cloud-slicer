// A picture of the sliced toolpaths, like the site's Preview tab, drawn without a GPU
// (Node has no WebGL; see picture.ts). The G-code is read with the site's own parser
// (lib/gcode.ts) and coloured with the Preview's own rules (lib/preview-colours.ts):
// line type, filament, speed, layer height, line width, flow, layer time, fan,
// temperature. Each extrusion is drawn as a rounded bead, lit from the upper left.
import * as THREE from 'three';
import { FEATURE_COLOURS, FEATURES, orderForPreview, parseGcode, type PreviewGcode } from '../../web/src/lib/gcode';
import { formatValue, isRangeView, segmentColours, valueAt, valueRange, VIEW_TYPES, rangeColour, type ColourBy } from '../../web/src/lib/preview-colours';
import { downsample, thumbnailCamera } from '../../web/src/lib/thumbnail';
import { i18n } from '../../web/src/i18n';

export type View = 'iso' | 'top' | 'front';

export interface ToolpathOptions {
  colourBy: ColourBy;
  /** 1-based layers to show, inclusive (default every layer). */
  fromLayer?: number;
  toLayer?: number;
  /** Line types (FEATURES names) left out. */
  hide?: string[];
  view: View;
  size: number;
  /** Filament colours by slot, when the G-code doesn't say. */
  colours: string[];
}

const SUPERSAMPLE = 2;
const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** The filament colours the G-code was sliced with (Orca writes them in its settings block). */
function gcodeColours(text: string): string[] {
  const m = /^; filament_colour = (.*)$/m.exec(text.slice(Math.max(0, text.length - 2 * 1024 * 1024))) ?? /^; filament_colour = (.*)$/m.exec(text.slice(0, 256 * 1024));
  return m ? m[1].split(';').map((c) => c.trim()).filter((c) => /^#[0-9a-f]{6}/i.test(c)).map((c) => c.slice(0, 7)) : [];
}

/** An orthographic camera looking along `dir` at the box, filling w×h like the site's thumbnail camera. */
function camera(box: THREE.Box3, view: View, w: number, h: number): THREE.OrthographicCamera {
  if (view === 'iso') return thumbnailCamera(box, w, h);
  const dir = view === 'top' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, -1, 0);
  const up = view === 'top' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const b = box.clone();
  const size = b.getSize(new THREE.Vector3());
  b.expandByVector(size.multiplyScalar(0.02));
  const centre = b.getCenter(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(dir.clone().negate(), up).normalize();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(centre);
    minX = Math.min(minX, v.dot(right)); maxX = Math.max(maxX, v.dot(right));
    minY = Math.min(minY, v.dot(up)); maxY = Math.max(maxY, v.dot(up));
  }
  const zoom = Math.min(w / ((maxX - minX) * 1.025 || 1), h / ((maxY - minY) * 1.025 || 1));
  const radius = b.getSize(new THREE.Vector3()).length() + 10;
  const cam = new THREE.OrthographicCamera(-w / zoom / 2, w / zoom / 2, h / zoom / 2, -h / zoom / 2, 0.1, radius * 4);
  cam.up.copy(up);
  cam.position.copy(centre).addScaledVector(dir, radius * 2);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** The toolpaths of a G-code as a picture (RGBA, rows bottom to top) with what its colours mean. */
export function drawToolpaths(text: string, opts: ToolpathOptions) {
  const p: PreviewGcode = orderForPreview(parseGcode(text));
  const layers = p.layerZ.length;
  if (!layers) throw new Error('This G-code has no toolpaths to show.');
  const from = Math.min(layers, Math.max(1, opts.fromLayer ?? 1));
  const to = Math.min(layers, Math.max(from, opts.toLayer ?? layers));
  // The start G-code's purge line ("Custom") would push the print into a corner: left out, unless hide is [].
  const hide = opts.hide?.length === 0 ? [] : [...new Set([...(opts.hide ?? []), 'Custom'])];
  const unknown = hide.filter((h) => !FEATURES.some((f) => f.toLowerCase() === h.trim().toLowerCase()));
  if (unknown.length) throw new Error(`No line type called ${unknown.map((u) => `"${u}"`).join(', ')}. Line types: ${FEATURES.join(', ')}.`);
  const hidden = new Set(hide.map((h) => FEATURES.findIndex((f) => f.toLowerCase() === h.trim().toLowerCase())));
  const filamentColours = gcodeColours(text);
  const colours = filamentColours.length ? filamentColours : opts.colours;
  const range = valueRange(p, opts.colourBy, hidden);
  const col = segmentColours(p, opts.colourBy, colours, range);

  // The segments shown: layers from..to, line types not hidden.
  const shown: number[] = [];
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const used = new Set<number>();
  for (let k = from - 1; k < to; k++)
    for (const [a, b] of [[p.shellStarts[k], p.shellStarts[k + 1]], [p.innerStarts[k], p.innerStarts[k + 1]]])
      for (let s = a; s < b; s++) {
        if (hidden.has(p.features[s])) continue;
        shown.push(s);
        used.add(opts.colourBy === 'filament' ? p.tools[s] : p.features[s]);
        box.expandByPoint(v.fromArray(p.positions, s * 6));
        box.expandByPoint(v.fromArray(p.positions, s * 6 + 3));
      }
  if (!shown.length) throw new Error('Nothing to show with those layers and line types.');
  // Frame the whole print, so pictures of different layer ranges line up.
  const whole = new THREE.Box3();
  for (let s = 0; s < p.features.length; s++) if (!hidden.has(p.features[s])) whole.expandByPoint(v.fromArray(p.positions, s * 6)).expandByPoint(v.fromArray(p.positions, s * 6 + 3));

  const w = opts.size * SUPERSAMPLE, h = opts.size * SUPERSAMPLE;
  const cam = camera(whole.isEmpty() ? box : whole, opts.view, w, h);
  const toClip = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const pxPerMm = w / (cam.right - cam.left);
  const pixels = new Uint8Array(w * h * 4);
  const depth = new Float32Array(w * h).fill(Infinity);
  // Light from the upper left and towards the viewer, in screen space (y up).
  const L = new THREE.Vector3(-0.35, 0.5, 0.8).normalize();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  // The bead's depth bulge in clip units per pixel of radius.
  const zPerPx = 2 / ((cam.far - cam.near) * pxPerMm);
  for (const s of shown) {
    a.fromArray(p.positions, s * 6).applyMatrix4(toClip);
    b.fromArray(p.positions, s * 6 + 3).applyMatrix4(toClip);
    const ax = ((a.x + 1) / 2) * w, ay = ((a.y + 1) / 2) * h, bx = ((b.x + 1) / 2) * w, by = ((b.y + 1) / 2) * h;
    const r = Math.max(0.75, (p.sizes[s * 2] || 0.4) * pxPerMm * 0.5);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    const cr = col[s * 3] / 255, cg = col[s * 3 + 1] / 255, cb = col[s * 3 + 2] / 255;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        // Nearest point on the segment, and how far across the bead this pixel is.
        const t = len2 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const ox = px - (ax + dx * t), oy = py - (ay + dy * t);
        const d2 = ox * ox + oy * oy;
        if (d2 > r * r) continue;
        const nz = Math.sqrt(1 - d2 / (r * r));
        const z = a.z + (b.z - a.z) * t - nz * r * zPerPx;
        const i = y * w + x;
        if (z >= depth[i]) continue;
        depth[i] = z;
        const lit = 0.35 + 0.65 * Math.max(0, (ox / r) * L.x + (oy / r) * L.y + nz * L.z);
        const spec = 0.18 * Math.pow(Math.max(0, nz * 0.9 + (ox * L.x + oy * L.y) / r * 0.3), 24);
        const o = i * 4;
        pixels[o] = Math.round(Math.min(1, cr * lit + spec) * 255);
        pixels[o + 1] = Math.round(Math.min(1, cg * lit + spec) * 255);
        pixels[o + 2] = Math.round(Math.min(1, cb * lit + spec) * 255);
        pixels[o + 3] = 255;
      }
    }
  }

  const title = VIEW_TYPES.find((t) => t.id === opts.colourBy)!;
  let legend: unknown;
  if (opts.colourBy === 'feature') legend = [...used].sort((x, y) => x - y).map((f) => ({ lineType: FEATURES[f], colour: FEATURE_COLOURS[f] }));
  else if (opts.colourBy === 'filament')
    legend = [...used].sort((x, y) => x - y).map((t) => ({ slot: t + 1, colour: colours[t] ?? '#CCCCCC', ...(p.stats.filaments[t]?.grams && { grams: Math.round(p.stats.filaments[t].grams * 10) / 10 }) }));
  else if (range && isRangeView(opts.colourBy))
    legend = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => ({ value: formatValue(opts.colourBy, valueAt(range, t)), colour: hex(rangeColour(t)) })).reverse();
  return {
    picture: { width: opts.size, height: opts.size, pixels: downsample(pixels, opts.size, opts.size, SUPERSAMPLE) },
    about: {
      colouredBy: i18n.t(title.title ?? title.label),
      layers: from === 1 && to === layers ? `all ${layers}` : `${from} to ${to} of ${layers}`,
      topLayerZmm: Math.round(p.layerZ[to - 1] * 100) / 100,
      view: opts.view,
      ...(hidden.size && { hidden: [...hidden].map((f) => FEATURES[f]) }),
      legend,
    },
  };
}
