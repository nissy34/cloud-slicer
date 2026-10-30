import { Fragment, useEffect, useState } from 'react';
import { useAlerts } from '../../state/alerts';
import { currentSession, useDevice } from '../../state/device';
import { camerasFor, MAX_ALERT_CAMERAS, type AlertEvent, type AlertPrefs } from '../alerts';
import { isIos, thisDevice } from '../push';
import { Icon, type IconName } from './icons';
import { Card } from './parts';
import { InfoTip } from '../../components/InfoTip';
import { Note } from '../../components/Note';

type Tile = [AlertEvent, IconName, string, string];

const PROBLEMS: Tile[] = [
  ['failed', 'failed', 'Failed or cancelled', 'Failed or cancelled'],
  ['paused', 'paused', 'Paused or out of filament', 'Paused or filament ran out'],
  ['error', 'error', 'Printer error', 'Printer error'],
];
/** Red for a print that stopped, amber for one that waits for you. */
const TONE: Partial<Record<AlertEvent, string>> = { failed: 'red', paused: 'amber', error: 'red' };

/** Along the print: [event, icon, tile words, full name]. */
const MILESTONES: Tile[] = [
  ['started', 'started', 'Started', 'Print started'],
  ['layer1', 'layer', 'First layer', 'First layer done'],
  ['layer', 'layer', 'After layer', 'After chosen layers'],
  ['progress', 'progress', 'Progress', 'Progress'],
  ['stillPrinting', 'clock', 'Still printing', 'Still printing, every few hours'],
  ['almostDone', 'almost', '10 min left', 'Almost done (10 min left)'],
  ['finished', 'finished', 'Finished', 'Finished'],
  ['resumed', 'resumed', 'Resumed', 'Resumed'],
  ['bedCooled', 'cooled', 'Bed cooled', 'Bed cooled down'],
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
  const strip = on && summary !== undefined && onOpen;
  return (
    <div className={`dv-alert-tile${on ? ' on' : ''}${tone ? ` ${tone}` : ''}${strip ? ' split' : ''}${open ? ` open col${column ?? 0}` : ''}`}>
      <button role="switch" aria-checked={on} aria-label={label} className="dv-alert-tile-top" onClick={() => onChange(!on)} data-testid={testId}>
        <Icon name={icon} size={22} />
        <span>{words}</span>
      </button>
      {strip && (
        <button className="dv-alert-strip" aria-expanded={!!open} aria-label={`${label}: ${open ? 'hide' : 'show'} its settings`} onClick={onOpen} data-testid={`${testId}-more`}>
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
    const t = setTimeout(() => void useAlerts.getState().load(), 1500);
    return () => clearTimeout(t);
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
    if (e === 'stillPrinting') bits.push(`every ${prefs.hours || 1} h`);
    if (e === 'layer') {
      const every = prefs.layers.length ? `${prefs.layers.length > 1 ? 'Layers' : 'Layer'} ${prefs.layers.join(', ')}` : '';
      bits.push([every, prefs.layer != null && `${every ? '' : 'Layer '}${prefs.layer} once`].filter(Boolean).join(' · '));
    }
    if (names.length) {
      const c = camsOf(e);
      bits.push(c.length === 0 ? (bits.length ? '' : 'No picture') : c.length > 1 ? `📷 ${c.length}` : bits.length ? '📷' : `📷 ${c[0]}`);
    }
    const said = bits.filter(Boolean);
    return said.length ? said.join(' · ') : undefined;
  };
  const tile = ([e, icon, words, label]: Tile, column: number) => (
    <AlertTile
      key={e}
      icon={icon}
      words={words}
      label={label}
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
        {list.map((t, i) => (
          <Fragment key={t[0]}>
            {tile(t, i % COLUMNS)}
            {i === after && prefs && (
              <AlertSettings
                event={list[at][0]}
                label={list[at][3]}
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
    <Card title="Alerts" testId="alerts-card" className="dv-alerts">
      <div className={`dv-alerts-hero${on ? ' on' : ''}`}>
        <span className="dv-alerts-bell">
          <Icon name="bell" size={24} />
        </span>
        <span className="dv-alerts-hero-text">
          <b>{on ? `Alerts on ${device}` : `Get alerts on ${device}`}</b>
          <span className="muted">{on ? `${chosen} ${chosen === 1 ? 'alert' : 'alerts'} chosen` : 'Know when a print fails, runs out of filament or finishes.'}</span>
        </span>
        <Switch
          label={`Send alerts to ${device}`}
          checked={on}
          disabled={a.busy || a.status === 'loading' || !!blocked || (bridge && conn !== 'online')}
          onChange={(v) => void (v ? a.enable() : a.disable())}
          testId="alerts-on"
        />
      </div>
      {bridge
        ? on && (
            <Note>Sent through the bridge, even when the browser is closed.</Note>
          )
        : (
            <Note>Alerts only come while Cloud Slicer is open in a tab. Through a bridge they come with the browser closed too.</Note>
          )}
      {a.problem === 'ios-home' && (
        <Note tone="warn" testId="alerts-ios">
          On iPhone and iPad, alerts work once Cloud Slicer is on your Home Screen: tap Share, then Add to Home Screen, and open it from there (iOS 16.4 or later).
        </Note>
      )}
      {a.problem === 'unsupported' && <Note tone="warn">This browser can’t show alerts. Chrome, Edge, Firefox and Safari can.</Note>}
      {a.problem === 'denied' && <Note tone="warn">Notifications are blocked for this site. Allow them in the browser’s site settings, then turn alerts on again.</Note>}
      {a.problem === 'relay' && <Note tone="warn">The bridge’s relay can’t send alerts yet.</Note>}
      {bridge && conn !== 'online' && !blocked && <p className="muted">Connect to the printer to change its alerts.</p>}
      {on && prefs && (
        <>
          <h3 className="dv-alerts-group">When something goes wrong</h3>
          {tiles(PROBLEMS)}
          <h3 className="dv-alerts-group">During the print</h3>
          {tiles(MILESTONES)}
          {bridge && (
            <div className="dv-alert-tiles dv-alerts-bridge">
              <AlertTile icon="offline" words="Bridge offline" label="The bridge goes offline" on={has('offline')} onChange={(v) => toggle('offline', v)} testId="alert-offline" />
            </div>
          )}
          {names.length > 0 && (
            <p className="muted dv-alerts-note">
              Tap the strip under an alert to choose its cameras.
              <InfoTip label="About alert pictures">
                Several cameras are joined into one picture. Pictures from a bridge printer need its bridge up to date (Update now in Printers and bridges).{isIos() ? ' iPhone shows alerts without the picture.' : ''}
              </InfoTip>
            </p>
          )}
          <div className="dv-row">
            <button className="secondary" onClick={() => void a.test()} disabled={a.busy} data-testid="alert-test">
              <Icon name="bell" />
              Send a test alert
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
  const setCameras = (list: string[]) => onSet({ cameras: { ...prefs.cameras, [event]: names.filter((n) => list.includes(n)) } });
  return (
    <div className={`dv-alert-settings${tone ? ` ${tone}` : ''} col${column}`} role="group" aria-label={`${label} settings`} data-testid="alert-settings">
      {event === 'progress' && (
        <div className="dv-alert-setting">
          <span>At</span>
          <span className="chips" role="group" aria-label="Progress alerts at">
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
          <span>Every</span>
          <span className="chips" role="group" aria-label="Every how many hours">
            {[1, 2, 3, 4].map((h) => (
              <button key={h} className="chip" aria-pressed={(prefs.hours || 1) === h} onClick={() => onSet({ hours: h })}>
                {h} h
              </button>
            ))}
          </span>
        </div>
      )}
      {event === 'layer' && (
        <>
          <div className="dv-alert-setting">
            <span>Every print</span>
            <span className="chips" role="group" aria-label="After these layers, every print">
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
          <div className="dv-alert-setting">
            <LayerField prefs={prefs} label="This print only" onSet={(layer) => onSet({ layer })} testId="alert-layer-number" />
          </div>
        </>
      )}
      {names.length === 1 && (
        <div className="dv-alert-setting">
          <span>Camera picture</span>
          <input
            className="switch"
            type="checkbox"
            role="switch"
            aria-label={`Camera picture with ${label}`}
            checked={chosen.length > 0}
            onChange={(e) => setCameras(e.target.checked ? names : [])}
            data-testid="alert-picture"
          />
        </div>
      )}
      {names.length > 1 && (
        <div className="dv-alert-setting">
          <span>Picture</span>
          <span className="chips" role="group" aria-label={`Cameras for ${label}`}>
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
      {names.length > 1 && <span className="muted dv-alert-setting-note">{chosen.length > 1 ? `${chosen.length} cameras, joined into one picture.` : chosen.length ? 'Tap more cameras to join them into one picture.' : 'No picture.'}</span>}
    </div>
  );
}

/** A box to add any layer to the "every print" chips. */
function AddLayer({ onAdd }: { onAdd(n: number): void }) {
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
      placeholder="+ layer"
      aria-label="Add a layer"
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
  label = 'Alert me after layer',
  max,
  testId = 'alert-layer',
}: {
  prefs: AlertPrefs | null;
  onSet(layer: number | null): void;
  label?: string;
  /** The print's layer count, when known: a later layer would never come. */
  max?: number | null;
  testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const layerNow = prefs?.layer ?? null;
  const commit = () => {
    if (draft == null) return;
    setDraft(null);
    const n = Number(draft);
    let layer = layerNow;
    if (draft.trim() === '') layer = null;
    else if (!Number.isInteger(n) || n < 1) setHint('Whole layers from 1');
    else if (max && n > max) setHint(`This print has ${max} layers`);
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
          data-testid={testId}
        />
        {max ? <span className="muted">of {max}</span> : null}
      </span>
      {hint && (
        <Note tone="warn" className="dv-alerts-hint" id="alert-layer-hint" testId="alert-layer-hint">
          {hint}
        </Note>
      )}
    </>
  );
}
