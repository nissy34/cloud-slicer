import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import type { PaintOverlay, PaintRay, PreviewMesh } from '../engine/protocol';
import { bedSize, rgb } from '../lib/colour';
import { useSceneColours } from '../lib/theme';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';

// Printer coordinates are Z-up with the plate from (0,0) to (w,d).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export function Bed({ w, d }: { w: number; d: number }) {
  const scene = useSceneColours();
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
        <meshStandardMaterial color={scene.bed} roughness={0.9} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color={scene.grid} transparent opacity={0.6} />
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

const OVERLAY_COLOURS: Record<string, [string, string]> = {
  support: ['#3fbf5f', '#e0454a'],
  seam: ['#3d8bff', '#e0454a'],
  fuzzy: ['#b061ff', '#b061ff'],
};

// Support, seam or fuzzy skin paint, drawn just in front of the parts.
function Overlay({ overlay, kind }: { overlay: PaintOverlay; kind: string }) {
  const geometry = useMemo(() => {
    const [enforce, block] = (OVERLAY_COLOURS[kind] ?? OVERLAY_COLOURS.support).map((c) => new THREE.Color(c));
    const n = overlay.states.length;
    const col = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      const c = overlay.states[t] === 2 ? block : enforce;
      for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], t * 9 + v * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(overlay.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [overlay, kind]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial vertexColors roughness={0.6} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
    </mesh>
  );
}

const toRay = (r: THREE.Ray): PaintRay => [r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z];

// The brush outline under the pointer: a ring lying on the face it hovers.
function BrushRing({ at, radius }: { at: { point: THREE.Vector3; normal: THREE.Vector3 } | null; radius: number }) {
  const quaternion = useMemo(
    () => (at ? new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), at.normal) : new THREE.Quaternion()),
    [at],
  );
  if (!at) return null;
  const p = at.point.clone().addScaledVector(at.normal, 0.05);
  return (
    <mesh position={p} quaternion={quaternion} raycast={() => null} renderOrder={2}>
      <ringGeometry args={[Math.max(radius - 0.25, radius * 0.9), radius, 48]} />
      <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.85} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Pointer hits go through a bounding volume tree, built on the first hit test:
// plain ray-casting a 200k-triangle part on every pointer move stalls the page,
// and painting replaces the geometry too often to build one up front.
function bvhRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
  const g = this.geometry;
  if (!g.boundsTree) g.boundsTree = new MeshBVH(g);
  acceleratedRaycast.call(this, raycaster, hits);
}

function Objects({ w, d }: { w: number; d: number }) {
  const preview = useSlicer((s) => s.preview);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  const { select, moveInstance, paintStroke } = useSlicer.getState();
  const parts = useParts(preview, colours);
  useEffect(() => () => parts.forEach((p) => p.geometry.dispose()), [parts]);
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const paint = useSlicer((s) => s.paint);
  const overlay = useSlicer((s) => s.overlay);
  const stroking = useRef(false);
  const [brush, setBrush] = useState<{ point: THREE.Vector3; normal: THREE.Vector3 } | null>(null);
  const brushTool = paint && (paint.tool === 'circle' || paint.tool === 'sphere');
  const drag = useRef<{ object: number; instance: number; start: THREE.Vector3; offset: [number, number] } | null>(null);
  const [delta, setDelta] = useState<[number, number] | null>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  // The camera must hold still while an object is dragged.
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;

  // During a stroke the rays come straight from the camera, so dragging never
  // waits on hit-testing the parts; the engine finds what each ray hits.
  const strokeMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const caster = new THREE.Raycaster();
    caster.setFromCamera(ndc, camera);
    void paintStroke([toRay(caster.ray)], false);
  };
  const endStroke = () => {
    if (!stroking.current) return;
    stroking.current = false;
    canvas.removeEventListener('pointermove', strokeMove);
    if (controls) controls.enabled = true;
  };
  useEffect(() => {
    window.addEventListener('pointerup', endStroke);
    window.addEventListener('pointercancel', endStroke);
    return () => {
      window.removeEventListener('pointerup', endStroke);
      window.removeEventListener('pointercancel', endStroke);
    };
  });
  useEffect(() => {
    if (!paint) setBrush(null);
  }, [paint]);

  // No hit tests while a stroke runs: its rays come from strokeMove.
  const partRaycast = useMemo(
    () =>
      function (this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
        if (!stroking.current) bvhRaycast.call(this, raycaster, hits);
      },
    [],
  );

  const hover = (e: ThreeEvent<PointerEvent>) => {
    if (!brushTool || !e.face) return setBrush(null);
    const normal = e.face.normal.clone().transformDirection(e.object.matrixWorld);
    setBrush({ point: e.point.clone(), normal });
  };

  const onDown = (e: ThreeEvent<PointerEvent>, object: number) => {
    e.stopPropagation();
    if (paint) {
      if (e.button !== 0) return;
      // Painting holds the camera still; a drag off the parts still orbits.
      if (brushTool) {
        stroking.current = true;
        canvas.addEventListener('pointermove', strokeMove);
        if (controls) controls.enabled = false;
      }
      void paintStroke([toRay(e.ray)], true);
      return;
    }
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
    if (paint) {
      hover(e);
      return;
    }
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
    <group onPointerMove={onMove} onPointerUp={onUp} onPointerOut={() => setBrush(null)} onPointerMissed={() => !paint && select(null)}>
      {/* invisible catcher so drags keep tracking off the object */}
      {delta && (
        <mesh position={[w / 2, d / 2, 0]} onPointerMove={onMove} onPointerUp={onUp}>
          <planeGeometry args={[w * 4, d * 4]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      {parts.map((p) => {
        const active = !paint && selected?.object === p.object;
        const offset = active && delta ? delta : [0, 0];
        return (
          <mesh key={p.object} geometry={p.geometry} position={[offset[0], offset[1], 0]} raycast={partRaycast} onPointerDown={(e) => onDown(e, p.object)} castShadow>
            <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} emissive={active ? '#2f6fe4' : '#000000'} emissiveIntensity={active ? 0.35 : 0} />
          </mesh>
        );
      })}
      {paint && overlay && paint.kind !== 'color' && <Overlay overlay={overlay} kind={paint.kind} />}
      {paint && brushTool && <BrushRing at={brush} radius={paint.radius} />}
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
  const scene = useSceneColours();
  return (
    <>
      <Canvas
        className="viewport"
        camera={{ position: [w / 2, -d * 0.75, d * 0.8], fov: 40, near: 1, far: 5000 }}
        gl={{ antialias: true }}
        data-testid="viewport"
      >
        <color attach="background" args={[scene.background]} />
        <hemisphereLight args={['#ffffff', scene.ground, 0.9]} />
        <directionalLight position={[w, -d, d * 2]} intensity={1.6} />
        <Bed w={w} d={d} />
        <Objects w={w} d={d} />
        <OrbitControls target={[w / 2, d / 2, 0]} makeDefault />
      </Canvas>
      <PlateTabs />
    </>
  );
}
