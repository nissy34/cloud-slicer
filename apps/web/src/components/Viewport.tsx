import { OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import type { PaintOverlay, PaintRay, PreviewMesh } from '../engine/protocol';
import { bedSize, rgb } from '../lib/colour';
import { hullPlanes, layOnFace, movedOffset, toDegrees, toQuat, DEG, type Placement } from '../lib/placement';
import { setCapture } from '../lib/snapshot';
import { useSceneColours } from '../lib/theme';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';
import { MeasureOverlay } from './MeasureOverlay';
import { WipeTowerView } from './WipeTower';

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

/**
 * Desktop's move, rotate and scale gizmos on the selected instance (drei's
 * TransformControls). The part is drawn inside a pivot at its centre: the
 * gizmo moves the pivot, and on release the change goes to the engine.
 * Rotation rings are in world axes, scale handles along the object's own.
 */
function Gizmo({
  tool,
  part,
  place,
  controlsRef,
  material,
  onRelease,
}: {
  tool: 'move' | 'rotate' | 'scale';
  part: Part;
  place: Placement;
  controlsRef: React.MutableRefObject<TransformControlsImpl | null>;
  material: React.ReactNode;
  onRelease(): void;
}) {
  const [pivot, setPivot] = useState<THREE.Group | null>(null);
  const snapSetting = useSlicer((s) => s.snap);
  const shift = useShift();
  const snap = snapSetting || shift;
  const coarse = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, []);
  const { moveInstance, transformInstance } = useSlicer.getState();
  const inverse = useMemo(() => place.rotation.clone().invert(), [place]);
  const negCentre = useMemo(() => place.centre.clone().negate(), [place]);

  // Back to the instance as the engine has it whenever it changes.
  useLayoutEffect(() => {
    if (!pivot) return;
    pivot.position.copy(place.centre);
    pivot.quaternion.copy(place.rotation);
    pivot.scale.set(1, 1, 1);
  }, [pivot, place, tool]);

  const commit = () => {
    onRelease();
    if (!pivot) return;
    const { object, instance, plate } = place;
    if (tool === 'move') {
      const d = pivot.position.clone().sub(place.centre);
      if (d.lengthSq() > 1e-6) void moveInstance(object, instance, place.offset.x + d.x, place.offset.y + d.y);
      return;
    }
    // What the gizmo did, about the part's centre.
    pivot.updateMatrix();
    const m = new THREE.Matrix4()
      .multiplyMatrices(pivot.matrix, new THREE.Matrix4().makeRotationFromQuaternion(inverse))
      .multiply(new THREE.Matrix4().makeTranslation(negCentre));
    if (tool === 'rotate') {
      if (pivot.quaternion.angleTo(place.rotation) < 1e-4) return;
      void transformInstance(object, instance, { rotation: toDegrees(pivot.quaternion), offset: movedOffset(place, m), plate });
    } else {
      const s = pivot.scale;
      if (Math.abs(s.x - 1) + Math.abs(s.y - 1) + Math.abs(s.z - 1) < 1e-4) return;
      const scale = [place.scale.x * s.x, place.scale.y * s.y, place.scale.z * s.z].map((v) => Math.max(0.001, Math.round(v * 1e4) / 1e4));
      void transformInstance(object, instance, { scale, offset: movedOffset(place, m), plate });
    }
  };

  return (
    <>
      <group ref={setPivot}>
        <group quaternion={inverse}>
          <mesh geometry={part.geometry} position={negCentre} raycast={() => null} castShadow>
            {material}
          </mesh>
        </group>
      </group>
      {pivot && (
        <TransformControls
          ref={controlsRef}
          object={pivot}
          mode={tool === 'move' ? 'translate' : tool}
          space={tool === 'scale' ? 'local' : 'world'}
          showZ={tool !== 'move'}
          size={coarse ? 1.5 : 1.15}
          translationSnap={snap ? 5 : null}
          rotationSnap={snap ? 15 * DEG : null}
          scaleSnap={snap ? 0.1 : null}
          onMouseUp={commit}
        />
      )}
    </>
  );
}

