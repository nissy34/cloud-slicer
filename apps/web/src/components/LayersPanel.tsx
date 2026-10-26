import { useEffect, useRef, useState } from 'react';
import { heightAt, layerColour, type LayerAction, type LayerProfile } from '../lib/layers';
import { useSlicer } from '../state/store';
import { Slider } from './Slider';

const ACTIONS: { action: LayerAction; label: string; title: string }[] = [
  { action: 'decrease', label: 'Add detail', title: 'Thinner layers (desktop: left mouse button)' },
  { action: 'increase', label: 'Remove detail', title: 'Thicker layers (desktop: right mouse button)' },
  { action: 'reduce', label: 'Back to base', title: 'Back to the plain layer height (desktop: Shift + left button)' },
  { action: 'smooth', label: 'Smooth', title: 'Smooth out steps (desktop: Shift + right button)' },
];

const W = 260;
const H = 200;
const fmt = (n: number) => n.toFixed(2);

/**
 * Desktop's layer height bar: layer height (across) over the object's height
 * (up). Pressing on it edits the profile around that height while held, like
 * desktop's drag; the mouse buttons and Shift do what they do on desktop.
 */
function ProfileChart({ p, action, band, onEdit }: { p: LayerProfile; action: LayerAction; band: number; onEdit(z: number, action: LayerAction, first: boolean): Promise<void> }) {
  const [hoverZ, setHoverZ] = useState<number | null>(null);
  const held = useRef<{ z: number; action: LayerAction; first: boolean; busy: boolean } | null>(null);
  const timer = useRef<number>();
  const lo = Math.min(p.minLayerHeight, p.layerHeight);
  const hi = Math.max(p.maxLayerHeight, p.layerHeight);
  const x = (h: number) => (hi > lo ? ((h - lo) / (hi - lo)) * W : W / 2);
  const y = (z: number) => H - (p.height > 0 ? (z / p.height) * H : 0);
  const zAt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    return Math.min(p.height, Math.max(0, ((r.bottom - e.clientY) / r.height) * p.height));
  };

  const step = () => {
    const h = held.current;
    if (!h || h.busy) return;
    h.busy = true;
    void onEdit(h.z, h.action, h.first).finally(() => (h.busy = false));
    h.first = false;
  };
  const stop = () => {
    held.current = null;
    window.clearInterval(timer.current);
  };
  useEffect(() => stop, []);

  const points: string[] = [];
  for (let i = 0; i + 1 < p.profile.length; i += 2) points.push(`${x(p.profile[i + 1])},${y(p.profile[i])}`);
  if (p.profile.length >= 2) points.push(`${x(p.profile[p.profile.length - 1])},0`);
  // The layers a slice prints, coloured by height like the object.
  const bands: React.ReactNode[] = [];
  for (let i = 0; i + 1 < p.layers.length && bands.length < 600; i += 2) {
    const [r, g, b] = layerColour(p.layers[i + 1] - p.layers[i], p.minLayerHeight, p.maxLayerHeight);
    bands.push(
      <rect key={i} x={0} width={6} y={y(p.layers[i + 1])} height={Math.max(0.5, y(p.layers[i]) - y(p.layers[i + 1]))} fill={`rgb(${r * 255} ${g * 255} ${b * 255})`} />,
    );
  }
  const hovered = hoverZ ?? held.current?.z ?? null;
  return (
    <svg
      className="layer-chart"
      viewBox={`-8 -4 ${W + 12} ${H + 8}`}
      role="img"
      aria-label="Layer height profile"
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={(e) => {
        const z = zAt(e);
        setHoverZ(z);
        if (held.current) held.current.z = z;
      }}
      onPointerLeave={() => setHoverZ(null)}
      onPointerDown={(e) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        const a: LayerAction = e.shiftKey ? (e.button === 2 ? 'smooth' : 'reduce') : e.button === 2 ? 'increase' : action;
        held.current = { z: zAt(e), action: a, first: true, busy: false };
        step();
        timer.current = window.setInterval(step, 60);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <rect x={0} y={0} width={W} height={H} className="layer-chart-bg" />
      <g transform="translate(-8 0)">{bands}</g>
      <line x1={x(p.layerHeight)} x2={x(p.layerHeight)} y1={0} y2={H} className="layer-chart-base" />
      {hovered != null && (
        <rect x={0} width={W} y={y(Math.min(p.height, hovered + band / 2))} height={Math.max(1, (band / p.height) * H)} className="layer-chart-band" />
      )}
      <polyline points={points.join(' ')} className="layer-chart-line" />
      {hovered != null && <circle cx={x(heightAt(p.profile, hovered))} cy={y(hovered)} r={3.5} className="layer-chart-dot" />}
    </svg>
  );
}

