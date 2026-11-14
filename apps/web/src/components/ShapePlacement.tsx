import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { useSlicer } from '../state/store';
import { cameraPosition } from '../state/view';

/**
 * The shape's number boxes in one row: its own (`fields`: height, depth...),
 * then where it stands on its object like desktop's Text and SVG tools: its
 * turn and its distance from the surface. The 3D view has the same as handles.
 */
export function ShapePlacement({
  object,
  volume,
  followsSurface,
  shapeKind,
  fields,
}: {
  object: number;
  volume: number;
  followsSurface: boolean;
  /** What it is, for the undo step's name. */
  shapeKind: 'text' | 'svg';
  fields: ReactNode;
}) {
  const { t } = useTranslation();
  const shape = useSlicer((s) => (s.shape?.object === object && s.shape.volume === volume ? s.shape : null));
  const shapePlace = useSlicer((s) => s.shapePlace);
  const instance = shape?.instance ?? 0;
  const [angle, setAngle] = useState('');
  const [distance, setDistance] = useState('');
  const shown = useRef({ angle: '', distance: '' });

  // Changed elsewhere (the handles, undo): show where it stands now.
  useEffect(() => {
    if (!shape) return;
    const now = { angle: String(Math.round(shape.angle * 10) / 10), distance: String(Math.round((shape.distance ?? 0) * 100) / 100) };
    shown.current = now;
    setAngle(now.angle);
    setDistance(now.distance);
  }, [shape]);

  // Applied a moment after the last change, like the other fields.
  useEffect(() => {
    if (!shape || angle === shown.current.angle || !Number.isFinite(Number(angle)) || angle.trim() === '') return;
    const timer = window.setTimeout(() => {
      shown.current = { ...shown.current, angle };
      void shapePlace(object, { op: 'rotate', volume, instance, angle: Number(angle) }, shapeKind === 'text' ? i18n.t('shapePlacement.rotateText') : i18n.t('shapePlacement.rotateSvg'));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [angle, shape, object, volume, instance, shapeKind, shapePlace]);
  useEffect(() => {
    if (!shape || distance === shown.current.distance || !Number.isFinite(Number(distance)) || distance.trim() === '') return;
    const timer = window.setTimeout(() => {
      shown.current = { ...shown.current, distance };
      void shapePlace(object, { op: 'distance', volume, instance, distance: Number(distance) }, shapeKind === 'text' ? i18n.t('shapePlacement.moveText') : i18n.t('shapePlacement.moveSvg'));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [distance, shape, object, volume, instance, shapeKind, shapePlace]);

  const onSurface = !!shape?.surface;
  return (
    <div className="num-fields">
      {fields}
      {shape && (
        <label className="num-field" title={t('shapePlacement.rotationTip')}>
          <span>
            {t('shapePlacement.rotation')} <span className="unit">(°)</span>
          </span>
          <input type="number" aria-label={t('shapePlacement.rotation')} inputMode="decimal" step={5} value={angle} onChange={(e) => setAngle(e.target.value)} />
        </label>
      )}
      {/* Following the surface, it sits on it. */}
      {onSurface && !followsSurface && (
        <label className="num-field" title={t('shapePlacement.fromSurfaceTip')}>
          <span>
            {t('shapePlacement.fromSurface')} <span className="unit">(mm)</span>
          </span>
          <input type="number" aria-label={t('shapePlacement.fromSurface')} inputMode="decimal" step={0.1} value={distance} onChange={(e) => setDistance(e.target.value)} />
        </label>
      )}
    </div>
  );
}

/** Desktop's "Keep up" and "Face the camera" for a shape on its object. */
export function ShapeActions({ object, volume }: { object: number; volume: number }) {
  const shape = useSlicer((s) => (s.shape?.object === object && s.shape.volume === volume ? s.shape : null));
  const keepUp = useSlicer((s) => s.keepUp);
  const { setKeepUp, shapePlace } = useSlicer.getState();
  const { t } = useTranslation();
  if (!shape) return null;
  return (
    <div className="tool-row shape-row">
      {shape.surface && (
        <label className="switch-row" title={t('shapePlacement.keepUpTip')}>
          <input className="switch" type="checkbox" checked={keepUp} onChange={(e) => setKeepUp(e.target.checked)} />
          {t('shapePlacement.keepUp')}
        </label>
      )}
      <button
        className="ghost"
        title={t('shapePlacement.faceCameraTip')}
        onClick={() => {
          const camera = cameraPosition();
          if (camera) void shapePlace(object, { op: 'face', volume, instance: shape.instance, camera }, t('shapePlacement.faceCamera'));
        }}
      >
        {t('shapePlacement.faceCamera')}
      </button>
    </div>
  );
}

/** The 3D view's handles, in words for this screen. */
export function placementHint(what: 'text' | 'shape', onObject: boolean): string {
  if (!onObject) return what === 'text' ? i18n.t('shapePlacement.moveToolsText') : i18n.t('shapePlacement.moveToolsShape');
  return what === 'text' ? i18n.t('shapePlacement.dragText') : i18n.t('shapePlacement.dragShape');
}
