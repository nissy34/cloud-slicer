import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaintKind, PaintSettings, PaintTool } from '../engine/protocol';
import { NO_COLOURS, useOption, useSlicer } from '../state/store';
import { Swatch } from './Swatch';
import { Slider } from './Slider';
import { Menu } from './Menu';
import { filamentChoices } from '../lib/filament-choices';

/** The card's title: the toolbar button that opened it says what is painted. */
const TITLES: Record<PaintKind, string> = {
  color: 'paintTool.colourTitle',
  support: 'paintTool.supportTitle',
  seam: 'paintTool.seamTitle',
  fuzzy: 'paintTool.fuzzyTitle',
};
/** "Clear … paint on …", for each kind. */
const CLEAR_WORDS: Record<PaintKind, string> = {
  color: 'paintTool.clearColour',
  support: 'paintTool.clearSupport',
  seam: 'paintTool.clearSeam',
  fuzzy: 'paintTool.clearFuzzy',
};

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
  ['circle', 'circle_paint', 'paintTool.brush', 'paintTool.brushTip'],
  ['sphere', 'toolbar_modifier_sphere', 'paintTool.sphere', 'paintTool.sphereTip'],
  ['fill', 'triangle_paint', 'paintTool.smartFill', 'paintTool.smartFillTip'],
  ['bucket', 'fill_paint', 'paintTool.bucket', 'paintTool.bucketTip'],
  ['height', 'height_range', 'paintTool.heightRange', 'paintTool.heightRangeTip'],
];
const SVGS = Object.fromEntries(TOOLS.map(([tool, file]) => [tool, icon(file)]));
/** Tools desktop has only for colour painting. */
const COLOUR_ONLY: PaintTool[] = ['bucket', 'height'];

export const DEFAULT_PAINT: PaintSettings = { kind: 'color', state: 2, tool: 'circle', radius: 3, angle: 30, height: 5 };

