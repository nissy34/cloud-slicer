import { NO_COLOURS, useSlicer } from '../state/store';
import { ObjectSettings } from './ObjectSettings';

const round = (n: number) => Math.round(n * 100) / 100;

/** Objects on the current plate, their filament, and the selected one's transform. */
export function ObjectList() {
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  const slots = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const { select, setObjectFilament, deleteObject, copyInstance, transformInstance, mirror } = useSlicer.getState();
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
          <div className="tool-row">
            <button className="secondary" title="Mirror along X" onClick={() => void mirror(selected.object, selected.instance, 0)}>
              Mirror X
            </button>
            <button className="secondary" title="Mirror along Y" onClick={() => void mirror(selected.object, selected.instance, 1)}>
              Mirror Y
            </button>
          </div>
          <ObjectSettings object={selected.object} />
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
