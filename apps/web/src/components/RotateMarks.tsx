import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import { DEG } from '../lib/placement';
import { ringScale, ringTurn, turnBetween, turnedText, turnLines } from '../lib/rotate-marks';

/** What TransformControls knows about a rotate drag (it keeps these to itself). */
type Turning = {
  object?: THREE.Object3D;
  camera: THREE.Camera;
  domElement: HTMLElement;
  mode: string;
  space: string;
  size: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  dragging: boolean;
  axis: string | null;
  rotationAxis: THREE.Vector3;
  quaternionStart: THREE.Quaternion;
  worldPositionStart: THREE.Vector3;
  worldQuaternionStart: THREE.Quaternion;
};

const AXES: Record<string, THREE.Vector3> = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
// The gizmo's ring colours, lighter so thin marks show on the dark view too.
const COLOURS: Record<string, string> = { X: '#ff7070', Y: '#70ff70', Z: '#80a8ff' };

/**
 * Desktop's rotate ring (Orca's GLGizmoRotate) on drei's TransformControls.
 * TransformControls turns by how far the pointer slides, so the turn drifts
 * away from the pointer; here, while a ring is dragged, the turn follows the
 * pointer round the ring instead, from where it was pressed. The scale is
 * drawn round that ring with 0° under the press: on the marks the turn steps
 * in 5°, on the spokes in the middle in 45°, elsewhere it is free (Shift or
 * the snap setting: 15° steps anywhere). The angle turned shows beside it.
 */
export function RotateMarks({ controlsRef, snap }: { controlsRef: React.MutableRefObject<TransformControlsImpl | null>; snap: boolean }) {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const turnGeometry = useRef<THREE.BufferGeometry>(null);
  const [axis, setAxis] = useState<string | null>(null);
  const [label, setLabel] = useState<{ text: string; at: THREE.Vector3 } | null>(null);
  const scale = useMemo(() => ringScale(), []);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  useEffect(() => {
    const c = controlsRef.current as unknown as Turning | null;
    if (!c) return;
    // The pointer, as TransformControls reads it, kept before it gets the event.
    const pointer = new THREE.Vector2();
    const track = (e: PointerEvent) => {
      const r = c.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const doc = c.domElement.ownerDocument;
    doc.addEventListener('pointerdown', track, true);
    doc.addEventListener('pointermove', track, true);

    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane();
    const hit = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const normal = new THREE.Vector3();
    // The ring's own directions: x towards where it was pressed, y a quarter turn on.
    const x = new THREE.Vector3();
    const y = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const basis = new THREE.Matrix4();
    let radius = 1;

    // Where the pointer meets the ring's plane, as (x, y) in the ring and how far out.
    const onRing = (): [number, number] | null => {
      ray.setFromCamera(pointer, camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      hit.sub(centre);
      return [hit.dot(x), hit.dot(y)];
    };

    const change = () => {
      const object = c.object;
      if (!c.dragging || c.mode !== 'rotate' || !c.axis || !AXES[c.axis] || !object) return;
      const at = onRing();
      if (!at) return;
      const reach = Math.hypot(at[0], at[1]) / radius;
      const angle = ringTurn(turnBetween([1, 0], at), reach, snapRef.current ? 15 * DEG : null);
      // The control's own maths with the ring's angle (TransformControls' rotationAxis is in the parent's space).
      q.setFromAxisAngle(c.rotationAxis, angle);
      if (c.space === 'local') object.quaternion.copy(c.quaternionStart).multiply(q).normalize();
      else object.quaternion.copy(q).multiply(c.quaternionStart).normalize();
      object.updateMatrixWorld();
      turnGeometry.current?.setAttribute('position', new THREE.Float32BufferAttribute(turnLines(angle), 3));
      dir.copy(x).multiplyScalar(Math.cos(angle)).addScaledVector(y, Math.sin(angle));
      setLabel({ text: turnedText(angle), at: centre.clone().addScaledVector(dir, radius * 1.45) });
    };

    const dragging = () => {
      const a = c.axis && AXES[c.axis];
      if (!(c.dragging && c.mode === 'rotate' && a)) {
        setAxis(null);
        setLabel(null);
        return;
      }
      centre.copy(c.worldPositionStart);
      normal.copy(a);
      if (c.space === 'local') normal.applyQuaternion(c.worldQuaternionStart);
      plane.setFromNormalAndCoplanarPoint(normal, centre);
      // The ring's size on screen, as TransformControls works it out (its rings have radius 1).
      const factor =
        camera instanceof THREE.OrthographicCamera
          ? (camera.top - camera.bottom) / camera.zoom
          : centre.distanceTo(camera.getWorldPosition(dir)) *
            Math.min((1.9 * Math.tan((Math.PI * (camera as THREE.PerspectiveCamera).fov) / 360)) / (camera as THREE.PerspectiveCamera).zoom, 7);
      radius = (factor * c.size) / 7;
      // 0° where it was pressed; seen edge on (no press point), the camera's right laid on the ring.
      x.set(1, 0, 0).applyQuaternion(camera.quaternion).projectOnPlane(normal).normalize();
      y.crossVectors(normal, x);
      const at = onRing();
      if (at && Math.hypot(at[0], at[1]) > 1e-6 * radius) {
        x.multiplyScalar(at[0]).addScaledVector(y, at[1]).normalize();
        y.crossVectors(normal, x);
      }
      const g = group.current;
      if (g) {
        g.position.copy(centre);
        g.quaternion.setFromRotationMatrix(basis.makeBasis(x, y, normal));
        g.scale.setScalar(radius);
      }
      setAxis(c.axis);
      change();
    };
    c.addEventListener('objectChange', change);
    c.addEventListener('dragging-changed', dragging);
    return () => {
      doc.removeEventListener('pointerdown', track, true);
      doc.removeEventListener('pointermove', track, true);
      c.removeEventListener('objectChange', change);
      c.removeEventListener('dragging-changed', dragging);
    };
  }, [controlsRef, camera]);

  const colour = COLOURS[axis ?? 'Z'];
  return (
    <>
      <group ref={group} visible={!!axis}>
        <lineSegments renderOrder={1000} raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[scale, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={colour} depthTest={false} transparent />
        </lineSegments>
        <lineSegments renderOrder={1000} raycast={() => null}>
          <bufferGeometry ref={turnGeometry} />
          <lineBasicMaterial color={colour} depthTest={false} transparent />
        </lineSegments>
      </group>
      {axis && label && (
        <Html position={label.at} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
          <div className="object-label" data-testid="rotate-angle">
            {label.text}
          </div>
        </Html>
      )}
    </>
  );
}
