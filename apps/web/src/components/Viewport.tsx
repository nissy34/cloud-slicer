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
import { layerTexture, type LayerProfile } from '../lib/layers';
import { KIND_COLOURS, partAt, partRanges, volumeMeshes } from '../lib/volumes';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';
import { setCameraSource } from '../state/view';
import { BrimMarks } from './BrimEars';
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
  /** Index of the object's first triangle in the preview. */
  first: number;
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
      parts.push({ object, geometry: g, centre, first: tri });
      tri += count;
    });
    return parts;
  }, [preview, colours]);
}

function geometryOf(pos: Float32Array, col?: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/**
 * One part of a multi-part object split out of the object's geometry, so the
 * gizmos can move it alone: the part, and the rest of the object.
 */
function splitPart(part: Part, ranges: [number, number][]): { piece: Part; rest: THREE.BufferGeometry; restTris: Uint32Array } {
  const pos = part.geometry.getAttribute('position').array as Float32Array;
  const col = part.geometry.getAttribute('color').array as Float32Array;
  const total = pos.length / 9;
  const inPiece = new Uint8Array(total);
  for (const [first, count] of ranges) inPiece.fill(1, Math.max(0, first - part.first), Math.min(total, first - part.first + count));
  const n = inPiece.reduce((a, b) => a + b, 0);
  const take = (src: Float32Array, want: number, size: number) => {
    const out = new Float32Array(size * 9);
    let k = 0;
    for (let t = 0; t < total; t++) if (inPiece[t] === want) out.set(src.subarray(t * 9, t * 9 + 9), 9 * k++);
    return out;
  };
  const geometry = geometryOf(take(pos, 1, n), take(col, 1, n));
  const centre = new THREE.Vector3();
  geometry.boundingBox!.getCenter(centre);
  // Where each triangle of the rest was in the object's geometry, to tell which part a press hit.
  const restTris = new Uint32Array(total - n);
  for (let t = 0, k = 0; t < total; t++) if (!inPiece[t]) restTris[k++] = t;
  return { piece: { object: part.object, geometry, centre, first: 0 }, rest: geometryOf(take(pos, 0, total - n), take(col, 0, total - n)), restTris };
}

interface VolumePart extends Part {
  volume: number;
  kind: number;
}

// Negative parts, modifiers and support enforcers/blockers, drawn see-through like desktop.
function useVolumeParts(preview: PreviewMesh | null): VolumePart[] {
  return useMemo(() => {
    if (!preview?.volumeList) return [];
    return volumeMeshes(preview).map((m) => {
      const geometry = geometryOf(m.positions);
      const centre = new THREE.Vector3();
      geometry.boundingBox!.getCenter(centre);
      return { object: m.object, volume: m.volume, kind: m.kind, geometry, centre, first: 0 };
    });
  }, [preview]);
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
  onMatrix,
}: {
  tool: 'move' | 'rotate' | 'scale';
  part: Part;
  place: Placement;
  controlsRef: React.MutableRefObject<TransformControlsImpl | null>;
  material: React.ReactNode;
  onRelease(): void;
  /** Takes what the gizmo did as a matrix in plate coordinates, instead of moving the instance (a part's gizmo). */
  onMatrix?(m: THREE.Matrix4): void;
}) {
  const [pivot, setPivot] = useState<THREE.Group | null>(null);
  const snapSetting = useSlicer((s) => s.snap);
  const shift = useShift();
  const snap = snapSetting || shift;
  const coarse = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, []);
  const { moveInstance, transformInstance } = useSlicer.getState();
  const inverse = useMemo(() => place.rotation.clone().invert(), [place]);
  const negCentre = useMemo(() => place.centre.clone().negate(), [place]);

  const invalidate = useThree((s) => s.invalidate);
  // Back to the instance as the engine has it whenever it changes.
  useLayoutEffect(() => {
    if (!pivot) return;
    pivot.position.copy(place.centre);
    pivot.quaternion.copy(place.rotation);
    pivot.scale.set(1, 1, 1);
    invalidate();
  }, [pivot, place, tool, invalidate]);

  const commit = () => {
    onRelease();
    if (!pivot) return;
    const { object, instance, plate } = place;
    if (tool === 'move') {
      const d = pivot.position.clone().sub(place.centre);
      if (onMatrix) return d.lengthSq() > 1e-6 && onMatrix(new THREE.Matrix4().makeTranslation(d));
      if (d.lengthSq() > 1e-6) void moveInstance(object, instance, place.offset.x + d.x, place.offset.y + d.y);
      return;
    }
    // What the gizmo did, about the part's centre.
    pivot.updateMatrix();
    const m = new THREE.Matrix4()
      .multiplyMatrices(pivot.matrix, new THREE.Matrix4().makeRotationFromQuaternion(inverse))
      .multiply(new THREE.Matrix4().makeTranslation(negCentre));
    if (onMatrix) {
      const changed = tool === 'rotate' ? pivot.quaternion.angleTo(place.rotation) >= 1e-4 : pivot.scale.distanceTo(new THREE.Vector3(1, 1, 1)) >= 1e-4;
      if (changed) onMatrix(m);
      return;
    }
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
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    handle?.position.set(centre.x, centre.y, z);
    invalidate(); // the clipping planes moved too
  }, [handle, centre.x, centre.y, z, invalidate]);

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

