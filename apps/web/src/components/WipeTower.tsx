import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { bedSize } from '../lib/colour';
import { holdCamera, onSecondFinger, twoFingers, type CameraControls } from '../lib/touch';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';

/** WIPE_TOWER_MARGIN in Orca: how close to the plate edge the tower may stand (plus its brim). */
const EDGE = 1;

/**
 * The prime tower on the plate, as desktop's Prepare view draws it: a
 * see-through box with a band for each filament the plate uses, standing where
 * it will print. Dragging it moves it; the slice puts it there.
 */
export function WipeTowerView() {
  const tower = useSlicer((s) => s.wipeTower);
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const paint = useSlicer((s) => s.paint);
  const tool = useSlicer((s) => s.tool);
  const brimWidth = Number(useOption('prime_tower_brim_width') ?? 0) || 0;
  const bed = bedSize(useOption('printable_area'));
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const drag = useRef<{ start: THREE.Vector3 } | null>(null);
  const [delta, setDelta] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState(false);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);

  // Let go of the camera if the tower goes away mid-drag.
  useEffect(
    () => () => {
      if (drag.current) holdCamera(controls, false);
    },
    [controls],
  );
  // A second finger zooms the camera instead (lib/touch).
  useEffect(
    () =>
      onSecondFinger(() => {
        if (!drag.current) return;
        drag.current = null;
        setDelta(null);
        holdCamera(controls, false);
      }),
    [controls],
  );

  if (!tower || paint) return null;
  const { width, depth, height, filaments } = tower;
  // Kept on the bed while it moves, the way the engine keeps it.
  const margin = EDGE + brimWidth;
  const clamp = (v: number, size: number, max: number) => Math.max(Math.min(v, max - size - margin), margin);
  const at = (d: [number, number] | null): [number, number] => [
    clamp(tower.x + (d?.[0] ?? 0), width, bed.x0 + bed.w),
    clamp(tower.y + (d?.[1] ?? 0), depth, bed.y0 + bed.d),
  ];
  const [x, y] = at(delta);
  const busy = tool === 'measure' || tool === 'assemble' || tool === 'cut' || tool === 'flatten';

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (busy || e.button !== 0 || twoFingers()) return;
    e.stopPropagation();
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(plane, hit)) return;
    drag.current = { start: hit };
    holdCamera(controls, true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(plane, hit)) return;
    setDelta([hit.x - drag.current.start.x, hit.y - drag.current.start.y]);
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    holdCamera(controls, false);
    if (delta && Math.hypot(delta[0], delta[1]) > 0.5) {
      const [nx, ny] = at(delta);
      useSlicer.getState().moveWipeTower(Math.round(nx * 100) / 100, Math.round(ny * 100) / 100);
    }
    setDelta(null);
  };

  const band = depth / filaments.length;
  const lit = hover || !!delta;
  return (
    <group name="wipe-tower">
      {/* keeps the drag going off the tower */}
      {delta && (
        <mesh position={[bed.x0 + bed.w / 2, bed.y0 + bed.d / 2, 0]} onPointerMove={onMove} onPointerUp={onUp}>
          <planeGeometry args={[bed.w * 4, bed.d * 4]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      <group position={[x, y, 0]} rotation={[0, 0, (tower.rotation * Math.PI) / 180]}>
        {filaments.map((f, i) => (
          <mesh
            key={`${f}-${i}`}
            position={[width / 2, band * (i + 0.5), height / 2]}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerOver={(e) => (e.stopPropagation(), setHover(true))}
            onPointerOut={() => setHover(false)}
            renderOrder={1}
          >
            <boxGeometry args={[width, band, height]} />
            <meshStandardMaterial
              color={colours[f - 1] ?? '#cccccc'}
              transparent
              opacity={0.66}
              depthWrite={false}
              roughness={0.6}
              emissive={lit ? '#2f6fe4' : '#000000'}
              emissiveIntensity={lit ? 0.35 : 0}
            />
          </mesh>
        ))}
        <Outline width={width} depth={depth} height={height} colour={lit ? '#4f8cff' : '#ffffff'} />
      </group>
    </group>
  );
}

/** The tower's edges, so it reads as one box whatever is behind it. */
function Outline({ width, depth, height, colour }: { width: number; depth: number; height: number; colour: string }) {
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(width, depth, height);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [width, depth, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} position={[width / 2, depth / 2, height / 2]} raycast={() => null}>
      <lineBasicMaterial color={colour} transparent opacity={0.7} />
    </lineSegments>
  );
}
