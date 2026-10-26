import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { bedSize } from '../lib/colour';
import { formatClock, formatMegabytes } from '../lib/format';
import { FEATURE_COLOURS, FEATURES, type GcodeStats, type PreviewGcode } from '../lib/gcode';
import {
  RANGE_COLOURS,
  VIEW_TYPES,
  formatValue,
  isRangeView,
  segmentColours,
  valueAt,
  valueRange,
  type ColourBy,
  type ValueRange,
} from '../lib/preview-colours';
import { codeAt } from '../lib/layerCodes';
import { plateBounds, toolpathWarnings } from '../lib/outside';
import { useSceneColours } from '../lib/theme';
import type { GcodeWorkerMessage } from '../engine/gcode-worker';
import type { FilamentPart, SliceResult } from '../engine/protocol';
import { useLoading } from '../state/loading';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';
import { LayerMarks, LayerMenu, useLayerCodes } from './LayerCodes';
import { PrintLoader } from './PrintLoader';
import { CameraViews, ViewButtons, type ViewHandle } from './ViewControls';
import { Bed } from './Bed';
import { PlateTabs } from './Viewport';
import { ChevronDown, ChevronUp, Pencil, Plus } from 'lucide-react';
import { Slider } from './Slider';

/** The G-code read in a worker: progress (0..1) while reading, then the segments. */
function useParsed(gcode: Blob | null) {
  const [parsed, setParsed] = useState<PreviewGcode | null>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setParsed(null);
    setProgress(0);
    if (!gcode) return;
    const worker = new Worker(new URL('../engine/gcode-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<GcodeWorkerMessage>) => {
      if ('progress' in data) setProgress(data.progress);
      else setParsed(data.parsed);
    };
    worker.postMessage({ gcode });
    return () => worker.terminate();
  }, [gcode]);
  return { parsed, progress };
}

/**
 * `parsed`, handed on only after the browser has painted once more, so the
 * "Drawing the preview" card shows before the main thread is busy building and
 * uploading the toolpaths (which freezes the page for a moment on a big print).
 */
function useAfterPaint<T>(value: T) {
  const [shown, setShown] = useState<T | null>(null);
  useEffect(() => {
    setShown(null);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setShown(value));
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

/** Calls `onDrawn` once, just after the first frame with the toolpaths in it has been drawn. */
function DrawnSignal({ onDrawn }: { onDrawn: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    // useFrame runs before the frame renders; the timeout fires after it.
    setTimeout(onDrawn, 0);
  });
  return null;
}

// One extrusion is drawn as a solid bead with a diamond cross-section (like
// Orca's preview), built on the GPU from the segment's two endpoints, width and
// height. Local coords: x along the segment (0..1), y across (-0.5..0.5),
// z down from the nozzle (-1..0). Eight corners with smooth normals give a
// rounded bead; the vertex shader runs once per corner, so a big print is
// mostly vertex work and this keeps it to eight per segment.
const BEAD = (() => {
  const ring = [
    [0, 0],
    [0.5, -0.5],
    [0, -1],
    [-0.5, -0.5],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const x of [0, 1])
    for (const [y, z] of ring) {
      pos.push(x, y, z);
      // Straight out from the bead's centre line: up, sideways or down.
      nrm.push(0, y * 2, (z + 0.5) * 2);
    }
  const corner = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const idx: number[] = [];
  // Wound counter-clockwise seen from outside, so back faces can be culled.
  const tri = (a: number, b: number, c: number, out: THREE.Vector3) => {
    const n = corner(b).sub(corner(a)).cross(corner(c).sub(corner(a)));
    idx.push(...(n.dot(out) > 0 ? [a, b, c] : [a, c, b]));
  };
  for (let k = 0; k < 4; k++) {
    const k1 = (k + 1) % 4;
    const out = new THREE.Vector3(0, ring[k][0] + ring[k1][0], ring[k][1] + ring[k1][1] + 1);
    tri(k, k1, 4 + k1, out);
    tri(k, 4 + k1, 4 + k, out);
  }
  tri(0, 1, 2, new THREE.Vector3(-1, 0, 0));
  tri(0, 2, 3, new THREE.Vector3(-1, 0, 0));
  tri(4, 5, 6, new THREE.Vector3(1, 0, 0));
  tri(4, 6, 7, new THREE.Vector3(1, 0, 0));
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx };
})();

