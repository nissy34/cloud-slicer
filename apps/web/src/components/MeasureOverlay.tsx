import { Html, Line } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { MEASURE_COLOURS, type MeasureFeature, type Measurement, type Vec3 } from '../lib/measure';
import { useSlicer } from '../state/store';

// Drawn over the parts, like desktop's Measure gizmo: features always show,
// even behind the model.
const ON_TOP = { depthTest: false, depthWrite: false, transparent: true } as const;

function circlePoints(centre: Vec3, radius: number, normal: Vec3): THREE.Vector3[] {
  const n = new THREE.Vector3(...normal).normalize();
  const u = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const c = new THREE.Vector3(...centre);
  return Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * Math.PI * 2;
    return c.clone().addScaledVector(u, Math.cos(a) * radius).addScaledVector(v, Math.sin(a) * radius);
  });
}

function Dot({ at, colour, size }: { at: Vec3; colour: string; size: number }) {
  return (
    <mesh position={at} raycast={() => null} renderOrder={5}>
      <sphereGeometry args={[size, 16, 12]} />
      <meshBasicMaterial color={colour} {...ON_TOP} />
    </mesh>
  );
}

function PlaneMark({ triangles, colour }: { triangles: number[]; colour: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
    return g;
  }, [triangles]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={() => null} renderOrder={4}>
      <meshBasicMaterial color={colour} opacity={0.55} side={THREE.DoubleSide} {...ON_TOP} />
    </mesh>
  );
}

/** One feature: a dot, a line along an edge, a ring for a circle (with its centre) or the plane's faces. */
function FeatureMark({ f, colour, size }: { f: MeasureFeature; colour: string; size: number }) {
  switch (f.type) {
    case 'point':
      return <Dot at={f.point} colour={colour} size={size} />;
    case 'edge':
      return <Line points={[f.start, f.end]} color={colour} lineWidth={4} renderOrder={5} raycast={() => null} {...ON_TOP} />;
    case 'circle':
      return (
        <>
          <Line points={circlePoints(f.centre, f.radius, f.normal)} color={colour} lineWidth={4} renderOrder={5} raycast={() => null} {...ON_TOP} />
          <Dot at={f.centre} colour={colour} size={size * 0.7} />
        </>
      );
    case 'plane':
      return <PlaneMark triangles={f.triangles} colour={colour} />;
  }
}

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** A figure on the view; `shift` moves it up (-1) or down (1) a line so figures at one spot don't cover each other. */
function Label({ at, shift = 0, children }: { at: Vec3; shift?: number; children: React.ReactNode }) {
  return (
    <Html position={at} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
      <div className="measure-label" style={shift ? { transform: `translateY(${shift * 1.6}em)` } : undefined}>
        {children}
      </div>
    </Html>
  );
}

/** The distance line and the angle arc between two picked features, with their figures. */
function Result({ m, size }: { m: Measurement; size: number }) {
  const arc = useMemo(() => {
    const a = m.angle;
    if (!a || a.radius <= 0 || a.degrees < 0.01) return null;
    const c = new THREE.Vector3(...a.centre);
    const d1 = new THREE.Vector3(...a.e1[1]).sub(new THREE.Vector3(...a.e1[0])).normalize();
    const d2 = new THREE.Vector3(...a.e2[1]).sub(new THREE.Vector3(...a.e2[0])).normalize();
    const angle = d1.angleTo(d2);
    const axis = new THREE.Vector3().crossVectors(d1, d2).normalize();
    if (axis.lengthSq() < 0.5) return null;
    const points = Array.from({ length: 33 }, (_, i) =>
      c.clone().addScaledVector(d1.clone().applyAxisAngle(axis, (angle * i) / 32), a.radius),
    );
    return { points, label: points[16].toArray() as Vec3 };
  }, [m.angle]);
  const d = m.distance;
  const p = m.perpendicular;
  const showPerpendicular = p && (!d || Math.abs(p.distance - d.distance) > 1e-6);
  return (
    <>
      {d && d.distance > 1e-6 && (
        <>
          <Line points={[d.from, d.to]} color="#ffffff" lineWidth={2} renderOrder={6} raycast={() => null} {...ON_TOP} />
          <Dot at={d.from} colour="#ffffff" size={size * 0.6} />
          <Dot at={d.to} colour="#ffffff" size={size * 0.6} />
          <Label at={mid(d.from, d.to)}>{d.distance.toFixed(3)} mm</Label>
        </>
      )}
      {showPerpendicular && p.distance > 1e-6 && (
        <>
          <Line points={[p.from, p.to]} color="#ffffff" lineWidth={1.5} dashed dashSize={size * 2} gapSize={size} renderOrder={6} raycast={() => null} {...ON_TOP} />
          <Label at={mid(p.from, p.to)} shift={-1}>⟂ {p.distance.toFixed(3)} mm</Label>
        </>
      )}
      {arc && (
        <>
          <Line points={arc.points} color="#ffffff" lineWidth={2} renderOrder={6} raycast={() => null} {...ON_TOP} />
          <Label at={arc.label} shift={1}>{m.angle!.degrees.toFixed(2)}°</Label>
        </>
      )}
    </>
  );
}

/**
 * The Measure tool on the 3D view: the feature under the pointer, the picked
 * ones and the measurement between them. `size` is the dot radius in mm, so
 * it suits the plate's scale.
 */
export function MeasureOverlay({ size }: { size: number }) {
  const { hover, picks, result } = useSlicer((s) => s.measure);
  const preview = useSlicer((s) => s.preview);
  // Features belong to the geometry they were found on. Assemble's picks
  // follow the parts it moves (and start over on undo).
  useEffect(() => {
    if (useSlicer.getState().tool !== 'assemble') useSlicer.getState().measureReset();
  }, [preview]);
  const colours = [MEASURE_COLOURS.first, MEASURE_COLOURS.second];
  const hovered = hover && !picks.some((p) => p.id === hover.id) ? hover : null;
  return (
    <group>
      {picks.map((f, i) => (
        <FeatureMark key={f.id} f={f} colour={colours[i]} size={size} />
      ))}
      {hovered && <FeatureMark f={hovered} colour={MEASURE_COLOURS.hover} size={size} />}
      {result && <Result m={result} size={size} />}
    </group>
  );
}
