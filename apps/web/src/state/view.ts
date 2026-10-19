// The 3D view's camera, for tools that place things where the user is
// looking (the Text tool puts new text on the surface facing the camera).
let cameraAt: (() => [number, number, number]) | null = null;

export function setCameraSource(source: (() => [number, number, number]) | null) {
  cameraAt = source;
}

/** The camera's position in plate coordinates, while the 3D view is open. */
export function cameraPosition(): [number, number, number] | undefined {
  return cameraAt?.() ?? undefined;
}
