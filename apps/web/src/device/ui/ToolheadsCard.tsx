import { useMemo, useState } from 'react';
import { useDevice } from '../../state/device';
import { feedGcode, filamentConfigGcode, u1Heads, type U1Head } from '../addons/u1';
import { setHeaterGcode } from '../commands';
import { extruderIndex, heaters, job, motion } from '../status';
import { Card, Dialog, Swatch, Temperature, useConfirm } from './parts';

const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PVA', 'HIPS', 'PLA-CF', 'PETG-CF', 'PA-CF'];

/**
 * One row per nozzle. On a U1 each row is a tool head: its filament (colour,
 * material, from the RFID tag or as set by hand) with load, unload and edit.
 */
export function ToolheadsCard() {
  const objects = useDevice((s) => s.objects);
  const addons = useDevice((s) => s.addons);
  const run = useDevice((s) => s.run);
  const isU1 = addons.some((a) => a.id === 'u1');
  const nozzles = useMemo(() => heaters(objects).filter((h) => h.kind === 'nozzle'), [objects]);
  const heads = useMemo(() => (isU1 ? u1Heads(objects) : []), [isU1, objects]);
  const active = motion(objects).activeExtruder;
  const printing = ['printing', 'paused'].includes(job(objects).state);
  const [editing, setEditing] = useState<U1Head | null>(null);
  const { confirm, dialog } = useConfirm();

  if (!nozzles.length) return null;

  return (
    <Card title={isU1 ? 'Tool heads' : nozzles.length > 1 ? 'Nozzles' : 'Nozzle'} testId="toolheads-card">
      <ul className="dv-heads">
        {nozzles.map((n) => {
          const i = extruderIndex(n.name) ?? 0;
          const head = heads[i];
          return (
            <li key={n.name} className={`dv-head${n.name === active ? ' active' : ''}`} data-testid={`head-${i}`}>
              <div className="dv-head-id">
                {head ? <Swatch colour={head.colour} empty={!head.loaded} title={head.loaded ? head.colour : 'Empty'} /> : null}
                <span className="dv-head-label">{head ? head.label : n.label}</span>
                {n.name === active && nozzles.length > 1 && <span className="dv-chip">In use</span>}
              </div>
              {head && (
                <div className="dv-head-filament">
                  {head.loaded ? (
                    <>
                      <b>{head.material || 'Unknown'}</b> <span className="muted">{[head.vendor, head.subType].filter(Boolean).join(' ')}</span>
                    </>
                  ) : (
                    <span className="muted">No filament</span>
                  )}
                  {head.feed?.error && <span className="dv-error-text"> · Feeder: {head.feed.error.replace(/_/g, ' ')}</span>}
                </div>
              )}
              <Temperature label={n.label} temp={n.temp} target={n.target} max={n.max} onSet={(t) => void run(setHeaterGcode(n.name, t, n.max))} />
              {head && (
                <div className="dv-head-actions">
                  {head.feed && (
                    <>
                      <button
                        className="dv-link"
                        disabled={printing || head.loaded}
                        title={head.loaded ? 'Unload the current filament first' : head.feed.auto ? undefined : 'Automatic loading is off for this feeder on the printer'}
                        onClick={() =>
                          confirm({
                            action: 'Load filament',
                            text: `Load the filament waiting at ${head.label}'s feeder? The printer heats the nozzle and moves the head.`,
                            run: () => void run(feedGcode(head.feed!, 'load')),
                          })
                        }
                      >
                        Load
                      </button>
                      <button
                        className="dv-link"
                        disabled={printing || !head.loaded}
                        onClick={() =>
                          confirm({
                            action: 'Unload filament',
                            text: `Unload ${head.label}'s filament? The printer heats the nozzle and moves the head.`,
                            run: () => void run(feedGcode(head.feed!, 'unload')),
                          })
                        }
                      >
                        Unload
                      </button>
                    </>
                  )}
                  <button className="dv-link" disabled={printing} onClick={() => setEditing(head)}>
                    Edit
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing && <FilamentEditor head={editing} onClose={() => setEditing(null)} />}
      {dialog}
    </Card>
  );
}

function FilamentEditor({ head, onClose }: { head: U1Head; onClose(): void }) {
  const run = useDevice((s) => s.run);
  const [material, setMaterial] = useState(head.material || 'PLA');
  const [vendor, setVendor] = useState(head.vendor || 'Generic');
  const [subType, setSubType] = useState(head.subType || 'Basic');
  const [colour, setColour] = useState(head.colour);
  const save = async () => {
    if (await run(filamentConfigGcode(head.index, { material, vendor, subType, colour }))) onClose();
  };
  return (
    <Dialog
      title={`${head.label} filament`}
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={head.official} onClick={() => void save()}>
            Save to printer
          </button>
        </>
      }
    >
      {head.official && <p className="dv-alert">This spool was read from a Snapmaker RFID tag, so the printer keeps its details.</p>}
      <div className="dv-form">
        <label>
          Material
          <select value={material} onChange={(e) => setMaterial(e.target.value)} disabled={head.official}>
            {[...new Set([material, ...MATERIALS])].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Brand
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={head.official} maxLength={32} />
        </label>
        <label>
          Type
          <input value={subType} onChange={(e) => setSubType(e.target.value)} disabled={head.official} maxLength={32} placeholder="Basic, Matte, Silk…" />
        </label>
        <label>
          Colour
          <span className="dv-colour">
            <input type="color" value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} disabled={head.official} />
            <code>{colour}</code>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
