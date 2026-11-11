import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAlerts } from '../../state/alerts';
import { currentSession, useDevice } from '../../state/device';
import { camerasFor, MAX_ALERT_CAMERAS, type AlertEvent, type AlertPrefs } from '../alerts';
import { isIos, thisDevice } from '../push';
import { Icon, type IconName } from './icons';
import { Card } from './parts';
import { InfoTip } from '../../components/InfoTip';
import { Note } from '../../components/Note';

/** [event, icon, tile words, full name]; the words are word keys, shown with t(). */
type Tile = [AlertEvent, IconName, string, string];

const PROBLEMS: Tile[] = [
  ['failed', 'failed', 'deviceAlerts.failed', 'deviceAlerts.failed'],
  ['paused', 'paused', 'deviceAlerts.pausedTile', 'deviceAlerts.pausedName'],
  ['error', 'error', 'deviceAlerts.error', 'deviceAlerts.error'],
];
/** Red for a print that stopped, amber for one that waits for you. */
const TONE: Partial<Record<AlertEvent, string>> = { failed: 'red', paused: 'amber', error: 'red' };

/** Along the print: [event, icon, tile words, full name]. */
const MILESTONES: Tile[] = [
  ['started', 'started', 'deviceAlerts.startedTile', 'deviceAlerts.startedName'],
  ['layer1', 'layer', 'deviceAlerts.layer1Tile', 'deviceAlerts.layer1Name'],
  ['layer', 'layer', 'deviceAlerts.layerTile', 'deviceAlerts.layerName'],
  ['progress', 'progress', 'deviceAlerts.progress', 'deviceAlerts.progress'],
  ['stillPrinting', 'clock', 'deviceAlerts.stillTile', 'deviceAlerts.stillName'],
  ['almostDone', 'almost', 'deviceAlerts.almostTile', 'deviceAlerts.almostName'],
  ['finished', 'finished', 'deviceAlerts.finished', 'deviceAlerts.finished'],
  ['resumed', 'resumed', 'deviceAlerts.resumed', 'deviceAlerts.resumed'],
  ['bedCooled', 'cooled', 'deviceAlerts.bedTile', 'deviceAlerts.bedName'],
];

const PERCENTS = [10, 20, 30, 40, 50, 60, 70, 80, 90];
/** Layers offered as chips; any other can be typed in. */
const LAYERS = [2, 3, 5, 10];

function Switch({ label, checked, onChange, disabled, testId }: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean; testId?: string }) {
  return (
    <input className="switch" type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
  );
}

/** The tiles sit three to a row, on desktop and phone. */
const COLUMNS = 3;

/**
 * One alert as a tile: tap it to turn it on or off. An alert that is on and has
 * something to set gets a strip along its bottom that says what is set (percentages,
 * cameras) and opens its settings, joined below the tile like a tab.
 */
function AlertTile({
  icon,
  words,
  label,
  on,
  tone,
  onChange,
  testId,
  summary,
  open,
  onOpen,
  column,
}: {
  icon: IconName;
  words: string;
  label: string;
  on: boolean;
  tone?: string;
  onChange(v: boolean): void;
  testId: string;
  /** What the strip says; no strip without it. */
  summary?: string;
  open?: boolean;
  onOpen?(): void;
  column?: number;
}) {
  const { t } = useTranslation();
  const strip = on && summary !== undefined && onOpen;
  return (
    <div className={`dv-alert-tile${on ? ' on' : ''}${tone ? ` ${tone}` : ''}${strip ? ' split' : ''}${open ? ` open col${column ?? 0}` : ''}`}>
      <button role="switch" aria-checked={on} aria-label={label} className="dv-alert-tile-top" onClick={() => onChange(!on)} data-testid={testId}>
        <Icon name={icon} size={22} />
        <span>{words}</span>
      </button>
      {strip && (
        <button className="dv-alert-strip" aria-expanded={!!open} aria-label={open ? t('deviceAlerts.hideSettings', { label }) : t('deviceAlerts.showSettings', { label })} onClick={onOpen} data-testid={`${testId}-more`}>
          <span>{summary}</span>
          <Icon name="expand" size={14} />
        </button>
      )}
    </div>
  );
}