const CUT_UPPER = '#22d3ee';
const CUT_LOWER = '#e879f9';

/**
 * The Cut tool's plane, like desktop's: a see-through plane at the cut height
 * with an arrow to drag it up and down, the part above it tinted cyan and the
 * part below pink.
 */
function CutPlane({
  part,
  controlsRef,
  onRelease,
}: {
  part: Part;
  controlsRef: React.MutableRefObject<TransformControlsImpl | null>;
  onRelease(): void;
}) {
  const z = useSlicer((s) => s.cutZ);
  const setCutZ = useSlicer((s) => s.setCutZ);
  const shift = useShift();
  const snap = useSlicer((s) => s.snap) || shift;
  const coarse = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, []);
  const [handle, setHandle] = useState<THREE.Group | null>(null);
  const box = part.geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y) * 1.3 + 10;
  // Three keeps what is on the positive side of a clipping plane.
  const above = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const below = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), []);
  above.constant = -z;
  below.constant = z;

  useLayoutEffect(() => {
    handle?.position.set(centre.x, centre.y, z);
  }, [handle, centre.x, centre.y, z]);

  const tint = (colour: string, plane: THREE.Plane) => (
    <mesh geometry={part.geometry} raycast={() => null} renderOrder={1}>
      <meshBasicMaterial color={colour} transparent opacity={0.45} depthWrite={false} clippingPlanes={[plane]} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>
  );
  return (
    <>
      {tint(CUT_UPPER, above)}
      {tint(CUT_LOWER, below)}
      <mesh position={[centre.x, centre.y, z]} raycast={() => null} renderOrder={2}>
        <planeGeometry args={[span, span]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <group ref={setHandle} />
      {handle && (
        <TransformControls
          ref={controlsRef}
          object={handle}
          mode="translate"
          showX={false}
          showY={false}
          size={coarse ? 1.5 : 1.15}
          translationSnap={snap ? 1 : null}
          onObjectChange={() => {
            const v = Math.min(Math.max(handle.position.z, 0.2), box.max.z - 0.2);
            handle.position.set(centre.x, centre.y, v);
            setCutZ(Math.round(v * 100) / 100);
          }}
          onMouseUp={onRelease}
        />
      )}
    </>
  );
}

/** Whether Shift is held, for the gizmos' snapping like desktop. */
function useShift() {
  const [shift, setShift] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => setShift(e.shiftKey);
    const off = () => setShift(false);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return shift;
}

