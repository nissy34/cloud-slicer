import { useState } from 'react';
import type { CutKeep } from '../engine/client';
import { useSlicer, type Tool } from '../state/store';

const round = (n: number) => Math.round(n * 100) / 100;

/** Horizontal cut of the selected instance, like desktop's Cut tool (C). */
function CutPanel({ object, instance, height, onDone }: { object: number; instance: number; height: number; onDone(): void }) {
  const cutObject = useSlicer((s) => s.cutObject);
  const [z, setZ] = useState(round(height / 2));
  const [keep, setKeep] = useState<CutKeep>('both');
  const [flip, setFlip] = useState(true);
  return (
    <div className="cut-panel">
      <label className="transform-row">
        <span>Cut at</span>
        <input type="range" aria-label="Cut height" min={0.2} max={round(height - 0.2)} step={0.1} value={z} onChange={(e) => setZ(Number(e.target.value))} />
        <input aria-label="Cut height in mm" value={z} onChange={(e) => setZ(Number(e.target.value) || 0)} />
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

const HINTS: Record<Exclude<Tool, 'cut'>, [string, string]> = {
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
  const { setTool, setSnap } = useSlicer.getState();
  if (!tool || !selected) return null;
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
      {tool !== 'flatten' && (
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          <span>{tool === 'rotate' ? 'Snap to 15°' : tool === 'move' ? 'Snap to 5 mm' : 'Snap to 10%'} (or hold Shift)</span>
        </label>
      )}
    </section>
  );
}
