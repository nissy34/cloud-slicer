import { formatDuration, formatGrams, gcodeFileName, stageLabel } from '../lib/format';
import { useSlicer } from '../state/store';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ActionBar() {
  const { engine, engineMessage, model, job, slice } = useSlicer();

  if (engine === 'failed') {
    return (
      <div className="actionbar error" role="alert">
        The slicing engine could not start: {engineMessage}
      </div>
    );
  }

  const busy = job.kind === 'loading' || job.kind === 'slicing';
  return (
    <div className="actionbar" data-testid="actionbar">
      <div className="status" aria-live="polite">
        {engine === 'starting' && <span className="muted">Loading the engine…</span>}
        {engine === 'ready' && job.kind === 'idle' && (
          <span className="muted">{model ? 'Ready to slice' : 'Open a model to start'}</span>
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
              <b>{formatGrams(job.result.estimatedFilamentGrams)}</b> filament
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
      </div>
      <div className="actions">
        {job.kind === 'sliced' && model && (
          <button className="secondary" onClick={() => download(job.gcode, gcodeFileName(model.name))}>
            Download G-code
          </button>
        )}
        <button className="primary" disabled={!model || busy || engine !== 'ready'} onClick={slice}>
          Slice
        </button>
      </div>
    </div>
  );
}
