import { useEffect, useMemo } from 'react';
import type { PaintKind, PaintSettings, PaintTool } from '../engine/protocol';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';
import { Swatch } from './Swatch';
import { Slider } from './Slider';

/** The card's title: the toolbar button that opened it says what is painted. */
const TITLES: Record<PaintKind, string> = {
  color: 'Colour painting',
  support: 'Support painting',
  seam: 'Seam painting',
  fuzzy: 'Fuzzy skin painting',
};
const KIND_WORDS: Record<PaintKind, string> = { color: 'colour', support: 'support', seam: 'seam', fuzzy: 'fuzzy skin' };

// Desktop's paint tool icons (resources/images, AGPL-3.0 like this app). Their
// grey and teal become the page's text and accent colours.
const ICONS = import.meta.glob<string>('../assets/orca-paint/*.svg', { query: '?raw', import: 'default', eager: true });
const icon = (name: string) =>
  (ICONS[`../assets/orca-paint/${name}.svg`] ?? '')
    .replace(/#54545a/gi, 'currentColor')
    .replace(/#009688/gi, 'var(--accent)')
    .replace(/ width="\d+" height="\d+"/, '');

/** Each tool, its desktop icon, its name and what it does (the button shows the icon; the tip, the rest). */
const TOOLS: [PaintTool, string, string, string][] = [
  ['circle', 'circle_paint', 'Brush', 'Paints the faces you see under the circle'],
  ['sphere', 'toolbar_modifier_sphere', 'Sphere', 'Paints everything inside the ball, front and back'],
  ['fill', 'triangle_paint', 'Smart fill', 'Fills connected faces that meet at less than the angle'],
  ['bucket', 'fill_paint', 'Bucket', 'Fills the painted area you click, up to the angle'],
  ['height', 'height_range', 'Height range', 'Paints every part all round, from where you click up by the height'],
];
const SVGS = Object.fromEntries(TOOLS.map(([t, file]) => [t, icon(file)]));
/** Tools desktop has only for colour painting. */
const COLOUR_ONLY: PaintTool[] = ['bucket', 'height'];

export const DEFAULT_PAINT: PaintSettings = { kind: 'color', state: 2, tool: 'circle', radius: 3, angle: 30, height: 5 };

/** Desktop Orca's paint tools: colours, support and seam enforcers/blockers, fuzzy skin. */
export function PaintPanel() {
  const paint = useSlicer((s) => s.paint);
  // Physical filaments, then the colour mixes: paint with either.
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const selected = useSlicer((s) => s.selected);
  const project = useSlicer((s) => s.project);
  const preview = useSlicer((s) => s.preview);
  // Desktop starts "Highlight overhangs" at the process's support threshold angle.
  const threshold = Number(useOption('support_threshold_angle')) || 30;
  const { setPaint, clearPaint } = useSlicer.getState();
  // The section view cuts down from the top of the plate's models.
  const top = useMemo(() => {
    let z = 0;
    const p = preview?.positions;
    if (p) for (let k = 2; k < p.length; k += 3) z = Math.max(z, p[k]);
    return Math.ceil(z * 10) / 10;
  }, [preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && void setPaint(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaint]);

  if (!paint) return null;
  const change = (c: Partial<PaintSettings>) => void setPaint({ ...paint, ...c });
  const colour = paint.kind === 'color';
  const brush = paint.tool === 'circle' || paint.tool === 'sphere';
  const object = selected ? project?.objects[selected.object] : undefined;
  const overhangAngle = paint.overhangAngle ?? threshold;
  const states: [number, string][] =
    paint.kind === 'fuzzy'
      ? [[1, 'Fuzzy skin']]
      : [
          [1, paint.kind === 'support' ? 'Add supports' : 'Seam here'],
          [2, paint.kind === 'support' ? 'Block supports' : 'Avoid seam'],
        ];

  return (
    <section className="paint-panel" aria-label="Paint">
      <div className="paint-head">
        <strong>{TITLES[paint.kind]}</strong>
        <button className="primary" onClick={() => void setPaint(null)}>
          Done
        </button>
      </div>
      {colour ? (
        // Desktop's filament squares, the number inside; mixes after the filaments.
        <div className="paint-filaments" role="radiogroup" aria-label="Paint with">
          {colours.map((c, i) => (
            <button
              key={i}
              role="radio"
              aria-checked={paint.state === i + 1}
              aria-label={i < physical ? `Filament ${i + 1}` : `Mix ${i + 1}`}
              title={i < physical ? `Filament ${i + 1}` : `Mix ${i + 1}`}
              className={paint.state === i + 1 ? 'on' : ''}
              onClick={() => change({ state: i + 1 })}
            >
              <Swatch colour={c} number={i + 1} size="lg" />
            </button>
          ))}
          <button role="radio" aria-checked={paint.state === 0} className={paint.state === 0 ? 'paint-erase on' : 'paint-erase'} onClick={() => change({ state: 0 })}>
            Erase
          </button>
        </div>
      ) : (
        <div className="paint-states" role="radiogroup" aria-label="Paint with">
          {states.map(([value, label]) => (
            <button key={value} role="radio" aria-checked={paint.state === value} className={paint.state === value ? 'on' : ''} onClick={() => change({ state: value })}>
              {label}
            </button>
          ))}
          <button role="radio" aria-checked={paint.state === 0} className={paint.state === 0 ? 'on' : ''} onClick={() => change({ state: 0 })}>
            Erase
          </button>
        </div>
      )}
      <div className="chooser paint-tools" role="radiogroup" aria-label="Tool">
        {TOOLS.filter(([t]) => colour || !COLOUR_ONLY.includes(t)).map(([t, , label, what]) => (
          <button
            key={t}
            role="radio"
            aria-checked={paint.tool === t}
            aria-label={label}
            className={paint.tool === t ? 'on' : ''}
            title={`${label}: ${what}`}
            onClick={() => change({ tool: t })}
          >
            <span className="paint-tool-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVGS[t] }} />
          </button>
        ))}
      </div>
      {brush ? (
        <label className="transform-row">
          <span>Size</span>
          <Slider aria-label="Brush radius" min={0.5} max={20} step={0.5} value={paint.radius} onChange={(e) => change({ radius: Number(e.target.value) })} />
          <span className="unit">{paint.radius} mm</span>
        </label>
      ) : paint.tool === 'height' ? (
        <label className="transform-row">
          <span>Height</span>
          <Slider aria-label="Height range" min={0.1} max={Math.max(1, top)} step={0.1} value={paint.height} onChange={(e) => change({ height: Number(e.target.value) })} />
          <span className="unit">{paint.height} mm</span>
        </label>
      ) : (
        <label className="transform-row">
          <span>Angle</span>
          <Slider aria-label="Fill angle" min={0} max={90} step={1} value={paint.angle} onChange={(e) => change({ angle: Number(e.target.value) })} />
          <span className="unit">{paint.angle}°</span>
        </label>
      )}
      {/* Desktop's section view: hides (and keeps the brush off) everything above the cut. */}
      <label className="transform-row">
        <span>Section view</span>
        <Slider
          aria-label="Section view"
          min={0}
          max={Math.max(top, 0.1)}
          step={0.1}
          // Right is the whole model; moving left cuts it down from the top.
          value={paint.clip ?? top}
          onChange={(e) => {
            const z = Number(e.target.value);
            change({ clip: z >= top ? undefined : z });
          }}
        />
        <span className="unit">{paint.clip === undefined ? 'Off' : `${paint.clip} mm`}</span>
      </label>
      {paint.kind === 'support' && (
        <>
          <label className="switch-row">
            <input className="switch" type="checkbox" checked={!!paint.highlightOverhangs} onChange={(e) => change({ highlightOverhangs: e.target.checked, overhangAngle })} />
            Highlight overhangs
          </label>
          {(paint.highlightOverhangs || paint.overhangsOnly) && (
            <label className="transform-row">
              <span>Overhang</span>
              <Slider aria-label="Overhang angle" min={0} max={90} step={1} value={overhangAngle} onChange={(e) => change({ overhangAngle: Number(e.target.value) })} />
              <span className="unit">{overhangAngle}°</span>
            </label>
          )}
          <label className="switch-row" title="The brush and fills paint only the faces highlighted as overhangs">
            <input className="switch" type="checkbox" checked={!!paint.overhangsOnly} onChange={(e) => change({ overhangsOnly: e.target.checked, overhangAngle })} />
            On overhangs only
          </label>
        </>
      )}
      <p className="muted hint">
        {brush ? 'Drag on a part to paint. Drag off the parts to turn the view.' : paint.tool === 'height' ? 'Tap a part where the band starts.' : 'Tap a part to fill.'} Esc finishes.
      </p>
      {object && selected && (
        <button className="secondary paint-clear" title={object.name} onClick={() => void clearPaint(selected.object)}>
          Clear {KIND_WORDS[paint.kind]} paint on {object.name || 'this object'}
        </button>
      )}
    </section>
  );
}
