import { useEffect, useState } from 'react';
import { useAlerts } from '../../state/alerts';
import { useDevice } from '../../state/device';
import type { AlertEvent, AlertPrefs } from '../alerts';
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
  ['layer3', 'layer', 'Third layer', 'Third layer done'],
  ['progress', 'progress', 'Progress', 'Progress'],
  ['stillPrinting', 'clock', 'Still printing', 'Still printing, every few hours'],
  ['almostDone', 'almost', '10 min left', 'Almost done (10 min left)'],
  ['finished', 'finished', 'Finished', 'Finished'],
  ['resumed', 'resumed', 'Resumed', 'Resumed'],
  ['bedCooled', 'cooled', 'Bed cooled', 'Bed cooled down'],
];

const PERCENTS = [10, 20, 30, 40, 50, 60, 70, 80, 90];

function Switch({ label, checked, onChange, disabled, testId }: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean; testId?: string }) {
  return (
    <input className="switch" type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
  );
}

/** One alert as a tile with an icon: tap to turn it on or off. */
function AlertTile({ icon, words, label, on, tone, onChange, testId, detail }: { icon: IconName; words: string; label: string; on: boolean; tone?: string; onChange(v: boolean): void; testId: string; detail?: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`dv-alert-tile${on ? ' on' : ''}${tone ? ` ${tone}` : ''}`}
      onClick={() => onChange(!on)}
      data-testid={testId}
    >
      <Icon name={icon} size={22} />
      <span>{words}</span>
      {detail && <small>{detail}</small>}
    </button>
  );
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
  const has = (e: AlertEvent) => !!prefs?.events.includes(e);
  const toggle = (e: AlertEvent, v: boolean) => {
    if (!prefs) return;
    const events = v ? [...prefs.events, e] : prefs.events.filter((x) => x !== e);
    if (e === 'stillPrinting') set({ events, hours: v ? prefs.hours || 1 : 0 });
    else if (e === 'progress') set({ events, percents: v && !prefs.percents.length ? [50] : prefs.percents });
    else set({ events });
  };
  const blocked = a.problem && a.problem !== 'offline';
  const chosen = prefs?.events.length ?? 0;

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
            <Note>
              Sent through the bridge, even when the browser is closed.
              <InfoTip label="About bridge alerts">Each says how far the print is, the time left and the filament used.</InfoTip>
            </Note>
          )
        : (
            <Note>
              Alerts come only while Cloud Slicer is open in a tab.
              <InfoTip label="About alerts without a bridge">
                This printer is reached straight from the browser. Through a bridge, alerts come with the browser closed too.
              </InfoTip>
            </Note>
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
          <div className="dv-alert-tiles">
            {PROBLEMS.map(([e, icon, words, label]) => (
              <AlertTile key={e} icon={icon} words={words} label={label} tone={TONE[e]} on={has(e)} onChange={(v) => toggle(e, v)} testId={`alert-${e}`} />
            ))}
          </div>
          <h3 className="dv-alerts-group">During the print</h3>
          <div className="dv-alert-tiles">
            {MILESTONES.map(([e, icon, words, label]) => (
              <AlertTile
                key={e}
                icon={icon}
                words={words}
                label={label}
                on={has(e)}
                onChange={(v) => toggle(e, v)}
                testId={`alert-${e}`}
                detail={e === 'progress' && has(e) ? prefs.percents.map((p) => `${p}%`).join(' ') : e === 'stillPrinting' && has(e) ? `every ${prefs.hours || 1} h` : undefined}
              />
            ))}
          </div>
          <ul className="dv-list dv-alerts-more">
            {has('progress') && (
              <li className="dv-alerts-wrap">
                <span>Progress alerts at</span>
                <span className="dv-steps dv-alerts-percents" role="group" aria-label="Progress alerts at">
                  {PERCENTS.map((pc) => (
                    <button
                      key={pc}
                      className={prefs.percents.includes(pc) ? 'on' : ''}
                      aria-pressed={prefs.percents.includes(pc)}
                      onClick={() => set({ percents: prefs.percents.includes(pc) ? prefs.percents.filter((x) => x !== pc) : [...prefs.percents, pc].sort((x, y) => x - y) })}
                    >
                      {pc}%
                    </button>
                  ))}
                </span>
              </li>
            )}
            {has('stillPrinting') && (
              <li>
                <span>Still printing, every</span>
                <select aria-label="Every how many hours" value={prefs.hours || 1} onChange={(ev) => set({ hours: Number(ev.target.value) })}>
                  {[1, 2, 3, 4].map((h) => (
                    <option key={h} value={h}>
                      {h} h
                    </option>
                  ))}
                </select>
              </li>
            )}
            <li className="dv-alerts-wrap">
              <LayerField prefs={prefs} onSet={(layer) => set({ layer })} />
            </li>
          </ul>
          {bridge && (
            <div className="dv-alert-tiles two">
              <AlertTile icon="camera" words="Camera picture" label="Camera picture on key alerts" on={prefs.pictures} onChange={(v) => set({ pictures: v })} testId="alert-pictures" />
              <AlertTile icon="offline" words="Bridge offline" label="The bridge goes offline" on={has('offline')} onChange={(v) => toggle('offline', v)} testId="alert-offline" />
            </div>
          )}
          {bridge && prefs.pictures && (
            <p className="muted dv-alerts-note">
              Pictures come from the printer’s camera.
              <InfoTip label="About alert pictures">
                On first and third layer, your layer, paused, failed, error, almost done and finished.{isIos() ? ' iPhone shows alerts without the picture.' : ''}
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

/** "Alert me after layer N": for this print, or the next one. */
export function LayerField({
  prefs,
  onSet,
  label = 'Alert me after layer',
  max,
}: {
  prefs: AlertPrefs | null;
  onSet(layer: number | null): void;
  label?: string;
  /** The print's layer count, when known: a later layer would never come. */
  max?: number | null;
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
          data-testid="alert-layer"
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
