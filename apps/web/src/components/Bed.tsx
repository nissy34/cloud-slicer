import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { bedFiles, bedModelOffset, bedVendor, bounds, decodeBedMesh, gridLines, parsePoints, texturePolygon, textureSize, type BedFiles, type Point } from '../lib/bed';
import { useSceneColours } from '../lib/theme';
import { useOption, useSlicer } from '../state/store';

/** The selected printer's bed files (lib/bed.ts), null while unknown or when its brand ships none. */
function useBedFiles(): { files: BedFiles | null; bambu: boolean } {
  const flavor = useSlicer((s) => s.flavor);
  const catalog = useSlicer((s) => s.catalog);
  const printer = useSlicer((s) => s.selection?.printer);
  const printers = useSlicer((s) => s.printers);
  const model = useOption('printer_model');
  const vendor = useMemo(() => bedVendor(catalog, printer, printers, model), [catalog, printer, printers, model]);
  const [files, setFiles] = useState<{ key: string; files: BedFiles | null }>({ key: '', files: null });
  const key = `${flavor}/${vendor?.id}/${model}`;
  useEffect(() => {
    if (!vendor || !model) return;
    let live = true;
    bedFiles(flavor, vendor, model).then((f) => live && setFiles({ key, files: f }));
    return () => {
      live = false;
    };
  }, [flavor, vendor, model, key]);
  return { files: files.key === key ? files.files : null, bambu: vendor?.id === 'BBL' };
}

/** A flat shape on the plate, its texture coordinates spread over `uvArea`'s box. */
function flatShape(pts: Point[], uvArea: Point[] = pts): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
  const b = bounds(uvArea);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - b.minX) / (b.maxX - b.minX || 1);
    uv[i * 2 + 1] = (pos.getY(i) - b.minY) / (b.maxY - b.minY || 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function linesOf(flat: number[], z: number): THREE.BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < flat.length; i += 4) pts.push(flat[i], flat[i + 1], z, flat[i + 2], flat[i + 3], z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** The bed picture drawn at the bed's proportions (2048 px on its long side, 1024 on a phone), as a texture. */
function useBedTexture(url: string | undefined, area: Point[]): THREE.Texture | null {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const areaKey = area.join(' ');
  useEffect(() => {
    setTexture(null);
    if (!url) return;
    let live = true;
    let made: THREE.Texture | null = null;
    const img = new Image();
    img.src = url;
    img
      .decode()
      .then(() => {
        if (!live) return;
        const phone = matchMedia('(pointer: coarse)').matches;
        const [w, h] = textureSize(area, Math.min(gl.capabilities.maxTextureSize, phone ? 1024 : 2048));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        made = new THREE.CanvasTexture(canvas);
        made.colorSpace = THREE.SRGBColorSpace;
        made.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        setTexture(made);
        invalidate();
      })
      .catch(() => {
        // An unreadable picture leaves the plain plate.
      });
    return () => {
      live = false;
      made?.dispose();
    };
    // `area` is keyed by its text.
  }, [url, areaKey, gl, invalidate]);
  return texture;
}

/** The bed's 3D shape, or null. */
function useBedModel(url: string | undefined): THREE.BufferGeometry | null {
  const invalidate = useThree((s) => s.invalidate);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    setGeometry(null);
    if (!url) return;
    let live = true;
    let made: THREE.BufferGeometry | null = null;
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => {
        if (!live) return;
        const { positions, index } = decodeBedMesh(buf);
        made = new THREE.BufferGeometry();
        made.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        made.setIndex(new THREE.BufferAttribute(index, 1));
        made.computeBoundingBox();
        setGeometry(made);
        invalidate();
      })
      .catch(() => {
        // No shape: the plate alone, as for a printer without one.
      });
    return () => {
      live = false;
      made?.dispose();
    };
  }, [url, invalidate]);
  return geometry;
}

