// Pictures of the 3D view for saved projects: the plate thumbnail inside the
// 3MF (RGBA pixels) and the small picture shown in the Projects list (kept in
// the database row, so WebP: about 15 KB; browsers that can't make WebP give PNG). The Prepare view
// registers how to take one while it is on screen.

export interface Snapshot {
  /** RGBA, rows top first. */
  pixels: Uint8Array;
  width: number;
  height: number;
  /** The list picture: WebP, or PNG where the browser can't make WebP. */
  picture: Blob;
}

type Capture = () => HTMLCanvasElement | null;
let capture: Capture | null = null;

/** The Prepare view: renders the scene now and returns its canvas (null when it can't). */
export function setCapture(fn: Capture | null) {
  capture = fn;
}

/** A square picture of the middle of the 3D view, `size` px, or null when the view isn't on screen. */
export async function snapshot(size = 256): Promise<Snapshot | null> {
  const source = capture?.();
  if (!source || !source.width || !source.height) return null;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  // Read right after the render: without preserveDrawingBuffer the WebGL
  // canvas is only guaranteed to hold the frame until the task ends.
  const side = Math.min(source.width, source.height);
  ctx.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, size, size);
  const pixels = new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
  const picture = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/webp', 0.85));
  return picture ? { pixels, width: size, height: size, picture } : null;
}
