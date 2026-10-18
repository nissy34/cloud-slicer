import { useState } from 'react';
import type { CutKeep } from '../engine/client';
import { useSlicer, type Tool } from '../state/store';
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

const HINTS: Record<Exclude<Tool, 'cut' | 'layers'>, [string, string]> = {
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
  const { setTool, setSnap } = useSlicer.getState();
  if (!tool || !selected) return null;
  if (tool === 'layers') return <LayersPanel key={selected.object} object={selected.object} />;
  if (tool === 'cut')
    return (
      <section className="tool-panel" aria-label="Cut">
        <strong>Cut</strong>
        <CutPanel key={`${selected.object}-${selected.instance}`} object={selected.object} instance={selected.instance} height={height ?? 10} onDone={() => setTool(null)} />
      </section>
    );
  const [title, hint] = HINTS[tool];
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
        <TransformFields tool={tool} object={selected.object} instance={selected.instance} />
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
