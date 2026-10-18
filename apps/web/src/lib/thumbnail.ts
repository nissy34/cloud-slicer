// Plate pictures for the G-code, drawn the way desktop Orca draws them
// (GLCanvas3D::render_thumbnail_internal): an orthographic camera from Orca's
// "iso" view, zoomed to the parts, the parts in their filament colours with
// Orca's thumbnail shader, on a transparent background, without the bed.
// Desktop renders with OpenGL while exporting; the wasm engine has no GL, so
// the page renders here and the engine's own G-code export encodes and places
// the pictures (see sliceWithConfig in engine/src/slice_api.cpp).
import * as THREE from 'three';
import type { PreviewMesh } from '../engine/protocol';
import { rgb } from './colour';

/** RGBA pixels, rows bottom to top (glReadPixels order, what Orca's encoders take). */
export interface Thumbnail {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * Sizes in an Orca `thumbnails` value ("48x48/PNG, 300x300/PNG"; the format
 * part is optional). Formats are the engine's business; it reads the same value.
 */
export function thumbnailSizes(value: string | undefined): { width: number; height: number }[] {
  const out: { width: number; height: number }[] = [];
  for (const part of String(value ?? '').split(/[,;]/)) {
    const m = /^\s*(\d+)\s*x\s*(\d+)/i.exec(part);
    if (!m) continue;
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (width > 0 && height > 0 && width <= 2048 && height <= 2048) out.push({ width, height });
  }
  return out;
}

// Orca's thumbnail shader (resources/shaders/140/thumbnail.vs/.fs): two
// directional lights fixed to the camera, a little specular and emission, and
// nothing below the plate.
const vertexShader = /* glsl */ `
  #define INTENSITY_CORRECTION 0.6
  const vec3 LIGHT_TOP_DIR = vec3(-0.4574957, 0.4574957, 0.7624929);
  #define LIGHT_TOP_DIFFUSE (0.8 * INTENSITY_CORRECTION)
  #define LIGHT_TOP_SPECULAR (0.125 * INTENSITY_CORRECTION)
  #define LIGHT_TOP_SHININESS 20.0
  const vec3 LIGHT_FRONT_DIR = vec3(0.6985074, 0.1397015, 0.6985074);
  #define LIGHT_FRONT_DIFFUSE (0.3 * INTENSITY_CORRECTION)
  #define INTENSITY_AMBIENT 0.3
  varying vec2 intensity;
  varying vec3 vColour;
  varying float worldZ;
  void main() {
    vec3 n = normalize(normalMatrix * normal);
    float NdotL = max(dot(n, LIGHT_TOP_DIR), 0.0);
    intensity.x = INTENSITY_AMBIENT + NdotL * LIGHT_TOP_DIFFUSE;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    intensity.y = LIGHT_TOP_SPECULAR * pow(max(dot(-normalize(p.xyz), reflect(-LIGHT_TOP_DIR, n)), 0.0), LIGHT_TOP_SHININESS);
    NdotL = max(dot(n, LIGHT_FRONT_DIR), 0.0);
    intensity.x += NdotL * LIGHT_FRONT_DIFFUSE;
    vColour = color;
    worldZ = (modelMatrix * vec4(position, 1.0)).z;
    gl_Position = projectionMatrix * p;
  }`;
const fragmentShader = /* glsl */ `
  varying vec2 intensity;
  varying vec3 vColour;
  varying float worldZ;
  void main() {
    if (worldZ < 0.0) discard;
    gl_FragColor = vec4(vec3(intensity.y) + vColour * (intensity.x + 0.1), 1.0);
  }`;

// adjust_color_for_rendering: black parts are drawn dark grey so they keep their shape.
const FULL_BLACK = 0.2;
function partColour(hex: string | undefined): [number, number, number] {
  const c = rgb(hex);
  return c.every((v) => v < FULL_BLACK) ? [FULL_BLACK, FULL_BLACK, FULL_BLACK] : c;
}

/** The plate's parts as one geometry, coloured per triangle by filament (as written, sRGB, like Orca). */
function plateGeometry(preview: PreviewMesh, colours: string[]): THREE.BufferGeometry {
  const palette = colours.map(partColour);
  const n = preview.filaments.length;
  const col = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const c = palette[(preview.filaments[t] || 1) - 1] ?? [0.8, 0.8, 0.8];
    for (let v = 0; v < 3; v++) col.set(c, t * 9 + v * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(preview.positions.subarray(0, n * 9), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// Camera::set_default_orientation: 45 degrees down, from the front left.
const ISO_DIR = new THREE.Vector3(-0.5, -0.5, Math.SQRT1_2);
const ISO_UP = new THREE.Vector3(0.5, 0.5, Math.SQRT1_2);

/** Orca's camera for a w x h picture of `box`: "iso" view, then zoom_to_box. */
export function thumbnailCamera(box: THREE.Box3, w: number, h: number): THREE.OrthographicCamera {
  // render_thumbnail_internal grows the parts' box by 1% per side from z = 0.
  const b = box.clone();
  b.min.z = 0;
  const size = b.getSize(new THREE.Vector3());
  b.expandByVector(size.multiplyScalar(0.01));
  const centre = b.getCenter(new THREE.Vector3());
  const forward = ISO_DIR.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, ISO_UP).normalize();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(centre);
    const x = v.dot(right), y = v.dot(ISO_UP);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // Camera::DefaultZoomToBoxMarginFactor
  const zoom = Math.min(w / ((maxX - minX) * 1.025 || 1), h / ((maxY - minY) * 1.025 || 1));
  const halfW = w / zoom / 2, halfH = h / zoom / 2;
  const radius = b.getSize(new THREE.Vector3()).length() + 10;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, radius * 4);
  cam.up.copy(ISO_UP);
  cam.position.copy(centre).addScaledVector(ISO_DIR, radius * 2);
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/**
 * Box-filters an RGBA image down by `factor` (supersampling). Colours are
 * averaged weighted by alpha, so part edges don't pick up the background.
 */
export function downsample(src: Uint8Array, w: number, h: number, factor: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const sw = w * factor;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * sw + x * factor + dx) * 4;
          const al = src[i + 3];
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al;
        }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / (factor * factor));
    }
  return out;
}

