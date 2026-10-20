import { useEffect, useState } from 'react';
import { sendToPrinter } from '../device';
import type { SliceWarning } from '../engine/protocol';
import { formatDuration, formatGrams, gcodeFileName, sentence, stageLabel } from '../lib/format';
import { blocksPrinting, OBJECT_CLASHED } from '../lib/outside';
import { LIGHT_TRIANGLES, triangleCount } from '../lib/simplify';
import { ENGINES } from '../lib/engines';
import { useProjects } from '../state/projects';
import { useFilamentLimit, useObjectsOutside, useSlicer } from '../state/store';
import { filamentLimitMessage } from '../lib/filament-limit';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The engine of an empty project, as a chip: tap it to start the project with
 * the other engine instead. New projects start with the setup wizard's default.
 */
function EngineChip() {
  const flavor = useSlicer((s) => s.flavor);
  const [open, setOpen] = useState(false);
  const current = ENGINES.find((e) => e.id === flavor)!;
  const pick = (id: (typeof ENGINES)[number]['id']) => {
    setOpen(false);
    if (id !== flavor) void useProjects.getState().newProject(id);
  };
  return (
    <span className="engine-chip-wrap">
      <button className="engine-chip" aria-haspopup="menu" aria-expanded={open} data-testid="engine-chip" onClick={() => setOpen(!open)}>
        Slicing with {current.name} ▾
      </button>
      {open && (
        <div className="menu-pop engine-chip-menu" role="menu" aria-label="Engine for this project" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <p className="menu-note">Engine for this project</p>
          {ENGINES.map((e) => (
            <button key={e.id} role="menuitemradio" aria-checked={e.id === flavor} onClick={() => pick(e.id)}>
              <span>
                <b>{e.name}</b>
                <span className="muted small"> {e.blurb}</span>
              </span>
              {e.id === flavor && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** The engine start-up error in full, with a button that copies it (and the build and browser) for a bug report. */
function EngineFailed({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  // The first line is the error; any lines after it are the stack.
  const summary = message.split('\n')[0];
  const report = [`The slicing engine could not start: ${message}`, `Engine build: ${import.meta.env.VITE_ENGINE_VERSION}`, `Browser: ${navigator.userAgent}`].join('\n');
  const copy = () =>
    navigator.clipboard.writeText(report).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <div className="actionbar error engine-failed" role="alert">
      <div className="status">
        The slicing engine could not start: {summary}
        <pre className="error-details" data-testid="engine-error">{report}</pre>
      </div>
      <div className="actions">
        <button className="secondary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy error'}
        </button>
      </div>
    </div>
  );
}

/**
 * The slicing progress: a bar with stripes that keep moving (so a long step
 * still looks alive), the percentage, and the step on its own line in full.
 */
function SliceProgress({ pct, stage, onCancel }: { pct: number; stage: string; onCancel: () => void }) {
  const shown = Math.floor(pct);
  return (
    <span className="progress" data-testid="slice-progress">
      <span className="progress-row">
        <span className="progress-bar" role="progressbar" aria-label="Slicing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown} aria-valuetext={`${shown}%, ${stage}`}>
          <span className="progress-fill" style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
        <span className="progress-pct">{shown}%</span>
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </span>
      <span className="stage">{stage}</span>
    </span>
  );
}

/**
 * The slice's warnings, like desktop's notifications: the engine's (empty
 * layers, path conflicts, objects that need support, settings) and the
 * toolpath checks the Preview makes. Desktop leaves out the path conflict
 * when the paths are outside the plate anyway.
 */
function useSliceWarnings(): SliceWarning[] {
  const job = useSlicer((s) => s.job);
  const fromGcode = useSlicer((s) => s.gcodeWarnings);
  if (job.kind !== 'sliced') return [];
  const outside = fromGcode?.gcode === job.gcode ? fromGcode.list : [];
  const engine = job.result.warnings ?? [];
  return [...outside, ...(outside.length ? engine.filter((w) => !w.text.startsWith('Conflicts of G-code paths')) : engine)];
}

/** One line per warning, serious ones first, folded to a count with Hide. */
function SliceWarnings({ warnings }: { warnings: SliceWarning[] }) {
  const options = useSlicer((s) => s.options);
  const gcode = useSlicer((s) => (s.job.kind === 'sliced' ? s.job.gcode : null));
  const [open, setOpen] = useState(true);
  // A new slice shows its warnings again.
  useEffect(() => setOpen(true), [gcode]);
  const serious = warnings.filter((w) => w.level === 'serious').length;
  const sorted = [...warnings].sort((a, b) => Number(b.level === 'serious') - Number(a.level === 'serious'));
  const count = `${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`;
  return (
    <div className="slice-warnings" data-testid="slice-warnings">
      <button className={`warnings-toggle${serious ? ' serious' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">⚠</span> {count}
        <span className="muted"> · {open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="warnings-list">
          {sorted.map((w, k) => (
            <li key={k} className={w.level === 'serious' ? 'serious' : 'warning'}>
              {w.object && !w.text.includes(w.object) && <b>{w.object}: </b>}
              {sentence(w.text)}
              {w.option && <span className="muted"> (setting: {options[w.option]?.label || w.option})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ActionBar() {
  const { engine, engineMessage, project, plate, job, notice, noticeWarn, heavy, simplifyHeavy, slice, cancelSlice, setTab, tab } = useSlicer();
  // A problem with the open tool shows in its card, where the eye is.
  const toolOpen = useSlicer((s) => !!(s.tool || s.paint));
  const errorHere = job.kind === 'error' && !(job.inTool && toolOpen);
  const warnings = useSliceWarnings();
  const unprintable = warnings.some(blocksPrinting);
  // Objects over the plate's edge, which desktop won't slice (shown darker in the 3D view).
  const outside = useObjectsOutside();
  const filamentCount = useSlicer((s) => s.selection?.filaments.length ?? 0);
  const tooManyFilaments = filamentLimitMessage(useFilamentLimit(), filamentCount)?.blocks ?? false;
  const clashed = outside.length > 0 && project && (job.kind === 'idle' || job.kind === 'sliced' || (job.kind === 'error' && !errorHere));

  if (engine === 'failed') return <EngineFailed message={engineMessage} />;

  const onPlate = project?.plates[plate]?.objects.length ?? 0;
  const busy = job.kind === 'loading' || job.kind === 'slicing';
  const plateLabel = (project?.plates.length ?? 0) > 1 ? `Slice plate ${plate + 1}` : 'Slice plate';
  const baseName = project?.fileName || project?.objects[0]?.name || 'plate';
  const plates = project?.plates.length ?? 0;
  const fileName = job.kind === 'sliced' ? gcodeFileName(plates > 1 ? `${baseName.replace(/\.[^.]+$/, '')}-plate${job.plate + 1}` : baseName) : '';
  return (
    <div className="actionbar" data-testid="actionbar">
      <div className="status" aria-live="polite">
        {engine === 'starting' && <span className="muted">Loading the engine and Snapmaker presets…</span>}
        {engine === 'ready' && !clashed && (job.kind === 'idle' || (job.kind === 'error' && !errorHere)) && (
          <span className="muted">
            {onPlate ? 'Ready to slice' : project?.objects.length ? 'This plate is empty' : 'Open a model to start'}
            {(notice || heavy) && '.'}
          </span>
        )}
        {engine === 'ready' && !project?.objects.length && job.kind !== 'loading' && <EngineChip />}
        {job.kind === 'loading' && <span className="muted">{job.label ?? `Opening ${job.name}`}…</span>}
        {job.kind === 'slicing' && (
          <SliceProgress pct={job.pct} stage={stageLabel(job.stage) || 'Slicing'} onCancel={cancelSlice} />
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
        {job.kind === 'sliced' && job.outdated && (
          <span className="hint warn" data-testid="layer-codes-outdated">
            {' '}
            Layer changes (pauses, filament, G-code) aren't in the G-code yet: slice again.
          </span>
        )}
        {errorHere && (
          <span className="error-text" role="alert">
            {sentence(job.message)}
          </span>
        )}
        {clashed && (
          <span className="error-text" role="alert" data-testid="objects-outside">
            {' '}
            {OBJECT_CLASHED} ({outside.map((o) => project.objects[o]?.name).join(', ')})
          </span>
        )}
        {notice && !errorHere && <span className={noticeWarn ? 'hint warn' : 'hint'}> {notice}</span>}
        {warnings.length > 0 && <SliceWarnings warnings={warnings} />}
        {heavy && job.kind === 'idle' && (
          <span className="hint warn" data-testid="heavy-model">
            {' '}
            This model has {triangleCount(heavy.triangles)} triangles, more than a browser can comfortably slice. Simplifying it to
            about {triangleCount(LIGHT_TRIANGLES)} keeps plenty of detail for printing{heavy.painted ? ', but removes its paint' : ''}.
          </span>
        )}
      </div>
      <div className="actions">
        {job.kind === 'sliced' && (
          <>
            {tab !== 'preview' && (
              <button className="secondary" onClick={() => setTab('preview')}>
                Preview
              </button>
            )}
            <button className="secondary" disabled={unprintable} title={unprintable ? 'The toolpaths leave the build volume' : undefined} onClick={() => download(job.gcode, fileName)}>
              Download G-code
            </button>
            <button
              className="secondary"
              disabled={unprintable}
              title={unprintable ? 'The toolpaths leave the build volume' : undefined}
              onClick={() => {
                sendToPrinter(job.gcode, fileName, useSlicer.getState().selection?.printer);
                setTab('device');
              }}
            >
              Send to printer
            </button>
          </>
        )}
        {heavy && job.kind === 'idle' && (
          <button className="secondary" onClick={() => void simplifyHeavy()}>
            Simplify model
          </button>
        )}
        <button
          className="primary"
          disabled={!onPlate || busy || engine !== 'ready' || outside.length > 0 || tooManyFilaments}
          title={tooManyFilaments ? 'More filaments than heads: see Filament' : undefined}
          onClick={() => void slice()}
        >
          {plateLabel}
        </button>
      </div>
    </div>
  );
}
