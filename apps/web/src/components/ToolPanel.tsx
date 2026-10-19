import { useState } from 'react';
import type { CutKeep } from '../engine/client';
import { describeFeature, measurementRows } from '../lib/measure';
import { AssemblePanel } from './AssemblePanel';
import { useSlicer, type Tool } from '../state/store';
import { SimplifyPanel } from './SimplifyPanel';
import { BooleanPanel } from './BooleanPanel';
import { SvgPanel } from './SvgPanel';
import { TextPanel } from './TextPanel';
import { BrimPanel } from './BrimEars';
import { LayersPanel } from './LayersPanel';

const round = (n: number) => Math.round(n * 100) / 100;

/** Horizontal cut of the selected instance, like desktop's Cut tool (C). */
function CutPanel({ object, instance, height, onDone }: { object: number; instance: number; height: number; onDone(): void }) {
  const cutObject = useSlicer((s) => s.cutObject);
  const z = useSlicer((s) => s.cutZ);
  const setZ = useSlicer((s) => s.setCutZ);
  const [keep, setKeep] = useState<CutKeep>('both');
  const [flip, setFlip] = useState(true);
  return (
    <div className="cut-panel">
      <p className="muted hint">Drag the arrow on the plane, or set the height here. Cyan is the upper part, pink the lower.</p>
      <label className="transform-row">
        <span>Cut at</span>
        <input type="range" aria-label="Cut height" min={0.2} max={round(height - 0.2)} step={0.1} value={z} onChange={(e) => setZ(Number(e.target.value))} />
        <input
          key={round(z)}
          aria-label="Cut height in mm"
          inputMode="decimal"
          defaultValue={round(z)}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0 && v < height) setZ(v);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="unit">mm</span>
      </label>
      <label className="transform-row">
        <span>Keep</span>
        <select aria-label="Parts to keep" value={keep} onChange={(e) => setKeep(e.target.value as CutKeep)}>
          <option value="both">Both parts</option>
          <option value="upper">Upper part</option>
          <option value="lower">Lower part</option>
        </select>
      </label>
      {keep !== 'lower' && (
        <label className="check">
          <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
          <span>Flip the upper part onto its cut face</span>
        </label>
      )}
      <div className="transform-row actions">
        <button className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!(z > 0 && z < height)}
          onClick={() => {
            onDone();
            void cutObject(object, instance, z, keep, flip);
          }}
        >
          Cut
        </button>
      </div>
    </div>
  );
}

