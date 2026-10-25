import { useEffect, useMemo, useState } from 'react';
import { formatDuration } from '../../lib/format';
import { currentSession, useDevice } from '../../state/device';
import { job as jobOf, klippyMessage, klippyState, remainingSeconds } from '../status';
import { printObjects } from '../objects';
import { takesCommands, type PrinterError } from '../addons';
import { Card, useConfirm } from './parts';
import { SkipObjectsDialog } from './SkipObjects';

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
  const parts = useMemo(() => printObjects(objects), [objects]);
  const [skipping, setSkipping] = useState(false);
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
  const printingNow = parts.objects.find((o) => o.current && !o.skipped);
  const canSkip = active && parts.objects.length > 0;
  // Klipper learns the objects from the top of the file, so only say they are
  // missing once the print is under way.
  const noObjectList = active && parts.supported && !parts.objects.length && (j.layer != null ? j.layer >= 1 : j.progress > 0.02);

  if (klippy !== 'ready') {
    const host = addons.map((a) => a.host).find(Boolean);
    return (
      <Card title="Print" testId="job-card">
        {takesCommands(addons) ? (
          <>
            <p className="dv-alert">
              {host
                ? klippyMessage(objects) || host.stopped
                : `${klippy === 'startup' ? 'The printer firmware is starting.' : 'The printer firmware has stopped.'} ${klippyMessage(objects)}`}
            </p>
            <PrinterErrors errors={errors} />
            {(!host || host.restart) && (
              <div className="dv-row">
                <button className="secondary" onClick={() => void call(host?.restarting ?? 'Restarting the firmware', (s) => s.firmwareRestart())}>
                  {host?.restart ?? 'Restart firmware'}
                </button>
              </div>
            )}
          </>
        ) : (
          // Not Klipper: the bridge says the printer stopped answering, and it keeps asking.
          <p className="dv-alert">{klippyMessage(objects) || 'The printer is not answering.'}</p>
        )}
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
            {active && printingNow && (
              <div>
                <dt>Printing</dt>
                <dd data-testid="printing-object">{printingNow.label}</dd>
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
      {noObjectList && (
        <p className="dv-note dv-job-note" data-testid="no-object-list">
          This file has no object list, so objects can't be skipped. Files sliced here always have one.
        </p>
      )}
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
        {canSkip && (
          <button className="secondary" onClick={() => setSkipping(true)}>
            Skip objects…
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
      {skipping && canSkip && <SkipObjectsDialog objects={parts.objects} onClose={() => setSkipping(false)} />}
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