/** Lay on face: hovering shows a candidate face, a click or tap lays the object on it. */
function FlattenPlanes({ part, place }: { part: Part; place: Placement }) {
  const planes = useMemo(() => hullPlanes(part.geometry), [part]);
  useEffect(() => () => planes.forEach((p) => p.geometry.dispose()), [planes]);
  const [hover, setHover] = useState<number | null>(null);
  const transformInstance = useSlicer((s) => s.transformInstance);

  const lay = (normal: THREE.Vector3) => void transformInstance(place.object, place.instance, layOnFace(place, normal));

  return (
    <group>
      {planes.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geometry}
          renderOrder={3}
          onPointerMove={(e) => {
            e.stopPropagation();
            setHover(i);
          }}
          onPointerOut={() => setHover((h) => (h === i ? null : h))}
          onPointerDown={(e) => {
            e.stopPropagation();
            // A tap has no hover before it: show the face it lands on.
            setHover(i);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.delta <= 6) lay(p.normal);
          }}
        >
          <meshBasicMaterial
            color={hover === i ? '#4f8cff' : '#ffffff'}
            transparent
            opacity={hover === i ? 0.8 : 0.14}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function Objects({ w, d }: { w: number; d: number }) {
  const preview = useSlicer((s) => s.preview);
  // Filament numbers past the physical ones are colour mixes.
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  const tool = useSlicer((s) => s.tool);
  const { select, moveInstance, paintStroke, measureHover, measurePick } = useSlicer.getState();
  const parts = useParts(preview, colours);
  useEffect(() => () => parts.forEach((p) => p.geometry.dispose()), [parts]);
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const paint = useSlicer((s) => s.paint);
  const overlay = useSlicer((s) => s.overlay);
  const measuring = !paint && tool === 'measure';
  const stroking = useRef(false);
  const [brush, setBrush] = useState<{ point: THREE.Vector3; normal: THREE.Vector3 } | null>(null);
  const brushTool = paint && (paint.tool === 'circle' || paint.tool === 'sphere');
  const drag = useRef<{ object: number; instance: number; start: THREE.Vector3; offset: [number, number] } | null>(null);
  const [delta, setDelta] = useState<[number, number] | null>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  // The camera must hold still while an object is dragged.
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const gizmo = useRef<TransformControlsImpl | null>(null);
  const gizmoReleased = useRef(0);

  // The selected instance, when it is the object's only one on this plate
  // (the part geometry holds all of them); the gizmos work on it.
  const place = useMemo((): Placement | null => {
    if (!selected || !project) return null;
    const obj = project.objects[selected.object];
    const inst = obj?.instances[selected.instance];
    const part = parts.find((p) => p.object === selected.object);
    if (!inst || !part || obj.instances.filter((i) => i.plate === plate).length !== 1) return null;
    return {
      object: selected.object,
      instance: selected.instance,
      plate,
      offset: new THREE.Vector3(...inst.offset),
      rotation: toQuat(inst.rotation),
      scale: new THREE.Vector3(...inst.scale),
      centre: part.centre.clone(),
    };
  }, [selected, project, parts, plate]);

  // During a stroke the rays come straight from the camera, so dragging never
  // waits on hit-testing the parts; the engine finds what each ray hits. The
  // listener is one function for the whole life of the view, so the one added
  // when a stroke starts is the one removed when it ends.
  const strokeMove = useRef<(e: PointerEvent) => void>(() => {});
  strokeMove.current = (e: PointerEvent) => {
    // Paint only while the button (or finger) is down, whatever event was missed.
    if (!(e.buttons & 1)) return endStroke();
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const caster = new THREE.Raycaster();
    caster.setFromCamera(ndc, camera);
    void paintStroke([toRay(caster.ray)], false);
  };
  const onStrokeMove = useMemo(() => (e: PointerEvent) => strokeMove.current(e), []);
  const endStroke = () => {
    if (!stroking.current) return;
    stroking.current = false;
    canvas.removeEventListener('pointermove', onStrokeMove);
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
  useEffect(() => () => canvas.removeEventListener('pointermove', onStrokeMove), [canvas, onStrokeMove]);
  useEffect(() => {
    if (!paint) {
      setBrush(null);
      endStroke();
    }
  }, [paint]);

  // No hit tests while a stroke runs: its rays come from strokeMove.
  const partRaycast = useMemo(
    () =>
      function (this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
        if (!stroking.current) bvhRaycast.call(this, raycaster, hits);
      },
    [],
  );

  // Hovering only shows the brush; painting needs the button held (onDown).
  const hover = (e: ThreeEvent<PointerEvent>) => {
    if (!brushTool || !e.face) return setBrush(null);
    const normal = e.face.normal.clone().transformDirection(e.object.matrixWorld);
    setBrush({ point: e.point.clone(), normal });
  };

  // TransformControls keeps these private; they say a handle is hovered or held.
  const onGizmo = () => {
    const g = gizmo.current as unknown as { dragging: boolean; axis: string | null } | null;
    return !!g && (g.dragging || g.axis !== null);
  };

  const onDown = (e: ThreeEvent<PointerEvent>, object: number) => {
    e.stopPropagation();
    // Measuring picks on click (below); a drag still turns the camera.
    if (measuring) return;
    if (paint) {
      if (e.button !== 0) return;
      // Painting holds the camera still; a drag off the parts still orbits.
      if (brushTool) {
        stroking.current = true;
        canvas.addEventListener('pointermove', onStrokeMove);
        if (controls) controls.enabled = false;
      }
      void paintStroke([toRay(e.ray)], true);
      return;
    }
    // A press on a gizmo handle in front of the part is the gizmo's.
    if (onGizmo()) return;
    const obj = project?.objects[object];
    const instances = obj?.instances.map((inst, i) => ({ inst, i })).filter(({ inst }) => inst.plate === plate) ?? [];
    const first = instances[0];
    if (selected?.object !== object) select(first ? { object, instance: first.i } : null);
    // Dragging moves an object with a single instance on this plate.
    if (instances.length !== 1) return;
    const hit = new THREE.Vector3();
    e.ray.intersectPlane(plane, hit);
    drag.current = { object, instance: first.i, start: hit, offset: [first.inst.offset[0], first.inst.offset[1]] };
    if (controls) controls.enabled = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (measuring) {
      if (e.buttons === 0) measureHover(toRay(e.ray));
      return;
    }
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
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!measuring || e.delta > 6) return;
    e.stopPropagation();
    // The ray of the click itself: a tap has no hover before it.
    void measurePick(toRay(e.ray));
  };
  const onMissed = () => {
    if (measuring) return useSlicer.getState().measureReset();
    // Clicks on a gizmo handle off the part don't deselect it.
    if (paint || onGizmo() || performance.now() - gizmoReleased.current < 400) return;
    select(null);
  };

  const gizmoTool = !paint && place && (tool === 'move' || tool === 'rotate' || tool === 'scale') ? tool : null;
  return (
    <group
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerOut={() => (setBrush(null), measuring && measureHover(null))}
      onPointerMissed={onMissed}
      onClick={onClick}
    >
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
        const material = (
          <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} emissive={active ? '#2f6fe4' : '#000000'} emissiveIntensity={active ? 0.35 : 0} />
        );
        if (gizmoTool && place && p.object === place.object)
          return (
            <group key={p.object}>
              {/* the part as the gizmo turns it; the hit target stays where the engine has it */}
              <mesh geometry={p.geometry} raycast={partRaycast} onPointerDown={(e) => onDown(e, p.object)} visible={false} />
              <group position={[offset[0], offset[1], 0]}>
                <Gizmo tool={gizmoTool} part={p} place={place} controlsRef={gizmo} material={material} onRelease={() => (gizmoReleased.current = performance.now())} />
              </group>
            </group>
          );
        return (
          <mesh key={p.object} geometry={p.geometry} position={[offset[0], offset[1], 0]} raycast={partRaycast} onPointerDown={(e) => onDown(e, p.object)} castShadow>
            {material}
          </mesh>
        );
      })}
      {!paint && tool === 'flatten' && place && (
        <FlattenPlanes key={place.object} part={parts.find((p) => p.object === place.object)!} place={place} />
      )}
      {!paint && tool === 'cut' && place && (
        <CutPlane
          key={place.object}
          part={parts.find((p) => p.object === place.object)!}
          controlsRef={gizmo}
          onRelease={() => (gizmoReleased.current = performance.now())}
        />
      )}
      {paint && overlay && paint.kind !== 'color' && <Overlay overlay={overlay} kind={paint.kind} />}
      {paint && brushTool && <BrushRing at={brush} radius={paint.radius} />}
      {measuring && <MeasureOverlay size={Math.max(0.4, Math.min(w, d) / 400)} />}
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

/** Lets saved projects take a picture of this view (lib/snapshot). */
function ThumbnailSource() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    setCapture(() => {
      // Desktop leaves the prime tower out of the plate picture.
      const tower = scene.getObjectByName('wipe-tower');
      if (tower) tower.visible = false;
      gl.render(scene, camera);
      if (tower) tower.visible = true;
      return gl.domElement;
    });
    return () => setCapture(null);
  }, [gl, scene, camera]);
  return null;
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
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true; // the Cut tool's tinted halves
        }}
        data-testid="viewport"
      >
        <color attach="background" args={[scene.background]} />
        <hemisphereLight args={['#ffffff', scene.ground, 0.9]} />
        <directionalLight position={[w, -d, d * 2]} intensity={1.6} />
        <Bed w={w} d={d} />
        <Objects w={w} d={d} />
        <WipeTowerView />
        <OrbitControls target={[w / 2, d / 2, 0]} makeDefault />
        <ThumbnailSource />
      </Canvas>
      <PlateTabs />
    </>
  );
}
