import { type ThreeEvent } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { PAINTED } from '../lib/brim';
import { useSlicer } from '../state/store';
import { Slider } from './Slider';
import { Note } from './Note';

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

// A phone or tablet: no right click and no Shift, so the hint says tap.
const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** Desktop's Brim ears panel for the selected object. */
export function BrimPanel({ object }: { object: number }) {
  const { t } = useTranslation();
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
    <section className="tool-panel brim-panel" aria-label={t('brimEars.title')}>
      <div className="tool-panel-head">
        <strong>{t('brimEars.title')}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          {t('brimEars.done')}
        </button>
      </div>
      <p className="muted hint">
        {t('brimEars.intro')} {touch ? t('brimEars.howTouch') : t('brimEars.howMouse')}
      </p>
      {!brim ? (
        <p className="muted hint">{t('brimEars.reading')}</p>
      ) : (
        <>
          {brim.brimType !== PAINTED && (
            <Note tone="warn" className="brim-warning">
              <span>{t('brimEars.notPainted')}</span>
              <button className="secondary" onClick={() => void setObjectSettings(object, -1, { brim_type: PAINTED })}>
                {t('brimEars.usePainted')}
              </button>
            </Note>
          )}
          <div className="brim-summary" aria-label={t('brimEars.ears')}>
            {t('brimEars.count', { count: brim.ears.length })}
            {loose > 0 && <span className="brim-loose"> · {t('brimEars.loose', { count: loose })}</span>}
            {picked.length > 0 && <span> · {t('brimEars.picked', { count: picked.length })}</span>}
          </div>
          <label className="transform-row">
            <span>{t('brimEars.size')}</span>
            <Slider aria-label={t('brimEars.size')} min={5} max={20} step={0.5} value={size} onChange={(e) => setBrimDiameter(Number(e.target.value))} />
            <span className="unit">{fmt(size)} mm</span>
          </label>
          <div className="brim-op">
            <button className="secondary" onClick={() => void editBrim({ op: 'auto', diameter: size, maxAngle, detection })}>
              {t('brimEars.auto')}
            </button>
            <label className="transform-row" title={t('brimEars.maxAngleTip')}>
              <span>{t('brimEars.maxAngle')}</span>
              <Slider aria-label={t('brimEars.maxAngle')} min={0} max={180} step={1} value={maxAngle} onChange={(e) => setMaxAngle(Number(e.target.value))} />
              <span className="unit">{maxAngle}°</span>
            </label>
            <label className="transform-row" title={t('brimEars.detectionTip')}>
              <span>{t('brimEars.detection')}</span>
              <Slider aria-label={t('brimEars.detection')} min={0} max={10} step={0.1} value={detection} onChange={(e) => setDetection(Number(e.target.value))} />
              <span className="unit">{fmt(detection)} mm</span>
            </label>
          </div>
          <div className="tool-row">
            <button className="secondary" disabled={!picked.length} onClick={() => void editBrim({ op: 'resize', indices: picked, diameter: size })}>
              {t('brimEars.resize')}
            </button>
            <button className="secondary" disabled={!picked.length} onClick={() => void editBrim({ op: 'remove', indices: picked })}>
              {t('brimEars.remove')}
            </button>
            <button className="secondary" disabled={!brim.ears.length} onClick={() => (pickEar(-1), void editBrim({ op: 'clear' }))}>
              {t('brimEars.removeAll')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