/** The cameras an alert's picture can come from: the printer's own list (names of those with a picture address). */
function useCameraNames(): string[] | null {
  const activeId = useDevice((s) => s.activeId);
  const online = useDevice((s) => s.conn.state === 'online');
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    setNames(null);
    const s = currentSession();
    if (!online || !s) return;
    let stale = false;
    void s
      .webcams()
      .then((list) => !stale && setNames(list.filter((c) => c.snapshotUrl).map((c) => c.name)))
      .catch(() => !stale && setNames([]));
    return () => {
      stale = true;
    };
  }, [activeId, online]);
  return names;
}

/**
 * Print alerts for the printer on screen, on this device: through a bridge
 * they come with the browser closed (Web Push from the relay); printers
 * reached directly only alert while a tab is open.
 */
export function AlertsCard() {
  const { t } = useTranslation();
  const activeId = useDevice((s) => s.activeId);
  const conn = useDevice((s) => s.conn.state);
  const printer = useDevice((s) => s.printers.find((p) => p.id === s.activeId));
  const a = useAlerts();
  const cams = useCameraNames();
  /** The alert whose settings are open, one at a time. */
  const [open, setOpen] = useState<AlertEvent | null>(null);
  const bridge = printer?.kind === 'bridge';
  const device = thisDevice();

  // Read again when a print ends: the relay clears "after layer N" then.
  const printState = useDevice((s) => (typeof s.objects.print_stats?.state === 'string' ? s.objects.print_stats.state : ''));
  const ended = printState === 'complete' || printState === 'cancelled' || printState === 'error';
  useEffect(() => {
    if (!ended) return void useAlerts.getState().load();
    const timer = setTimeout(() => void useAlerts.getState().load(), 1500);
    return () => clearTimeout(timer);
  }, [activeId, conn, ended]);

  if (!printer) return null;
  const prefs = a.prefs;
  const on = a.status === 'on' && !!prefs;
  const set = (patch: Partial<AlertPrefs>) => prefs && void a.save({ ...prefs, ...patch });
  // "After layer" is on while any layer is chosen: every print, or this print only.
  const has = (e: AlertEvent) => (e === 'layer' ? !!prefs && (prefs.layers.length > 0 || prefs.layer != null) : !!prefs?.events.includes(e));
  const toggle = (e: AlertEvent, v: boolean) => {
    if (!prefs) return;
    if (e === 'layer') return set(v ? { layers: [3] } : { layers: [], layer: null });
    const events = v ? [...prefs.events, e] : prefs.events.filter((x) => x !== e);
    if (e === 'stillPrinting') set({ events, hours: v ? prefs.hours || 1 : 0 });
    else if (e === 'progress') set({ events, percents: v && !prefs.percents.length ? [50] : prefs.percents });
    else set({ events });
  };
  const blocked = a.problem && a.problem !== 'offline';
  const chosen = (prefs?.events.length ?? 0) + (has('layer') ? 1 : 0);
  const names = cams ?? [];
  /** The cameras an alert's picture comes from now, as the printer will take them. */
  const camsOf = (e: AlertEvent) => camerasFor(prefs?.cameras[e], names);
  /** What an alert's strip says; nothing to say (no strip) when it has nothing to set. */
  const summary = (e: AlertEvent): string | undefined => {
    if (!prefs) return undefined;
    const bits: string[] = [];
    if (e === 'progress') bits.push(prefs.percents.map((p) => `${p}%`).join(' '));
    if (e === 'stillPrinting') bits.push(t('deviceAlerts.everyHours', { h: prefs.hours || 1 }));
    if (e === 'layer') {
      const every = prefs.layers.length ? t('deviceAlerts.layersList', { count: prefs.layers.length, list: prefs.layers.join(', ') }) : '';
      bits.push([every, prefs.layer != null && (every ? t('deviceAlerts.once', { n: prefs.layer }) : t('deviceAlerts.layerOnce', { n: prefs.layer }))].filter(Boolean).join(' · '));
    }
    if (names.length) {
      const c = camsOf(e);
      bits.push(c.length === 0 ? (bits.length ? '' : t('deviceAlerts.noPicture')) : c.length > 1 ? `📷 ${c.length}` : bits.length ? '📷' : `📷 ${c[0]}`);
    }
    const said = bits.filter(Boolean);
    return said.length ? said.join(' · ') : undefined;
  };
  const tile = ([e, icon, words, label]: Tile, column: number) => (
    <AlertTile
      key={e}
      icon={icon}
      words={t(words)}
      label={t(label)}
      tone={TONE[e]}
      on={has(e)}
      onChange={(v) => {
        toggle(e, v);
        // Turning an alert on opens its settings when it has some; turning it off closes them.
        setOpen(v && (names.length || e === 'progress' || e === 'stillPrinting' || e === 'layer') ? e : open === e ? null : open);
      }}
      testId={`alert-${e}`}
      summary={summary(e)}
      open={open === e}
      onOpen={() => setOpen(open === e ? null : e)}
      column={column}
    />
  );
  /** A group of tiles, with the open alert's settings right under its row. */
  const tiles = (list: Tile[]) => {
    const at = list.findIndex(([e]) => e === open && has(e));
    const after = at < 0 ? -1 : Math.min(list.length - 1, Math.floor(at / COLUMNS) * COLUMNS + COLUMNS - 1);
    return (
      <div className={`dv-alert-tiles${at >= 0 ? ' joined' : ''}`}>
        {list.map((x, i) => (
          <Fragment key={x[0]}>
            {tile(x, i % COLUMNS)}
            {i === after && prefs && (
              <AlertSettings
                event={list[at][0]}
                label={t(list[at][3])}
                tone={TONE[list[at][0]]}
                column={at % COLUMNS}
                prefs={prefs}
                names={names}
                chosen={camsOf(list[at][0])}
                onSet={set}
              />
            )}
          </Fragment>
        ))}
      </div>
    );
  };

  return (
    <Card title={t('deviceCards.alerts')} testId="alerts-card" className="dv-alerts">
      <div className={`dv-alerts-hero${on ? ' on' : ''}`}>
        <span className="dv-alerts-bell">
          <Icon name="bell" size={24} />
        </span>
        <span className="dv-alerts-hero-text">
          <b>{on ? t('deviceAlerts.onDevice', { device }) : t('deviceAlerts.getOnDevice', { device })}</b>
          <span className="muted">{on ? t('deviceAlerts.chosen', { count: chosen }) : t('deviceAlerts.pitch')}</span>
        </span>
        <Switch
          label={t('deviceAlerts.sendTo', { device })}
          checked={on}
          disabled={a.busy || a.status === 'loading' || !!blocked || (bridge && conn !== 'online')}
          onChange={(v) => void (v ? a.enable() : a.disable())}
          testId="alerts-on"
        />
      </div>
      {bridge
        ? on && (
            <Note>{t('deviceAlerts.viaBridge')}</Note>
          )
        : (
            <Note>{t('deviceAlerts.tabOnly')}</Note>
          )}
      {a.problem === 'ios-home' && (
        <Note tone="warn" testId="alerts-ios">
          {t('deviceAlerts.iosHome')}
        </Note>
      )}
      {a.problem === 'unsupported' && <Note tone="warn">{t('deviceAlerts.unsupported')}</Note>}
      {a.problem === 'denied' && <Note tone="warn">{t('deviceAlerts.denied')}</Note>}
      {a.problem === 'relay' && <Note tone="warn">{t('deviceAlerts.relay')}</Note>}
      {bridge && conn !== 'online' && !blocked && <p className="muted">{t('deviceAlerts.connectFirst')}</p>}
      {on && prefs && (
        <>
          <h3 className="dv-alerts-group">{t('deviceAlerts.groupProblems')}</h3>
          {tiles(PROBLEMS)}
          <h3 className="dv-alerts-group">{t('deviceAlerts.groupDuring')}</h3>
          {tiles(MILESTONES)}
          {bridge && (
            <div className="dv-alert-tiles dv-alerts-bridge">
              <AlertTile icon="offline" words={t('deviceAlerts.offlineTile')} label={t('deviceAlerts.offlineName')} on={has('offline')} onChange={(v) => toggle('offline', v)} testId="alert-offline" />
            </div>
          )}
          {names.length > 0 && (
            <p className="muted dv-alerts-note">
              {t('deviceAlerts.stripHelp')}
              <InfoTip label={t('deviceAlerts.picturesAbout')}>
                {t('deviceAlerts.picturesHelp')}{isIos() ? ` ${t('deviceAlerts.picturesIos')}` : ''}
              </InfoTip>
            </p>
          )}
          <div className="dv-row">
            <button className="secondary" onClick={() => void a.test()} disabled={a.busy} data-testid="alert-test">
              <Icon name="bell" />
              {t('deviceAlerts.sendTest')}
            </button>
            {a.note && (
              <span className="muted" role="status">
                {a.note}
              </span>
            )}
          </div>
        </>
      )}
      {a.error && a.problem !== 'offline' && (
        <Note tone="error">
          {a.error}
        </Note>
      )}
    </Card>
  );
}

