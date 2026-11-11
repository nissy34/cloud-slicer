import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../../i18n';
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
  const { t } = useTranslation();
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
    const say = t(scene && scene !== 'asleep' ? SCENE_WORDS[scene] : MOOD_WORDS[mood]);
    return { n, i, head, inUse, loaded, mood, label, inBed, scene: inBed ? (scene ?? 'asleep') : undefined, say };
  });
  const one = tiles.length === 1;
  const sel = tiles.find((x) => x.n.name === chosen) ?? tiles.find((x) => x.inUse) ?? tiles[0];
  const { n, head } = sel;

  return (
    <Card title={one ? t('deviceHeads.toolHead') : t('deviceHeads.toolHeads')} testId="toolheads-card">
      <ul className={`dv-heads${one ? ' one' : ''}`} style={{ gridTemplateColumns: `repeat(${Math.min(tiles.length, 4)}, minmax(0, 1fr))` }}>
        {tiles.map((x) => (
          <li
            key={x.n.name}
            className={`dv-head${x.inUse && !one ? ' active' : ''}${x === sel && !one ? ' selected' : ''}`}
            data-testid={`head-${x.i}`}
            data-dock={x.head?.dock ?? undefined}
            data-mood={x.mood}
            data-scene={x.scene}
          >
            <button
              className="dv-head-tile"
              aria-pressed={one ? undefined : x === sel}
              aria-label={x.inBed ? t('deviceHeads.tileDocked', { name: x.label, say: x.say, temp: Math.round(x.n.temp) }) : t('deviceHeads.tile', { name: x.label, say: x.say, temp: Math.round(x.n.temp) })}
              onClick={() => setChosen(x.n.name)}
            >
              <span className="dv-head-say">{x.say}</span>
              <span className="dv-head-pic">
                {x.inBed ? (
                  <HeadBed mood={x.mood} colour={x.head?.colour ?? null} loaded={x.loaded} temp={x.n.temp} scene={x.scene ?? 'asleep'} size={46} />
                ) : (
                  <HeadFace mood={x.mood} colour={x.head?.colour ?? null} loaded={x.loaded} temp={x.n.temp} size={one ? 76 : 52} />
                )}
              </span>
              <span className="dv-head-name">
                <b>{x.label}</b> <span className="dv-head-temp">{Math.round(x.n.temp)}°</span>
              </span>
              {x.head ? (
                <span className="dv-head-filament">{filamentWords(x.head)}</span>
              ) : (
                x.loaded === false && <span className="dv-head-filament">{t('deviceHeads.noFilament')}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="dv-head-sheet" data-testid="head-sheet">
        {(!one || head) && (
          <div className="dv-head-sheet-title">
            {/* The head's name in its filament colour, like the cap on its tile. */}
            {head ? (
              <>
                <Swatch className="dv-head-swatch" colour={head.colour} number={sel.label} empty={!head.loaded} />
                <span className="sr-only">{sel.label}</span>
              </>
            ) : (
              <b>{sel.label}</b>
            )}
            {head && (
              <span className="muted">
                {head.loaded ? [head.material || t('deviceHeads.unknown'), head.vendor, head.subType].filter(Boolean).join(' ') : filamentWords(head)}
              </span>
            )}
          </div>
        )}
        {!head && sel.loaded != null && (
          <div className="dv-head-sheet-state">
            <span className={sel.loaded ? 'muted' : 'dv-warn-text'} data-testid="head-loaded">
              {sel.loaded ? t('deviceHeads.loaded') : t('deviceHeads.sensorEmpty')}
            </span>
          </div>
        )}
        {(head?.dock || head?.nozzle || head?.feed?.error || feeding) && (
          <div className="dv-head-sheet-state">
            {feeding && <span data-testid="head-feeding">{u1Activity(objects)}…</span>}
            {head?.dock && (
              <span className={head.dock === 'unknown' ? 'dv-warn-text' : undefined} data-testid="head-dock">
                {t(DOCK_LABEL[head.dock])}
              </span>
            )}
            {head?.nozzle && <span className="muted">{nozzleText(head.nozzle)}</span>}
            {head?.feed?.error && <span className="dv-error-text">{t('deviceHeads.feeder', { error: head.feed.error.replace(/_/g, ' ') })}</span>}
          </div>
        )}
        <div className="dv-head-sheet-temp">
          <span>{t('deviceHeads.nozzleTemp')}</span>
          <Temperature label={n.label} temp={n.temp} target={n.target} max={n.max} onSet={(v) => void run(setHeaterGcode(n.name, v, n.max, dialect(addons)))} disabled={!takesCommands(addons)} />
        </div>
        {head && (
          <div className="dv-head-actions">
            {head.dock && head.dock !== 'attached' && (
              <button
                className="secondary"
                disabled={printing}
                onClick={() =>
                  confirm({
                    action: t('deviceHeads.pickUp'),
                    text: t('deviceHeads.pickUpText', { name: head.label }),
                    run: () => void run(pickHeadGcode(head.index)),
                  })
                }
              >
                <Icon name="pickUp" />
                {t('deviceHeads.pickUp')}
              </button>
            )}
            {head.dock === 'attached' && (
              <button
                className="secondary"
                disabled={printing}
                onClick={() =>
                  confirm({
                    action: t('deviceHeads.park'),
                    text: t('deviceHeads.parkText', { name: head.label }),
                    run: () => void run(parkHeadGcode(head.index)),
                  })
                }
              >
                <Icon name="park" />
                {t('deviceHeads.park')}
              </button>
            )}
            {head.feed && (
              <>
                <button
                  className={head.loaded ? 'secondary' : 'primary'}
                  disabled={printing || feeding || head.loaded}
                  title={
                    head.loaded
                      ? t('deviceHeads.unloadFirst')
                      : !head.feed.auto
                        ? t('deviceHeads.autoOff')
                        : head.feed.filamentDetected
                          ? undefined
                          : t('deviceHeads.pushFirst', { name: head.label })
                  }
                  onClick={() =>
                    confirm({
                      action: t('deviceHeads.loadFilament'),
                      text: t('deviceHeads.loadText', { name: head.label }),
                      run: () => void run(feedGcode(head.feed!, 'load')),
                    })
                  }
                >
                  <Icon name="load" />
                  {t('deviceHeads.load')}
                </button>
                <button
                  className="secondary"
                  disabled={printing || feeding || !head.loaded}
                  onClick={() =>
                    confirm({
                      action: t('deviceHeads.unloadFilament'),
                      text: t('deviceHeads.unloadText', { name: head.label }),
                      run: () => void run(feedGcode(head.feed!, 'unload')),
                    })
                  }
                >
                  <Icon name="unload" />
                  {t('deviceHeads.unload')}
                </button>
              </>
            )}
            <button className="secondary" disabled={printing} onClick={() => setEditing(head)}>
              <Icon name="filament" />
              {t('deviceHeads.filament')}
            </button>
            {head.nozzle && (
              <button className="secondary" disabled={printing} onClick={() => setNozzleOf(head.index)}>
                <Icon name="nozzle" />
                {t('deviceHeads.nozzle')}
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
  h.loaded ? [h.material || i18n.t('deviceHeads.unknown'), h.vendor].filter(Boolean).join(' ') : h.feed?.filamentDetected ? i18n.t('deviceHeads.atFeeder') : i18n.t('deviceHeads.noFilament');

/** Word keys for what a head in bed says. */
const SCENE_WORDS: Record<Exclude<BedScene, 'asleep'>, string> = {
  coffee: 'deviceHeads.coffee',
  waking: 'deviceHeads.waking',
  bedtime: 'deviceHeads.bedtime',
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

/** Word keys for where a head is. */
const DOCK_LABEL = {
  parked: 'deviceHeads.docked',
  attached: 'deviceHeads.attached',
  unknown: 'deviceHeads.dockUnknown',
} as const;

const nozzleText = (n: NonNullable<U1Head['nozzle']>) =>
  n.volumeType === 'high_flow' ? i18n.t('deviceHeads.nozzleHighFlow', { size: n.diameter }) : i18n.t('deviceHeads.nozzleSize', { size: n.diameter });

function NozzleEditor({ head, onClose }: { head: U1Head; onClose(): void }) {
  const { t } = useTranslation();
  const run = useDevice((s) => s.run);
  const [diameter, setDiameter] = useState(head.nozzle?.diameter ?? 0.4);
  const [volumeType, setVolumeType] = useState(head.nozzle?.volumeType ?? 'standard');
  const { confirm, dialog } = useConfirm();
  const save = async () => {
    if (await run(nozzleGcode(head.index, diameter, volumeType))) onClose();
  };
  return (
    <Dialog
      title={t('deviceHeads.nozzleTitle', { name: head.label })}
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" onClick={() => void save()}>
            {t('deviceHeads.saveToPrinter')}
          </button>
        </>
      }
    >
      <p className="muted">{t('deviceHeads.nozzleHelp')}</p>
      <div className="dv-form">
        <label>
          {t('deviceHeads.size')}
          <Picker field label={t('deviceHeads.size')} value={String(diameter)} options={U1_NOZZLE_DIAMETERS.map((d) => ({ value: String(d), label: `${d} mm` }))} onChange={(v) => setDiameter(Number(v))} />
        </label>
        <label>
          {t('deviceHeads.type')}
          <Picker field label={t('deviceHeads.type')} value={volumeType} options={U1_NOZZLE_TYPES.map((x) => ({ value: x.id, label: t(x.label) }))} onChange={setVolumeType} />
        </label>
      </div>
      {head.switches && (
        <p className="muted" data-testid="head-switches">
          {t('deviceHeads.toolChanges', { count: head.switches.count.toLocaleString(), since: head.switches.sinceMaintenance.toLocaleString() })}
          {head.switches.errors > 0 && t('deviceHeads.failed', { n: head.switches.errors })}.{' '}
          <button
            className="quiet"
            onClick={() =>
              confirm({
                action: t('deviceHeads.reset'),
                text: t('deviceHeads.resetText'),
                run: () => void run(RESET_MAINTENANCE_GCODE),
              })
            }
          >
            {t('deviceHeads.markServiced')}
          </button>
        </p>
      )}
      {dialog}
    </Dialog>
  );
}

function FilamentEditor({ head, onClose }: { head: U1Head; onClose(): void }) {
  const { t } = useTranslation();
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
      title={t('deviceHeads.filamentTitle', { name: head.label })}
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={head.official} onClick={() => void save()}>
            {t('deviceHeads.saveToPrinter')}
          </button>
        </>
      }
    >
      {head.official && <p className="dv-alert">{t('deviceHeads.official')}</p>}
      <div className="dv-form">
        <label>
          {t('deviceHeads.material')}
          <Picker field label={t('deviceHeads.material')} value={material} disabled={head.official} options={[...new Set([material, ...MATERIALS])].map((m) => ({ value: m, label: m }))} onChange={setMaterial} />
        </label>
        <label>
          {t('deviceHeads.brand')}
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={head.official} maxLength={32} />
        </label>
        <label>
          {t('deviceHeads.type')}
          <input value={subType} onChange={(e) => setSubType(e.target.value)} disabled={head.official} maxLength={32} placeholder={t('deviceHeads.typePlaceholder')} />
        </label>
        <label>
          {t('deviceHeads.colour')}
          <span className="dv-colour">
            <input type="color" value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())} disabled={head.official} />
            <code>{colour}</code>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
