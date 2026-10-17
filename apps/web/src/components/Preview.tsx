import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { bedSize, rgb } from '../lib/colour';
import { FEATURE_COLOURS, FEATURES, type ParsedGcode } from '../lib/gcode';
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

function Toolpaths({ parsed, upTo, colourBy, colours }: { parsed: ParsedGcode; upTo: number; colourBy: ColourBy; colours: string[] }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
    return g;
  }, [parsed]);
  useMemo(() => {
    const n = parsed.features.length;
    const col = new Float32Array(n * 6);
    const featurePalette = FEATURE_COLOURS.map(rgb);
    const toolPalette = colours.map(rgb);
    for (let s = 0; s < n; s++) {
      const c = colourBy === 'feature' ? featurePalette[parsed.features[s]] : (toolPalette[parsed.tools[s]] ?? [0.8, 0.8, 0.8]);
      col.set(c, s * 6);
      col.set(c, s * 6 + 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }, [geometry, parsed, colourBy, colours]);
  const end = parsed.layerStarts[Math.min(upTo + 1, parsed.layerStarts.length - 1)];
  geometry.setDrawRange(0, end * 2);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  );
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
  const upTo = Math.min(layer, layers - 1);

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
      <Canvas className="viewport" camera={{ position: [w / 2, -d * 0.6, d * 0.7], fov: 40, near: 1, far: 5000 }} data-testid="gcode-preview">
        <color attach="background" args={['#16191e']} />
        <Bed w={w} d={d} />
        {parsed && <Toolpaths parsed={parsed} upTo={upTo} colourBy={colourBy} colours={colours} />}
        <OrbitControls target={[w / 2, d / 2, 0]} makeDefault />
      </Canvas>
      <div className="legend">
        <div className="legend-head">
          <select aria-label="Colour by" value={colourBy} onChange={(e) => setColourBy(e.target.value as ColourBy)}>
            <option value="feature">Line type</option>
            <option value="filament">Filament</option>
          </select>
        </div>
        {!parsed && <p className="muted">Reading G-code…</p>}
        {parsed &&
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