const SHAPE_FRAME = '#4f8cff';

/**
 * The Text and SVG tools' handles on the picked shape, like desktop's: the
 * shape and a frame around it to drag over the object's surface (the frame is
 * bigger on touch screens, so a finger finds it) and a ring to turn it about
 * its own axis. The shape is drawn inside a pivot at its own origin: the ring
 * turns the pivot, and on
 * release the change goes to the engine. While a drag slides it, `slide` puts
 * it where the engine says it will go.
 */
function ShapeHandles({
  piece,
  material,
  slide,
  ringRef,
  frameRef,
  onPress,
  onRelease,
}: {
  piece: Part;
  material: React.ReactNode;
  /** Where a running drag has the shape: the change from where it stands. */
  slide: THREE.Matrix4 | null;
  ringRef: React.MutableRefObject<TransformControlsImpl | null>;
  /** The frame, for presses where the object's surface is nearer than it (a curved surface, a sunk shape). */
  frameRef: React.MutableRefObject<THREE.Mesh | null>;
  onPress(e: ThreeEvent<PointerEvent>): void;
  onRelease(): void;
}) {
  const shape = useSlicer((s) => s.shape);
  const preview = useSlicer((s) => s.preview);
  const shapePlace = useSlicer((s) => s.shapePlace);
  const coarse = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, []);
  const shift = useShift();
  const snap = useSlicer((s) => s.snap) || shift;
  const invalidate = useThree((s) => s.invalidate);
  const [pivot, setPivot] = useState<THREE.Group | null>(null);
  // The engine's placement of this very geometry (it is read after each change).
  const ready = !!shape && shape.preview === preview;
  const place = useMemo(() => {
    if (!ready) return null;
    const m = new THREE.Matrix4().fromArray(shape.matrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(position, quaternion, scale);
    const inverse = m.clone().invert();
    // The shape's own extent, in its coordinates. Following the surface, a
    // letter over a hole lands on a wall far behind; the frame stays on the
    // surface it stands on.
    const box = new THREE.Box3();
    const all = new THREE.Box3();
    const pos = piece.geometry.getAttribute('position');
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(inverse);
      all.expandByPoint(p);
      if (Math.abs(p.z) < 5) box.expandByPoint(p);
    }
    if (box.isEmpty()) box.copy(all);
    return { position, quaternion, scale, inverse, box };
  }, [ready, shape, piece]);

  useLayoutEffect(() => {
    if (!pivot || !place) return;
    pivot.position.copy(place.position);
    pivot.quaternion.copy(place.quaternion);
    pivot.scale.copy(place.scale);
    invalidate();
  }, [pivot, place, invalidate]);

  // Where the shape's origin is on screen, for the browser tests (test/toolbar.mjs).
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    if (!place) return;
    const p = place.position.clone().project(camera);
    const r = canvas.getBoundingClientRect();
    canvas.dataset.shapeAt = `${Math.round(r.left + ((p.x + 1) / 2) * r.width)},${Math.round(r.top + ((1 - p.y) / 2) * r.height)}`;
    return () => void delete canvas.dataset.shapeAt;
  }, [place, camera, canvas]);

  const frame = useMemo(() => {
    if (!place || place.box.isEmpty()) return null;
    const size = place.box.getSize(new THREE.Vector3());
    // A finger needs about 9 mm of shape around small text.
    const margin = Math.max(1.5, Math.min(size.x, size.y) * 0.15) + (coarse ? 4 : 0);
    const w = size.x + 2 * margin;
    const h = size.y + 2 * margin;
    const centre = place.box.getCenter(new THREE.Vector3());
    const [hx, hy] = [w / 2, h / 2];
    const outline = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hx, -hy, 0),
      new THREE.Vector3(hx, -hy, 0),
      new THREE.Vector3(hx, hy, 0),
      new THREE.Vector3(-hx, hy, 0),
    ]);
    return { w, h, at: new THREE.Vector3(centre.x, centre.y, place.box.max.z + 0.05), outline };
  }, [place, coarse]);
  useEffect(() => () => frame?.outline.dispose(), [frame]);

  const mesh = (
    <mesh geometry={piece.geometry} raycast={() => null} castShadow>
      {material}
    </mesh>
  );
  if (!place || !frame) return slide ? <group matrixAutoUpdate={false} matrix={slide}>{mesh}</group> : mesh;

  const turn = () => {
    onRelease();
    if (!pivot || !shape) return;
    const rel = place.quaternion.clone().invert().multiply(pivot.quaternion);
    const turned = 2 * Math.atan2(rel.z, rel.w);
    if (Math.abs(turned) < 1e-4) return;
    let angle = shape.angle - turned / DEG;
    angle = ((((angle + 180) % 360) + 360) % 360) - 180;
    void shapePlace(shape.object, { op: 'rotate', volume: shape.volume, instance: shape.instance, angle: Math.round(angle * 100) / 100 }, 'Rotate text');
  };

  return (
    <>
      <group matrixAutoUpdate={!slide} matrix={slide ?? undefined}>
        <group ref={setPivot}>
          <group matrixAutoUpdate={false} matrix={place.inverse}>
            {mesh}
          </group>
          {/* the frame to grab: drag it to slide the shape over the surface */}
          <group position={frame.at}>
            <mesh ref={frameRef} onPointerDown={onPress} renderOrder={3}>
              <planeGeometry args={[frame.w, frame.h]} />
              <meshBasicMaterial color={SHAPE_FRAME} transparent opacity={0.08} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <lineLoop geometry={frame.outline} raycast={() => null} renderOrder={3}>
              <lineBasicMaterial color={SHAPE_FRAME} transparent opacity={0.9} depthTest={false} />
            </lineLoop>
          </group>
        </group>
      </group>
      {pivot && !slide && (
        <TransformControls
            ref={ringRef}
            object={pivot}
            mode="rotate"
            space="local"
            showX={false}
            showY={false}
            size={coarse ? 1.5 : 1.15}
            rotationSnap={snap ? 15 * DEG : null}
            onMouseUp={turn}
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

/**
 * The variable layer height tool's look of the object, like desktop's: every
 * layer a slice will print, coloured by its height (thin cool, thick warm).
 */
function LayerMaterial({ profile, bottom }: { profile: LayerProfile; bottom: number }) {
  const texture = useMemo(() => {
    const rows = 2048;
    const t = new THREE.DataTexture(layerTexture(profile, rows), 1, rows, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, [profile]);
  useEffect(() => () => texture.dispose(), [texture]);
  const onBeforeCompile = useMemo(
    () => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.layerMap = { value: texture };
      shader.uniforms.layerBottom = { value: bottom };
      shader.uniforms.layerHeight = { value: Math.max(profile.height, 1e-3) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vLayerZ;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLayerZ = (modelMatrix * vec4(transformed, 1.0)).z;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vLayerZ;\nuniform sampler2D layerMap;\nuniform float layerBottom;\nuniform float layerHeight;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb = texture2D(layerMap, vec2(0.5, clamp((vLayerZ - layerBottom) / layerHeight, 0.0, 1.0))).rgb;',
        );
    },
    [texture, bottom, profile.height],
  );
  // A new key per texture: three caches the compiled program by material.
  return <meshStandardMaterial key={texture.uuid} roughness={0.7} onBeforeCompile={onBeforeCompile} customProgramCacheKey={() => texture.uuid} />;
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

/** Desktop's see-through look of a negative part, modifier or support enforcer/blocker. */
function VolumeMaterial({ kind, active }: { kind: number; active: boolean }) {
  const { colour, opacity } = KIND_COLOURS[kind] ?? KIND_COLOURS[2];
  return (
    <meshStandardMaterial
      color={colour}
      transparent
      opacity={active ? Math.min(1, opacity + 0.2) : opacity}
      depthWrite={false}
      roughness={0.6}
      emissive={active ? '#2f6fe4' : '#000000'}
      emissiveIntensity={active ? 0.4 : 0}
    />
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
  const { select, moveInstance, paintStroke, editBrim, measureHover, measurePick } = useSlicer.getState();
  const parts = useParts(preview, colours);
  useEffect(() => () => parts.forEach((p) => p.geometry.dispose()), [parts]);
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const paint = useSlicer((s) => s.paint);
  const overlay = useSlicer((s) => s.overlay);
  const layers = useSlicer((s) => s.layers);
  const measuring = !paint && (tool === 'measure' || tool === 'assemble');
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
  const brimTool = !paint && tool === 'brim' && !!selected;
  const shapeTool = !paint && (tool === 'text' || tool === 'svg');

  // The 3D view has its own menu (on an object); the browser's would only get in the way.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    canvas.addEventListener('contextmenu', block);
    return () => canvas.removeEventListener('contextmenu', block);
  }, [canvas]);

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

  // A selected part, modifier... of that instance: the gizmos move it inside
  // the object (a part is split out of the object's geometry while they do).
  const volumeParts = useVolumeParts(preview);
  useEffect(() => () => volumeParts.forEach((p) => p.geometry.dispose()), [volumeParts]);
  const picked = useMemo(() => {
    const v = selected?.volume;
    if (!place || v === undefined || !preview) return null;
    const info = project?.objects[place.object]?.volumes[v];
    if (!info) return null;
    if (info.kind !== 'part') {
      const piece = volumeParts.find((p) => p.object === place.object && p.volume === v);
      return piece ? { volume: v, kind: piece.kind, piece, rest: null, restTris: null, place: { ...place, rotation: new THREE.Quaternion(), centre: piece.centre.clone() } } : null;
    }
    const whole = parts.find((p) => p.object === place.object);
    if (!whole || project!.objects[place.object].volumes.filter((x) => x.kind === 'part').length < 2) return null;
    const { piece, rest, restTris } = splitPart(whole, partRanges(preview, place.object, v));
    return { volume: v, kind: 0, piece, rest, restTris, place: { ...place, rotation: new THREE.Quaternion(), centre: piece.centre.clone() } };
  }, [place, selected, preview, project, parts, volumeParts]);
  useEffect(() => () => {
    if (picked?.rest) {
      picked.rest.dispose();
      picked.piece.geometry.dispose();
    }
  }, [picked]);

  // The picked text or SVG shape in the Text and SVG tools: its handles, and
  // where it stands, read again after every change.
  const shapeInfo = selected?.volume !== undefined ? project?.objects[selected.object]?.volumes[selected.volume] : undefined;
  const shapePicked = shapeTool && picked && (shapeInfo?.text || shapeInfo?.svg) ? picked : null;
  const loadShape = useSlicer((s) => s.loadShape);
  useEffect(() => {
    if (shapeTool) void loadShape();
  }, [shapeTool, selected, preview, project, loadShape]);

  // Sliding a shape over the surface (desktop's SurfaceDrag): the pointer
  // keeps its offset from the shape's origin, and the engine finds where a ray
  // through it meets the object's other parts. One request at a time, the
  // latest position wins; on release the shape goes there as one undo step.
  const [slide, setSlide] = useState<THREE.Matrix4 | null>(null);
  const shapeFrame = useRef<THREE.Mesh | null>(null);
  const shapeDrag = useRef<{
    object: number;
    volume: number;
    instance: number;
    x0: number;
    y0: number;
    at: [number, number];
    offset: [number, number] | null;
    inverse: THREE.Matrix4 | null;
    ray: [number, number, number, number, number, number] | null;
    busy: boolean;
    moved: boolean;
  } | null>(null);
  const rayThrough = (x: number, y: number) => {
    const r = canvas.getBoundingClientRect();
    const caster = new THREE.Raycaster();
    caster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    return toRay(caster.ray) as [number, number, number, number, number, number];
  };
  const slideStep = async () => {
    const d = shapeDrag.current;
    if (!d || d.busy || !d.offset || !d.inverse || !d.moved) return;
    const ray = rayThrough(d.at[0] + d.offset[0], d.at[1] + d.offset[1]);
    d.busy = true;
    try {
      const m = await useSlicer.getState().shapeSlide(d.object, d.volume, d.instance, ray);
      if (shapeDrag.current !== d) return;
      if (m) {
        d.ray = ray;
        setSlide(new THREE.Matrix4().fromArray(m).multiply(d.inverse));
      }
    } catch (err) {
      console.warn('Slide:', err);
    } finally {
      d.busy = false;
    }
    // The pointer moved on while the engine worked.
    if (shapeDrag.current === d && ray.some((v, k) => v !== rayThrough(d.at[0] + d.offset![0], d.at[1] + d.offset![1])[k])) void slideStep();
  };
  const shapeMove = useRef<(e: PointerEvent) => void>(() => {});
  shapeMove.current = (e: PointerEvent) => {
    const d = shapeDrag.current;
    if (!d) return;
    d.at = [e.clientX, e.clientY];
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    void slideStep();
  };
  const shapeEnd = useRef<(e: PointerEvent) => void>(() => {});
  shapeEnd.current = (e: PointerEvent) => {
    const d = shapeDrag.current;
    if (!d) return;
    shapeDrag.current = null;
    window.removeEventListener('pointermove', onShapeMove);
    window.removeEventListener('pointerup', onShapeEnd);
    window.removeEventListener('pointercancel', onShapeEnd);
    canvas.removeEventListener('pointerdown', onShapeEnd);
    if (controls) controls.enabled = true;
    gizmoReleased.current = performance.now();
    // A second finger is the camera's. Let go off the object, it stays
    // where it last was on it.
    if (e.type !== 'pointerup' || !d.moved || !d.ray) return setSlide(null);
    void useSlicer
      .getState()
      .shapePlace(d.object, { op: 'drag', volume: d.volume, instance: d.instance, ray: d.ray, commit: true }, shapeInfo?.svg ? 'Move SVG over surface' : 'Move text over surface')
      .finally(() => setSlide(null));
  };
  const onShapeMove = useMemo(() => (e: PointerEvent) => shapeMove.current(e), []);
  const onShapeEnd = useMemo(() => (e: PointerEvent) => shapeEnd.current(e), []);
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onShapeMove);
      window.removeEventListener('pointerup', onShapeEnd);
      window.removeEventListener('pointercancel', onShapeEnd);
      canvas.removeEventListener('pointerdown', onShapeEnd);
    },
    [canvas, onShapeMove, onShapeEnd],
  );
  const startShapeDrag = (ev: PointerEvent, object: number, volume: number, instance: number) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const d: NonNullable<typeof shapeDrag.current> = {
      object,
      volume,
      instance,
      x0: ev.clientX,
      y0: ev.clientY,
      at: [ev.clientX, ev.clientY],
      offset: null,
      inverse: null,
      ray: null,
      busy: false,
      moved: false,
    };
    shapeDrag.current = d;
    if (controls) controls.enabled = false;
    window.addEventListener('pointermove', onShapeMove);
    window.addEventListener('pointerup', onShapeEnd);
    window.addEventListener('pointercancel', onShapeEnd);
    // Registered after this press, so only a second finger ends the drag.
    setTimeout(() => shapeDrag.current === d && canvas.addEventListener('pointerdown', onShapeEnd));
    // Where the shape's origin is on screen, from where it stands.
    const s = useSlicer.getState();
    const known = s.shape && s.shape.object === object && s.shape.volume === volume && s.shape.preview === s.preview ? s.shape : null;
    void (known ? Promise.resolve(known.matrix) : s.loadShape().then(() => useSlicer.getState().shape?.matrix)).then((matrix) => {
      if (shapeDrag.current !== d || !matrix) return;
      const m = new THREE.Matrix4().fromArray(matrix);
      const origin = new THREE.Vector3().setFromMatrixPosition(m).project(camera);
      const r = canvas.getBoundingClientRect();
      d.offset = [r.left + ((origin.x + 1) / 2) * r.width - d.x0, r.top + ((1 - origin.y) / 2) * r.height - d.y0];
      d.inverse = m.invert();
      void slideStep();
    });
  };
  // Shapes slide only on an object with other parts to slide over.
  const startShapeAt = (ev: PointerEvent, object: number, volume: number) => {
    const obj = project?.objects[object];
    const instance = Math.max(0, obj?.instances.findIndex((i) => i.plate === plate) ?? -1);
    select({ object, instance, volume });
    if (obj && obj.volumes.length > 1 && obj.instances.filter((i) => i.plate === plate).length === 1) startShapeDrag(ev, object, volume, instance);
  };

  // Where the camera is, for the Text tool's new text (state/view.ts).
  useEffect(() => {
    setCameraSource(() => [camera.position.x, camera.position.y, camera.position.z]);
    return () => setCameraSource(null);
  }, [camera]);

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

  // The object menu: a right click (released without dragging, since a
  // right drag pans the view) or a long press with a finger.
  const menuPress = (ev: PointerEvent, object: number, instance: number, long: boolean, volume?: number) => {
    const [x0, y0] = [ev.clientX, ev.clientY];
    let timer = 0;
    const open = () => useSlicer.getState().openObjectMenu({ object, instance, volume, x: x0, y: y0 });
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', done);
    };
    const move = (m: PointerEvent) => Math.hypot(m.clientX - x0, m.clientY - y0) > 6 && done();
    const up = (u: PointerEvent) => (done(), !long && u.button === 2 && open());
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', done);
    if (long)
      timer = window.setTimeout(() => {
        done();
        // The press opens the menu instead of moving the object.
        drag.current = null;
        setDelta(null);
        if (controls) controls.enabled = true;
        open();
      }, 550);
  };

  const onDown = (e: ThreeEvent<PointerEvent>, object: number, tris?: Uint32Array | null) => {
    e.stopPropagation();
    if (e.button === 2) {
      if (paint || measuring) return;
      const inst = project?.objects[object]?.instances.findIndex((i) => i.plate === plate) ?? -1;
      select({ object, instance: Math.max(0, inst) });
      return menuPress(e.nativeEvent, object, Math.max(0, inst), false);
    }
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
    if (shapeTool && obj && obj.volumes.length > 1 && preview && e.faceIndex != null) {
      // The Text and SVG tools: a press on a shape picks it and slides it; a
      // press on the rest of the object turns the camera, the shape stays picked.
      // The picked shape's frame wins even where the surface is in front of it.
      if (shapePicked && shapeFrame.current && new THREE.Raycaster(e.ray.origin, e.ray.direction).intersectObject(shapeFrame.current, false).length)
        return startShapeAt(e.nativeEvent, object, shapePicked.volume);
      const whole = parts.find((p) => p.object === object);
      const v = whole ? partAt(preview, object, whole.first + (tris ? tris[e.faceIndex] : e.faceIndex)) : undefined;
      const info = v !== undefined ? obj.volumes[v] : undefined;
      if (v !== undefined && (info?.text || info?.svg)) return startShapeAt(e.nativeEvent, object, v);
      if (selected?.object === object && selected.volume !== undefined) return;
    }
    const instances = obj?.instances.map((inst, i) => ({ inst, i })).filter(({ inst }) => inst.plate === plate) ?? [];
    const first = instances[0];
    if (selected?.object !== object || selected.volume !== undefined) select(first ? { object, instance: first.i } : null);
    if (first && e.pointerType === 'touch') menuPress(e.nativeEvent, object, first.i, true);
    // Brim ears: a click adds an ear (onEarClick); the object stays put. The
    // Text and SVG tools move shapes, not objects with other parts.
    if (brimTool || (shapeTool && (obj?.volumes.length ?? 0) > 1)) return;
    // Dragging moves an object with a single instance on this plate.
    if (instances.length !== 1) return;
    const hit = new THREE.Vector3();
    e.ray.intersectPlane(plane, hit);
    drag.current = { object, instance: first.i, start: hit, offset: [first.inst.offset[0], first.inst.offset[1]] };
    if (controls) controls.enabled = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  // A press on a see-through volume picks it (its menu on a right click or long press).
  const onVolumeDown = (e: ThreeEvent<PointerEvent>, v: VolumePart) => {
    if (paint || measuring || brimTool || onGizmo()) return;
    e.stopPropagation();
    const info = project?.objects[v.object]?.volumes[v.volume];
    if (shapeTool && e.button === 0 && (info?.text || info?.svg)) return startShapeAt(e.nativeEvent, v.object, v.volume);
    const instance = Math.max(0, project?.objects[v.object]?.instances.findIndex((i) => i.plate === plate) ?? -1);
    select({ object: v.object, instance, volume: v.volume });
    if (e.button === 2) return menuPress(e.nativeEvent, v.object, instance, false, v.volume);
    if (e.pointerType === 'touch') menuPress(e.nativeEvent, v.object, instance, true, v.volume);
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
  // Brim ears: a click (not an orbit drag) on the selected object, or on the
  // bed, adds an ear there, like desktop's left click.
  const onEarClick = (e: ThreeEvent<MouseEvent>, object?: number) => {
    if (!brimTool || e.delta > 6 || e.button !== 0 || (object !== undefined && object !== selected?.object)) return;
    e.stopPropagation();
    void editBrim({ op: 'add', x: e.point.x, y: e.point.y, diameter: useSlicer.getState().brimDiameter ?? 8 });
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
    if (paint || brimTool || onGizmo() || performance.now() - gizmoReleased.current < 400) return;
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
        const layered = !paint && tool === 'layers' && layers?.object === p.object ? layers : null;
        const material = layered ? (
          <LayerMaterial profile={layered} bottom={p.geometry.boundingBox!.min.z} />
        ) : (
          <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} emissive={active ? '#2f6fe4' : '#000000'} emissiveIntensity={active ? 0.35 : 0} />
        );
        if (shapePicked && place && p.object === place.object) {
          const pieceMaterial = shapePicked.kind ? (
            <VolumeMaterial kind={shapePicked.kind} active />
          ) : (
            <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} emissive="#2f6fe4" emissiveIntensity={0.35} />
          );
          const restTris = shapePicked.restTris;
          return (
            <group key={p.object}>
              <mesh
                geometry={shapePicked.rest ?? p.geometry}
                raycast={partRaycast}
                onPointerDown={(e) => onDown(e, p.object, restTris)}
                castShadow
              >
                <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} />
              </mesh>
              <ShapeHandles
                key={shapePicked.volume}
                piece={shapePicked.piece}
                material={pieceMaterial}
                slide={slide}
                ringRef={gizmo}
                frameRef={shapeFrame}
                onPress={(e) => {
                  e.stopPropagation();
                  if (!onGizmo()) startShapeAt(e.nativeEvent, p.object, shapePicked.volume);
                }}
                onRelease={() => (gizmoReleased.current = performance.now())}
              />
            </group>
          );
        }
        if (gizmoTool && place && picked && p.object === place.object) {
          return (
            <group key={p.object}>
              <mesh geometry={picked.rest ?? p.geometry} raycast={partRaycast} onPointerDown={(e) => onDown(e, p.object)} castShadow>
                <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} />
              </mesh>
              <Gizmo
                key={picked.volume}
                tool={gizmoTool}
                part={picked.piece}
                place={picked.place}
                controlsRef={gizmo}
                material={
                  picked.kind ? (
                    <VolumeMaterial kind={picked.kind} active />
                  ) : (
                    <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} emissive="#2f6fe4" emissiveIntensity={0.35} />
                  )
                }
                onRelease={() => (gizmoReleased.current = performance.now())}
                onMatrix={(m) =>
                  void useSlicer
                    .getState()
                    .volumeAction(place.object, { op: 'transform', volume: picked.volume, instance: place.instance, matrix: m.elements.slice() }, gizmoTool === 'move' ? 'Move part' : gizmoTool === 'rotate' ? 'Rotate part' : 'Scale part')
                }
              />
            </group>
          );
        }
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
          <mesh
            key={p.object}
            geometry={p.geometry}
            position={[offset[0], offset[1], 0]}
            raycast={partRaycast}
            onPointerDown={(e) => onDown(e, p.object)}
            onClick={(e) => onEarClick(e, p.object)}
            castShadow
          >
            {material}
          </mesh>
        );
      })}
      {!paint &&
        volumeParts.map((v, k) => {
          if ((gizmoTool || shapePicked) && picked && !picked.rest && v === picked.piece) return null;
          const offset = selected?.object === v.object && delta ? delta : [0, 0];
          const active = selected?.object === v.object && selected.volume === v.volume;
          return (
            <mesh
              key={`v${k}`}
              geometry={v.geometry}
              position={[offset[0], offset[1], 0]}
              renderOrder={1}
              raycast={measuring || brimTool ? () => null : undefined}
              onPointerDown={(e) => onVolumeDown(e, v)}
            >
              <VolumeMaterial kind={v.kind} active={active} />
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
      {brimTool && (
        <>
          {/* the bed takes clicks for new ears */}
          <mesh position={[w / 2, d / 2, 0]} onClick={(e) => onEarClick(e)}>
            <planeGeometry args={[w, d]} />
            <meshBasicMaterial visible={false} />
          </mesh>
          <BrimMarks />
        </>
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
      {/* Draws only when something changes (React props, the camera, the gizmos'
          own invalidate), so an idle view costs nothing while a slice runs. */}
      <Canvas
        className="viewport"
        frameloop="demand"
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
