import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { hasPlateSettings } from '../lib/plate-settings';
import { useTheme } from '../lib/theme';
import { useSlicer } from '../state/store';


// Desktop's plate icons (resources/images/plate_*.svg, AGPL-3.0 like this
// app), each with its dark-theme and hover pictures.
const URLS = import.meta.glob<string>('../assets/orca-plate/*.svg', { query: '?url', import: 'default', eager: true });
const url = (name: string) => URLS[`../assets/orca-plate/${name}.svg`];

/** An icon picture as a texture, drawn large enough to stay sharp up close. */
function useIconTexture(name: string) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      c.getContext('2d')!.drawImage(img, 0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      setTexture(t);
    };
    img.src = url(name) ?? '';
    return () => {
      live = false;
    };
  }, [name]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

interface IconDef {
  id: string;
  image: string;
  /** Top left corner on the plate, and the side, in mm. */
  at: [number, number];
  size: number;
  label: string;
  title: string;
  run(): void;
  disabled?: boolean;
}

function Icon({ def }: { def: IconDef }) {
  const dark = useTheme() === 'dark';
  const canvas = useThree((s) => s.gl.domElement);
  const [hover, setHover] = useState(false);
  const name = `${def.image}${hover && !def.disabled ? '_hover' : ''}${dark ? '_dark' : ''}`;
  const texture = useIconTexture(name);
  // The pointer leaving with the icon gone mid-hover.
  useEffect(
    () => () => {
      canvas.style.cursor = '';
      canvas.removeAttribute('title');
    },
    [canvas],
  );
  if (!texture) return null;
  const over = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(on);
    canvas.style.cursor = on && !def.disabled ? 'pointer' : '';
    if (on) canvas.title = def.title;
    else canvas.removeAttribute('title');
  };
  const { at, size } = def;
  return (
    <mesh
      position={[at[0] + size / 2, at[1] - size / 2, 0.02]}
      onPointerOver={over(true)}
      onPointerOut={over(false)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta > 6 || def.disabled || e.button !== 0) return;
        def.run();
      }}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={texture} transparent opacity={def.disabled ? 0.4 : 1} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** A line of bold text as a texture, in desktop's orange (it reads on the bed's dark frame and on the floor); aspect is width / height. */
