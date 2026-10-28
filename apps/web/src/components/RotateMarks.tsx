import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import { holdOnMark, markSegments, turnedText } from '../lib/rotate-marks';

/** What TransformControls knows about a rotate drag (it keeps these to itself). */
type Turning = {
  object?: THREE.Object3D;
  mode: string;
  space: string;
  size: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  dragging: boolean;
  axis: string | null;
  rotationAngle: number;
  rotationAxis: THREE.Vector3;
  quaternionStart: THREE.Quaternion;
};

const AXES: Record<string, THREE.Vector3> = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
// The gizmo's ring colours, lighter so thin marks show on the dark view too.
const COLOURS: Record<string, string> = { X: '#ff7070', Y: '#70ff70', Z: '#80a8ff' };

/**
 * Desktop's rotate ring help: while a ring is dragged, marks round it every
 * 15° (bigger every 45°), the turn held on a mark when it comes close (Shift
 * or the snap setting still steps in 15°), and the angle turned beside the ring.
 */
export function RotateMarks({ controlsRef, snap }: { controlsRef: React.MutableRefObject<TransformControlsImpl | null>; snap: boolean }) {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const needle = useRef<THREE.BufferGeometry>(null);
  const [axis, setAxis] = useState<string | null>(null);
  const [label, setLabel] = useState<{ text: string; at: THREE.Vector3 } | null>(null);
  const marks = useMemo(() => markSegments(), []);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  useEffect(() => {
    const c = controlsRef.current as unknown as Turning | null;
    if (!c) return;
    // Where 0° sits on the ring: towards the top of the screen, fixed at the start of the drag.
    const zero = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const centre = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const change = () => {
      const object = c.object;
      const a = c.axis && AXES[c.axis];
      if (!c.dragging || c.mode !== 'rotate' || !a || !object) return;
      const angle = snapRef.current ? c.rotationAngle : holdOnMark(c.rotationAngle);
      if (angle !== c.rotationAngle) {
        // The control's own maths with the held angle (world rings, as the gizmos use).
        q.setFromAxisAngle(c.rotationAxis, angle);
        if (c.space === 'local') object.quaternion.copy(c.quaternionStart).multiply(q).normalize();
        else object.quaternion.copy(q).multiply(c.quaternionStart).normalize();
      }
      object.getWorldPosition(centre);
      // The ring's size on screen, as TransformControls works it out.
      const factor =
        camera instanceof THREE.OrthographicCamera
          ? (camera.top - camera.bottom) / camera.zoom
          : centre.distanceTo(camera.getWorldPosition(dir)) *
            Math.min((1.9 * Math.tan((Math.PI * (camera as THREE.PerspectiveCamera).fov) / 360)) / (camera as THREE.PerspectiveCamera).zoom, 7);
      const radius = (factor * c.size) / 7;
      const g = group.current;
      if (g) {
        g.position.copy(centre);
        g.quaternion.setFromUnitVectors(AXES.Z, a);
        g.scale.setScalar(radius);
      }
      dir.copy(zero).applyAxisAngle(a, angle);
      // A line from the middle to the ring, where the turn has got to.
      const tip = dir.clone().applyQuaternion(q.setFromUnitVectors(a, AXES.Z));
      needle.current?.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, tip.x, tip.y, tip.z], 3));
      setLabel({ text: turnedText(angle), at: centre.clone().addScaledVector(dir, radius * 1.45) });
    };
    const dragging = () => {
      const a = c.axis && AXES[c.axis];
      if (c.dragging && c.mode === 'rotate' && a) {
        // Screen up, laid flat on the ring; along the axis itself, the camera's right instead.
        zero.set(0, 1, 0).applyQuaternion(camera.quaternion).projectOnPlane(a);
        if (zero.lengthSq() < 1e-6) zero.set(1, 0, 0).applyQuaternion(camera.quaternion).projectOnPlane(a);
        zero.normalize();
        setAxis(c.axis);
        change();
      } else {
        setAxis(null);
        setLabel(null);
      }
    };
    c.addEventListener('objectChange', change);
    c.addEventListener('dragging-changed', dragging);
    return () => {
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
            <bufferAttribute attach="attributes-position" args={[marks, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={colour} depthTest={false} transparent />
        </lineSegments>
        <lineSegments renderOrder={1000} raycast={() => null}>
          <bufferGeometry ref={needle} />
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
