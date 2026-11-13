// The print history on screen (state/prints.ts): the mark on each plate tab,
// "Printed 6 of 10" with the next plate in the top bar, and each plate's
// history window with Mark as printed / not printed and Keep as printed.
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { formatDuration } from '../lib/format';
import { statusWords, type PlateMark, type PrintRecord } from '../lib/prints';
import { changesSince, usePlateMarks, usePrintProgress, usePrints } from '../state/prints';
import { useProjects } from '../state/projects';
import { useAccount } from '../state/account';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';

/** Words for a plate's mark, as the tooltip and the window say it. */
export function markWords(m: PlateMark): string {
  if (m.state === 'printed') return m.record.status === 'marked' ? i18n.t('printHistory.markedPrinted') : i18n.t('printHistory.printed');
  if (m.state === 'changed') return i18n.t('printHistory.printedChanged');
  if (m.state === 'sent') return m.record.status === 'printing' ? i18n.t('printHistory.printing') : i18n.t('printHistory.sentNotFinished');
  return i18n.t('printHistory.notPrinted');
}

/** The same in a word, for a phone's top bar (the mark's colour and the tooltip say the rest). */
export function markShortWords(m: PlateMark): string {
  if (m.state === 'printed') return i18n.t('printHistory.printed');
  if (m.state === 'changed') return i18n.t('printHistory.changed');
  if (m.state === 'sent') return m.record.status === 'printing' ? i18n.t('printHistory.printing') : i18n.t('printHistory.sent');
  return i18n.t('printHistory.notPrinted');
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One line about a record: when, where, how long. */
export function recordLine(r: PrintRecord): string {
  const parts = [when(r.at)];
  if (r.printerName) parts.push(r.printerName);
  parts.push(statusWords(r));
  if (r.duration) parts.push(formatDuration(r.duration));
  return parts.join(' · ');
}

/**
 * Green tick, amber "!", or a blue ring; nothing for a plate never printed.
 * `onOpen`: a tap on it opens the plate's history (on a plate tab, without picking the tab).
 */
export function MarkIcon({ mark, onOpen }: { mark: PlateMark | undefined; onOpen?(): void }) {
  const { t } = useTranslation();
  if (!mark || mark.state === 'none') return null;
  const words = markWords(mark);
  return (
    <span
      className={`print-mark ${mark.state}`}
      aria-label={words}
      title={onOpen ? t('printHistory.tapForHistory', { words }) : words}
      data-testid={`print-mark-${mark.state}`}
      onClick={
        onOpen &&
        ((e) => {
          e.stopPropagation();
          onOpen();
        })
      }
    >
      {mark.state === 'printed' ? '✓' : mark.state === 'changed' ? '!' : ''}
    </span>
  );
}

/** Whether this project can keep a print history: saved online, signed in. */
export function useHistoryAvailable(): boolean {
  const id = useProjects((s) => s.current.id);
  const signedIn = useAccount((s) => s.status === 'signedIn');
  return Boolean(id && signedIn);
}

/** Why there is no history here, for greyed menu items. */
export const noHistoryWords = () => i18n.t('printHistory.noHistory');

/** "Printed 6 of 10" with a small bar, and "Next: plate 7", beside the project name. */
export function PrintProgress() {
  const { t } = useTranslation();
  const progress = usePrintProgress();
  const marks = usePlateMarks();
  const plates = useSlicer((s) => s.project?.plates.length ?? 0);
  const plate = useSlicer((s) => s.plate);
  if (!progress) return null;
  const open = (p: number) => usePrints.getState().openHistory(p);
  if (plates <= 1) {
    // One plate: just its mark.
    const m = marks[0];
    if (!m || m.state === 'none') return null;
    return (
      <button className={`ghost print-progress single ${m.state}`} onClick={() => open(0)} title={t('printHistory.tapForHistory', { words: markWords(m) })} data-testid="print-progress">
        <MarkIcon mark={m} />
        <span className="print-progress-text">
          <span className="wide-only">{markWords(m)}</span>
          <span className="phone-only">{markShortWords(m)}</span>
        </span>
      </button>
    );
  }
  const { printed, changed, total, next } = progress;
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <span className="print-progress-group">
      <button
        className="ghost print-progress"
        onClick={() => open(plate)}
        title={changed ? t('printHistory.progressTitleChanged', { printed, total, changed }) : t('printHistory.progressTitle', { printed, total })}
        data-testid="print-progress"
      >
        <span className="print-progress-text">
          <span className="wide-only">{t('printHistory.printedOf', { printed, total })}</span>
          <span className="phone-only">
            {printed}/{total}
          </span>
        </span>
        <span className="print-bar" aria-hidden="true">
          <span className="print-bar-ok" style={{ width: pct(printed - changed) }} />
          <span className="print-bar-changed" style={{ width: pct(changed) }} />
        </span>
      </button>
      {next !== null && next !== plate && (
        <button className="secondary print-next" onClick={() => void useSlicer.getState().setPlate(next)} title={t('printHistory.nextTitle')} data-testid="print-next">
          {t('printHistory.next', { plate: next + 1 })}
        </button>
      )}
    </span>
  );
}

