// Fingers on the screen, for the 3D views: two fingers always turn, zoom and
// pan the camera, whatever is under them. A one-finger press on an object
// starts moving it (or painting, or a long press for its menu); when a second
// finger lands, whatever that first finger started gives way to the camera.
//
// The listeners are on window in the capture phase, so they hear about each
// finger before the 3D view's own handlers (and the camera controls) do.

const fingers = new Set<number>();
const secondFinger = new Set<() => void>();
const allUp = new Set<() => void>();
// Whether the touch going on now has had two fingers down at some point; its
// last finger lifting can still look like a tap to the 3D view.
let pinched = false;

function down(e: PointerEvent) {
  if (e.pointerType !== 'touch' || fingers.size === 0) pinched = false;
  if (e.pointerType !== 'touch') return;
  fingers.add(e.pointerId);
  if (fingers.size === 2) {
    pinched = true;
    secondFinger.forEach((l) => l());
  }
}
function up(e: PointerEvent) {
  if (!fingers.delete(e.pointerId) || fingers.size) return;
  allUp.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}

/** Whether this touch is (or was, until every finger lifts and a new touch starts) a two-finger one. */
export function twoFingers(): boolean {
  return pinched;
}

/** Calls back when a second finger lands; returns the unsubscribe. */
export function onSecondFinger(listener: () => void): () => void {
  secondFinger.add(listener);
  return () => void secondFinger.delete(listener);
}

/** Calls back when the last finger lifts; returns the unsubscribe. */
export function onFingersUp(listener: () => void): () => void {
  allUp.add(listener);
  return () => void allUp.delete(listener);
}

/** The bits of drei's OrbitControls the views switch. */
export interface CameraControls {
  enabled: boolean;
  enableRotate: boolean;
  enablePan: boolean;
}

/**
 * Holds the camera still while one finger (or the mouse) drags something in
 * the view. Turning the controls off instead would make them miss that finger,
 * and a second finger would then turn the camera instead of zooming it.
 */
export function holdCamera(controls: CameraControls | null, hold: boolean) {
  if (!controls) return;
  controls.enableRotate = !hold;
  controls.enablePan = !hold;
}
