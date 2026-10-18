import { type ThreeEvent } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { PAINTED } from '../lib/brim';
import { useSlicer } from '../state/store';

// The ears as desktop draws them: teal on the bed, red when loose, picked ones highlighted.
export const EAR_COLOURS = { ear: '#26a69a', loose: '#e5484d', picked: '#f5c542' };
const DISC = new THREE.CircleGeometry(1, 40);

/**
 * The selected object's ears on the bed. They show through the object, so
 * the ones under it can be picked too. A click picks an ear (Shift or Ctrl
 * adds to the picks); a right click removes it, like desktop.
 */
export function BrimMarks() {
  const brim = useSlicer((s) => s.brim);
  const picked = useSlicer((s) => s.brimPicked);
  const { pickEar, editBrim } = useSlicer.getState();
  if (!brim) return null;
  return (
    <group>
      {brim.ears.map((e, i) => (
        <mesh
          key={`${i}-${e.x}-${e.y}`}
          geometry={DISC}
          position={[e.x, e.y, 0.05]}
          scale={[e.diameter / 2, e.diameter / 2, 1]}
          renderOrder={5}
          onClick={(ev: ThreeEvent<MouseEvent>) => {
            ev.stopPropagation();
            if (ev.delta <= 6) pickEar(i, ev.shiftKey || ev.ctrlKey || ev.metaKey);
          }}
          onContextMenu={(ev: ThreeEvent<MouseEvent>) => {
            ev.stopPropagation();
            ev.nativeEvent.preventDefault();
            void editBrim({ op: 'remove', indices: [i] });
          }}
        >
          <meshBasicMaterial
            color={picked.includes(i) ? EAR_COLOURS.picked : e.attached ? EAR_COLOURS.ear : EAR_COLOURS.loose}
            transparent
            opacity={0.85}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** Desktop's Brim ears panel for the selected object. */
export function BrimPanel({ object }: { object: number }) {
  const brim = useSlicer((s) => (s.brim?.object === object ? s.brim : null));
  const picked = useSlicer((s) => s.brimPicked);
  const diameter = useSlicer((s) => s.brimDiameter);
  const project = useSlicer((s) => s.project);
  const { setTool, editBrim, setBrimDiameter, setObjectSettings, pickEar } = useSlicer.getState();
  // Desktop's defaults: corners sharper than 125°, outline smoothed by 1 mm.
  const [maxAngle, setMaxAngle] = useState(125);
  const [detection, setDetection] = useState(1);

  // Read again after anything that may change them: another object, undo, a move.
  useEffect(() => void editBrim({ op: 'get' }), [object, project, editBrim]);

  const size = diameter ?? brim?.defaultDiameter ?? 8;
  const loose = brim?.ears.filter((e) => !e.attached).length ?? 0;
  return (
    <section className="tool-panel brim-panel" aria-label="Brim ears">
      <div className="tool-panel-head">
        <strong>Brim ears</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
        </button>
      </div>
      <p className="muted hint">
        Round pads of brim under the corners keep them from lifting, with far less brim to clean off than a full brim. Click or tap the model
        or the bed next to it to add an ear. Tap an ear to pick it, then remove or resize the picked ones (a right click removes one too).
      </p>
      {!brim ? (
        <p className="muted hint">Reading the ears…</p>
      ) : (
        <>
          {brim.brimType !== PAINTED && (
            <div className="brim-warning" role="note">
              <span>The ears only print when this object's brim type is Painted (brim ears).</span>
              <button className="secondary" onClick={() => void setObjectSettings(object, -1, { brim_type: PAINTED })}>
                Use brim ears for this object
              </button>
            </div>
          )}
          <div className="brim-summary" aria-label="Ears">
            {brim.ears.length} {brim.ears.length === 1 ? 'ear' : 'ears'}
            {loose > 0 && <span className="brim-loose"> · {loose} not touching the object</span>}
            {picked.length > 0 && <span> · {picked.length} picked</span>}
          </div>
          <label className="transform-row">
            <span>Ear size</span>
            <input type="range" aria-label="Ear size" min={5} max={20} step={0.5} value={size} onChange={(e) => setBrimDiameter(Number(e.target.value))} />
            <span className="unit">{fmt(size)} mm</span>
          </label>
          <div className="brim-op">
            <button className="secondary" onClick={() => void editBrim({ op: 'auto', diameter: size, maxAngle, detection })}>
              Add ears on the corners
            </button>
            <label className="transform-row" title="Corners sharper than this get an ear">
              <span>Max angle</span>
              <input type="range" aria-label="Max angle" min={0} max={180} step={1} value={maxAngle} onChange={(e) => setMaxAngle(Number(e.target.value))} />
              <span className="unit">{maxAngle}°</span>
            </label>
            <label className="transform-row" title="Small bumps shorter than this are smoothed out first, so they don't get ears">
              <span>Detection length</span>
              <input type="range" aria-label="Detection length" min={0} max={10} step={0.1} value={detection} onChange={(e) => setDetection(Number(e.target.value))} />
              <span className="unit">{fmt(detection)} mm</span>
            </label>
          </div>
          <div className="tool-row">
            <button className="secondary" disabled={!picked.length} onClick={() => void editBrim({ op: 'resize', indices: picked, diameter: size })}>
              Resize picked
            </button>
            <button className="secondary" disabled={!picked.length} onClick={() => void editBrim({ op: 'remove', indices: picked })}>
              Remove picked
            </button>
            <button className="secondary" disabled={!brim.ears.length} onClick={() => (pickEar(-1), void editBrim({ op: 'clear' }))}>
              Remove all
            </button>
          </div>
        </>
      )}
    </section>
  );
}
