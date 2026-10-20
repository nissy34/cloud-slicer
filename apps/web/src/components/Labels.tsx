import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useSlicer } from '../state/store';

/**
 * Desktop's Show labels (GLCanvas3D::Labels): each object's name over the
 * middle of its copy on the shown plate, "(2)" and so on after the name when it
 * has several copies. Hidden while a tool is open, like desktop.
 */
export function ObjectLabels({ parts }: { parts: { object: number; geometry: THREE.BufferGeometry }[] }) {
  const show = useSlicer((s) => s.labels && !s.tool && !s.paint);
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  if (!show || !project) return null;
  return (
    <>
      {parts.flatMap(({ object, geometry }) => {
        const obj = project.objects[object];
        const box = geometry.boundingBox;
        if (!obj || !box) return [];
        const here = obj.instances.map((inst, i) => ({ inst, i })).filter(({ inst }) => inst.plate === plate);
        const middle = box.getCenter(new THREE.Vector3());
        return here.map(({ inst, i }) => {
          // The object's geometry holds all its copies on the plate; one copy is its middle.
          const at: [number, number, number] = here.length === 1 ? [middle.x, middle.y, middle.z] : [inst.offset[0], inst.offset[1], middle.z];
          return (
            <Html key={`${object}-${i}`} position={at} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
              <div className="object-label">{obj.instances.length > 1 ? `${obj.name} (${i + 1})` : obj.name}</div>
            </Html>
          );
        });
      })}
    </>
  );
}

/** The shown plate's name, on the plate past its back left corner, like desktop draws it. */
export function PlateName({ d }: { d: number }) {
  const name = useSlicer((s) => s.project?.plates[s.plate]?.name ?? '');
  if (!name) return null;
  return (
    <Html position={[0, d, 0]} zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
      <div className="plate-name">{name}</div>
    </Html>
  );
}