function useTextTexture(text: string) {
  const made = useMemo(() => {
    const px = 96;
    const font = `600 ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    g.font = font;
    c.width = Math.max(1, Math.ceil(g.measureText(text).width) + 8);
    c.height = Math.round(px * 1.25);
    g.font = font;
    g.fillStyle = '#f2754e';
    g.textBaseline = 'middle';
    g.fillText(text, 4, c.height / 2);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { texture, aspect: c.width / c.height };
  }, [text]);
  useEffect(() => () => made.texture.dispose(), [made]);
  return made;
}

/** Flat text on the bed: x, y is its bottom left corner, height its height, in mm. */
function FlatText({ texture, aspect, x, y, height }: { texture: THREE.Texture; aspect: number; x: number; y: number; height: number }) {
  const width = height * aspect;
  return (
    <mesh position={[x + width / 2, y + height / 2, 0.02]} raycast={() => null}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** How far desktop's plate furniture reaches past the plate, in mm: right (icons, number) and back (name). */
export const iconsReach = (d: number) => (19 * d) / 200;
export const nameReach = (d: number) => (10 * d) / 200;

/**
 * What desktop draws on the bed around the shown plate (PartPlate::render_icons),
 * sized to the plate (factor = depth / 200, so 16 mm icons on a 200 mm deep
 * plate):
 * - a column past the back right corner, in desktop's slots: delete plate
 *   (with more than one plate), auto orient, arrange this plate, lock (Arrange
 *   and Auto orient then leave the plate alone), plate settings (orange when
 *   the plate has settings of its own); desktop's last slot, move plate to
 *   the front, is left out;
 * - the plate's number past the front right corner;
 * - the plate's name past the back left corner, with the rename pencil after it.
 * The icons hide while a tool is open; the name and number stay.
 */
export function PlateIcons({ w, d }: { w: number; d: number }) {
  const show = useSlicer((s) => !!s.project && !s.tool && !s.paint);
  const hasProject = useSlicer((s) => !!s.project);
  const plates = useSlicer((s) => s.project?.plates.length ?? 1);
  const plate = useSlicer((s) => s.plate);
  const name = useSlicer((s) => s.project?.plates[s.plate]?.name ?? '');
  const empty = useSlicer((s) => !s.project?.plates[s.plate]?.objects.length);
  const own = useSlicer((s) => hasPlateSettings(s.project?.plates[s.plate]?.settings));
  const locked = useSlicer((s) => !!s.project?.plates[s.plate]?.locked);
  const factor = d / 200;
  const size = 16 * factor;
  const nameH = 9 * factor;
  const title = useTextTexture(name || 'Untitled');
  const number = useTextTexture(String(plate + 1).padStart(2, '0'));

  const icons = useMemo(() => {
    const s = useSlicer.getState();
    const nothing = 'Nothing on this plate yet';
    const off = empty ? nothing : locked ? 'This plate is locked' : undefined;
    // Desktop's slot k: 3 mm right of the plate, 3 mm down from its back edge, 16 mm icons 5 mm apart (all scaled).
    const slot = (k: number): [number, number] => [w + 3 * factor, d - 3 * factor - k * (size + 5 * factor)];
    const list: IconDef[] = [
      { id: 'delete', image: 'plate_close', at: slot(0), size, label: 'Delete plate', title: 'Remove this plate and what is on it (not the last one)', run: () => void s.deletePlate() },
      { id: 'orient', image: 'plate_orient', at: slot(1), size, label: 'Auto orient plate', title: off ?? 'Auto orient the objects on this plate', run: () => void s.orient(), disabled: !!off },
      { id: 'arrange', image: 'plate_arrange', at: slot(2), size, label: 'Arrange plate', title: off ?? 'Arrange the objects on this plate (Shift+A)', run: () => void s.arrange(), disabled: !!off },
      {
        id: 'lock',
        image: locked ? 'plate_locked' : 'plate_unlocked',
        at: slot(3),
        size,
        label: locked ? 'Unlock plate' : 'Lock plate',
        title: locked ? 'Unlock this plate' : 'Lock this plate: Arrange and Auto orient leave it as it is',
        run: () => void s.lockPlate(!locked),
      },
      {
        id: 'settings',
        image: own ? 'plate_settings_changed' : 'plate_settings',
        at: slot(4),
        size,
        label: `Plate ${plate + 1} settings`,
        title: own ? 'Plate settings: this plate has settings of its own' : 'Plate settings: plate type, print sequence, spiral vase, filament order',
        run: () => s.openPlateSettings(true),
      },
      // Right after the name, as tall as it (desktop: 9 mm, 1 mm off the plate's back edge).
      { id: 'rename', image: 'plate_name_edit', at: [nameH * title.aspect, d + factor + nameH], size: nameH, label: 'Rename plate', title: 'Rename this plate', run: () => s.openPlateSettings(true) },
    ];
    return list.filter((i) => i.id !== 'delete' || plates > 1);
  }, [empty, own, locked, plate, plates, w, d, factor, size, nameH, title.aspect]);

  // Where each icon is on screen, and the shown name, for the browser tests (data-plate-icons / data-plate-name on the canvas).
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const last = useRef('');
  useFrame(() => {
    if (!show) return;
    const r = canvas.getBoundingClientRect();
    const at = Object.fromEntries(
      icons.map((i) => {
        const p = new THREE.Vector3(i.at[0] + i.size / 2, i.at[1] - i.size / 2, 0).project(camera);
        return [i.label, [Math.round(r.left + ((p.x + 1) / 2) * r.width), Math.round(r.top + ((1 - p.y) / 2) * r.height)]];
      }),
    );
    const text = JSON.stringify(at);
    if (text !== last.current) canvas.dataset.plateIcons = last.current = text;
  });
  useEffect(
    () => () => {
      delete canvas.dataset.plateIcons;
      last.current = '';
    },
    [canvas, show],
  );
  useEffect(() => {
    if (hasProject) canvas.dataset.plateName = name;
    return () => void delete canvas.dataset.plateName;
  }, [canvas, hasProject, name]);

  if (!hasProject) return null;
  return (
    <group>
      <FlatText {...title} x={0} y={d + factor} height={nameH} />
      {/* Desktop: a 16 mm tile 3 mm right of the plate, the digits 1 mm in from each side. */}
      <FlatText {...number} x={w + 4 * factor} y={factor} height={14 * factor} />
      {show && icons.map((i) => <Icon key={i.id} def={i} />)}
    </group>
  );
}
