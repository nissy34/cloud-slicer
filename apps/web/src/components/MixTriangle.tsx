import { useEffect, useRef } from 'react';
import { barycentric, triangleCorners, triangleWeights, trianglePoint, type Point } from '../lib/mixing';
import { Swatch } from './Swatch';

const SIZE = 160;
/** Arrow keys move the point this far (px). */
const STEP = 4;

/**
 * Desktop's Mixing Ratio triangle for three filaments: each corner is one
 * filament, the colour inside blends them, and dragging the white ring sets
 * how much of each goes in (10% to 90% each).
 */
export function MixTriangle({ filaments, colours, weights, onChange }: { filaments: number[]; colours: string[]; weights: number[]; onChange: (weights: number[]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const corners = triangleCorners(SIZE);
  const tri = filaments.map((f) => colours[f - 1] ?? '#808080');
  const key = tri.join();

  // Plain RGB blend of the three corners, like desktop's fill.
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
    c.width = c.height = SIZE * scale;
    const img = ctx.createImageData(c.width, c.height);
    const rgb = tri.map(hexRgb);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const w = barycentric({ x: (x + 0.5) / scale, y: (y + 0.5) / scale }, corners);
        if (w[0] < -0.001 || w[1] < -0.001 || w[2] < -0.001) continue;
        const i = (y * c.width + x) * 4;
        for (let ch = 0; ch < 3; ch++) img.data[i + ch] = w[0] * rgb[0][ch] + w[1] * rgb[1][ch] + w[2] * rgb[2][ch];
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    // corners never change; the colours do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const toLocal = (e: React.PointerEvent): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * SIZE) / r.width, y: ((e.clientY - r.top) * SIZE) / r.height };
  };
  const drag = (e: React.PointerEvent) => onChange(triangleWeights(toLocal(e), corners));
  const handle = trianglePoint(weights, corners);
  const onKey = (e: React.KeyboardEvent) => {
    const d: Record<string, Point> = { ArrowUp: { x: 0, y: -STEP }, ArrowDown: { x: 0, y: STEP }, ArrowLeft: { x: -STEP, y: 0 }, ArrowRight: { x: STEP, y: 0 } };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    onChange(triangleWeights({ x: handle.x + m.x, y: handle.y + m.y }, corners));
  };
  const summary = filaments.map((f, i) => `filament ${f} ${weights[i]}%`).join(', ');

  return (
    <div className="mix-triangle">
      <div className="mix-triangle-box">
        <canvas ref={canvas} aria-hidden />
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="slider"
          tabIndex={0}
          aria-label="Mixing ratio"
          aria-valuetext={summary}
          aria-valuenow={weights[0]}
          aria-valuemin={10}
          aria-valuemax={90}
          data-testid="mix-triangle"
          onKeyDown={onKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag(e);
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && drag(e)}
        >
          <polygon points={corners.map((p) => `${p.x},${p.y}`).join(' ')} className="mix-triangle-edge" />
          {corners.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={3} fill={tri[i]} className="mix-triangle-corner" />
          ))}
          <circle cx={handle.x} cy={handle.y} r={6} className="mix-triangle-handle" />
        </svg>
      </div>
      <div className="mix-triangle-legend">
        {filaments.map((f, i) => (
          <span key={f}>
            <Swatch colour={tri[i]} number={f} size="sm" /> {weights[i]}%
          </span>
        ))}
      </div>
    </div>
  );
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}
