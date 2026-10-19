import { useEffect, useRef, useState } from 'react';
import { KIND_LABELS, keepsAPart } from '../lib/volumes';
import { useSlicer } from '../state/store';
import { ShapePlacement, placementHint } from './ShapePlacement';

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
  return (
    <section className="tool-panel text-panel" aria-label="SVG shape">
      <div className="tool-panel-head">
        <strong>SVG shape</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
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
            Pick an SVG shape in the object list or the 3D view to change it, or add one from an .svg file: on the selected object, or as an object of its
            own when nothing is selected. Opening or dropping an .svg file adds one too.
          </p>
          <div className="tool-row">
            <button className="primary" onClick={() => void startSvg(selected?.object ?? null)}>
              Add SVG…
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
    <label className="transform-row text-row" title={title}>
      <span>{label}</span>
      <input type="number" aria-label={label} inputMode="decimal" step={key === 'depth' ? 0.1 : 1} min={0} value={values[key]} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="unit">mm</span>
    </label>
  );

  return (
    <>
      <p className="svg-name" title={name}>
        {name}
      </p>
      {field('depth', 'Depth', kind === 'negative' ? 'How deep the shape cuts in' : 'How far the shape stands out', (x) => setValues((s) => ({ ...s, depth: x })))}
      {field('width', 'Width', 'Size across the shape', (x) => setSize('width', x))}
      {field('height', 'Height', 'Size up the shape', (x) => setSize('height', x))}
      <label className="svg-ratio">
        <input type="checkbox" checked={keepRatio} onChange={(e) => setKeepRatio(e.target.checked)} />
        Keep proportions
      </label>
      {onObject && (
        <div className="shape-checks">
          <label className="svg-ratio" title="The shape bends with the object's surface instead of standing flat on it">
            <input
              type="checkbox"
              checked={size.useSurface}
              disabled={working}
              onChange={async (e) => {
                setWorking(true);
                await svgVolume(object, { volume, useSurface: e.target.checked });
                setWorking(false);
              }}
            />
            Use surface
          </label>
        </div>
      )}
      <ShapePlacement object={object} volume={volume} followsSurface={size.useSurface} label="SVG" />
      {canChangeType && (
        <div className="segmented" role="radiogroup" aria-label="SVG type">
          {TYPES.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={kind === t}
              className={kind === t ? 'on' : ''}
              onClick={() => kind !== t && void volumeAction(object, { op: 'type', volume, type: t }, 'Change type')}
            >
              {t === 'negative' ? 'Engraved' : KIND_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      <p className="muted hint">{working ? 'Making the shape…' : `${placementHint('shape', onObject)} Undo brings the last shape back.`}</p>
    </>
  );
}