/** Desktop Orca's paint tools: colours, support and seam enforcers/blockers, fuzzy skin. */
export function PaintPanel() {
  const paint = useSlicer((s) => s.paint);
  // Physical filaments, then the colour mixes: paint with either.
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const presets = useSlicer((s) => s.selection?.filaments ?? NO_COLOURS);
  // Desktop's Remap filaments: while open, the filament each one becomes (1-based).
  const [remap, setRemap] = useState<number[] | null>(null);
  const selected = useSlicer((s) => s.selected);
  const project = useSlicer((s) => s.project);
  const preview = useSlicer((s) => s.preview);
  // Desktop starts "Highlight overhangs" at the process's support threshold angle.
  const threshold = Number(useOption('support_threshold_angle')) || 30;
  const { setPaint, clearPaint } = useSlicer.getState();
  const { t } = useTranslation();
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
      ? [[1, t('paintTool.fuzzySkin')]]
      : [
          [1, paint.kind === 'support' ? t('paintTool.addSupports') : t('paintTool.seamHere')],
          [2, paint.kind === 'support' ? t('paintTool.blockSupports') : t('paintTool.avoidSeam')],
        ];

  return (
    <section className="paint-panel" aria-label={t('paintTool.paint')}>
      <div className="paint-head">
        <strong>{t(TITLES[paint.kind])}</strong>
        <button className="primary" onClick={() => void setPaint(null)}>
          {t('paintTool.done')}
        </button>
      </div>
      {colour ? (
        // Desktop's filament squares, the number inside; mixes after the filaments.
        <div className="paint-filaments" role="radiogroup" aria-label={t('paintTool.paintWith')}>
          {colours.map((c, i) => (
            <button
              key={i}
              role="radio"
              aria-checked={paint.state === i + 1}
              aria-label={i < physical ? t('paintTool.filament', { n: i + 1 }) : t('paintTool.mix', { n: i + 1 })}
              title={i < physical ? t('paintTool.filament', { n: i + 1 }) : t('paintTool.mix', { n: i + 1 })}
              className={paint.state === i + 1 ? 'on' : ''}
              onClick={() => change({ state: i + 1 })}
            >
              <Swatch colour={c} number={i + 1} size="lg" />
            </button>
          ))}
          <button role="radio" aria-checked={paint.state === 0} className={paint.state === 0 ? 'paint-erase on' : 'paint-erase'} onClick={() => change({ state: 0 })}>
            {t('paintTool.erase')}
          </button>
        </div>
      ) : (
        <div className="paint-states" role="radiogroup" aria-label={t('paintTool.paintWith')}>
          {states.map(([value, label]) => (
            <button key={value} role="radio" aria-checked={paint.state === value} className={paint.state === value ? 'on' : ''} onClick={() => change({ state: value })}>
              {label}
            </button>
          ))}
          <button role="radio" aria-checked={paint.state === 0} className={paint.state === 0 ? 'on' : ''} onClick={() => change({ state: 0 })}>
            {t('paintTool.erase')}
          </button>
        </div>
      )}
      <div className="chooser paint-tools" role="radiogroup" aria-label={t('paintTool.tool')}>
        {TOOLS.filter(([tool]) => colour || !COLOUR_ONLY.includes(tool)).map(([tool, , label, what]) => (
          <button
            key={tool}
            role="radio"
            aria-checked={paint.tool === tool}
            aria-label={t(label)}
            className={paint.tool === tool ? 'on' : ''}
            title={`${t(label)}: ${t(what)}`}
            onClick={() => change({ tool })}
          >
            <span className="paint-tool-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVGS[tool] }} />
          </button>
        ))}
      </div>
      {brush ? (
        <label className="transform-row">
          <span>{t('paintTool.size')}</span>
          <Slider aria-label={t('paintTool.brushRadius')} min={0.5} max={20} step={0.5} value={paint.radius} onChange={(e) => change({ radius: Number(e.target.value) })} />
          <span className="unit">{paint.radius} mm</span>
        </label>
      ) : paint.tool === 'height' ? (
        <label className="transform-row">
          <span>{t('paintTool.height')}</span>
          <Slider aria-label={t('paintTool.heightRange')} min={0.1} max={Math.max(1, top)} step={0.1} value={paint.height} onChange={(e) => change({ height: Number(e.target.value) })} />
          <span className="unit">{paint.height} mm</span>
        </label>
      ) : (
        <label className="transform-row">
          <span>{t('paintTool.angle')}</span>
          <Slider aria-label={t('paintTool.fillAngle')} min={0} max={90} step={1} value={paint.angle} onChange={(e) => change({ angle: Number(e.target.value) })} />
          <span className="unit">{paint.angle}°</span>
        </label>
      )}
      {/* Desktop's section view: hides (and keeps the brush off) everything above the cut. */}
      <label className="transform-row">
        <span>{t('paintTool.sectionView')}</span>
        <Slider
          aria-label={t('paintTool.sectionView')}
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
        <span className="unit">{paint.clip === undefined ? t('paintTool.off') : `${paint.clip} mm`}</span>
      </label>
      {paint.kind === 'support' && (
        <>
          <label className="switch-row">
            <input className="switch" type="checkbox" checked={!!paint.highlightOverhangs} onChange={(e) => change({ highlightOverhangs: e.target.checked, overhangAngle })} />
            {t('paintTool.highlightOverhangs')}
          </label>
          {(paint.highlightOverhangs || paint.overhangsOnly) && (
            <label className="transform-row">
              <span>{t('paintTool.overhang')}</span>
              <Slider aria-label={t('paintTool.overhangAngle')} min={0} max={90} step={1} value={overhangAngle} onChange={(e) => change({ overhangAngle: Number(e.target.value) })} />
              <span className="unit">{overhangAngle}°</span>
            </label>
          )}
          <label className="switch-row" title={t('paintTool.overhangsOnlyTip')}>
            <input className="switch" type="checkbox" checked={!!paint.overhangsOnly} onChange={(e) => change({ overhangsOnly: e.target.checked, overhangAngle })} />
            {t('paintTool.overhangsOnly')}
          </label>
        </>
      )}
      <p className="muted hint">
        {brush ? t('paintTool.brushHint') : paint.tool === 'height' ? t('paintTool.heightHint') : t('paintTool.fillHint')} {t('paintTool.escFinishes')}
      </p>
      {colour && (
        <RemapFilaments
          remap={remap}
          setRemap={setRemap}
          colours={colours}
          presets={presets}
          physical={physical}
          where={object && selected ? object.name || t('paintTool.thisObject') : t('paintTool.plateObjects')}
        />
      )}
      {object && selected && (
        <button className="secondary paint-clear" title={object.name} onClick={() => void clearPaint(selected.object)}>
          {t(CLEAR_WORDS[paint.kind], { name: object.name || t('paintTool.thisObject') })}
        </button>
      )}
    </section>
  );
}

