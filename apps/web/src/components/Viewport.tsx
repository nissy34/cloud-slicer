import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PreviewMesh } from '../engine/protocol';
import { bedSize, rgb } from '../lib/colour';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';

// Printer coordinates are Z-up with the plate from (0,0) to (w,d).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export function Bed({ w, d }: { w: number; d: number }) {
  const grid = useMemo(() => {
    const pts: number[] = [];
    for (let x = 0; x <= w + 0.01; x += 10) pts.push(x, 0, 0, x, d, 0);
    for (let y = 0; y <= d + 0.01; y += 10) pts.push(0, y, 0, w, y, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [w, d]);
  return (
    <group>
      <mesh position={[w / 2, d / 2, -0.2]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#2b2f36" roughness={0.9} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color="#4a5160" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

interface Part {
  object: number;
  geometry: THREE.BufferGeometry;
  centre: THREE.Vector3;
}

// One geometry per object, coloured per triangle by its filament.
function useParts(preview: PreviewMesh | null, colours: string[]): Part[] {
  return useMemo(() => {
    if (!preview) return [];
    const palette = colours.map(rgb);
    const parts: Part[] = [];
    let tri = 0;
    preview.objectTriangles.forEach((count, object) => {
      if (count === 0) return;
      const pos = preview.positions.subarray(tri * 9, (tri + count) * 9);
      const col = new Float32Array(count * 9);
      for (let t = 0; t < count; t++) {
        const c = palette[(preview.filaments[tri + t] || 1) - 1] ?? [0.8, 0.8, 0.8];
        for (let v = 0; v < 3; v++) col.set(c, t * 9 + v * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      g.computeBoundingBox();
      const centre = new THREE.Vector3();
      g.boundingBox!.getCenter(centre);
      parts.push({ object, geometry: g, centre });
      tri += count;
    });
    return parts;
  }, [preview, colours]);
}

function Objects({ w, d }: { w: number; d: number }) {
  const preview = useSlicer((s) => s.preview);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  const { select, moveInstance } = useSlicer.getState();
  const parts = useParts(preview, colours);
  const drag = useRef<{ object: number; instance: number; start: THREE.Vector3; offset: [number, number] } | null>(null);
  const [delta, setDelta] = useState<[number, number] | null>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  // The camera must hold still while an object is dragged.
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;

  const onDown = (e: ThreeEvent<PointerEvent>, object: number) => {
    e.stopPropagation();
    const obj = project?.objects[object];
    const instances = obj?.instances.map((inst, i) => ({ inst, i })).filter(({ inst }) => inst.plate === plate) ?? [];
    const first = instances[0];
    select(first ? { object, instance: first.i } : null);
    // Dragging moves an object with a single instance on this plate.
    if (instances.length !== 1) return;
    const hit = new THREE.Vector3();
    e.ray.intersectPlane(plane, hit);
    drag.current = { object, instance: first.i, start: hit, offset: [first.inst.offset[0], first.inst.offset[1]] };
    if (controls) controls.enabled = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(plane, hit)) return;
    setDelta([hit.x - drag.current.start.x, hit.y - drag.current.start.y]);
  };
  const onUp = () => {
    const dr = drag.current;
    drag.current = null;
    if (controls) controls.enabled = true;
    if (dr && delta && Math.hypot(delta[0], delta[1]) > 0.5)
      void moveInstance(dr.object, dr.instance, dr.offset[0] + delta[0], dr.offset[1] + delta[1]);
    setDelta(null);
  };

  return (
    <group onPointerMove={onMove} onPointerUp={onUp} onPointerMissed={() => select(null)}>
      {/* invisible catcher so drags keep tracking off the object */}
      {delta && (
        <mesh position={[w / 2, d / 2, 0]} onPointerMove={onMove} onPointerUp={onUp}>
          <planeGeometry args={[w * 4, d * 4]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      {parts.map((p) => {
        const active = selected?.object === p.object;
        const offset = active && delta ? delta : [0, 0];
        return (
          <mesh key={p.object} geometry={p.geometry} position={[offset[0], offset[1], 0]} onPointerDown={(e) => onDown(e, p.object)} castShadow>
            <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} emissive={active ? '#2f6fe4' : '#000000'} emissiveIntensity={active ? 0.35 : 0} />
          </mesh>
        );
      })}
    </group>
  );
}

function PlateTabs() {
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const setPlate = useSlicer((s) => s.setPlate);
  if (!project || project.plates.length < 2) return null;
  return (
    <div className="plate-tabs" role="tablist" aria-label="Plates">
      {project.plates.map((p) => (
        <button key={p.index} role="tab" aria-selected={p.index === plate} className={p.index === plate ? 'plate active' : 'plate'} onClick={() => void setPlate(p.index)}>
          {p.index + 1}
          {p.name ? ` ${p.name}` : ''}
          <span className="muted"> · {p.objects.length}</span>
        </button>
      ))}
    </div>
  );
}

export function Viewport() {
  const { w, d } = bedSize(useOption('printable_area'));
  return (
    <>
      <Canvas
        className="viewport"
        camera={{ position: [w / 2, -d * 0.75, d * 0.8], fov: 40, near: 1, far: 5000 }}
        gl={{ antialias: true }}
        data-testid="viewport"
      >
        <color attach="background" args={['#16191e']} />
        <hemisphereLight args={['#ffffff', '#3a3f48', 0.9]} />
        <directionalLight position={[w, -d, d * 2]} intensity={1.6} />
        <Bed w={w} d={d} />
        <Objects w={w} d={d} />
        <OrbitControls target={[w / 2, d / 2, 0]} makeDefault />
      </Canvas>
      <PlateTabs />
    </>
  );
}
