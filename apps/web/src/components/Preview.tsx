import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { bedSize, rgb } from '../lib/colour';
import { formatMegabytes } from '../lib/format';
import { FEATURE_COLOURS, FEATURES, type PreviewGcode } from '../lib/gcode';
import { codeAt } from '../lib/layerCodes';
import { useSceneColours } from '../lib/theme';
import type { GcodeWorkerMessage } from '../engine/gcode-worker';
import { useLoading } from '../state/loading';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';
import { LayerMarks, LayerMenu, useLayerCodes } from './LayerCodes';
import { PrintLoader } from './PrintLoader';
import { CameraViews, ViewButtons, type ViewHandle } from './ViewControls';
import { Bed } from './Viewport';

type ColourBy = 'feature' | 'filament';

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
  varying vec3 vColor;
  varying vec3 vNormal;
  void main() {
    vec3 d = iEnd - iStart;
    float len = length(d);
    vec3 dir = len > 1e-6 ? d / len : vec3(1.0, 0.0, 0.0);
    vec3 side = cross(vec3(0.0, 0.0, 1.0), dir);
    side = length(side) > 1e-6 ? normalize(side) : vec3(0.0, 1.0, 0.0);
    vec3 up = cross(dir, side);
    float w = iSize.x;
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
function Toolpaths({ parsed, upTo, colourBy, colours, moving }: { parsed: PreviewGcode; upTo: number; colourBy: ColourBy; colours: string[]; moving: boolean }) {
  const colour = useMemo(() => {
    const n = parsed.features.length;
    const col = new Uint8Array(n * 3);
    // RGB bytes per feature or per tool (256 entries, light grey past the known tools).
    const palette = new Uint8Array(256 * 3).fill(204);
    (colourBy === 'feature' ? FEATURE_COLOURS : colours).forEach((c, i) =>
      palette.set(rgb(c).map((v) => Math.round(v * 255)), i * 3),
    );
    const index = colourBy === 'feature' ? parsed.features : parsed.tools;
    for (let s = 0; s < n; s++) {
      const p = index[s] * 3;
      col[s * 3] = palette[p];
      col[s * 3 + 1] = palette[p + 1];
      col[s * 3 + 2] = palette[p + 2];
    }
    return col;
  }, [parsed, colourBy, colours]);
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
  const material = useMemo(() => new THREE.ShaderMaterial({ vertexShader: beadVertex, fragmentShader: beadFragment }), []);
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

export function Preview() {
  const job = useSlicer((s) => s.job);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const setTab = useSlicer((s) => s.setTab);
  const { w, d } = bedSize(useOption('printable_area'));
  const gcode = job.kind === 'sliced' ? job.gcode : null;
  const { parsed: read, progress } = useParsed(gcode);
  const parsed = useAfterPaint(read);
  // The loading card stays from the slice finishing until the first frame of
  // toolpaths is on screen: reading the G-code, then building the 3D view.
  const [drawn, setDrawn] = useState<PreviewGcode | null>(null);
  const ready = parsed !== null && drawn === parsed;
  const otherLoading = useLoading() !== null;
  const layers = parsed ? parsed.layerZ.length : 0;
  const [layer, setLayer] = useState(Number.MAX_SAFE_INTEGER);
  const [colourBy, setColourBy] = useState<ColourBy>('feature');
  // The colour key starts folded on a phone, where it would cover the model.
  const [keyOpen, setKeyOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  const upTo = Math.min(layer, layers - 1);
  const scene = useSceneColours();
  const [moving, onCameraChange] = useMoving();
  const views: ViewHandle = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const codes = useLayerCodes();
  const slicing = useSlicer((s) => s.job.kind === 'slicing');

  if (!gcode && slicing) {
    return (
      <div className="coming-soon">
        <h1>Slicing the plate</h1>
        <p>Its toolpaths show here when it's done.</p>
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
    <div className="preview">
      <Canvas className="viewport" frameloop="demand" camera={{ position: [w / 2, -d * 0.6, d * 0.7], fov: 40, near: 1, far: 5000 }} data-testid="gcode-preview">
        <color attach="background" args={[scene.background]} />
        <Bed w={w} d={d} />
        {parsed && <Toolpaths parsed={parsed} upTo={upTo} colourBy={colourBy} colours={colours} moving={moving} />}
        {parsed && !ready && <DrawnSignal onDrawn={() => setDrawn(parsed)} />}
        {parsed && <FitCamera parsed={parsed} />}
        <OrbitControls target={[w / 2, d / 2, 0]} makeDefault onChange={onCameraChange} />
        <CameraViews
          handle={views}
          box={() => (parsed?.positions.length ? toolpathBox(parsed) : new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, d, 0)))}
        />
      </Canvas>
      <ViewButtons handle={views} className="over-slider" />
      <div className="legend">
        <div className="legend-head">
          <select aria-label="Colour by" value={colourBy} onChange={(e) => setColourBy(e.target.value as ColourBy)}>
            <option value="feature">Line type</option>
            <option value="filament">Filament</option>
          </select>
          <button
            className="legend-toggle"
            aria-label={keyOpen ? 'Hide colour key' : 'Show colour key'}
            aria-expanded={keyOpen}
            onClick={() => setKeyOpen((o) => !o)}
          >
            {keyOpen ? '▴' : '▾'}
          </button>
        </div>
        {parsed &&
          keyOpen &&
          (colourBy === 'feature'
            ? usedFeatures.map((f) => (
                <div key={f} className="legend-row">
                  <span className="dot" style={{ background: FEATURE_COLOURS[f] }} />
                  {FEATURES[f]}
                </div>
              ))
            : parsed.toolsUsed.map((t) => (
                <div key={t} className="legend-row">
                  <span className="dot" style={{ background: colours[t] ?? '#ccc' }} />
                  Filament {t + 1}
                </div>
              )))}
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
            <input
              type="range"
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
            {codeAt(codes, parsed.layerZ, upTo) ? '✎' : '+'}
          </button>
        </div>
      )}
    </div>
  );
}
