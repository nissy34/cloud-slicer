import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { PRINTER } from '../lib/presets';
import { useSlicer } from '../state/store';

const { x: BED_X, y: BED_Y } = PRINTER.bed;

// Printer coordinates are Z-up with the bed from (0,0) to (BED_X,BED_Y).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

function Bed() {
  const grid = useMemo(() => {
    const pts: number[] = [];
    for (let x = 0; x <= BED_X; x += 10) pts.push(x, 0, 0, x, BED_Y, 0);
    for (let y = 0; y <= BED_Y; y += 10) pts.push(0, y, 0, BED_X, y, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <group>
      <mesh position={[BED_X / 2, BED_Y / 2, -0.2]} receiveShadow>
        <planeGeometry args={[BED_X, BED_Y]} />
        <meshStandardMaterial color="#2b2f36" roughness={0.9} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color="#4a5160" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

function Model({ positions }: { positions: Float32Array }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }, [positions]);
  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color="#5b8def" roughness={0.55} metalness={0.05} />
    </mesh>
  );
}

export function Viewport() {
  const model = useSlicer((s) => s.model);
  return (
    <Canvas
      className="viewport"
      camera={{ position: [BED_X / 2, -BED_Y * 0.75, BED_Y * 0.8], fov: 40, near: 1, far: 5000 }}
      gl={{ antialias: true }}
      data-testid="viewport"
    >
      <color attach="background" args={['#16191e']} />
      <hemisphereLight args={['#ffffff', '#3a3f48', 0.9]} />
      <directionalLight position={[BED_X, -BED_Y, BED_Y * 2]} intensity={1.6} />
      <Bed />
      {model && <Model positions={model.positions} />}
      <OrbitControls target={[BED_X / 2, BED_Y / 2, 0]} makeDefault />
    </Canvas>
  );
}
