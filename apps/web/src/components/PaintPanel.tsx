import { useEffect } from 'react';
import type { PaintKind, PaintSettings, PaintTool } from '../engine/protocol';
import { NO_COLOURS, useSlicer } from '../state/store';

const KINDS: [PaintKind, string][] = [
  ['color', 'Colour'],
  ['support', 'Supports'],
  ['seam', 'Seam'],
  ['fuzzy', 'Fuzzy skin'],
];

const TOOLS: [PaintTool, string, string][] = [
  ['circle', 'Brush', 'Paints the faces you see under the circle'],
  ['sphere', 'Sphere', 'Paints everything inside the ball, front and back'],
  ['fill', 'Smart fill', 'Fills connected faces that meet at less than the angle'],
  ['bucket', 'Bucket', 'Fills the painted area you click, up to the angle'],
];

export const DEFAULT_PAINT: PaintSettings = { kind: 'color', state: 2, tool: 'circle', radius: 3, angle: 30 };

/** Desktop Orca's paint tools: colours, support and seam enforcers/blockers, fuzzy skin. */
export function PaintPanel() {
  const paint = useSlicer((s) => s.paint);
  // Physical filaments, then the colour mixes: paint with either.
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const selected = useSlicer((s) => s.selected);
  const project = useSlicer((s) => s.project);
  const { setPaint, clearPaint } = useSlicer.getState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && void setPaint(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaint]);

  if (!paint) return null;
  const change = (c: Partial<PaintSettings>) => void setPaint({ ...paint, ...c });
  const setKind = (kind: PaintKind) =>
    change({ kind, state: kind === 'color' ? Math.min(2, colours.length) : 1, tool: paint.tool === 'bucket' && kind !== 'color' ? 'circle' : paint.tool });

  const states: [number, string, string?][] =
    paint.kind === 'color'
      ? colours.map((c, i) => [i + 1, `${i + 1}`, c] as [number, string, string])
      : paint.kind === 'fuzzy'
        ? [[1, 'Fuzzy skin']]
        : [
            [1, paint.kind === 'support' ? 'Add supports' : 'Seam here'],
            [2, paint.kind === 'support' ? 'Block supports' : 'Avoid seam'],
          ];
  const brush = paint.tool === 'circle' || paint.tool === 'sphere';
  const object = selected ? project?.objects[selected.object] : undefined;

  return (
    <section className="paint-panel" aria-label="Paint">
      <div className="paint-head">
        <strong>Paint</strong>
        <button className="primary" onClick={() => void setPaint(null)}>
          Done
        </button>
      </div>
      <div className="segmented" role="radiogroup" aria-label="What to paint">
        {KINDS.map(([k, label]) => (
          <button key={k} role="radio" aria-checked={paint.kind === k} className={paint.kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="paint-states" role="radiogroup" aria-label="Paint with">
        {states.map(([value, label, colour]) => (
          <button
            key={value}
            role="radio"
            aria-checked={paint.state === value}
            className={paint.state === value ? 'on' : ''}
            onClick={() => change({ state: value })}
            title={colour ? `Filament ${label}` : label}
          >
            {colour && <span className="paint-swatch" style={{ background: colour }} />}
            {label}
          </button>
        ))}
        <button role="radio" aria-checked={paint.state === 0} className={paint.state === 0 ? 'on' : ''} onClick={() => change({ state: 0 })}>
          Erase
        </button>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Tool">
        {TOOLS.filter(([t]) => t !== 'bucket' || paint.kind === 'color').map(([t, label, title]) => (
          <button key={t} role="radio" aria-checked={paint.tool === t} className={paint.tool === t ? 'on' : ''} title={title} onClick={() => change({ tool: t })}>
            {label}
          </button>
        ))}
      </div>
      {brush ? (
        <label className="transform-row">
          <span>Size</span>
          <input type="range" aria-label="Brush radius" min={0.5} max={20} step={0.5} value={paint.radius} onChange={(e) => change({ radius: Number(e.target.value) })} />
          <span className="unit">{paint.radius} mm</span>
        </label>
      ) : (
        <label className="transform-row">
          <span>Angle</span>
          <input type="range" aria-label="Fill angle" min={0} max={90} step={1} value={paint.angle} onChange={(e) => change({ angle: Number(e.target.value) })} />
          <span className="unit">{paint.angle}°</span>
        </label>
      )}
      <p className="muted hint">
        {brush ? 'Drag on a part to paint. Drag off the parts to turn the view.' : 'Click a part to fill.'} Esc finishes.
      </p>
      {object && selected && (
        <button className="secondary" onClick={() => void clearPaint(selected.object)}>
          Clear {KINDS.find(([k]) => k === paint.kind)![1].toLowerCase()} paint on {object.name || 'this object'}
        </button>
      )}
    </section>
  );
}
