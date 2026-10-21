import { useEffect, useState } from 'react';
import { useAlerts } from '../../state/alerts';
import { useDevice } from '../../state/device';
import type { AlertEvent, AlertPrefs } from '../alerts';
import { isIos, thisDevice } from '../push';
import { Card } from './parts';

const PROBLEMS: [AlertEvent, string][] = [
  ['failed', 'Failed or cancelled'],
  ['paused', 'Paused or filament ran out'],
  ['error', 'Printer error'],
];

const MILESTONES: [AlertEvent, string][] = [
  ['started', 'Print started'],
  ['layer1', 'First layer done'],
  ['layer3', 'Third layer done'],
  ['progress', 'Progress'],
  ['almostDone', 'Almost done (10 min left)'],
  ['stillPrinting', 'Still printing, every'],
  ['finished', 'Finished'],
  ['resumed', 'Resumed'],
  ['bedCooled', 'Bed cooled down'],
];

const PERCENTS = [10, 20, 30, 40, 50, 60, 70, 80, 90];

function Switch({ label, checked, onChange, disabled, testId }: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean; testId?: string }) {
  return (
    <label className="dv-switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span />
    </label>
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
  const toggle = (e: AlertEvent, v: boolean) => prefs && set({ events: v ? [...prefs.events, e] : prefs.events.filter((x) => x !== e) });
  const has = (e: AlertEvent) => !!prefs?.events.includes(e);
  const blocked = a.problem && a.problem !== 'offline';

  return (
    <Card title="Alerts" testId="alerts-card" className="dv-alerts">
      <p className="muted dv-alerts-how">
        {bridge
          ? 'Sent through the bridge, even when the browser is closed.'
          : 'This printer is reached straight from the browser, so alerts only come while Cloud Slicer is open in a tab. Through a bridge they come with the browser closed too.'}
      </p>
      <ul className="dv-list">
        <li>
          <span>Send alerts to {device}</span>
          <Switch
            label={`Send alerts to ${device}`}
            checked={on}
            disabled={a.busy || a.status === 'loading' || !!blocked || (bridge && conn !== 'online')}
            onChange={(v) => void (v ? a.enable() : a.disable())}
            testId="alerts-on"
          />
        </li>
      </ul>
      {a.problem === 'ios-home' && (
        <p className="dv-note" data-testid="alerts-ios">
          On iPhone and iPad, alerts work once Cloud Slicer is on your Home Screen: tap Share, then Add to Home Screen, and open it from there (iOS 16.4 or later).
        </p>
      )}
      {a.problem === 'unsupported' && <p className="dv-note">This browser can’t show alerts. Chrome, Edge, Firefox and Safari can.</p>}
      {a.problem === 'denied' && <p className="dv-note">Notifications are blocked for this site. Allow them in the browser’s site settings, then turn alerts on again.</p>}
      {a.problem === 'relay' && <p className="dv-note">The bridge’s relay can’t send alerts yet.</p>}
      {bridge && conn !== 'online' && !blocked && <p className="muted">Connect to the printer to change its alerts.</p>}
      {on && prefs && (
        <>
          <h3 className="dv-alerts-group">Problems</h3>
          <ul className="dv-list">
            {PROBLEMS.map(([e, label]) => (
              <li key={e}>
                <span>{label}</span>
                <Switch label={label} checked={has(e)} onChange={(v) => toggle(e, v)} testId={`alert-${e}`} />
              </li>
            ))}
          </ul>
          <h3 className="dv-alerts-group">Milestones</h3>
          <ul className="dv-list">
            {MILESTONES.map(([e, label]) => (
              <li key={e} className={e === 'progress' && has(e) ? 'dv-alerts-wrap' : undefined}>
                <span>{label}</span>
                <span className="dv-alerts-control">
                  {e === 'stillPrinting' && has(e) && (
                    <select aria-label="Every how many hours" value={prefs.hours || 1} onChange={(ev) => set({ hours: Number(ev.target.value) })}>
                      {[1, 2, 3, 4].map((h) => (
                        <option key={h} value={h}>
                          {h} h
                        </option>
                      ))}
                    </select>
                  )}
                  <Switch
                    label={label}
                    checked={has(e)}
                    onChange={(v) =>
                      e === 'stillPrinting'
                        ? set({ events: v ? [...prefs.events, e] : prefs.events.filter((x) => x !== e), hours: v ? prefs.hours || 1 : 0 })
                        : e === 'progress'
                          ? set({ events: v ? [...prefs.events, e] : prefs.events.filter((x) => x !== e), percents: v && !prefs.percents.length ? [50] : prefs.percents })
                          : toggle(e, v)
                    }
                    testId={`alert-${e}`}
                  />
                </span>
                {e === 'progress' && has(e) && (
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
                )}
              </li>
            ))}
          </ul>
          <ul className="dv-list dv-alerts-more">
            <li>
              <LayerField prefs={prefs} onSet={(layer) => set({ layer })} />
            </li>
            {bridge && (
              <li>
                <span>Camera picture on key alerts</span>
                <Switch label="Camera picture on key alerts" checked={prefs.pictures} onChange={(v) => set({ pictures: v })} testId="alert-pictures" />
              </li>
            )}
            {bridge && (
              <li>
                <span>The bridge goes offline</span>
                <Switch label="The bridge goes offline" checked={has('offline')} onChange={(v) => toggle('offline', v)} testId="alert-offline" />
              </li>
            )}
          </ul>
          {bridge && prefs.pictures && <p className="muted dv-alerts-how">Pictures come from the printer’s camera on first and third layer, your layer, paused, failed, error, almost done and finished.{isIos() ? ' iPhone shows alerts without the picture.' : ''}</p>}
          <div className="dv-row">
            <button className="secondary" onClick={() => void a.test()} disabled={a.busy} data-testid="alert-test">
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
        <p className="dv-error-text" role="alert">
          {a.error}
        </p>
      )}
    </Card>
  );
}

/** "Tell me after layer N": for this print, or the next one. */
export function LayerField({ prefs, onSet, label = 'Tell me after layer' }: { prefs: AlertPrefs; onSet(layer: number | null): void; label?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = Number(draft);
    setDraft(null);
    const layer = draft.trim() === '' ? null : Number.isInteger(n) && n >= 1 ? n : prefs.layer;
    if (layer !== prefs.layer) onSet(layer);
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
          placeholder="–"
          aria-label={label}
          value={draft ?? (prefs.layer != null ? String(prefs.layer) : '')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          data-testid="alert-layer"
        />
      </span>
    </>
  );
}
