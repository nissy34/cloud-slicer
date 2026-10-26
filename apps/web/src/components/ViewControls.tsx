import { Bounds, useBounds } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import fitIcon from '../assets/orca-view/fit_camera.svg?raw';
import cubeIcon from '../assets/orca-view/menu_obj_cube.svg?raw';
import { Menu } from './Menu';

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
 * fits it all on screen. drei's Bounds does the short camera move.
 */
export function CameraViews({ handle, box }: { handle: ViewHandle; box: () => THREE.Box3 }) {
  return (
    <Bounds maxDuration={0.4}>
      <Views handle={handle} box={box} />
    </Bounds>
  );
}

function Views({ handle, box }: { handle: ViewHandle; box: () => THREE.Box3 }) {
  const bounds = useBounds();
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
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
    // The whole box in sight from any side: its bounding sphere fits the
    // narrower of the two fields of view. (Bounds' own fit is too tight for
    // a tall model, or a phone held upright.)
    const b = box();
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    const cam = camera as THREE.PerspectiveCamera;
    const vertical = THREE.MathUtils.degToRad(cam.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * cam.aspect);
    const distance = (Math.max(sphere.radius, 5) / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? sphere.center;
    const from =
      view === 'fit'
        ? camera.position.clone().sub(target).normalize()
        : new THREE.Vector3(...VIEWS.find((v) => v.view === view)!.from).normalize();
    bounds.refresh(b).moveTo(sphere.center.clone().addScaledVector(from, distance)).lookAt({ target: sphere.center, up: Z_UP });
    // Bounds moves the camera frame by frame, and this view only draws on demand.
    invalidate();
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
  const go = (view: View) => handle.current?.(view);
  return (
    <div className={className ? `view-buttons ${className}` : 'view-buttons'}>
      <Menu
        label="Views"
        placement="left-end"
        className="view-menu"
        button={(props) => (
          <button {...props} className="view-button" aria-label="Views" title="Views: top, front, side...">
            <span className="view-icon small" dangerouslySetInnerHTML={{ __html: CUBE }} />
          </button>
        )}
      >
        {(close) =>
          VIEWS.map((v) => (
            <button
              key={v.view}
              className="menu-item"
              role="menuitem"
              title={`${v.label} view (${v.key})`}
              onClick={() => {
                close();
                go(v.view);
              }}
            >
              {v.label}
            </button>
          ))
        }
      </Menu>
      <button className="view-button" aria-label="Fit all" title="Fit all: show everything (Z)" onClick={() => go('fit')}>
        <span className="view-icon" dangerouslySetInnerHTML={{ __html: FIT }} />
      </button>
    </div>
  );
}