/** Desktop's Variable layer height panel for the selected object. */
export function LayersPanel({ object }: { object: number }) {
  const p = useSlicer((s) => (s.layers?.object === object ? s.layers : null));
  const project = useSlicer((s) => s.project);
  const { setTool, editLayers } = useSlicer.getState();
  const [quality, setQuality] = useState(0.5);
  const [radius, setRadius] = useState(5);
  const [keepMin, setKeepMin] = useState(false);
  const [action, setAction] = useState<LayerAction>('decrease');
  const [band, setBand] = useState(2);
  const [hover, setHover] = useState<number | null>(null);

  // Read again after anything that may change it: another object, undo, a new scale.
  useEffect(() => void editLayers(object, { op: 'get' }), [object, project, editLayers]);

  return (
    <section className="tool-panel layers-panel" aria-label="Variable layer height">
      <div className="tool-panel-head">
        <strong>Variable layer height</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
        </button>
      </div>
      <p className="muted hint">
        Thin layers where the shape needs detail, thick ones where it doesn't. Adaptive does it from the slopes; or press and hold on the
        chart to add or remove detail around that height.
      </p>
      {p ? (
        <>
          <div className="layer-summary" aria-label="Layer heights">
            {p.custom ? 'Variable' : 'Plain'} · {p.layers.length / 2} layers · {fmt(p.minLayerHeight)}–{fmt(p.maxLayerHeight)} mm
            {hover != null && (
              <span>
                {' '}
                · {fmt(hover)} mm: {fmt(heightAt(p.profile, hover))} mm
              </span>
            )}
          </div>
          <div onPointerMove={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setHover(Math.min(p.height, Math.max(0, ((r.bottom - e.clientY) / r.height) * p.height)));
          }} onPointerLeave={() => setHover(null)}>
            <ProfileChart p={p} action={action} band={band} onEdit={(z, a, first) => editLayers(object, { op: 'adjust', action: a, zs: [z], band }, !first)} />
          </div>
          <div className="chooser" role="radiogroup" aria-label="Chart edits">
            {ACTIONS.map((a) => (
              <button key={a.action} role="radio" aria-checked={action === a.action} className={action === a.action ? 'on' : ''} title={a.title} onClick={() => setAction(a.action)}>
                {a.label}
              </button>
            ))}
          </div>
          <label className="transform-row">
            <span>Edit band</span>
            <Slider aria-label="Edit band" min={1.5} max={10} step={0.5} value={band} onChange={(e) => setBand(Number(e.target.value))} />
            <span className="unit">{band} mm</span>
          </label>
          <div className="layer-op">
            <button className="secondary" onClick={() => void editLayers(object, { op: 'adaptive', quality })}>
              Adaptive
            </button>
            <label className="transform-row">
              <span>Quality</span>
              <Slider aria-label="Quality or speed" min={0} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
              <span className="unit">Speed</span>
            </label>
          </div>
          <div className="layer-op">
            <button className="secondary" onClick={() => void editLayers(object, { op: 'smooth', radius, keepMin })}>
              Smooth
            </button>
            <label className="transform-row">
              <span>Radius</span>
              <Slider aria-label="Smoothing radius" min={1} max={10} step={1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
              <span className="unit">{radius}</span>
            </label>
            <label className="switch-row">
              <input className="switch" type="checkbox" checked={keepMin} onChange={(e) => setKeepMin(e.target.checked)} />
              <span>Keep the thinnest layers</span>
            </label>
          </div>
          <div className="tool-row">
            <button className="secondary" disabled={!p.custom} onClick={() => void editLayers(object, { op: 'reset' })}>
              Reset
            </button>
          </div>
        </>
      ) : (
        <p className="muted hint">Reading the layers…</p>
      )}
    </section>
  );
}
