// Plate pictures for the G-code (what the printer's screen and file list show),
// drawn without a GPU. The site draws them with WebGL (apps/web/src/lib/thumbnail.ts,
// Orca's own camera and thumbnail shader); Node has no WebGL that three.js still
// supports (headless-gl is WebGL 1 only), so this draws the same picture on the
// processor: the site's camera and colours, and the shader's lighting worked out
// per corner and blended across each triangle the way a GPU does. Keep the
// lighting numbers in step with the shader in thumbnail.ts.
import * as THREE from 'three';
import { SUPERSAMPLE, downsample, partColour, thumbnailCamera, type Thumbnail } from '../../web/src/lib/thumbnail';

export interface PlateMesh {
  positions: Float32Array;
  filaments: Uint8Array;
}

// Orca's thumbnail shader (resources/shaders/140/thumbnail.vs/.fs).
const INTENSITY_CORRECTION = 0.6;
const LIGHT_TOP_DIR = new THREE.Vector3(-0.4574957, 0.4574957, 0.7624929);
const LIGHT_TOP_DIFFUSE = 0.8 * INTENSITY_CORRECTION;
const LIGHT_TOP_SPECULAR = 0.125 * INTENSITY_CORRECTION;
const LIGHT_TOP_SHININESS = 20;
const LIGHT_FRONT_DIR = new THREE.Vector3(0.6985074, 0.1397015, 0.6985074);
const LIGHT_FRONT_DIFFUSE = 0.3 * INTENSITY_CORRECTION;
const INTENSITY_AMBIENT = 0.3;

/** One picture per size of the plate's parts, or [] when there is nothing to draw. */
export function drawThumbnails(mesh: PlateMesh | null, colours: string[], sizes: { width: number; height: number }[]): Thumbnail[] {
  if (!mesh || mesh.filaments.length === 0 || sizes.length === 0) return [];
  const n = mesh.filaments.length;
  const box = new THREE.Box3().setFromArray(mesh.positions.subarray(0, n * 9));
  const palette = colours.map(partColour);
  return sizes.map(({ width, height }) => {
    const sw = width * SUPERSAMPLE, sh = height * SUPERSAMPLE;
    const big = draw(mesh, n, palette, thumbnailCamera(box, width, height), sw, sh);
    return { width, height, pixels: downsample(big, width, height, SUPERSAMPLE) };
  });
}

function draw(mesh: PlateMesh, n: number, palette: [number, number, number][], cam: THREE.OrthographicCamera, w: number, h: number): Uint8Array {
  const view = cam.matrixWorldInverse;
  const toClip = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, view);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(view);
  const pixels = new Uint8Array(w * h * 4);
  const depth = new Float32Array(w * h).fill(Infinity);
  const p = mesh.positions;
  const world = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const screen = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const eye = new THREE.Vector3();
  const reflect = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const diffuse = [0, 0, 0], specular = [0, 0, 0];
  for (let t = 0; t < n; t++) {
    for (let v = 0; v < 3; v++) world[v].fromArray(p, t * 9 + v * 3);
    // computeVertexNormals on separate triangles: each corner gets the face's normal.
    normal.crossVectors(e1.subVectors(world[1], world[0]), e2.subVectors(world[2], world[0]));
    if (normal.lengthSq() === 0) continue;
    normal.applyMatrix3(normalMatrix).normalize();
    for (let v = 0; v < 3; v++) {
      screen[v].copy(world[v]).applyMatrix4(toClip);
      screen[v].set(((screen[v].x + 1) / 2) * w, ((screen[v].y + 1) / 2) * h, screen[v].z);
      // The vertex shader's two lights, per corner.
      eye.copy(world[v]).applyMatrix4(view);
      let d = INTENSITY_AMBIENT + Math.max(normal.dot(LIGHT_TOP_DIR), 0) * LIGHT_TOP_DIFFUSE;
      reflect.copy(LIGHT_TOP_DIR).negate().reflect(normal);
      specular[v] = LIGHT_TOP_SPECULAR * Math.pow(Math.max(eye.normalize().negate().dot(reflect), 0), LIGHT_TOP_SHININESS);
      d += Math.max(normal.dot(LIGHT_FRONT_DIR), 0) * LIGHT_FRONT_DIFFUSE;
      diffuse[v] = d;
    }
    const [a, b, c] = screen;
    // three.js draws front faces only (counter-clockwise on screen).
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (area <= 0) continue;
    const colour = palette[(mesh.filaments[t] || 1) - 1] ?? [0.8, 0.8, 0.8];
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        // Barycentric weights from edge functions; a pixel centre on an edge counts once.
        const wa = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        const wb = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        const wc = 1 - wa - wb;
        if (wa < 0 || wb < 0 || wc < 0) continue;
        const z = wa * a.z + wb * b.z + wc * c.z;
        const i = y * w + x;
        if (z >= depth[i] || z < -1 || z > 1) continue;
        // The fragment shader leaves out anything below the plate.
        if (wa * world[0].z + wb * world[1].z + wc * world[2].z < 0) continue;
        depth[i] = z;
        const lit = wa * diffuse[0] + wb * diffuse[1] + wc * diffuse[2] + 0.1;
        const spec = wa * specular[0] + wb * specular[1] + wc * specular[2];
        const o = i * 4;
        for (let k = 0; k < 3; k++) pixels[o + k] = Math.round(Math.min(1, Math.max(0, spec + colour[k] * lit)) * 255);
        pixels[o + 3] = 255;
      }
    }
  }
  return pixels;
}