const SUPERSAMPLE = 3;
let renderer: THREE.WebGLRenderer | null = null;

/**
 * One picture per size of the plate's parts, or [] when there is nothing to
 * draw. Throws when the browser has no WebGL.
 */
export function renderThumbnails(preview: PreviewMesh | null, colours: string[], sizes: { width: number; height: number }[]): Thumbnail[] {
  if (!preview || preview.filaments.length === 0 || sizes.length === 0) return [];
  renderer ??= new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false, alpha: true });
  const geometry = plateGeometry(preview, colours);
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, vertexColors: true });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  try {
    return sizes.map(({ width, height }) => {
      const sw = width * SUPERSAMPLE, sh = height * SUPERSAMPLE;
      // A plain RGBA8 target: values go out as the shader wrote them, like Orca's framebuffer.
      const target = new THREE.WebGLRenderTarget(sw, sh, { depthBuffer: true });
      try {
        renderer!.setRenderTarget(target);
        renderer!.setClearColor(0x000000, 0);
        renderer!.clear();
        renderer!.render(scene, thumbnailCamera(geometry.boundingBox!, width, height));
        const big = new Uint8Array(sw * sh * 4);
        renderer!.readRenderTargetPixels(target, 0, 0, sw, sh, big);
        return { width, height, pixels: downsample(big, width, height, SUPERSAMPLE) };
      } finally {
        renderer!.setRenderTarget(null);
        target.dispose();
      }
    });
  } finally {
    geometry.dispose();
    material.dispose();
  }
}
