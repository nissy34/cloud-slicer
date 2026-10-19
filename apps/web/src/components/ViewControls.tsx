import { Bounds, useBounds } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import fitIcon from '../assets/orca-view/fit_camera.svg?raw';
import cubeIcon from '../assets/orca-view/menu_obj_cube.svg?raw';

export type View = 'fit' | 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/** Moves the camera of the 3D view it was handed to (CameraViews fills it in). */
export type ViewHandle = React.MutableRefObject<((view: View) => void) | null>;

// Desktop Orca's View menu and its number keys (Camera::select_view): Iso
// looks from the front left, Top has the front of the plate at the bottom of
// the screen, Bottom at the top. The tiny Y in Top and Bottom tells the
// camera which way is up when it looks straight down.
const VIEWS: { view: Exclude<View, 'fit'>; label: string; key: string; from: [number, number, number] }[] = [
  { view: 'iso', label: 'Iso', key: '0', from: [-0.5, -0.5, Math.SQRT1_2] },
  { view: 'top', label: 'Top', key: '1', from: [0, -1e-4, 1] },
  { view: 'bottom', label: 'Bottom', key: '2', from: [0, -1e-4, -1] },
  { view: 'front', label: 'Front', key: '3', from: [0, -1, 0] },
  { view: 'back', label: 'Back', key: '4', from: [0, 1, 0] },
  { view: 'left', label: 'Left', key: '5', from: [-1, 0, 0] },
  { view: 'right', label: 'Right', key: '6', from: [1, 0, 0] },
];

const Z_UP = new THREE.Vector3(0, 0, 1);

/**
 * Inside the 3D view's Canvas: points the camera at what box() returns (the
 * models, or the toolpaths) from one of the views, or keeps the direction and
 * fits it all on screen. drei's Bounds does the framing and the short camera
 * move, and redraws while it runs (the views draw on demand).
 */
export function CameraViews({ handle, box }: { handle: ViewHandle; box: () => THREE.Box3 }) {
  return (
    <Bounds margin={1.15} maxDuration={0.4}>
      <Views handle={handle} box={box} />
    </Bounds>
  );
}

function Views({ handle, box }: { handle: ViewHandle; box: () => THREE.Box3 }) {
  const bounds = useBounds();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as THREE.EventDispatcher<{ start: object }> | null;

  // Bounds tilts camera.up while it moves the camera; the controls orbit about
  // it, so a drag that cuts the move short puts it back to Z up.
  useEffect(() => {
    if (!controls) return;
    const up = () => void camera.up.copy(Z_UP);
    controls.addEventListener('start', up);
    return () => controls.removeEventListener('start', up);
  }, [controls, camera]);

  const go = (view: View) => {
    bounds.refresh(box());
    if (view === 'fit') return void bounds.reset();
    const { center, distance } = bounds.getSize();
    const from = new THREE.Vector3(...VIEWS.find((v) => v.view === view)!.from).normalize();
    bounds.moveTo(center.clone().addScaledVector(from, distance)).lookAt({ target: center, up: Z_UP });
  };
  useEffect(() => {
    handle.current = go;
    return () => void (handle.current = null);
  });

  // Desktop's keys: 0 to 6 for the views, Z to fit everything.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]') || e.altKey || e.ctrlKey || e.metaKey) return;
      const view = e.key.toUpperCase() === 'Z' ? 'fit' : VIEWS.find((v) => v.key === e.key)?.view;
      if (!view) return;
      e.preventDefault();
      handle.current?.(view);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handle]);
  return null;
}

// Desktop Orca's icons, in the page's text colour (the fit icon without its white disc).
const FIT = fitIcon.replace(/<circle[^>]*\/>/, '').replace(/#666666/g, 'currentColor');
const CUBE = cubeIcon.replace(/#949494/g, 'currentColor');

/**
 * The corner buttons over a 3D view: Fit all, which brings everything back on
 * screen from wherever the camera is, and a menu of the standard views.
 */
export function ViewButtons({ handle, className }: { handle: ViewHandle; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const go = (view: View) => {
    setOpen(false);
    handle.current?.(view);
  };
  return (
    <div className={className ? `view-buttons ${className}` : 'view-buttons'} ref={root}>
      {open && (
        <div className="view-menu" role="menu" aria-label="Views">
          {VIEWS.map((v) => (
            <button key={v.view} role="menuitem" title={`${v.label} view (${v.key})`} onClick={() => go(v.view)}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      <button
        className="view-button"
        aria-label="Views"
        title="Views: top, front, side..."
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="view-icon small" dangerouslySetInnerHTML={{ __html: CUBE }} />
      </button>
      <button className="view-button" aria-label="Fit all" title="Fit all: show everything (Z)" onClick={() => go('fit')}>
        <span className="view-icon" dangerouslySetInnerHTML={{ __html: FIT }} />
      </button>
    </div>
  );
}
