import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../../lib/format';
import { currentSession, useDevice } from '../../state/device';
import { job as jobOf, klippyMessage, klippyState, remainingSeconds } from '../status';
import { printObjects } from '../objects';
import { takesCommands, type PrinterError } from '../addons';
import { Card, useConfirm } from './parts';
import { SkipObjectsDialog } from './SkipObjects';
import { Note } from '../../components/Note';

/** Word keys for each print state. */
const STATE_LABEL: Record<string, string> = {
  standby: 'deviceJob.ready',
  printing: 'deviceJob.printing',
  paused: 'deviceJob.paused',
  complete: 'deviceJob.finished',
  cancelled: 'deviceJob.cancelled',
  error: 'deviceJob.error',
};

export function JobCard() {
  const { t } = useTranslation();
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
      <Card title={t('deviceCards.print')} testId="job-card">
        {takesCommands(addons) ? (
          <>
            <Note tone="warn">
              {host
                ? klippyMessage(objects) || host.stopped
                : `${klippy === 'startup' ? t('deviceJob.firmwareStarting') : t('deviceJob.firmwareStopped')} ${klippyMessage(objects)}`}
            </Note>
            <PrinterErrors errors={errors} />
            {(!host || host.restart) && (
              <div className="dv-row">
                <button className="secondary" onClick={() => void call(host?.restarting ?? t('deviceJob.restarting'), (s) => s.firmwareRestart())}>
                  {host?.restart ?? t('deviceJob.restart')}
                </button>
              </div>
            )}
          </>
        ) : (
          // Not Klipper: the bridge says the printer stopped answering, and it keeps asking.
          <Note tone="warn">{klippyMessage(objects) || t('deviceJob.notAnswering')}</Note>
        )}
      </Card>
    );
  }

  return (
    <Card title={t('deviceCards.print')} testId="job-card">
      <div className="dv-job-head">
        <span className={`dv-badge ${errors.length && !active ? 'error' : j.state}`} data-testid="print-state">
          {errors.length && !active ? t('deviceJob.needsAttention') : activity && !active ? activity : t(STATE_LABEL[j.state])}
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
              <dt>{t('deviceJob.done')}</dt>
              <dd>{pct}%</dd>
            </div>
            <div>
              <dt>{t('deviceJob.printingFor')}</dt>
              <dd>{formatDuration(j.printSeconds)}</dd>
            </div>
            {active && (
              <div>
                <dt>{t('deviceJob.left')}</dt>
                <dd>{remaining != null ? formatDuration(remaining) : '–'}</dd>
              </div>
            )}
            {j.totalLayers != null && (
              <div>
                <dt>{t('deviceJob.layer')}</dt>
                <dd>
                  {t('deviceJob.layerOf', { layer: j.layer ?? 0, total: j.totalLayers })}
                </dd>
              </div>
            )}
            {active && printingNow && (
              <div>
                <dt>{t('deviceJob.printingNow')}</dt>
                <dd data-testid="printing-object">{printingNow.label}</dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <p className="muted dv-job-idle">
          {j.state === 'error' && j.message ? j.message : t('deviceJob.idle')}
        </p>
      )}
      {j.message && active && <p className="muted">{j.message}</p>}
      {noObjectList && (
        <Note testId="no-object-list">
          {t('deviceJob.noObjectList')}
        </Note>
      )}
      <div className="dv-row">
        {j.state === 'printing' && (
          <button className="secondary" onClick={() => void call(t('deviceJob.pausing'), (s) => s.pause())}>
            {t('deviceJob.pause')}
          </button>
        )}
        {j.state === 'paused' && (
          <button className="primary" onClick={() => void call(t('deviceJob.resuming'), (s) => s.resume())}>
            {t('deviceJob.resume')}
          </button>
        )}
        {canSkip && (
          <button className="secondary" onClick={() => setSkipping(true)}>
            {t('deviceJob.skipObjects')}
          </button>
        )}
        {active && (
          <button
            className="secondary danger"
            onClick={() =>
              confirm({
                action: t('deviceJob.cancelPrint'),
                text: t('deviceJob.cancelText', { file: j.filename }),
                danger: true,
                run: () => void call(t('deviceJob.cancelling'), (s) => s.cancel()),
              })
            }
          >
            {t('deviceJob.cancelPrint')}
          </button>
        )}
        {!active && j.filename && (
          <button className="secondary" onClick={() => openPrintDialog({ kind: 'file', path: j.filename })}>
            {t('deviceJob.printAgain')}
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
  const { t } = useTranslation();
  if (!errors.length) return null;
  return (
    <div className="dv-errors" data-testid="printer-errors">
      {errors.map((e) => (
        <Note key={e.id} tone="error" className="dv-error" testId="printer-error">
          <strong>{e.title}</strong>
          <p>{e.text}</p>
          <div className="dv-error-foot">
            <span className="muted">{t('deviceJob.errorCode', { code: e.code })}</span>
            {e.once && (
              <button className="quiet" onClick={() => currentSession()?.dismissError(e.id)}>
                {t('common.close')}
              </button>
            )}
          </div>
        </Note>
      ))}
    </div>
  );
}
