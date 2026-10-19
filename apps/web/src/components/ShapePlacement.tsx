import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  label,
  fields,
}: {
  object: number;
  volume: number;
  followsSurface: boolean;
  label: string;
  fields: ReactNode;
}) {
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
    const t = window.setTimeout(() => {
      shown.current = { ...shown.current, angle };
      void shapePlace(object, { op: 'rotate', volume, instance, angle: Number(angle) }, `Rotate ${label}`);
    }, 600);
    return () => window.clearTimeout(t);
  }, [angle, shape, object, volume, instance, label, shapePlace]);
  useEffect(() => {
    if (!shape || distance === shown.current.distance || !Number.isFinite(Number(distance)) || distance.trim() === '') return;
    const t = window.setTimeout(() => {
      shown.current = { ...shown.current, distance };
      void shapePlace(object, { op: 'distance', volume, instance, distance: Number(distance) }, `Move ${label} from surface`);
    }, 600);
    return () => window.clearTimeout(t);
  }, [distance, shape, object, volume, instance, label, shapePlace]);

  const onSurface = !!shape?.surface;
  return (
    <div className="num-fields">
      {fields}
      {shape && (
        <label className="num-field" title="Turn it about its own axis, clockwise (the ring in the 3D view does the same)">
          <span>
            Rotation <span className="unit">(°)</span>
          </span>
          <input type="number" aria-label="Rotation" inputMode="decimal" step={5} value={angle} onChange={(e) => setAngle(e.target.value)} />
        </label>
      )}
      {/* Following the surface, it sits on it. */}
      {onSurface && !followsSurface && (
        <label className="num-field" title="How far it stands off the surface">
          <span>
            From surface <span className="unit">(mm)</span>
          </span>
          <input type="number" aria-label="From surface" inputMode="decimal" step={0.1} value={distance} onChange={(e) => setDistance(e.target.value)} />
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
  if (!shape) return null;
  return (
    <div className="tool-row shape-row">
      {shape.surface && (
        <label className="svg-ratio" title="Keeps it upright while you slide it over the surface or face it to the camera">
          <input type="checkbox" checked={keepUp} onChange={(e) => setKeepUp(e.target.checked)} />
          Keep up
        </label>
      )}
      <button
        className="ghost"
        title="Turn it to face you, where you look at it from"
        onClick={() => {
          const camera = cameraPosition();
          if (camera) void shapePlace(object, { op: 'face', volume, instance: shape.instance, camera }, 'Face the camera');
        }}
      >
        Face the camera
      </button>
    </div>
  );
}

/** The 3D view's handles, in words for this screen. */
export function placementHint(what: 'text' | 'shape', onObject: boolean): string {
  if (!onObject) return `Move or rotate the ${what} with those tools.`;
  return `Drag the ${what} or its blue frame to slide it over the object. The ring turns it.`;
}