/** Exact values for the open gizmo, like the fields in desktop's gizmo panels. */
function TransformFields({ tool, object, instance }: { tool: 'move' | 'rotate' | 'scale'; object: number; instance: number }) {
  const inst = useSlicer((s) => s.project?.objects[object]?.instances[instance]);
  const { transformInstance, moveInstance, mirror } = useSlicer.getState();
  if (!inst) return null;
  const values = tool === 'move' ? inst.offset.slice(0, 2) : tool === 'rotate' ? inst.rotation : inst.scale.map((v) => v * 100);
  const [label, unit] = tool === 'move' ? ['Position', 'mm'] : tool === 'rotate' ? ['Rotation', '°'] : ['Scale', '%'];
  const set = (axis: number, raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || round(v) === round(values[axis])) return;
    if (tool === 'move') {
      const at = [inst.offset[0], inst.offset[1]];
      at[axis] = v;
      return void moveInstance(object, instance, at[0], at[1]);
    }
    if (tool === 'rotate') {
      const rotation = [...inst.rotation];
      rotation[axis] = v;
      return void transformInstance(object, instance, { rotation });
    }
    if (v <= 0) return;
    const scale = [...inst.scale];
    scale[axis] = v / 100;
    void transformInstance(object, instance, { scale });
  };
  return (
    <>
      <div className="transform-row">
        <span>{label} {unit}</span>
        {values.map((v, axis) => (
          <input
            key={`${tool}${axis}-${v}`}
            aria-label={`${label} ${'XYZ'[axis]}`}
            inputMode="decimal"
            defaultValue={round(v)}
            onBlur={(e) => set(axis, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ))}
      </div>
      {tool === 'scale' && (
        <div className="tool-row">
          <button className="secondary" title="Mirror along X" onClick={() => void mirror(object, instance, 0)}>
            Mirror X
          </button>
          <button className="secondary" title="Mirror along Y" onClick={() => void mirror(object, instance, 1)}>
            Mirror Y
          </button>
        </div>
      )}
    </>
  );
}

/** The Measure tool's figures, like desktop's Measure panel. */
function MeasurePanel() {
  const { hover, picks, result, onlyPlane } = useSlicer((s) => s.measure);
  const { setTool, measureReset, setMeasureOnlyPlane } = useSlicer.getState();
  const shown = picks.length ? picks : hover ? [hover] : [];
  return (
    <section className="tool-panel measure-panel" aria-label="Measure">
      <div className="tool-panel-head">
        <strong>Measure</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
        </button>
      </div>
      <p className="muted hint">
        {picks.length === 0
          ? 'Point at a face, edge, circle or corner and click it. Click a second one to measure between them.'
          : picks.length === 1
            ? 'Now click a second feature to measure the distance and angle.'
            : 'Click another feature to start a new measurement.'}
      </p>
      {shown.map((f, i) => {
        const { name, rows } = describeFeature(f);
        return (
          <dl className={`measure-figures pick-${picks.length ? i + 1 : 0}`} key={`${i}-${f.id}`} aria-label={picks.length ? `Feature ${i + 1}` : 'Feature under the pointer'}>
            <dt className="measure-title">{picks.length ? `${i + 1}. ${name}` : name}</dt>
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        );
      })}
      {result && (
        <dl className="measure-figures result" aria-label="Measurement">
          {measurementRows(result).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <label className="check">
        <input type="checkbox" checked={onlyPlane} onChange={(e) => setMeasureOnlyPlane(e.target.checked)} />
        <span>Pick whole faces only</span>
      </label>
      {picks.length > 0 && (
        <div className="tool-row">
          <button className="secondary" onClick={measureReset}>
            Start over
          </button>
        </div>
      )}
    </section>
  );
}

const HINTS: Record<Exclude<Tool, 'cut' | 'measure' | 'layers' | 'brim' | 'simplify' | 'boolean' | 'text' | 'svg' | 'assemble'>, [string, string]> = {
  move: ['Move', 'Drag an arrow, or drag the object itself.'],
  rotate: ['Rotate', 'Drag a ring to turn the object around that axis.'],
  scale: ['Scale', 'Drag a handle; the centre box scales evenly.'],
  flatten: ['Lay on face', 'Tap or click a highlighted face to lay the object flat on it.'],
};

/** The open tool's options, floating over the 3D view like desktop's gizmo panels. */
export function ToolPanel() {
  const tool = useSlicer((s) => s.tool);
  const selected = useSlicer((s) => s.selected);
  const height = useSlicer((s) => (s.selected ? s.project?.objects[s.selected.object]?.size[2] : undefined));
  const snap = useSlicer((s) => s.snap);
  const rotation = useSlicer((s) => (s.selected ? s.project?.objects[s.selected.object]?.instances[s.selected.instance]?.rotation : undefined));
  // A part, modifier... picked in an object of several: the gizmos move it inside the object.
  const volume = useSlicer((s) => {
    const obj = s.selected?.volume !== undefined ? s.project?.objects[s.selected.object] : undefined;
    const v = obj?.volumes[s.selected!.volume!];
    return v && (v.kind !== 'part' || obj!.volumes.filter((x) => x.kind === 'part').length > 1) ? v.name : null;
  });
  const { setTool, setSnap } = useSlicer.getState();
  if (tool === 'measure') return <MeasurePanel />;
  if (tool === 'assemble') return <AssemblePanel />;
  if (tool === 'text') return <TextPanel />;
  if (tool === 'svg') return <SvgPanel />;
  if (!tool || !selected) return null;
  if (tool === 'boolean') return <BooleanPanel key={selected.object} object={selected.object} />;
  if (tool === 'simplify') return <SimplifyPanel key={selected.object} object={selected.object} />;
  if (tool === 'brim') return <BrimPanel key={selected.object} object={selected.object} />;
  if (tool === 'layers') return <LayersPanel key={selected.object} object={selected.object} />;
  if (tool === 'cut')
    return (
      <section className="tool-panel" aria-label="Cut">
        <strong>Cut</strong>
        <CutPanel key={`${selected.object}-${selected.instance}`} object={selected.object} instance={selected.instance} height={height ?? 10} onDone={() => setTool(null)} />
      </section>
    );
  const [title, objectHint] = HINTS[tool];
  const onVolume = volume !== null && tool !== 'flatten';
  const hint = onVolume
    ? `${tool === 'move' ? 'Drag an arrow' : tool === 'rotate' ? 'Drag a ring' : 'Drag a handle'} to change ${volume} inside its object. Pick the object in the list to work on all of it.`
    : objectHint;
  return (
    <section className="tool-panel" aria-label={title}>
      <div className="tool-panel-head">
        <strong>{title}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
        </button>
      </div>
      <p className="muted hint">{hint}</p>
      {tool === 'flatten' ? (
        <p className="muted hint" aria-label="Current rotation">
          Rotation now: {rotation?.map((r) => `${round(r)}°`).join(', ')}
        </p>
      ) : (
        !onVolume && <TransformFields tool={tool} object={selected.object} instance={selected.instance} />
      )}
      {tool !== 'flatten' && (
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          <span>{tool === 'rotate' ? 'Snap to 15°' : tool === 'move' ? 'Snap to 5 mm' : 'Snap to 10%'} (or hold Shift)</span>
        </label>
      )}
    </section>
  );
}