/** One alert's settings, joined under its tile: progress marks, hours, and the cameras its picture comes from. */
function AlertSettings({
  event,
  label,
  tone,
  column,
  prefs,
  names,
  chosen,
  onSet,
}: {
  event: AlertEvent;
  label: string;
  tone?: string;
  column: number;
  prefs: AlertPrefs;
  names: string[];
  chosen: string[];
  onSet(patch: Partial<AlertPrefs>): void;
}) {
  const { t } = useTranslation();
  const setCameras = (list: string[]) => onSet({ cameras: { ...prefs.cameras, [event]: names.filter((n) => list.includes(n)) } });
  return (
    <div className={`dv-alert-settings${tone ? ` ${tone}` : ''} col${column}`} role="group" aria-label={t('deviceAlerts.settingsOf', { label })} data-testid="alert-settings">
      {event === 'progress' && (
        <div className="dv-alert-setting">
          <span>{t('deviceAlerts.at')}</span>
          <span className="chips" role="group" aria-label={t('deviceAlerts.progressAt')}>
            {PERCENTS.map((pc) => (
              <button
                key={pc}
                className="chip"
                aria-pressed={prefs.percents.includes(pc)}
                onClick={() => onSet({ percents: prefs.percents.includes(pc) ? prefs.percents.filter((x) => x !== pc) : [...prefs.percents, pc].sort((x, y) => x - y) })}
              >
                {pc}%
              </button>
            ))}
          </span>
        </div>
      )}
      {event === 'stillPrinting' && (
        <div className="dv-alert-setting">
          <span>{t('deviceAlerts.every')}</span>
          <span className="chips" role="group" aria-label={t('deviceAlerts.everyHowMany')}>
            {[1, 2, 3, 4].map((h) => (
              <button key={h} className="chip" aria-pressed={(prefs.hours || 1) === h} onClick={() => onSet({ hours: h })}>
                {t('deviceAlerts.hours', { h })}
              </button>
            ))}
          </span>
        </div>
      )}
      {event === 'layer' && (
        <>
          <div className="dv-alert-setting">
            <span>{t('deviceAlerts.everyPrint')}</span>
            <span className="chips" role="group" aria-label={t('deviceAlerts.afterLayersEvery')}>
              {[...new Set([...LAYERS, ...prefs.layers])].sort((x, y) => x - y).map((n) => (
                <button
                  key={n}
                  className="chip"
                  aria-pressed={prefs.layers.includes(n)}
                  onClick={() => onSet({ layers: prefs.layers.includes(n) ? prefs.layers.filter((x) => x !== n) : [...prefs.layers, n].sort((x, y) => x - y) })}
                  data-testid={`alert-layer-${n}`}
                >
                  {n}
                </button>
              ))}
              <AddLayer onAdd={(n) => !prefs.layers.includes(n) && onSet({ layers: [...prefs.layers, n].sort((x, y) => x - y) })} />
            </span>
          </div>
        </>
      )}
      {names.length === 1 && (
        <div className="dv-alert-setting">
          <span>{t('deviceAlerts.cameraPicture')}</span>
          <input
            className="switch"
            type="checkbox"
            role="switch"
            aria-label={t('deviceAlerts.cameraPictureWith', { label })}
            checked={chosen.length > 0}
            onChange={(e) => setCameras(e.target.checked ? names : [])}
            data-testid="alert-picture"
          />
        </div>
      )}
      {names.length > 1 && (
        <div className="dv-alert-setting">
          <span>{t('deviceAlerts.picture')}</span>
          <span className="chips" role="group" aria-label={t('deviceAlerts.camerasFor', { label })}>
            {names.map((n) => {
              const on = chosen.includes(n);
              return (
                <button
                  key={n}
                  className="chip"
                  aria-pressed={on}
                  disabled={!on && chosen.length >= MAX_ALERT_CAMERAS}
                  onClick={() => setCameras(on ? chosen.filter((c) => c !== n) : [...chosen, n])}
                  data-testid={`alert-camera-${n}`}
                >
                  <Icon name="camera" size={14} />
                  {n}
                </button>
              );
            })}
          </span>
        </div>
      )}
      {names.length > 1 && <span className="muted dv-alert-setting-note">{chosen.length > 1 ? t('deviceAlerts.joined', { n: chosen.length }) : chosen.length ? t('deviceAlerts.tapMore') : t('deviceAlerts.noPictureDot')}</span>}
    </div>
  );
}