const beadVertex = /* glsl */ `
  attribute vec3 iStart;
  attribute vec3 iEnd;
  attribute vec3 iColor;
  attribute vec2 iSize;
  attribute float iFeature;
  // 1 for each line type the legend has hidden.
  uniform float uHidden[${FEATURES.length}];
  // Height of the drawing in pixels.
  uniform float uViewHeight;
  varying vec3 vColor;
  varying vec3 vNormal;
  void main() {
    if (uHidden[int(iFeature + 0.5)] > 0.5) {
      // Outside the view on every corner: nothing is drawn.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec3 d = iEnd - iStart;
    float len = length(d);
    vec3 dir = len > 1e-6 ? d / len : vec3(1.0, 0.0, 0.0);
    vec3 side = cross(vec3(0.0, 0.0, 1.0), dir);
    side = length(side) > 1e-6 ? normalize(side) : vec3(0.0, 1.0, 0.0);
    vec3 up = cross(dir, side);
    // At least a pixel and a bit wide on screen: thinner lines (a first
    // layer seen from afar) leave pixel gaps that show the bed and its logo
    // through the print.
    float dist = max(-(modelViewMatrix * vec4(iStart, 1.0)).z, 0.0);
    float pixel = 2.0 * dist / (projectionMatrix[1][1] * uViewHeight);
    float w = max(iSize.x, 1.5 * pixel);
    float h = iSize.y;
    // Run past both ends by half a width so corners close up.
    float along = -0.5 * w + position.x * (len + w);
    vec3 p = iStart + dir * along + side * (position.y * w) + up * (position.z * h);
    vec3 n = dir * normal.x + side * (normal.y / w) + up * (normal.z / h);
    vNormal = normalize(normalMatrix * normalize(n));
    vColor = iColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const beadFragment = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    float key = max(dot(n, normalize(vec3(0.35, 0.55, 1.0))), 0.0);
    float fill = max(dot(n, normalize(vec3(-0.6, -0.2, 0.4))), 0.0);
    vec3 c = vColor * (0.32 + 0.6 * key + 0.18 * fill);
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** Segments [from, to) of the G-code as instanced beads, in the colours given per segment. */
function useBeads(parsed: PreviewGcode, from: number, to: number, colour: Uint8Array) {
  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(BEAD.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(BEAD.nrm, 3));
    g.setIndex(BEAD.idx);
    const ends = new THREE.InstancedInterleavedBuffer(parsed.positions.subarray(from * 6, to * 6), 6);
    g.setAttribute('iStart', new THREE.InterleavedBufferAttribute(ends, 3, 0));
    g.setAttribute('iEnd', new THREE.InterleavedBufferAttribute(ends, 3, 3));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(parsed.sizes.subarray(from * 2, to * 2), 2));
    g.setAttribute('iFeature', new THREE.InstancedBufferAttribute(parsed.features.subarray(from, to), 1));
    return g;
  }, [parsed, from, to]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useMemo(() => {
    geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colour.subarray(from * 3, to * 3), 3, true));
  }, [geometry, colour, from, to]);
  return geometry;
}

/**
 * The toolpaths up to layer `upTo`: the shell (what shows from outside) always,
 * the inner segments (infill, inner walls) only while the view holds still,
 * since they are most of a print and almost all hidden. While the view moves,
 * only the top layer keeps its inner segments.
 */
function Toolpaths({
  parsed,
  upTo,
  colourBy,
  colours,
  range,
  hidden,
  moving,
}: {
  parsed: PreviewGcode;
  upTo: number;
  colourBy: ColourBy;
  colours: string[];
  range: ValueRange | null;
  hidden: ReadonlySet<number>;
  moving: boolean;
}) {
  const colour = useMemo(() => segmentColours(parsed, colourBy, colours, range), [parsed, colourBy, colours, range]);
  const { shellStarts, innerStarts } = parsed;
  const last = shellStarts.length - 1;
  const shellEnd = shellStarts[last];
  const top = Math.max(0, Math.min(upTo, last - 1));
  const shell = useBeads(parsed, 0, shellEnd, colour);
  const inner = useBeads(parsed, shellEnd, innerStarts[last], colour);
  const topInner = useBeads(parsed, innerStarts[top], innerStarts[top + 1], colour);
  shell.instanceCount = shellStarts[top + 1];
  inner.instanceCount = innerStarts[top + 1] - shellEnd;
  topInner.instanceCount = innerStarts[top + 1] - innerStarts[top];
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: beadVertex,
        fragmentShader: beadFragment,
        uniforms: { uHidden: { value: new Array<number>(FEATURES.length).fill(0) }, uViewHeight: { value: 1 } },
      }),
    [],
  );
  const viewHeight = useThree((s) => s.size.height * s.viewport.dpr);
  material.uniforms.uViewHeight.value = Math.max(1, viewHeight);
  useMemo(() => {
    material.uniforms.uHidden.value = FEATURES.map((_, i) => (hidden.has(i) ? 1 : 0));
  }, [material, hidden]);
  // The view draws on demand: the layer and colour changes above are not props.
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => invalidate());
  return (
    <>
      <mesh geometry={shell} material={material} frustumCulled={false} />
      <mesh geometry={inner} material={material} frustumCulled={false} visible={!moving} />
      <mesh geometry={topInner} material={material} frustumCulled={false} visible={moving} />
    </>
  );
}

/** Whether the camera is moving: from the first change until it has been still for a moment. */
function useMoving() {
  const [moving, setMoving] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onChange = () => {
    setMoving(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMoving(false), 250);
  };
  return [moving, onChange] as const;
}

/** The printed part's bounding box. */
function toolpathBox(parsed: PreviewGcode): THREE.Box3 {
  const p = parsed.positions;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  if (!p.length) return box;
  // Every 8th segment is plenty for a bounding box.
  for (let i = 0; i < p.length; i += 48) box.expandByPoint(v.set(p[i], p[i + 1], p[i + 2]));
  box.expandByPoint(v.set(p[p.length - 3], p[p.length - 2], p[p.length - 1]));
  return box;
}

/** Points the camera at the printed part once the G-code has been read. */
function FitCamera({ parsed }: { parsed: PreviewGcode }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  useEffect(() => {
    if (!parsed.positions.length || !controls) return;
    const box = toolpathBox(parsed);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 20);
    const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.1;
    const dir = new THREE.Vector3(0, -0.75, 0.6).normalize();
    camera.position.copy(centre).addScaledVector(dir, dist);
    controls.target.copy(centre);
    controls.update();
  }, [parsed, camera, controls]);
  return null;
}

/** Line types in the print, each a button that hides or shows it (desktop's Display column). */
function LineTypes({ features, hidden, setHidden }: { features: number[]; hidden: ReadonlySet<number>; setHidden: (h: ReadonlySet<number>) => void }) {
  const toggle = (f: number) => {
    const next = new Set(hidden);
    if (!next.delete(f)) next.add(f);
    setHidden(next);
  };
  return (
    <>
      <div className="line-types">
        {features.map((f) => (
          <button
            key={f}
            className={hidden.has(f) ? 'legend-row legend-item off' : 'legend-row legend-item'}
            aria-pressed={!hidden.has(f)}
            title={hidden.has(f) ? `Show ${FEATURES[f].toLowerCase()}` : `Hide ${FEATURES[f].toLowerCase()}`}
            onClick={() => toggle(f)}
          >
            <span className="dot" style={{ background: FEATURE_COLOURS[f] }} />
            {FEATURES[f]}
          </button>
        ))}
      </div>
      <p className="legend-note">{hidden.size ? 'Tap a line type to show it again.' : 'Tap a line type to hide it.'}</p>
    </>
  );
}

const grams = (g: number) => `${g < 10 ? g.toFixed(2) : g.toFixed(1)} g`;
const metres = (mm: number) => `${(mm / 1000).toFixed(2)} m`;
const money = (c: number) => c.toFixed(2);

const PARTS: { part: FilamentPart; title: string }[] = [
  { part: 'model', title: 'Model' },
  { part: 'support', title: 'Support' },
  { part: 'flushed', title: 'Flushed' },
  { part: 'tower', title: 'Tower' },
];

/** A weight with its length under it (the phone shows the weight only). */
function Use({ g, mm }: { g: number; mm: number }) {
  return (
    <>
      {grams(g)}
      <small>{metres(mm)}</small>
    </>
  );
}

/**
 * Each filament's use like desktop's Filament view: a table of what went into
 * the model, support, flushing and the prime tower (columns no filament used
 * are left out) and their total, then the cost and filament changes. Without
 * the engine's split, one line per filament with the G-code's own totals.
 */
function FilamentStats({ stats, used, colours, parts, cost }: { stats: GcodeStats; used: number[]; colours: string[]; parts?: SliceResult['filamentParts']; cost?: number }) {
  const tools = [...new Set([...used, ...stats.filaments.flatMap((f, i) => (f.grams > 0 || f.mm > 0 ? [i] : []))])].sort((a, b) => a - b);
  // The engine's total has the printer's time cost too; a G-code file opened on its own has only the filaments'.
  const totalCost = cost ?? stats.totalCost;
  const costed = totalCost > 0;
  const totalMm = stats.filaments.reduce((a, f) => a + f.mm, 0);
  const columns = parts ? PARTS.filter(({ part }) => tools.some((t) => (parts[t + 1]?.[part]?.mm ?? 0) > 0)) : [];
  const partOf = (t: number, part: FilamentPart) => parts?.[t + 1]?.[part];
  const add = (cells: ({ g: number; mm: number } | undefined)[]) =>
    cells.reduce<{ g: number; mm: number }>((a, c) => ({ g: a.g + (c?.g ?? 0), mm: a.mm + (c?.mm ?? 0) }), { g: 0, mm: 0 });
  // As desktop: a filament's total is its columns added up, shown when there is more than Model.
  const rowTotal = (t: number) => add(columns.map(({ part }) => partOf(t, part)));
  const columnTotal = (part: FilamentPart) => add(tools.map((t) => partOf(t, part)));
  const totalColumn = columns.some(({ part }) => part !== 'model');
  const grandTotal = add(tools.map(rowTotal));
  return (
    <div className="filament-stats" data-testid="filament-stats">
      {columns.length > 0 ? (
        <table className="filament-table">
          <thead>
            <tr>
              <th>Filament</th>
              {columns.map((c) => (
                <th key={c.part}>{c.title}</th>
              ))}
              {totalColumn && <th>Total</th>}
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => {
              const total = rowTotal(t);
              return (
                <tr key={t} data-filament={t + 1}>
                  <td>
                    <span className="dot" style={{ background: colours[t] ?? '#ccc' }} />
                    {t + 1}
                  </td>
                  {columns.map(({ part }) => {
                    const p = partOf(t, part);
                    return <td key={part}>{p ? <Use g={p.g} mm={p.mm} /> : <span className="none">–</span>}</td>;
                  })}
                  {totalColumn && (
                    <td className="filament-total">
                      <Use g={total.g} mm={total.mm} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {columns.map(({ part }) => {
                const c = columnTotal(part);
                return (
                  <td key={part}>
                    <Use g={c.g} mm={c.mm} />
                  </td>
                );
              })}
              {totalColumn && (
                <td className="filament-total">
                  <Use g={grandTotal.g} mm={grandTotal.mm} />
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      ) : (
        tools.map((t) => {
          const f = stats.filaments[t];
          return (
            <div key={t} className="legend-row filament-row" data-filament={t + 1}>
              <span className="dot" style={{ background: colours[t] ?? '#ccc' }} />
              <span className="filament-name">Filament {t + 1}</span>
              {f && (
                <span className="filament-use">
                  {grams(f.grams)} · {metres(f.mm)}
                  {costed && ` · ${money(f.cost)}`}
                </span>
              )}
            </div>
          );
        })
      )}
      <div className={columns.length > 0 ? 'stats-total split' : 'stats-total'}>
        <span>Total</span>
        <span>
          {grams(stats.totalGrams)} · {metres(totalMm)}
        </span>
        <span>Cost</span>
        <span>{costed ? money(totalCost) : '–'}</span>
        <span>Filament changes</span>
        <span data-testid="tool-changes">{stats.toolChanges}</span>
      </div>
      {!costed && <p className="legend-note">Set the Price in the filament settings, or the Time cost in the printer settings, to see the cost.</p>}
    </div>
  );
}

/** Desktop's time estimate under the key, in every view: the start G-code's share, the model's, and the total. */
function TimeStats({ total, prepare }: { total: number; prepare: number }) {
  if (!(total > 0)) return null;
  // The phone shows the rows on one line with the short names.
  const rows: [string, string, number, string?][] = [
    ...(prepare > 0 ? [['Prepare time', 'Prepare', prepare] as [string, string, number]] : []),
    ['Model printing time', 'Printing', total - prepare],
    ['Total time', 'Total', total, 'total-time'],
  ];
  return (
    <div className="time-stats" data-testid="time-stats">
      <span className="time-title">Time</span>
      {rows.map(([name, short, seconds, testId]) => (
        <span key={name} className="time-row">
          <span className="long">{name}</span>
          <span className="short">{short}</span>
          <span className="time-value" data-testid={testId}>
            {formatClock(seconds)}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The scale of a value view: Orca's colours from highest at the top to lowest, with six values along it. */
function RangeKey({ by, range }: { by: ColourBy; range: ValueRange | null }) {
  const title = VIEW_TYPES.find((v) => v.id === by)?.title;
  if (!range) return <p className="legend-note">Nothing shown to colour.</p>;
  const single = range.max <= range.min;
  const ticks = single ? [range.max] : [1, 0.8, 0.6, 0.4, 0.2, 0].map((t) => valueAt(range, t));
  return (
    <div className="range-key" data-testid="range-key">
      <span className="range-title">{title}</span>
      <div className="range-body">
        <span
          className="range-bar"
          style={
            {
              '--stops': single ? `${RANGE_COLOURS[0]}, ${RANGE_COLOURS[0]}` : RANGE_COLOURS.join(', '),
              background: single ? RANGE_COLOURS[0] : `linear-gradient(to top, ${RANGE_COLOURS.join(', ')})`,
            } as CSSProperties
          }
        />
        <span className="range-ticks">
          {ticks.map((v, i) => (
            <span key={i}>{formatValue(by, v)}</span>
          ))}
        </span>
      </div>
    </div>
  );
}

export function Preview() {
  const job = useSlicer((s) => s.job);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const setTab = useSlicer((s) => s.setTab);
  const { w, d } = bedSize(useOption('printable_area'));
  const gcode = job.kind === 'sliced' ? job.gcode : null;
  const { parsed: read, progress } = useParsed(gcode);
  const parsed = useAfterPaint(read);
  // Desktop checks the toolpaths against the plate when it reads the G-code.
  const area = useOption('printable_area');
  const height = useOption('printable_height');
  useEffect(() => {
    if (read && gcode) useSlicer.getState().setGcodeWarnings(gcode, toolpathWarnings(read, plateBounds(area, height)));
  }, [read, gcode, area, height]);
  // The loading card stays from the slice finishing until the first frame of
  // toolpaths is on screen: reading the G-code, then building the 3D view.
  const [drawn, setDrawn] = useState<PreviewGcode | null>(null);
  const ready = parsed !== null && drawn === parsed;
  const otherLoading = useLoading() !== null;
  const layers = parsed ? parsed.layerZ.length : 0;
  const [layer, setLayer] = useState(Number.MAX_SAFE_INTEGER);
  const [colourBy, setColourBy] = useState<ColourBy>('feature');
  // Line types (FEATURES indexes) hidden from the legend, as desktop's Display column.
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const range = useMemo(() => (parsed ? valueRange(parsed, colourBy, hidden) : null), [parsed, colourBy, hidden]);
  // On a phone the key is a strip above the 3D view (styles/phone.css), so it can start open there too.
  const [keyOpen, setKeyOpen] = useState(true);
  const upTo = Math.min(layer, layers - 1);
  const scene = useSceneColours();
  const [moving, onCameraChange] = useMoving();
  const views: ViewHandle = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const codes = useLayerCodes();
  // Each plate keeps its own slice; job is the shown plate's (or the slice running).
  const slicingPlate = useSlicer((s) => (s.job.kind === 'slicing' ? s.job.plate : null));
  const plate = useSlicer((s) => s.plate);
  const plates = useSlicer((s) => s.project?.plates.length ?? 0);
  const onPlate = useSlicer((s) => s.project?.plates[s.plate]?.objects.length ?? 0);

  if (!gcode && slicingPlate === plate) {
    return (
      <div className="coming-soon">
        <PlateTabs />
        <h1>{plates > 1 ? `Slicing plate ${plate + 1}` : 'Slicing the plate'}</h1>
        <p>Its toolpaths show here when it's done.</p>
      </div>
    );
  }
  if (!gcode && plates > 1) {
    return (
      <div className="coming-soon">
        <PlateTabs />
        <h1>Plate {plate + 1} isn't sliced yet</h1>
        <p>
          {!onPlate
            ? 'This plate is empty.'
            : slicingPlate !== null
              ? `Plate ${slicingPlate + 1} is slicing now. Slice this one when it's done.`
              : 'Slice it to see its toolpaths here.'}
        </p>
        {!onPlate && (
          <button className="primary" onClick={() => setTab('prepare')}>
            Go to Prepare
          </button>
        )}
      </div>
    );
  }
  if (!gcode) {
    return (
      <div className="coming-soon">
        <h1>Nothing sliced yet</h1>
        <p>Slice a plate on the Prepare tab to see its toolpaths here.</p>
        <button className="primary" onClick={() => setTab('prepare')}>
          Go to Prepare
        </button>
      </div>
    );
  }

  const usedFeatures = parsed ? [...new Set(parsed.features)].sort((a, b) => a - b) : [];
  return (
    <div className={menuOpen ? 'preview layer-menu-open' : 'preview'}>
      <Canvas className="viewport" frameloop="demand" camera={{ position: [w / 2, -d * 0.6, d * 0.7], fov: 40, near: 1, far: 5000 }} data-testid="gcode-preview">
        <color attach="background" args={[scene.background]} />
        {/* The same light as Prepare: without it the bed shape and plate draw black. */}
        <hemisphereLight args={['#ffffff', scene.ground, 0.9]} />
        <directionalLight position={[w, -d, d * 2]} intensity={1.6} />
        <Bed />
        {parsed && (
          <Toolpaths parsed={parsed} upTo={upTo} colourBy={colourBy} colours={colours} range={range} hidden={hidden} moving={moving} />
        )}
        {parsed && !ready && <DrawnSignal onDrawn={() => setDrawn(parsed)} />}
        {parsed && <FitCamera parsed={parsed} />}
        <OrbitControls target={[w / 2, d / 2, 0]} makeDefault onChange={onCameraChange} />
        <CameraViews
          handle={views}
          box={() => (parsed?.positions.length ? toolpathBox(parsed) : new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, d, 0)))}
        />
      </Canvas>
      <ViewButtons handle={views} className="over-slider" />
      <PlateTabs />
      <div className="legend" data-testid="legend">
        <div className="legend-head">
          <select aria-label="Colour by" value={colourBy} onChange={(e) => setColourBy(e.target.value as ColourBy)}>
            {VIEW_TYPES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            className="legend-toggle"
            aria-label={keyOpen ? 'Hide colour key' : 'Show colour key'}
            aria-expanded={keyOpen}
            onClick={() => setKeyOpen((o) => !o)}
          >
            {keyOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </button>
        </div>
        {parsed && keyOpen && (
          <>
            {colourBy === 'feature' && <LineTypes features={usedFeatures} hidden={hidden} setHidden={setHidden} />}
            {colourBy === 'filament' && <FilamentStats stats={parsed.stats} used={parsed.toolsUsed} colours={colours} parts={job.kind === 'sliced' ? job.result.filamentParts : undefined} cost={job.kind === 'sliced' ? job.result.totalCost : undefined} />}
            {isRangeView(colourBy) && <RangeKey by={colourBy} range={range} />}
            {colourBy !== 'feature' && hidden.size > 0 && (
              <p className="legend-note">
                {hidden.size === 1 ? '1 line type hidden. ' : `${hidden.size} line types hidden. `}
                <button className="quiet" onClick={() => setHidden(new Set())}>
                  Show all
                </button>
              </p>
            )}
            <TimeStats
              total={(job.kind === 'sliced' && job.result.estimatedTimeSeconds) || parsed.stats.seconds}
              prepare={job.kind === 'sliced' ? (job.result.prepareSeconds ?? 0) : 0}
            />
          </>
        )}
      </div>
      {!ready && !otherLoading && (
        <div className="loading-overlay no-blur" role="status" aria-live="polite">
          <PrintLoader
            loading={
              read
                ? { label: 'Drawing the preview', progress: 1 }
                : { label: 'Reading the G-code', progress, detail: `${formatMegabytes(gcode.size)} of G-code` }
            }
          />
        </div>
      )}
      {parsed && layers > 0 && menuOpen && (
        <LayerMenu key={upTo} layerZ={parsed.layerZ} layer={upTo} onLayer={setLayer} onClose={() => setMenuOpen(false)} />
      )}
      {parsed && layers > 0 && (
        <div className="layer-slider">
          <div className="layer-track">
            <Slider
              aria-label="Layer"
              min={0}
              max={layers - 1}
              value={upTo}
              onChange={(e) => setLayer(Number(e.target.value))}
              // Desktop opens the slider's menu with a right click; a long press here.
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuOpen(true);
              }}
            />
            <LayerMarks layerZ={parsed.layerZ} onLayer={setLayer} />
          </div>
          <span className="layer-label" data-testid="layer-label">
            {upTo + 1} / {layers} · {parsed.layerZ[upTo].toFixed(2)} mm
          </span>
          <button
            className={`layer-add${codeAt(codes, parsed.layerZ, upTo) ? ' has-code' : ''}`}
            aria-label={codeAt(codes, parsed.layerZ, upTo) ? 'Change what happens at this layer' : 'Add a pause, filament change or G-code at this layer'}
            title={codeAt(codes, parsed.layerZ, upTo) ? 'Change what happens at this layer' : 'Add a pause, filament change or G-code at this layer'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {codeAt(codes, parsed.layerZ, upTo) ? <Pencil size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
          </button>
        </div>
      )}
    </div>
  );
}
