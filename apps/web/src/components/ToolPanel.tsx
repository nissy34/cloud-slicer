import { useMemo, useState } from 'react';
import * as THREE from 'three';
import type { CutKeep } from '../engine/client';
import { describeFeature, measurementRows } from '../lib/measure';
import { scaledBy } from '../lib/transform';
import { groupBox } from '../lib/group';
import { AssemblePanel } from './AssemblePanel';
import { useSlicer, type Tool } from '../state/store';
import { SimplifyPanel } from './SimplifyPanel';
import { BooleanPanel } from './BooleanPanel';
import { SvgPanel } from './SvgPanel';
import { TextPanel } from './TextPanel';
import { BrimPanel } from './BrimEars';
import { LayersPanel } from './LayersPanel';
import { Slider } from './Slider';

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
        <Slider aria-label="Cut height" min={0.2} max={round(height - 0.2)} step={0.1} value={z} onChange={(e) => setZ(Number(e.target.value))} />
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
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
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

const AXES = ['X', 'Y', 'Z'] as const;

/** Three number boxes side by side, each captioned with its axis and unit, like desktop's gizmo fields. */
function AxisFields({ label, unit, values, onSet, only }: { label: string; unit: string; values: number[]; onSet(axis: number, v: number): void; only?: number }) {
  return (
    <div className="num-fields axis-fields" role="group" aria-label={`${label} (${unit})`}>
      {values.slice(0, only ?? 3).map((v, axis) => (
        <label className="num-field" key={`${axis}-${round(v)}`}>
          <span>
            {label} {AXES[axis]} <span className="unit">({unit})</span>
          </span>
          <input
            aria-label={`${label} ${AXES[axis]}`}
            data-value={round(v)}
            inputMode="decimal"
            defaultValue={round(v)}
            onBlur={(e) => {
              const n = Number(e.target.value.replace(',', '.'));
              if (e.target.value.trim() !== '' && Number.isFinite(n) && round(n) !== round(v)) onSet(axis, n);
              else e.target.value = String(round(v));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
      ))}
    </div>
  );
}

/** A transform, as the fields show it: an object's copy or a part inside its object. */
interface Placement {
  offset: number[];
  rotation: number[];
  scale: number[];
  meshSize: number[];
}

/** Exact values for the open move/rotate/scale tool, like the fields in desktop's tool panels. */
function TransformFields({ tool, object, instance, volume }: { tool: 'move' | 'rotate' | 'scale'; object: number; instance: number; volume?: number }) {
  const obj = useSlicer((s) => s.project?.objects[object]);
  const uniform = useSlicer((s) => s.uniformScale);
  const { transformInstance, transformVolume, mirror, setUniformScale } = useSlicer.getState();
  const inst = obj?.instances[instance];
  const vol = volume !== undefined ? obj?.volumes[volume] : undefined;
  const at: Placement | undefined = vol ?? (inst && obj ? { ...inst, meshSize: obj.meshSize } : undefined);
  if (!at) return null;
  const apply = (changes: { offset?: number[]; rotation?: number[]; scale?: number[] }) =>
    vol ? void transformVolume(object, volume!, changes) : void transformInstance(object, instance, changes as never);
  const replace = (list: number[], axis: number, v: number) => list.map((x, k) => (k === axis ? v : x));
  const size = at.meshSize.map((m, k) => m * Math.abs(at.scale[k]));

  if (tool === 'move')
    return (
      <AxisFields
        label="Position"
        unit="mm"
        values={at.offset}
        onSet={(axis, v) => apply({ offset: replace(at.offset, axis, v) })}
      />
    );
  if (tool === 'rotate') return <AxisFields label="Rotation" unit="°" values={at.rotation} onSet={(axis, v) => apply({ rotation: replace(at.rotation, axis, v) })} />;
  const setScale = (axis: number, factor: number) => {
    if (!(factor > 0)) return;
    // A mirrored axis keeps its flip.
    const signed = at.scale.map((v) => Math.abs(v));
    const next = scaledBy(signed, axis, factor, uniform).map((v, k) => v * Math.sign(at.scale[k] || 1));
    apply({ scale: next });
  };
  return (
    <>
      <AxisFields label="Scale" unit="%" values={at.scale.map((v) => Math.abs(v) * 100)} onSet={(axis, v) => setScale(axis, v / 100)} />
      <AxisFields label="Size" unit="mm" values={size} onSet={(axis, v) => at.meshSize[axis] > 0 && setScale(axis, v / at.meshSize[axis])} />
      <div className="tool-row">
        <label className="switch-row" title="Changing one box changes the other two by as much, so the shape keeps its proportions">
          <input className="switch" type="checkbox" checked={uniform} onChange={(e) => setUniformScale(e.target.checked)} />
          <span>Scale evenly</span>
        </label>
        {!vol && (
          <>
            <button className="secondary" title="Mirror along X" onClick={() => void mirror(object, instance, 0)}>
              Mirror X
            </button>
            <button className="secondary" title="Mirror along Y" onClick={() => void mirror(object, instance, 1)}>
              Mirror Y
            </button>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Exact values for several chosen objects: the middle of the box around them
 * (move), a turn about it (rotate) or an even scale (scale), like desktop's
 * fields with a multi-selection.
 */
function GroupFields({ tool }: { tool: 'move' | 'rotate' | 'scale' }) {
  const preview = useSlicer((s) => s.preview);
  const group = useSlicer((s) => s.group);
  const { transformGroup } = useSlicer.getState();
  const version = useMemo(() => Math.random().toString(36), [preview]);
  if (!preview) return null;
  const box = groupBox(preview, group);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Typed values apply once: the fields start fresh after every change.
  const fresh = version;
  const about = (inner: THREE.Matrix4) =>
    new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(inner).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).elements.slice();
  if (tool === 'move')
    return (
      <AxisFields
        key={fresh}
        label="Position"
        unit="mm"
        only={2}
        values={[c.x, c.y]}
        onSet={(axis, v) => void transformGroup(new THREE.Matrix4().makeTranslation(axis === 0 ? v - c.x : 0, axis === 1 ? v - c.y : 0, 0).elements.slice(), 'Move')}
      />
    );
  if (tool === 'rotate')
    return (
      <AxisFields
        key={fresh}
        label="Turn by"
        unit="°"
        values={[0, 0, 0]}
        onSet={(axis, v) => {
          const r = (v * Math.PI) / 180;
          void transformGroup(about(axis === 0 ? new THREE.Matrix4().makeRotationX(r) : axis === 1 ? new THREE.Matrix4().makeRotationY(r) : new THREE.Matrix4().makeRotationZ(r)), 'Rotate');
        }}
      />
    );
  return (
    <>
      <AxisFields
        key={fresh}
        label="Scale"
        unit="%"
        only={1}
        values={[100]}
        onSet={(_, v) => v > 0 && void transformGroup(about(new THREE.Matrix4().makeScale(v / 100, v / 100, v / 100)), 'Scale')}
      />
      <p className="muted hint" aria-label="Group size">
        Together {size.toArray().map((n) => round(n)).join(' × ')} mm
      </p>
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
      <label className="switch-row">
        <input className="switch" type="checkbox" checked={onlyPlane} onChange={(e) => setMeasureOnlyPlane(e.target.checked)} />
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
  const several = useSlicer((s) => s.group.length);
  const { setTool, setSnap } = useSlicer.getState();
  if (tool === 'measure') return <MeasurePanel />;
  if (tool === 'assemble') return <AssemblePanel />;
  if (tool === 'text') return <TextPanel />;
  if (tool === 'svg') return <SvgPanel />;
  if (several > 1 && (tool === 'move' || tool === 'rotate' || tool === 'scale')) {
    const [title] = HINTS[tool];
    const what = tool === 'move' ? 'Drag an arrow, or drag one of them,' : tool === 'rotate' ? 'Drag a ring' : 'Drag a handle';
    return (
      <section className="tool-panel" aria-label={title}>
        <div className="tool-panel-head">
          <strong>{title}</strong>
          <button className="ghost" onClick={() => setTool(null)}>
            Done
          </button>
        </div>
        <p className="muted hint">
          {what} or type below to {tool} {several === 2 ? 'both' : `all ${several}`} chosen objects together{tool === 'move' ? '' : ' about their middle'}.
        </p>
        <GroupFields key={tool} tool={tool} />
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          <span>{tool === 'rotate' ? 'Snap to 15°' : tool === 'move' ? 'Snap to 5 mm' : 'Snap to 10%'} (or hold Shift)</span>
        </label>
      </section>
    );
  }
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
    ? `${tool === 'move' ? 'Drag an arrow' : tool === 'rotate' ? 'Drag a ring' : 'Drag a handle'} or type below to change ${volume} inside its object${tool === 'move' ? ' (from its middle)' : ''}. Pick the object in the list to work on all of it.`
    : tool === 'move'
      ? `${objectHint} A Z below the bed sinks it into the bed; only what is above prints.`
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
        <TransformFields
          key={`${selected.object}-${selected.instance}-${onVolume ? selected.volume : ''}`}
          tool={tool}
          object={selected.object}
          instance={selected.instance}
          volume={onVolume ? selected.volume : undefined}
        />
      )}
      {tool !== 'flatten' && (
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          <span>{tool === 'rotate' ? 'Snap to 15°' : tool === 'move' ? 'Snap to 5 mm' : 'Snap to 10%'} (or hold Shift)</span>
        </label>
      )}
    </section>
  );
}
