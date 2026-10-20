import { useEffect, useMemo, useState } from 'react';
import { formatDuration } from '../../lib/format';
import { currentSession, useDevice } from '../../state/device';
import { job as jobOf, klippyMessage, klippyState, remainingSeconds } from '../status';
import type { PrinterError } from '../addons';
import { Card, useConfirm } from './parts';

const STATE_LABEL: Record<string, string> = {
  standby: 'Ready',
  printing: 'Printing',
  paused: 'Paused',
  complete: 'Finished',
  cancelled: 'Cancelled',
  error: 'Error',
};

export function JobCard() {
  const objects = useDevice((s) => s.objects);
  const addons = useDevice((s) => s.addons);
  const errors = useDevice((s) => s.errors);
  const call = useDevice((s) => s.call);
  const openPrintDialog = useDevice((s) => s.openPrintDialog);
  const j = useMemo(() => jobOf(objects), [objects]);
  const klippy = klippyState(objects);
  const activity = addons.map((a) => a.activity?.(objects)).find(Boolean) ?? null;
  const [estimate, setEstimate] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  // The slicer's own time estimate makes the remaining time far better than extrapolating.
  useEffect(() => {
    setEstimate(null);
    if (!j.filename) return;
    void currentSession()
      ?.metadata(j.filename)
      .then((m) => setEstimate(typeof m?.estimated_time === 'number' ? m.estimated_time : null));
  }, [j.filename]);

  const active = j.state === 'printing' || j.state === 'paused';
  const remaining = remainingSeconds(j, estimate);
  const pct = Math.round(j.progress * 100);

  if (klippy !== 'ready') {
    return (
      <Card title="Print" testId="job-card">
        <p className="dv-alert">
          {klippy === 'startup' ? 'The printer firmware is starting.' : 'The printer firmware has stopped.'} {klippyMessage(objects)}
        </p>
        <PrinterErrors errors={errors} />
        <div className="dv-row">
          <button className="secondary" onClick={() => void call('Restarting the firmware', (s) => s.firmwareRestart())}>
            Restart firmware
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Print" testId="job-card">
      <div className="dv-job-head">
        <span className={`dv-badge ${errors.length && !active ? 'error' : j.state}`} data-testid="print-state">
          {errors.length && !active ? 'Needs attention' : activity && !active ? activity : STATE_LABEL[j.state]}
        </span>
        {j.filename && (
          <span className="dv-job-file" title={j.filename}>
            {j.filename}
          </span>
        )}
      </div>
      <PrinterErrors errors={errors} />
      {active || j.state === 'complete' ? (
        <>
          <div className="dv-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <dl className="dv-facts">
            <div>
              <dt>Done</dt>
              <dd>{pct}%</dd>
            </div>
            <div>
              <dt>Printing for</dt>
              <dd>{formatDuration(j.printSeconds)}</dd>
            </div>
            {active && (
              <div>
                <dt>Left</dt>
                <dd>{remaining != null ? formatDuration(remaining) : '–'}</dd>
              </div>
            )}
            {j.totalLayers != null && (
              <div>
                <dt>Layer</dt>
                <dd>
                  {j.layer ?? 0} of {j.totalLayers}
                </dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <p className="muted dv-job-idle">
          {j.state === 'error' && j.message ? j.message : 'Send a sliced plate from Prepare, or print a file already on the printer.'}
        </p>
      )}
      {j.message && active && <p className="muted">{j.message}</p>}
      <div className="dv-row">
        {j.state === 'printing' && (
          <button className="secondary" onClick={() => void call('Pausing', (s) => s.pause())}>
            Pause
          </button>
        )}
        {j.state === 'paused' && (
          <button className="primary" onClick={() => void call('Resuming', (s) => s.resume())}>
            Resume
          </button>
        )}
        {active && (
          <button
            className="secondary dv-danger-text"
            onClick={() =>
              confirm({
                action: 'Cancel print',
                text: `Stop printing ${j.filename}? This cannot be resumed.`,
                danger: true,
                run: () => void call('Cancelling', (s) => s.cancel()),
              })
            }
          >
            Cancel print
          </button>
        )}
        {!active && j.filename && (
          <button className="secondary" onClick={() => openPrintDialog({ kind: 'file', path: j.filename })}>
            Print again…
          </button>
        )}
      </div>
      {dialog}
    </Card>
  );
}

/** What the printer is complaining about, in its maker's words, with the code its own app shows. */
function PrinterErrors({ errors }: { errors: PrinterError[] }) {
  if (!errors.length) return null;
  return (
    <div className="dv-errors" data-testid="printer-errors">
      {errors.map((e) => (
        <div key={e.id} className="dv-error" role="alert" data-testid="printer-error">
          <strong>{e.title}</strong>
          <p>{e.text}</p>
          <div className="dv-error-foot">
            <span className="muted">Error code {e.code}</span>
            {e.once && (
              <button className="dv-link" onClick={() => currentSession()?.dismissError(e.id)}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
