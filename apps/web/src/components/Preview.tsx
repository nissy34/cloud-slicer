import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { bedSize, rgb } from '../lib/colour';
import { FEATURE_COLOURS, FEATURES, type ParsedGcode } from '../lib/gcode';
import { useSceneColours } from '../lib/theme';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';
import { Bed } from './Viewport';

type ColourBy = 'feature' | 'filament';

function useParsed(gcode: Blob | null) {
  const [parsed, setParsed] = useState<ParsedGcode | null>(null);
  useEffect(() => {
    setParsed(null);
    if (!gcode) return;
    const worker = new Worker(new URL('../engine/gcode-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<ParsedGcode>) => setParsed(data);
    worker.postMessage({ gcode });
    return () => worker.terminate();
  }, [gcode]);
  return parsed;
}

// One extrusion is drawn as a solid bead with a diamond cross-section (like
// Orca's preview), built on the GPU from the segment's two endpoints, width and
// height. Local coords: x along the segment (0..1), y across (-0.5..0.5),
// z down from the nozzle (-1..0).
const BEAD = (() => {
  const ring = [
    [0, 0],
    [0.5, -0.5],
    [0, -1],
    [-0.5, -0.5],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) nrm.push(...n);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let k = 0; k < 4; k++) {
    const [y0, z0] = ring[k];
    const [y1, z1] = ring[(k + 1) % 4];
    // Outward normal of the edge in the y/z plane (unit space; rescaled in the shader).
    const ny = z0 - z1;
    const nz = y1 - y0;
    const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2 + 0.5;
    const flip = ny * cy + nz * cz < 0 ? -1 : 1;
    quad([0, y0, z0], [1, y0, z0], [1, y1, z1], [0, y1, z1], [0, ny * flip, nz * flip]);
  }
  quad([0, ...ring[0]], [0, ...ring[3]], [0, ...ring[2]], [0, ...ring[1]], [-1, 0, 0]);
  quad([1, ...ring[0]], [1, ...ring[1]], [1, ...ring[2]], [1, ...ring[3]], [1, 0, 0]);
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

function Toolpaths({ parsed, upTo, colourBy, colours }: { parsed: ParsedGcode; upTo: number; colourBy: ColourBy; colours: string[] }) {
  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(BEAD.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(BEAD.nrm, 3));
    g.setIndex(BEAD.idx);
    const ends = new THREE.InstancedInterleavedBuffer(parsed.positions, 6);
    g.setAttribute('iStart', new THREE.InterleavedBufferAttribute(ends, 3, 0));
    g.setAttribute('iEnd', new THREE.InterleavedBufferAttribute(ends, 3, 3));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(parsed.sizes, 2));
    return g;
  }, [parsed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: beadVertex, fragmentShader: beadFragment, side: THREE.DoubleSide }),
    [],
  );
  useMemo(() => {
    const n = parsed.features.length;
    const col = new Uint8Array(n * 3);
    const toByte = (c: [number, number, number]) => c.map((v) => Math.round(v * 255));
    const featurePalette = FEATURE_COLOURS.map((c) => toByte(rgb(c)));
    const toolPalette = colours.map((c) => toByte(rgb(c)));
    const fallback = [204, 204, 204];
    for (let s = 0; s < n; s++) {
      const c = colourBy === 'feature' ? featurePalette[parsed.features[s]] : (toolPalette[parsed.tools[s]] ?? fallback);
      col.set(c, s * 3);
    }
    geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(col, 3, true));
  }, [geometry, parsed, colourBy, colours]);
  geometry.instanceCount = parsed.layerStarts[Math.min(upTo + 1, parsed.layerStarts.length - 1)];
  // The view draws on demand: the layer and colour changes above are not props.
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => invalidate());
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

/** Points the camera at the printed part once the G-code has been read. */
function FitCamera({ parsed }: { parsed: ParsedGcode }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  useEffect(() => {
    const p = parsed.positions;
    if (!p.length || !controls) return;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    // Every 8th segment is plenty for a bounding box.
    for (let i = 0; i < p.length; i += 48) box.expandByPoint(v.set(p[i], p[i + 1], p[i + 2]));
    box.expandByPoint(v.set(p[p.length - 3], p[p.length - 2], p[p.length - 1]));
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
  const parsed = useParsed(gcode);
  const layers = parsed ? parsed.layerZ.length : 0;
  const [layer, setLayer] = useState(Number.MAX_SAFE_INTEGER);
  const [colourBy, setColourBy] = useState<ColourBy>('feature');
  // The colour key starts folded on a phone, where it would cover the model.
  const [keyOpen, setKeyOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  const upTo = Math.min(layer, layers - 1);
  const scene = useSceneColours();

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
        {parsed && <Toolpaths parsed={parsed} upTo={upTo} colourBy={colourBy} colours={colours} />}
        {parsed && <FitCamera parsed={parsed} />}
        <OrbitControls target={[w / 2, d / 2, 0]} makeDefault />
      </Canvas>
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
        {!parsed && <p className="muted">Reading G-code…</p>}
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
      {parsed && layers > 0 && (
        <div className="layer-slider">
          <input
            type="range"
            aria-label="Layer"
            min={0}
            max={layers - 1}
            value={upTo}
            onChange={(e) => setLayer(Number(e.target.value))}
          />
          <span className="layer-label" data-testid="layer-label">
            {upTo + 1} / {layers} · {parsed.layerZ[upTo].toFixed(2)} mm
          </span>
        </div>
      )}
    </div>
  );
}
