import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { frontMiddle, moved, overlapping } from '../lib/clearance';
import type { PlatePoint } from '../engine/protocol';
import { useSlicer } from '../state/store';

const OUTLINE = '#7d8694';
const RED = '#e5484d';
const ON_TOP = { depthTest: false, transparent: true } as const;

/** A flat filled outline at height z. */
function Fill({ points, z, opacity }: { points: PlatePoint[]; z: number; opacity: number }) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))), [points]);
  return (
    <mesh geometry={geometry} position={[0, 0, z]} renderOrder={4} raycast={() => null}>
      <meshBasicMaterial color={RED} opacity={opacity} side={THREE.DoubleSide} depthWrite={false} {...ON_TOP} />
    </mesh>
  );
}

const ring = (points: PlatePoint[], z: number): [number, number, number][] => [...points, points[0]].map(([x, y]) => [x, y, z]);

/**
 * Printing object by object, desktop's outlines round each object on the
 * plate (GLCanvas3D's sequential print clearance): dashed where the tool head
 * needs room, red where two of them touch, a red band at the height an object
 * may reach when it is too tall for its place in the order, and its print
 * order number (#1 prints first). While objects are dragged (`moving`, by
 * `delta`) their outlines move and the overlaps update at once; the engine
 * checks again when they are let go.
 */
export function ClearanceView({ moving, delta }: { moving: (object: number) => boolean; delta: [number, number] | null }) {
  const clearance = useSlicer((s) => s.clearance);
  const paint = useSlicer((s) => s.paint);
  const outlines = useMemo(
    () => clearance?.outlines.map((o) => (delta && moving(o.object) ? { ...o, points: moved(o.points, delta) } : o)) ?? [],
    [clearance, delta, moving],
  );
  const red = useMemo(() => overlapping(outlines.map((o) => o.points)), [outlines]);
  if (!clearance || paint) return null;
  return (
    <group>
      {outlines.map((o, i) => (
        <group key={`${o.object}-${o.instance}`}>
          <Line points={ring(o.points, 0.05)} color={red.has(i) ? RED : OUTLINE} lineWidth={red.has(i) ? 2 : 1.5} dashed dashSize={3} gapSize={2} renderOrder={4} raycast={() => null} {...ON_TOP} />
          {red.has(i) && <Fill points={o.points} z={0.04} opacity={0.18} />}
          {outlines.length > 1 && (
            <Html position={[...frontMiddle(o.points), 0]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
              <div className={`clearance-order${red.has(i) ? ' bad' : ''}`} title={`Prints ${o.order === 1 ? 'first' : `as number ${o.order}`}`}>
                #{o.order}
              </div>
            </Html>
          )}
        </group>
      ))}
      {/* The engine's too-tall bands, until a drag moves things (it checks again on letting go). */}
      {!delta &&
        clearance.tall.map((t, i) => (
          <group key={`tall-${i}`}>
            <Fill points={t.points} z={t.height} opacity={0.3} />
            <Line points={ring(t.points, t.height)} color={RED} lineWidth={2} renderOrder={4} raycast={() => null} {...ON_TOP} />
          </group>
        ))}
    </group>
  );
}
