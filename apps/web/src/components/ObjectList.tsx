import { NO_COLOURS, useSlicer } from '../state/store';
import { ObjectSettings } from './ObjectSettings';

/** Objects on the current plate, their filament, and the selected one's settings. */
export function ObjectList() {
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  // Physical filaments, then the colour mixes in use.
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const slots = colours.length;
  const { select, setObjectFilament, deleteObject, copyInstance, openObjectMenu, setTool } = useSlicer.getState();
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
      {Array.from({ length: physical }, (_, i) => (
        <option key={i} value={i + 1}>
          {i + 1}
        </option>
      ))}
      {Math.max(slots, value) > physical && (
        <optgroup label="Mixes">
          {Array.from({ length: Math.max(slots, value) - physical }, (_, i) => (
            <option key={i} value={physical + i + 1}>
              {physical + i + 1}
            </option>
          ))}
        </optgroup>
      )}
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
                <button
                  className="ghost object-more"
                  aria-label={`More for ${obj.name}`}
                  title="More: clone, rename, mirror, export… (or right-click the object)"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const i = Math.max(0, instance);
                    select({ object: o, instance: i });
                    openObjectMenu({ object: o, instance: i, x: r.left, y: r.bottom + 2 });
                  }}
                >
                  ⋯
                </button>
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
          <ObjectSettings object={selected.object} />
          <div className="transform-row actions">
            <button className="secondary" onClick={() => void copyInstance(selected.object, selected.instance)}>
              Add copy
            </button>
            <button className="secondary" title="Fewer triangles, like desktop's Simplify model" onClick={() => setTool('simplify')}>
              Simplify
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
