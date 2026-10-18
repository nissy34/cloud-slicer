import { useMemo, useState } from 'react';
import { useDevice } from '../../state/device';
import {
  feedGcode,
  filamentConfigGcode,
  nozzleGcode,
  parkHeadGcode,
  pickHeadGcode,
  RESET_MAINTENANCE_GCODE,
  U1_NOZZLE_DIAMETERS,
  U1_NOZZLE_TYPES,
  u1Heads,
  type U1Head,
} from '../addons/u1';
import { setHeaterGcode } from '../commands';
import { extruderIndex, heaters, job, motion } from '../status';
import { Card, Dialog, Swatch, Temperature, useConfirm } from './parts';

const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PVA', 'HIPS', 'PLA-CF', 'PETG-CF', 'PA-CF'];

/**
 * One row per nozzle. On a U1 each row is a tool head: whether it is docked or
 * on the carriage (pick up / park), its filament (colour, material, from the
 * RFID tag or as set by hand) with load, unload and edit, and its nozzle.
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
  const [nozzleOf, setNozzleOf] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  if (!nozzles.length) return null;

  return (
    <Card title={isU1 ? 'Tool heads' : nozzles.length > 1 ? 'Nozzles' : 'Nozzle'} testId="toolheads-card">
      <ul className="dv-heads">
        {nozzles.map((n) => {
          const i = extruderIndex(n.name) ?? 0;
          const head = heads[i];
          // With dock sensors (U1) the head on the carriage is the one in use; otherwise Klipper's active extruder.
          const inUse = head?.dock ? head.dock === 'attached' : n.name === active;
          return (
            <li key={n.name} className={`dv-head${inUse ? ' active' : ''}`} data-testid={`head-${i}`}>
              <div className="dv-head-id">
                {head ? <Swatch colour={head.colour} empty={!head.loaded} title={head.loaded ? head.colour : 'Empty'} /> : null}
                <span className="dv-head-label">{head ? head.label : n.label}</span>
                {head?.dock ? (
                  <span className={`dv-chip${head.dock === 'unknown' ? ' dv-chip-warn' : ''}`} title={DOCK_HINT[head.dock]}>
                    {DOCK_LABEL[head.dock]}
                  </span>
                ) : (
                  n.name === active && nozzles.length > 1 && <span className="dv-chip">In use</span>
                )}
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
                  {head.nozzle && <span className="muted"> · {nozzleText(head.nozzle)}</span>}
                </div>
              )}
              <Temperature label={n.label} temp={n.temp} target={n.target} max={n.max} onSet={(t) => void run(setHeaterGcode(n.name, t, n.max))} />
              {head && (
                <div className="dv-head-actions">
                  {head.dock && head.dock !== 'attached' && (
                    <button
                      className="dv-link"
                      disabled={printing}
                      onClick={() =>
                        confirm({
                          action: 'Pick up',
                          text: `Pick up ${head.label} from its dock? The printer homes X and Y if needed, parks the head on the carriage and moves to ${head.label}'s dock.`,
                          run: () => void run(pickHeadGcode(head.index)),
                        })
                      }
                    >
                      Pick up
                    </button>
                  )}
                  {head.dock === 'attached' && (
                    <button
                      className="dv-link"
                      disabled={printing}
                      onClick={() =>
                        confirm({
                          action: 'Park',
                          text: `Put ${head.label} back in its dock? The carriage moves to the dock.`,
                          run: () => void run(parkHeadGcode(head.index)),
                        })
                      }
                    >
                      Park
                    </button>
                  )}
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
                  {head.nozzle && (
                    <button className="dv-link" disabled={printing} onClick={() => setNozzleOf(head.index)}>
                      Nozzle
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing && <FilamentEditor head={editing} onClose={() => setEditing(null)} />}
      {nozzleOf !== null && heads[nozzleOf] && <NozzleEditor head={heads[nozzleOf]} onClose={() => setNozzleOf(null)} />}
      {dialog}
    </Card>
  );
}

const DOCK_LABEL = { parked: 'Docked', attached: 'On carriage', unknown: 'Check dock' } as const;
const DOCK_HINT = {
  parked: 'In its dock',
  attached: 'Picked up: this head prints next',
  unknown: 'The dock sensors disagree. Check the head is seated in its dock or on the carriage.',
} as const;

const nozzleText = (n: NonNullable<U1Head['nozzle']>) =>
  `${n.diameter} mm${n.volumeType === 'high_flow' ? ' high flow' : ''} nozzle`;

function NozzleEditor({ head, onClose }: { head: U1Head; onClose(): void }) {
  const run = useDevice((s) => s.run);
  const [diameter, setDiameter] = useState(head.nozzle?.diameter ?? 0.4);
  const [volumeType, setVolumeType] = useState(head.nozzle?.volumeType ?? 'standard');
  const { confirm, dialog } = useConfirm();
  const save = async () => {
    if (await run(nozzleGcode(head.index, diameter, volumeType))) onClose();
  };
  return (
    <Dialog
      title={`${head.label} nozzle`}
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => void save()}>
            Save to printer
          </button>
        </>
      }
    >
      <p className="muted">Tell the printer which nozzle is fitted after swapping one. The slicer's printer profile should match.</p>
      <div className="dv-form">
        <label>
          Size
          <select value={diameter} onChange={(e) => setDiameter(Number(e.target.value))}>
            {U1_NOZZLE_DIAMETERS.map((d) => (
              <option key={d} value={d}>
                {d} mm
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={volumeType} onChange={(e) => setVolumeType(e.target.value)}>
            {U1_NOZZLE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {head.switches && (
        <p className="muted" data-testid="head-switches">
          Tool changes: {head.switches.count.toLocaleString()} ({head.switches.sinceMaintenance.toLocaleString()} since the docks were last serviced)
          {head.switches.errors > 0 && `, ${head.switches.errors} failed`}.{' '}
          <button
            className="dv-link"
            onClick={() =>
              confirm({
                action: 'Reset',
                text: 'Mark the docks of all heads as serviced? The printer starts counting tool changes toward its next maintenance reminder again.',
                run: () => void run(RESET_MAINTENANCE_GCODE),
              })
            }
          >
            Mark docks serviced
          </button>
        </p>
      )}
      {dialog}
    </Dialog>
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
