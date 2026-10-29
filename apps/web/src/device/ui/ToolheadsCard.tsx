import { useEffect, useMemo, useRef, useState } from 'react';
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
  u1Activity,
  u1MainState,
  type U1Head,
} from '../addons/u1';
import { dialect, takesCommands } from '../addons';
import { setHeaterGcode } from '../commands';
import { extruderIndex, heaters, job, motion } from '../status';
import { filamentInExtruders, headMood, MOOD_WORDS } from '../heads';
import { BED_SCENE_MS, HeadBed, type BedScene } from './HeadBed';
import { HeadFace } from './HeadFace';
import { Icon } from './icons';
import { Swatch } from '../../components/Swatch';
import { Card, Temperature, useConfirm } from './parts';
import { Dialog } from '../../components/Dialog';
import { Picker } from '../../components/Picker';

const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PVA', 'HIPS', 'PLA-CF', 'PETG-CF', 'PA-CF'];

/**
 * One tile per nozzle, each drawn as a little character whose face says how it
 * is (printing, heating, still hot, napping, out of filament). Tapping a tile
 * opens its temperature and buttons in the panel underneath. On a
 * U1 each tile is a tool head: docked heads lie asleep in bed, the one on the
 * carriage stands up in a blue frame (pick up / park plays getting up and going
 * back to bed), plus its filament (colour, material, from the RFID tag or as
 * set by hand) with load, unload and edit, and its nozzle.
 */