/** Desktop's coordinate arrows at the origin: X red, Y green, Z blue. */
function Axes({ length }: { length: number }) {
  const arrows: [string, [number, number, number]][] = [
    ['#bf0000', [0, 0, -Math.PI / 2]],
    ['#00bf00', [0, 0, 0]],
    ['#0000bf', [Math.PI / 2, 0, 0]],
  ];
  return (
    <group name="bed-axes">
      {arrows.map(([colour, rotation]) => (
        <group key={colour} rotation={rotation}>
          <mesh position={[0, length / 2, 0]}>
            <cylinderGeometry args={[0.5, 0.5, length, 12]} />
            <meshStandardMaterial color={colour} roughness={0.6} />
          </mesh>
          <mesh position={[0, length + 2.5, 0]}>
            <coneGeometry args={[1.25, 5, 16]} />
            <meshStandardMaterial color={colour} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * The plate as desktop draws it: the printer's bed shape below, the plate in
 * the printable area's outline with the brand's picture over it, desktop's grid
 * (bold every fifth line), the exclusion areas and the origin arrows. A printer
 * whose brand ships no bed shows the plain plate and grid.
 */
export function Bed() {
  const scene = useSceneColours();
  const areaText = useOption('printable_area');
  const excludeText = useOption('bed_exclude_area');
  const height = Number(useOption('printable_height')) || 0;
  const area = useMemo(() => {
    const pts = parsePoints(areaText);
    return pts.length >= 3 ? pts : ([[0, 0], [270, 0], [270, 270], [0, 270]] as Point[]);
  }, [areaText]);
  const exclude = useMemo(() => parsePoints(excludeText), [excludeText]);
  const { files, bambu } = useBedFiles();
  const sheet = useMemo(() => texturePolygon(area, bambu), [area, bambu]);
  const texture = useBedTexture(files?.texture, sheet);
  const model = useBedModel(files?.model);

  const plate = useMemo(() => flatShape(area), [area]);
  const picture = useMemo(() => flatShape(sheet), [sheet]);
  const excluded = useMemo(() => (exclude.length >= 3 ? flatShape(exclude) : null), [exclude]);
  const grid = useMemo(() => {
    const { thin, bold } = gridLines(area);
    return { thin: linesOf(thin, 0), bold: linesOf(bold, 0) };
  }, [area]);
  useEffect(
    () => () => [plate, picture, excluded, grid.thin, grid.bold].forEach((g) => g?.dispose()),
    [plate, picture, excluded, grid],
  );

  // Tests read which bed is drawn from the canvas.
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    const name = (url?: string) => url?.split('?')[0].split('/').pop() ?? '';
    canvas.dataset.bedTexture = texture ? name(files?.texture) : '';
    canvas.dataset.bedModel = model ? name(files?.model) : '';
  }, [canvas, texture, model, files]);

  const b = bounds(area);
  const axis = 0.1 * Math.max(b.maxX - b.minX, b.maxY - b.minY, height);
  const offset = model ? bedModelOffset(area, model.boundingBox?.max.z ?? 0) : null;
  return (
    <group name="bed">
      {model && offset && (
        <mesh geometry={model} position={offset}>
          <meshStandardMaterial color={scene.bedModel} roughness={0.8} flatShading />
        </mesh>
      )}
      <mesh geometry={plate} position={[0, 0, -0.2]} receiveShadow>
        <meshStandardMaterial color={scene.bed} roughness={0.9} />
      </mesh>
      {texture && (
        <mesh geometry={picture} position={[0, 0, -0.1]} renderOrder={-1}>
          <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {excluded && (
        <mesh geometry={excluded} position={[0, 0, -0.05]}>
          <meshBasicMaterial color={scene.exclude} transparent opacity={0.7} depthWrite={false} />
        </mesh>
      )}
      <lineSegments geometry={grid.thin}>
        <lineBasicMaterial color={scene.grid} transparent opacity={0.45} />
      </lineSegments>
      <lineSegments geometry={grid.bold}>
        <lineBasicMaterial color={scene.grid} transparent opacity={0.9} />
      </lineSegments>
      {axis > 0 && <Axes length={axis} />}
    </group>
  );
}
