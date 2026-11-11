import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { kindLabel, keepsAPart } from '../lib/volumes';
import { useSlicer } from '../state/store';
import { ShapeActions, ShapePlacement, placementHint } from './ShapePlacement';

const TYPES = ['part', 'negative', 'modifier'] as const;

/** Asks for an .svg file, as desktop's SVG tool does when it starts. */
function chooseSvg(): Promise<File | null> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg,image/svg+xml';
    input.onchange = () => done(input.files?.[0] ?? null);
    input.oncancel = () => done(null);
    input.click();
  });
}

/** Starts an SVG shape where desktop's SVG tool would: on the picked object, else as an object of its own. */
export async function startSvg(object: number | null, type: (typeof TYPES)[number] = 'part') {
  const file = await chooseSvg();
  if (!file) return;
  const s = useSlicer.getState();
  if (await s.svgVolume(object, { type, file })) s.setTool('svg');
}

const round = (x: number) => Math.round(x * 100) / 100;

/**
 * Desktop's SVG tool for the picked SVG shape: its depth, and its size across
 * its face (proportions kept unless unticked), each change remade where it stands.
 */
export function SvgPanel() {
  const selected = useSlicer((s) => s.selected);
  const volumes = useSlicer((s) => (s.selected ? s.project?.objects[s.selected.object]?.volumes : undefined));
  const v = selected?.volume !== undefined ? volumes?.[selected.volume] : volumes?.length === 1 ? volumes[0] : undefined;
  const index = selected?.volume ?? 0;
  const { setTool } = useSlicer.getState();
  const { t } = useTranslation();
  return (
    <section className="tool-panel text-panel" aria-label={t('svgTool.title')}>
      <div className="tool-panel-head">
        <strong>{t('svgTool.title')}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          {t('svgTool.done')}
        </button>
      </div>
      {v?.svg && selected ? (
        <SvgFields
          key={`${selected.object}-${index}`}
          object={selected.object}
          volume={index}
          name={v.name}
          size={v.svg}
          kind={v.kind}
          onObject={!!volumes && volumes.length > 1}
          canChangeType={!!volumes && keepsAPart(volumes, index) && volumes.length > 1}
        />
      ) : (
        <>
          <p className="muted hint">
            {t('svgTool.pickHint')}
          </p>
          <div className="tool-row">
            <button className="primary" onClick={() => void startSvg(selected?.object ?? null)}>
              {t('svgTool.addSvg')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type Size = { depth: number; width: number; height: number };

function SvgFields({
  object,
  volume,
  name,
  size,
  kind,
  onObject,
  canChangeType,
}: {
  object: number;
  volume: number;
  name: string;
  size: Size & { useSurface: boolean };
  kind: string;
  onObject: boolean;
  canChangeType: boolean;
}) {
  const [values, setValues] = useState<Size>(() => ({ depth: round(size.depth), width: round(size.width), height: round(size.height) }));
  const [keepRatio, setKeepRatio] = useState(true);
  const [working, setWorking] = useState(false);
  const applied = useRef<Size>(values);
  const { svgVolume, volumeAction } = useSlicer.getState();
  const { t } = useTranslation();

  // Changed elsewhere (undo, the Scale tool): show the new size.
  useEffect(() => {
    const now = { depth: round(size.depth), width: round(size.width), height: round(size.height) };
    applied.current = now;
    setValues(now);
  }, [size.depth, size.width, size.height]);

  // Remakes the shape a moment after the last change, like desktop's live preview.
  useEffect(() => {
    const was = applied.current;
    const valid = (x: number) => Number.isFinite(x) && x > 0;
    if (!valid(values.depth) || !valid(values.width) || !valid(values.height)) return;
    const change: { depth?: number; width?: number; height?: number } = {};
    if (values.depth !== was.depth) change.depth = values.depth;
    if (values.width !== was.width) change.width = values.width;
    if (values.height !== was.height) change.height = values.height;
    if (!Object.keys(change).length) return;
    const timer = window.setTimeout(async () => {
      applied.current = values;
      setWorking(true);
      await svgVolume(object, { volume, ...change });
      setWorking(false);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [values, object, volume, svgVolume]);

  const setSize = (key: 'width' | 'height', value: number) =>
    setValues((s) => {
      if (!keepRatio || !(value > 0) || !(s[key] > 0)) return { ...s, [key]: value };
      const other = key === 'width' ? 'height' : 'width';
      return { ...s, [key]: value, [other]: round((s[other] * value) / s[key]) };
    });
  const field = (key: keyof Size, label: string, title: string, onChange: (x: number) => void) => (
    <label className="num-field" title={title}>
      <span>
        {label} <span className="unit">(mm)</span>
      </span>
      <input type="number" aria-label={label} inputMode="decimal" step={key === 'depth' ? 0.1 : 1} min={0} value={values[key]} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );

  return (
    <>
      <p className="svg-name" title={name}>
        {name}
      </p>
      <ShapePlacement
        object={object}
        volume={volume}
        followsSurface={size.useSurface}
        shapeKind="svg"
        fields={
          <>
            {field('depth', t('svgTool.depth'), kind === 'negative' ? t('svgTool.depthCutTip') : t('svgTool.depthTip'), (x) => setValues((s) => ({ ...s, depth: x })))}
            {field('width', t('svgTool.width'), t('svgTool.widthTip'), (x) => setSize('width', x))}
            {field('height', t('svgTool.height'), t('svgTool.heightTip'), (x) => setSize('height', x))}
          </>
        }
      />
      <label className="switch-row">
        <input className="switch" type="checkbox" checked={keepRatio} onChange={(e) => setKeepRatio(e.target.checked)} />
        {t('svgTool.keepProportions')}
      </label>
      {onObject && (
        <div className="shape-checks">
          <label className="switch-row" title={t('svgTool.useSurfaceTip')}>
            <input className="switch"
              type="checkbox"
              checked={size.useSurface}
              disabled={working}
              onChange={async (e) => {
                setWorking(true);
                await svgVolume(object, { volume, useSurface: e.target.checked });
                setWorking(false);
              }}
            />
            {t('svgTool.useSurface')}
          </label>
        </div>
      )}
      <ShapeActions object={object} volume={volume} />
      {canChangeType && (
        <div className="chooser" role="radiogroup" aria-label={t('svgTool.svgType')}>
          {TYPES.map((type) => (
            <button
              key={type}
              role="radio"
              aria-checked={kind === type}
              className={kind === type ? 'on' : ''}
              onClick={() => kind !== type && void volumeAction(object, { op: 'type', volume, type, remake: true }, t('svgTool.changeType'))}
            >
              {type === 'negative' ? t('svgTool.engraved') : kindLabel(type)}
            </button>
          ))}
        </div>
      )}
      <p className="muted hint">{working ? t('svgTool.making') : `${placementHint('shape', onObject)} ${t('svgTool.undoHint')}`}</p>
    </>
  );
}