export function ToolheadsCard() {
  const objects = useDevice((s) => s.objects);
  const addons = useDevice((s) => s.addons);
  const run = useDevice((s) => s.run);
  const isU1 = addons.some((a) => a.id === 'u1');
  const nozzles = useMemo(() => heaters(objects).filter((h) => h.kind === 'nozzle'), [objects]);
  const heads = useMemo(() => (isU1 ? u1Heads(objects) : []), [isU1, objects]);
  // Any printer: filament in each extruder from its Klipper filament sensors.
  const motionSensorsFeelFilament = addons.some((a) => a.motionSensorsFeelFilament);
  const inExtruder = useMemo(() => filamentInExtruders(objects, { motionSensorsFeelFilament }), [objects, motionSensorsFeelFilament]);
  // The U1 loads or unloads one head at a time and says so; both buttons wait for it.
  const feeding = isU1 && ['AUTO_LOAD', 'AUTO_UNLOAD', 'MANUAL_LOAD'].includes(u1MainState(objects));
  const active = motion(objects).activeExtruder;
  const printing = ['printing', 'paused'].includes(job(objects).state);
  const [chosen, setChosen] = useState<string | null>(null);
  const [editing, setEditing] = useState<U1Head | null>(null);
  const [nozzleOf, setNozzleOf] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();
  // Only napping heads take a coffee break; hot, hungry or heating ones have other things on their mind.
  const napping = nozzles.flatMap((n) => {
    const i = extruderIndex(n.name) ?? 0;
    const h = heads[i];
    if (h?.dock !== 'parked') return [];
    const mood = headMood({ temp: n.temp, target: n.target, inUse: false, printing, loaded: h.loaded, dock: h.dock, feedError: h.feed?.error });
    return mood === 'napping' ? [i] : [];
  });
  const scenes = useBedScenes(heads, napping);

  if (!nozzles.length) return null;

  const tiles = nozzles.map((n) => {
    const i = extruderIndex(n.name) ?? 0;
    const head: U1Head | undefined = heads[i];
    // With dock sensors (U1) the head on the carriage is the one in use; otherwise Klipper's active extruder.
    const inUse = head?.dock ? head.dock === 'attached' : n.name === active;
    const loaded = head ? head.loaded : (inExtruder.get(i) ?? null);
    const mood = headMood({ temp: n.temp, target: n.target, inUse, printing, loaded, dock: head?.dock, feedError: head?.feed?.error });
    const label = head ? head.label : n.label;
    const scene = scenes[i];
    // In bed while docked, and while getting up after a pick up.
    const inBed = head?.dock === 'parked' || scene === 'waking';
    const say = scene && scene !== 'asleep' ? SCENE_WORDS[scene] : MOOD_WORDS[mood];
    return { n, i, head, inUse, loaded, mood, label, inBed, scene: inBed ? (scene ?? 'asleep') : undefined, say };
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
            data-scene={t.scene}
          >
            <button
              className="dv-head-tile"
              aria-pressed={one ? undefined : t === sel}
              aria-label={`${t.label}: ${t.inBed ? 'in its dock, ' : ''}${t.say}, ${Math.round(t.n.temp)}°`}
              onClick={() => setChosen(t.n.name)}
            >
              <span className="dv-head-say">{t.say}</span>
              <span className="dv-head-pic">
                {t.inBed ? (
                  <HeadBed mood={t.mood} colour={t.head?.colour ?? null} loaded={t.loaded} temp={t.n.temp} scene={t.scene ?? 'asleep'} size={46} />
                ) : (
                  <HeadFace mood={t.mood} colour={t.head?.colour ?? null} loaded={t.loaded} temp={t.n.temp} size={one ? 76 : 52} />
                )}
              </span>
              <span className="dv-head-name">
                <b>{t.label}</b> <span className="dv-head-temp">{Math.round(t.n.temp)}°</span>
              </span>
              {t.head ? (
                <span className="dv-head-filament">{filamentWords(t.head)}</span>
              ) : (
                t.loaded === false && <span className="dv-head-filament">No filament</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="dv-head-sheet" data-testid="head-sheet">
        {(!one || head) && (
          <div className="dv-head-sheet-title">
            {head ? <Swatch colour={head.colour} number={head.index + 1} empty={!head.loaded} /> : null}
            <b>{sel.label}</b>
            {head && (
              <span className="muted">
                {head.loaded ? [head.material || 'Unknown', head.vendor, head.subType].filter(Boolean).join(' ') : filamentWords(head)}
              </span>
            )}
          </div>
        )}
        {!head && sel.loaded != null && (
          <div className="dv-head-sheet-state">
            <span className={sel.loaded ? 'muted' : 'dv-warn-text'} data-testid="head-loaded">
              {sel.loaded ? 'Filament loaded' : 'No filament: the filament sensor is empty'}
            </span>
          </div>
        )}
        {(head?.dock || head?.nozzle || head?.feed?.error || feeding) && (
          <div className="dv-head-sheet-state">
            {feeding && <span data-testid="head-feeding">{u1Activity(objects)}…</span>}
            {head?.dock && (
              <span className={head.dock === 'unknown' ? 'dv-warn-text' : undefined} data-testid="head-dock">
                {DOCK_LABEL[head.dock]}
              </span>
            )}
            {head?.nozzle && <span className="muted">{nozzleText(head.nozzle)}</span>}
            {head?.feed?.error && <span className="dv-error-text">Feeder: {head.feed.error.replace(/_/g, ' ')}</span>}
          </div>
        )}
        <div className="dv-head-sheet-temp">
          <span>Nozzle temperature</span>
          <Temperature label={n.label} temp={n.temp} target={n.target} max={n.max} onSet={(t) => void run(setHeaterGcode(n.name, t, n.max, dialect(addons)))} disabled={!takesCommands(addons)} />
        </div>
        {head && (
          <div className="dv-head-actions">
            {head.dock && head.dock !== 'attached' && (
              <button
                className="secondary"
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
                className="secondary"
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
                  className={head.loaded ? 'secondary' : 'primary'}
                  disabled={printing || feeding || head.loaded}
                  title={
                    head.loaded
                      ? 'Unload the current filament first'
                      : !head.feed.auto
                        ? 'Automatic loading is off for this feeder on the printer'
                        : head.feed.filamentDetected
                          ? undefined
                          : `Push filament into ${head.label}'s side feeder first`
                  }
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
                  className="secondary"
                  disabled={printing || feeding || !head.loaded}
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
            <button className="secondary" disabled={printing} onClick={() => setEditing(head)}>
              <Icon name="filament" />
              Filament
            </button>
            {head.nozzle && (
              <button className="secondary" disabled={printing} onClick={() => setNozzleOf(head.index)}>
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

/** What is in a U1 head: its filament, filament waiting at the side feeder, or nothing. */
const filamentWords = (h: U1Head) =>
  h.loaded ? [h.material || 'Unknown', h.vendor].filter(Boolean).join(' ') : h.feed?.filamentDetected ? 'At the feeder' : 'No filament';

const SCENE_WORDS: Record<Exclude<BedScene, 'asleep'>, string> = {
  coffee: 'Coffee break',
  waking: 'Getting up',
  bedtime: 'Back to bed',
};

/** A coffee break about once a minute, for one sleeping head at a time. */
const COFFEE_EVERY_MS = [45_000, 80_000] as const;

/**
 * The little scenes in the beds: getting up when a docked head is picked up,
 * back to bed when it is parked, and now and then a coffee break. Nothing
 * plays when the viewer asks for less motion.
 */
function useBedScenes(heads: U1Head[], napping: number[]): Partial<Record<number, BedScene>> {
  const [scenes, setScenes] = useState<Partial<Record<number, BedScene>>>({});
  const docks = useRef<Record<number, U1Head['dock']>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const nappingKey = napping.join(',');
  const play = (i: number, scene: Exclude<BedScene, 'asleep'>) => {
    clearTimeout(timers.current[i]);
    setScenes((s) => ({ ...s, [i]: scene }));
    timers.current[i] = setTimeout(() => setScenes((s) => ({ ...s, [i]: undefined })), BED_SCENE_MS[scene]);
  };
  const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const dockKey = heads.map((h) => `${h.index}:${h.dock}`).join(',');
  useEffect(() => {
    for (const h of heads) {
      const before = docks.current[h.index];
      docks.current[h.index] = h.dock;
      if (calm() || !before) continue;
      if (before === 'parked' && h.dock === 'attached') play(h.index, 'waking');
      if (before === 'attached' && h.dock === 'parked') play(h.index, 'bedtime');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockKey]);

  useEffect(() => {
    if (!napping.length) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      const [lo, hi] = COFFEE_EVERY_MS;
      t = setTimeout(() => {
        if (!calm() && !document.hidden) {
          setScenes((s) => {
            if (Object.values(s).some(Boolean)) return s;
            const i = napping[Math.floor(Math.random() * napping.length)];
            clearTimeout(timers.current[i]);
            timers.current[i] = setTimeout(() => setScenes((x) => ({ ...x, [i]: undefined })), BED_SCENE_MS.coffee);
            return { ...s, [i]: 'coffee' };
          });
        }
        next();
      }, lo + Math.random() * (hi - lo));
    };
    next();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nappingKey]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  return scenes;
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
          <Picker field label="Size" value={String(diameter)} options={U1_NOZZLE_DIAMETERS.map((d) => ({ value: String(d), label: `${d} mm` }))} onChange={(v) => setDiameter(Number(v))} />
        </label>
        <label>
          Type
          <Picker field label="Type" value={volumeType} options={U1_NOZZLE_TYPES.map((t) => ({ value: t.id, label: t.label }))} onChange={setVolumeType} />
        </label>
      </div>
      {head.switches && (
        <p className="muted" data-testid="head-switches">
          Tool changes: {head.switches.count.toLocaleString()} ({head.switches.sinceMaintenance.toLocaleString()} since the docks were last serviced)
          {head.switches.errors > 0 && `, ${head.switches.errors} failed`}.{' '}
          <button
            className="quiet"
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
          <Picker field label="Material" value={material} disabled={head.official} options={[...new Set([material, ...MATERIALS])].map((m) => ({ value: m, label: m }))} onChange={setMaterial} />
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
