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
import { headMood, MOOD_WORDS } from '../heads';
import { HeadFace } from './HeadFace';
import { Icon } from './icons';
import { Card, Dialog, Swatch, Temperature, useConfirm } from './parts';

const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PVA', 'HIPS', 'PLA-CF', 'PETG-CF', 'PA-CF'];

/**
 * One tile per nozzle, each drawn as a little character whose face says how it
 * is (printing, heating, still hot, napping, out of filament). Tapping a tile
 * opens its temperature and buttons underneath. On a U1 each tile is a tool
 * head: docked or on the carriage (pick up / park), its filament (colour,
 * material, from the RFID tag or as set by hand) with load, unload and edit,
 * and its nozzle.
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
  const [chosen, setChosen] = useState<string | null>(null);
  const [editing, setEditing] = useState<U1Head | null>(null);
  const [nozzleOf, setNozzleOf] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  if (!nozzles.length) return null;

  const tiles = nozzles.map((n) => {
    const i = extruderIndex(n.name) ?? 0;
    const head: U1Head | undefined = heads[i];
    // With dock sensors (U1) the head on the carriage is the one in use; otherwise Klipper's active extruder.
    const inUse = head?.dock ? head.dock === 'attached' : n.name === active;
    const loaded = head ? head.loaded : null;
    const mood = headMood({ temp: n.temp, target: n.target, inUse, printing, loaded, dock: head?.dock, feedError: head?.feed?.error });
    const label = head ? head.label : n.label;
    return { n, i, head, inUse, loaded, mood, label };
  });
  const one = tiles.length === 1;
  const sel = tiles.find((t) => t.n.name === chosen) ?? tiles.find((t) => t.inUse) ?? tiles[0];
  const { n, head } = sel;

  return (
    <Card title={one ? 'Tool head' : 'Tool heads'} testId="toolheads-card">
      <ul className={`dv-heads${one ? ' one' : ''}`} style={{ gridTemplateColumns: `repeat(${Math.min(tiles.length, 4)}, minmax(0, 1fr))` }}>
        {tiles.map((t) => (
          <li
            key={t.n.name}
            className={`dv-head${t.inUse && !one ? ' active' : ''}${t === sel && !one ? ' selected' : ''}`}
            data-testid={`head-${t.i}`}
            data-dock={t.head?.dock ?? undefined}
            data-mood={t.mood}
          >
            <button
              className="dv-head-tile"
              aria-pressed={one ? undefined : t === sel}
              aria-label={`${t.label}: ${MOOD_WORDS[t.mood]}, ${Math.round(t.n.temp)}°`}
              onClick={() => setChosen(t.n.name)}
            >
              <span className="dv-head-say">{MOOD_WORDS[t.mood]}</span>
              <HeadFace mood={t.mood} colour={t.head?.colour ?? null} loaded={t.loaded} temp={t.n.temp} size={one ? 76 : 52} />
              <span className="dv-head-name">
                <b>{t.label}</b> <span className="dv-head-temp">{Math.round(t.n.temp)}°</span>
              </span>
              {t.head && <span className="dv-head-filament">{t.head.loaded ? [t.head.material || 'Unknown', t.head.vendor].filter(Boolean).join(' ') : 'No filament'}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="dv-head-sheet" data-testid="head-sheet">
        {(!one || head) && (
          <div className="dv-head-sheet-title">
            {head ? <Swatch colour={head.colour} empty={!head.loaded} /> : null}
            <b>{sel.label}</b>
            {head && (
              <span className="muted">
                {head.loaded ? [head.material || 'Unknown', head.vendor, head.subType].filter(Boolean).join(' ') : 'No filament'}
              </span>
            )}
          </div>
        )}
        {(head?.dock || head?.nozzle || head?.feed?.error) && (
          <div className="dv-head-sheet-state">
            {head.dock && (
              <span className={head.dock === 'unknown' ? 'dv-warn-text' : undefined} data-testid="head-dock">
                {DOCK_LABEL[head.dock]}
              </span>
            )}
            {head.nozzle && <span className="muted">{nozzleText(head.nozzle)}</span>}
            {head.feed?.error && <span className="dv-error-text">Feeder: {head.feed.error.replace(/_/g, ' ')}</span>}
          </div>
        )}
        <div className="dv-head-sheet-temp">
          <span>Nozzle temperature</span>
          <Temperature label={n.label} temp={n.temp} target={n.target} max={n.max} onSet={(t) => void run(setHeaterGcode(n.name, t, n.max))} />
        </div>
        {head && (
          <div className="dv-head-actions">
            {head.dock && head.dock !== 'attached' && (
              <button
                className="secondary dv-btn-icon"
                disabled={printing}
                onClick={() =>
                  confirm({
                    action: 'Pick up',
                    text: `Pick up ${head.label} from its dock? The printer homes X and Y if needed, parks the head on the carriage and moves to ${head.label}'s dock.`,
                    run: () => void run(pickHeadGcode(head.index)),
                  })
                }
              >
                <Icon name="pickUp" />
                Pick up
              </button>
            )}
            {head.dock === 'attached' && (
              <button
                className="secondary dv-btn-icon"
                disabled={printing}
                onClick={() =>
                  confirm({
                    action: 'Park',
                    text: `Put ${head.label} back in its dock? The carriage moves to the dock.`,
                    run: () => void run(parkHeadGcode(head.index)),
                  })
                }
              >
                <Icon name="park" />
                Park
              </button>
            )}
            {head.feed && (
              <>
                <button
                  className={head.loaded ? 'secondary dv-btn-icon' : 'primary dv-btn-icon'}
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
                  <Icon name="load" />
                  Load
                </button>
                <button
                  className="secondary dv-btn-icon"
                  disabled={printing || !head.loaded}
                  onClick={() =>
                    confirm({
                      action: 'Unload filament',
                      text: `Unload ${head.label}'s filament? The printer heats the nozzle and moves the head.`,
                      run: () => void run(feedGcode(head.feed!, 'unload')),
                    })
                  }
                >
                  <Icon name="unload" />
                  Unload
                </button>
              </>
            )}
            <button className="secondary dv-btn-icon" disabled={printing} onClick={() => setEditing(head)}>
              <Icon name="edit" />
              Filament
            </button>
            {head.nozzle && (
              <button className="secondary dv-btn-icon" disabled={printing} onClick={() => setNozzleOf(head.index)}>
                <Icon name="nozzle" />
                Nozzle
              </button>
            )}
          </div>
        )}
      </div>
      {editing && <FilamentEditor head={editing} onClose={() => setEditing(null)} />}
      {nozzleOf !== null && heads[nozzleOf] && <NozzleEditor head={heads[nozzleOf]} onClose={() => setNozzleOf(null)} />}
      {dialog}
    </Card>
  );
}

const DOCK_LABEL = {
  parked: 'In its dock',
  attached: 'On the carriage: this head prints next',
  unknown: 'Check its dock: the dock sensors disagree. Make sure the head sits in its dock or on the carriage.',
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