/** A box to add any layer to the "every print" chips. */
function AddLayer({ onAdd }: { onAdd(n: number): void }) {
  const { t } = useTranslation();
  const [v, setV] = useState('');
  const add = () => {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 100_000) onAdd(n);
    setV('');
  };
  return (
    <input
      className="dv-alerts-layer dv-alerts-add"
      type="number"
      inputMode="numeric"
      min={1}
      placeholder={t('deviceAlerts.addLayerPlaceholder')}
      aria-label={t('deviceAlerts.addLayer')}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={add}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      data-testid="alert-layer-add"
    />
  );
}

/** "Alert me after layer N": for this print, or the next one. */
export function LayerField({
  prefs,
  onSet,
  label,
  max,
}: {
  prefs: AlertPrefs | null;
  onSet(layer: number | null): void;
  label?: string;
  /** The print's layer count, when known: a later layer would never come. */
  max?: number | null;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  label ??= t('deviceAlerts.alertAfterLayer');
  const layerNow = prefs?.layer ?? null;
  const commit = () => {
    if (draft == null) return;
    setDraft(null);
    const n = Number(draft);
    let layer = layerNow;
    if (draft.trim() === '') layer = null;
    else if (!Number.isInteger(n) || n < 1) setHint(t('deviceAlerts.wholeLayers'));
    else if (max && n > max) setHint(t('deviceAlerts.printHas', { count: max }));
    else layer = n;
    if (layer !== layerNow) onSet(layer);
  };
  return (
    <>
      <span>{label}</span>
      <span className="dv-alerts-control">
        <input
          className="dv-alerts-layer"
          type="number"
          inputMode="numeric"
          min={1}
          max={max ?? undefined}
          placeholder="–"
          aria-label={label}
          aria-describedby={hint ? 'alert-layer-hint' : undefined}
          value={draft ?? (layerNow != null ? String(layerNow) : '')}
          onChange={(e) => {
            setDraft(e.target.value);
            setHint('');
          }}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          data-testid="alert-layer"
        />
        {max ? <span className="muted">{t('deviceAlerts.ofMax', { max })}</span> : null}
      </span>
      {hint && (
        <Note tone="warn" className="dv-alerts-hint" id="alert-layer-hint" testId="alert-layer-hint">
          {hint}
        </Note>
      )}
    </>
  );
}
