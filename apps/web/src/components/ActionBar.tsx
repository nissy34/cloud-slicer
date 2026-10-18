import { formatDuration, formatGrams, gcodeFileName, stageLabel } from '../lib/format';
import { useSlicer } from '../state/store';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ActionBar() {
  const { engine, engineMessage, project, plate, job, notice, noticeWarn, slice, setTab, tab } = useSlicer();

  if (engine === 'failed') {
    // The first line is the error; any lines after it are the stack, for bug reports.
    const [summary, ...stack] = engineMessage.split('\n');
    return (
      <div className="actionbar error" role="alert">
        The slicing engine could not start: {summary}
        {stack.length > 0 && (
          <details>
            <summary>Details</summary>
            <pre>{stack.join('\n')}</pre>
          </details>
        )}
      </div>
    );
  }

  const onPlate = project?.plates[plate]?.objects.length ?? 0;
  const busy = job.kind === 'loading' || job.kind === 'slicing';
  const plateLabel = (project?.plates.length ?? 0) > 1 ? `Slice plate ${plate + 1}` : 'Slice plate';
  const baseName = project?.fileName || project?.objects[0]?.name || 'plate';
  return (
    <div className="actionbar" data-testid="actionbar">
      <div className="status" aria-live="polite">
        {engine === 'starting' && <span className="muted">Loading the engine and Snapmaker presets…</span>}
        {engine === 'ready' && job.kind === 'idle' && (
          <span className="muted">{onPlate ? 'Ready to slice' : project?.objects.length ? 'This plate is empty' : 'Open a model to start'}</span>
        )}
        {job.kind === 'loading' && <span className="muted">Opening {job.name}…</span>}
        {job.kind === 'slicing' && (
          <span className="progress">
            <progress max={100} value={job.pct} />
            <span>{stageLabel(job.stage) || 'Slicing'}</span>
          </span>
        )}
        {job.kind === 'sliced' && (
          <span className="stats" data-testid="slice-stats">
            <span>
              <b>{formatDuration(job.result.estimatedTimeSeconds)}</b> print
            </span>
            <span>
              <b>{formatGrams(job.result.totalFilamentGrams)}</b> filament
            </span>
            <span>
              <b>{job.result.totalLayers}</b> layers
            </span>
            <span className="muted">sliced in {(job.ms / 1000).toFixed(1)} s</span>
          </span>
        )}
        {job.kind === 'error' && (
          <span className="error-text" role="alert">
            {job.message}
          </span>
        )}
        {notice && job.kind !== 'error' && <span className={noticeWarn ? 'hint warn' : 'hint'}> {notice}</span>}
      </div>
      <div className="actions">
        {job.kind === 'sliced' && (
          <>
            {tab !== 'preview' && (
              <button className="secondary" onClick={() => setTab('preview')}>
                Preview
              </button>
            )}
            <button
              className="secondary"
              onClick={() => download(job.gcode, gcodeFileName(project?.plates.length && project.plates.length > 1 ? `${baseName.replace(/\.[^.]+$/, '')}-plate${job.plate + 1}` : baseName))}
            >
              Download G-code
            </button>
          </>
        )}
        <button className="primary" disabled={!onPlate || busy || engine !== 'ready'} onClick={() => void slice()}>
          {plateLabel}
        </button>
      </div>
    </div>
  );
}
