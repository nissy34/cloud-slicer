import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { hasPlateSettings } from '../lib/plate-settings';
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

// Desktop's plate icons (resources/images/plate_*.svg, AGPL-3.0 like this app).
// Their light grey and dark grey become the page's panel and text colours.
const PLATE_ICONS = import.meta.glob<string>('../assets/orca-plate/*.svg', { query: '?raw', import: 'default', eager: true });
const plateIcon = (name: string) =>
  (PLATE_ICONS[`../assets/orca-plate/${name}.svg`] ?? '')
    .replace(/<\?xml[^>]*>/, '')
    .replace(/#e9e9e9/gi, 'var(--surface)')
    .replace(/#545454/gi, 'currentColor')
    .replace(/ width="43" height="43"/, '');

/**
 * Desktop's icons beside the shown plate (PartPlate::render_icons): delete
 * plate, arrange, auto orient, plate settings (orange when the plate has
 * settings of its own) and rename. Hidden while a tool is open.
 */
export function PlateIcons({ w, d }: { w: number; d: number }) {
  const show = useSlicer((s) => !!s.project && !s.tool && !s.paint);
  const plates = useSlicer((s) => s.project?.plates.length ?? 1);
  const plate = useSlicer((s) => s.plate);
  const empty = useSlicer((s) => !s.project?.plates[s.plate]?.objects.length);
  const own = useSlicer((s) => hasPlateSettings(s.project?.plates[s.plate]?.settings));
  if (!show) return null;
  const s = useSlicer.getState();
  const icon = (name: string, label: string, title: string, onClick: () => void, disabled = false) => (
    <button key={name} type="button" className="plate-icon" aria-label={label} title={title} disabled={disabled} onClick={onClick} dangerouslySetInnerHTML={{ __html: plateIcon(name) }} />
  );
  return (
    <Html position={[w, d, 0]} zIndexRange={[3, 0]}>
      <div className="plate-icons" role="group" aria-label={`Plate ${plate + 1} icons`} onContextMenu={(e) => e.preventDefault()}>
        {plates > 1 && icon('plate_close', 'Delete plate', 'Delete this plate and what is on it', () => void s.deletePlate())}
        {icon('plate_arrange', 'Arrange plate', empty ? 'Nothing on this plate yet' : 'Lay out the objects on this plate', () => void s.arrange(), empty)}
        {icon('plate_orient', 'Auto orient plate', empty ? 'Nothing on this plate yet' : 'Turn every object on this plate to print with the least overhang', () => void s.orient(), empty)}
        {icon(
          own ? 'plate_settings_changed' : 'plate_settings',
          `Plate ${plate + 1} settings`,
          own ? "Plate settings: this plate has settings of its own" : "Plate settings: plate type, print sequence, spiral vase, filament order",
          () => s.openPlateSettings(true),
        )}
        {icon('plate_name_edit', 'Rename plate', 'Rename this plate', () => s.openPlateSettings(true))}
      </div>
    </Html>
  );
}