/** A plate's history: its mark, what changed since, the buttons, and every send. */
export function PrintHistoryDialog() {
  const { t } = useTranslation();
  const plate = usePrints((s) => s.historyPlate);
  const records = usePrints((s) => s.records);
  const error = usePrints((s) => s.error);
  const marks = usePlateMarks();
  const plates = useSlicer((s) => s.project?.plates.length ?? 0);
  const name = useSlicer((s) => (plate !== null ? (s.project?.plates[plate]?.name ?? '') : ''));
  if (plate === null) return null;
  const close = () => usePrints.getState().openHistory(null);
  const mark = marks[plate] ?? { state: 'none' as const };
  const mine = records.filter((r) => r.plate === plate).sort((a, b) => b.at - a.at);
  const changes = mark.state === 'changed' ? changesSince(plate, mark.record) : [];
  const s = usePrints.getState();
  const title =
    plates > 1
      ? name
        ? t('printHistory.titlePlateNamed', { plate: plate + 1, name })
        : t('printHistory.titlePlate', { plate: plate + 1 })
      : t('printHistory.title');
  const printedNow = mark.state === 'printed' || mark.state === 'changed';
  return (
    <Dialog
      title={title}
      onClose={close}
      testId="print-history"
      footer={
        <>
          {printedNow ? (
            <button className="secondary" onClick={() => void s.unmark(plate)} data-testid="print-unmark">
              {t('printHistory.markNotPrinted')}
            </button>
          ) : (
            <button className="secondary" onClick={() => void s.mark(plate)} data-testid="print-mark">
              {t('printHistory.markPrinted')}
            </button>
          )}
          {mark.state === 'changed' && (
            <button className="secondary" onClick={() => void s.keep(plate)} title={t('printHistory.keepTitle')} data-testid="print-keep">
              {t('printHistory.keep')}
            </button>
          )}
          <button className="primary" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="print-history">
        <p className={`print-state ${mark.state}`} data-testid="print-history-state">
          <MarkIcon mark={mark} />
          <b>{markWords(mark)}</b>
          {mark.state !== 'none' && <span className="muted"> {recordLine(mark.record)}</span>}
        </p>
        {mark.state === 'changed' && (
          <div className="print-changes">
            <p>{t('printHistory.sinceThen')}</p>
            {changes.length ? (
              <ul data-testid="print-changes">
                {changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t('printHistory.somethingDifferent')}</p>
            )}
          </div>
        )}
        {mark.state === 'none' && !mine.length && (
          <p className="muted">{t('printHistory.explain')}</p>
        )}
        {mine.length > 0 && (
          <ul className="print-list" data-testid="print-list">
            {mine.map((r) => (
              <li key={r.id}>
                <span className={`print-dot ${r.status}`} aria-hidden="true" />
                <span>
                  {recordLine(r)}
                  {r.file && <span className="muted print-file"> {r.file}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="hint warn" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