type RemapProps = {
  remap: number[] | null;
  setRemap(remap: number[] | null): void;
  colours: readonly string[];
  presets: readonly string[];
  physical: number;
  /** What it changes, for the tooltip: the selected object or the plate's objects. */
  where: string;
};

/**
 * Desktop's "Remap filaments" (GLGizmoMmuSegmentation::render_filament_remap_ui):
 * a square per filament, mixes included, in the colour and number of the filament
 * its paint becomes; tapping one opens a small pop-up of every filament to pick
 * from. Remap changes them all at once (so 1 and 2 can swap); Cancel leaves the paint.
 */
function RemapFilaments({ remap, setRemap, colours, presets, physical, where }: RemapProps) {
  const remapPaint = useSlicer((s) => s.remapPaint);
  const { t } = useTranslation();
  const names = filamentChoices(colours, presets, physical).map((o) => o.label);
  if (!remap)
    return (
      <button className="secondary paint-remap" title={t('paintTool.remapTip', { where })} onClick={() => setRemap(colours.map((_, i) => i + 1))}>
        {t('paintTool.remapFilaments')}
      </button>
    );
  // The row follows the filaments, if one was added or removed while it was open.
  const to = colours.map((_, i) => (remap[i] && remap[i] <= colours.length ? remap[i] : i + 1));
  const label = (n: number) => `${n}: ${names[n - 1] ?? ''}`;
  return (
    <div className="paint-remap" role="group" aria-label={t('paintTool.remapFilaments')}>
      <div className="paint-filaments">
        {to.map((dst, i) => (
          <Menu
            key={i}
            role="dialog"
            label={t('paintTool.becomes', { n: i + 1 })}
            placement="bottom"
            className="paint-remap-pop"
            button={(props, open) => (
              <button
                {...props}
                className={open ? 'on' : ''}
                aria-label={t('paintTool.becomesN', { n: i + 1, to: dst })}
                title={dst === i + 1 ? t('paintTool.stays', { filament: label(i + 1) }) : t('paintTool.becomesFilament', { filament: label(i + 1), to: label(dst) })}
              >
                <Swatch colour={colours[dst - 1]} number={dst} size="lg" />
              </button>
            )}
          >
            {(close) => (
              <div className="paint-filaments" role="radiogroup" aria-label={t('paintTool.becomes', { n: i + 1 })}>
                {colours.map((c, k) => (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={dst === k + 1}
                    aria-label={t('paintTool.filament', { n: k + 1 })}
                    title={label(k + 1)}
                    className={dst === k + 1 ? 'on' : ''}
                    onClick={() => {
                      setRemap(to.map((d, j) => (j === i ? k + 1 : d)));
                      close();
                    }}
                  >
                    <Swatch colour={c} number={k + 1} size="lg" />
                  </button>
                ))}
              </div>
            )}
          </Menu>
        ))}
      </div>
      <div className="paint-remap-actions">
        <button
          className="primary"
          onClick={() => {
            setRemap(null);
            void remapPaint(to);
          }}
        >
          {t('paintTool.remap')}
        </button>
        <button className="secondary" onClick={() => setRemap(null)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
