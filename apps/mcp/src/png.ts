// A plate picture as a PNG: what plate_picture hands Claude, and an online
// project's list picture (projects.ts).
import { PNG } from 'pngjs';

/** A plate picture (rows bottom to top, like OpenGL) as a PNG on a white ground. */
export function pngOf({ width, height, pixels }: { width: number; height: number; pixels: Uint8Array }) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = ((height - 1 - y) * width + x) * 4, o = (y * width + x) * 4;
      const a = pixels[i + 3] / 255;
      for (let k = 0; k < 3; k++) png.data[o + k] = Math.round(pixels[i + k] * a + 255 * (1 - a));
      png.data[o + 3] = 255;
    }
  return PNG.sync.write(png);
}
