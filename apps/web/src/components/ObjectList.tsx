import { useState } from 'react';
import type { CutKeep } from '../engine/client';
import { NO_COLOURS, useSlicer } from '../state/store';

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

/** Objects on the current plate, their filament, and the selected one's transform. */
export function ObjectList() {
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  const slots = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const { select, setObjectFilament, deleteObject, copyInstance, transformInstance, orientObject, splitObject, mirror } = useSlicer.getState();
  const [cutting, setCutting] = useState(false);
  if (!project?.objects.length) return null;
  const onPlate = project.plates[plate]?.objects ?? [];

  const filamentSelect = (o: number, v: number, value: number, label: string) => (
    <select
      className="filament-pick"
      aria-label={label}
      value={value}
      style={{ borderLeftColor: colours[Math.max(0, (value || 1) - 1)] }}
      onChange={(e) => void setObjectFilament(o, v, Number(e.target.value))}
    >
      {v >= 0 && <option value={0}>Object</option>}
      {Array.from({ length: Math.max(slots, value) }, (_, i) => (
        <option key={i} value={i + 1}>
          {i + 1}
        </option>
      ))}
    </select>
  );

  const sel = selected && project.objects[selected.object]?.instances[selected.instance];
  return (
    <section className="group">
      <h2>Objects</h2>
      <ul className="objects">
        {onPlate.map((o) => {
          const obj = project.objects[o];
          const parts = obj.volumes.map((v, i) => ({ v, i })).filter(({ v }) => v.kind === 'part');
          const instance = obj.instances.findIndex((inst) => inst.plate === plate);
          const active = selected?.object === o;
          return (
            <li key={o} className={active ? 'object active' : 'object'}>
              <div className="object-row">
                <button className="object-name" onClick={() => select(active ? null : { object: o, instance: Math.max(0, instance) })} title={obj.name}>
                  {obj.name || `Object ${o + 1}`}
                  {obj.instances.length > 1 && <span className="muted"> ×{obj.instances.length}</span>}
                </button>
                {filamentSelect(o, -1, obj.extruder || 1, `Filament for ${obj.name}`)}
              </div>
              {active && parts.length > 1 && (
                <ul className="volumes">
                  {parts.map(({ v, i }) => (
                    <li key={i} className="object-row">
                      <span className="volume-name" title={v.name}>
                        {v.name}
                        {v.painted && <span className="muted"> (painted)</span>}
                      </span>
                      {filamentSelect(o, i, v.extruder, `Filament for ${v.name}`)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {selected && sel && (
        <div className="transform">
          <div className="transform-row">
            <span>Rotate°</span>
            {sel.rotation.map((r, axis) => (
              <input
                key={`r${axis}-${r}`}
                aria-label={`Rotation ${'XYZ'[axis]}`}
                defaultValue={round(r)}
                onBlur={(e) => {
                  const rot = [...sel.rotation];
                  rot[axis] = Number(e.target.value) || 0;
                  if (rot[axis] !== sel.rotation[axis]) void transformInstance(selected.object, selected.instance, { rotation: rot });
                }}
              />
            ))}
          </div>
          <div className="transform-row">
            <span>Scale %</span>
            {sel.scale.map((s, axis) => (
              <input
                key={`s${axis}-${s}`}
                aria-label={`Scale ${'XYZ'[axis]}`}
                defaultValue={round(s * 100)}
                onBlur={(e) => {
                  const scl = [...sel.scale];
                  scl[axis] = (Number(e.target.value) || 100) / 100;
                  if (scl[axis] !== sel.scale[axis]) void transformInstance(selected.object, selected.instance, { scale: scl });
                }}
              />
            ))}
          </div>
          <div className="tool-row" role="toolbar" aria-label="Object tools">
            <button className="secondary" title="Turn it so it prints with the least overhang" onClick={() => void orientObject(selected.object)}>
              Auto-orient
            </button>
            <button className="secondary" title="Make every separate piece its own object" onClick={() => void splitObject(selected.object)}>
              Split
            </button>
            <button className="secondary" aria-pressed={cutting} onClick={() => setCutting((c) => !c)}>
              Cut
            </button>
            <button className="secondary" title="Mirror along X" onClick={() => void mirror(selected.object, selected.instance, 0)}>
              Mirror X
            </button>
            <button className="secondary" title="Mirror along Y" onClick={() => void mirror(selected.object, selected.instance, 1)}>
              Mirror Y
            </button>
          </div>
          {cutting && (
            <CutPanel
              key={`${selected.object}-${selected.instance}`}
              object={selected.object}
              instance={selected.instance}
              height={project.objects[selected.object].size[2]}
              onDone={() => setCutting(false)}
            />
          )}
          <div className="transform-row actions">
            <button className="secondary" onClick={() => void copyInstance(selected.object, selected.instance)}>
              Add copy
            </button>
            <button className="secondary danger" onClick={() => void deleteObject(selected.object)}>
              Delete
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
