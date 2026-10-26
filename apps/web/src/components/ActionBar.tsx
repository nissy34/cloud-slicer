import { useEffect, useState } from 'react';
import { sendToPrinter } from '../device';
import type { SliceWarning } from '../engine/protocol';
import { sentence, stageLabel } from '../lib/format';
import { clearanceProblems } from '../lib/clearance';
import { blocksPrinting, OBJECT_CLASHED } from '../lib/outside';
import { newPrintId, withPrintTag } from '../lib/prints';
import { LIGHT_TRIANGLES, triangleCount } from '../lib/simplify';
import { useProjects } from '../state/projects';
import { useObjectsOutside, useSlicer } from '../state/store';
import { usePresetSettings } from './PresetSettingsDialog';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

const busy0 = (kind: string) => kind === 'loading' || kind === 'slicing';
const mm = (v: number) => `${Math.round(v * 10) / 10} mm`;

export function ActionBar() {
  const { engine, engineMessage, project, plate, job, notice, noticeWarn, heavy, simplifyHeavy, slice, cancelSlice, setTab, tab, slicedAway, viewSlice } = useSlicer();
  // A problem with the open tool shows in its card, where the eye is.
  const toolOpen = useSlicer((s) => !!(s.tool || s.paint));
  const errorHere = job.kind === 'error' && !(job.inTool && toolOpen);
  const warnings = useSliceWarnings();
  const unprintable = warnings.some(blocksPrinting);
  // Objects over the plate's edge, which desktop won't slice (shown darker in the 3D view).
  const outside = useObjectsOutside();
  const clashed = outside.length > 0 && project && (job.kind === 'idle' || job.kind === 'sliced' || (job.kind === 'error' && !errorHere));

  // Printing object by object: what the slice would refuse because the tool head would hit an object.
  const clearance = useSlicer((s) => s.clearance);
  const tooClose = clearance ? clearanceProblems(clearance.error) : [];
  const blocked = tooClose.length > 0 && !busy0(job.kind);

  if (engine === 'failed') return <EngineFailed message={engineMessage} />;

  const onPlate = project?.plates[plate]?.objects.length ?? 0;
  const busy = job.kind === 'loading' || job.kind === 'slicing';
  const plateLabel = (project?.plates.length ?? 0) > 1 ? `Slice plate ${plate + 1}` : 'Slice plate';
  // As desktop names it: the engine fills the process preset's filename_format in, whose {plate_number} tells plates apart.
  const gcodeName = job.kind === 'sliced' ? job.result.fileName || 'plate.gcode' : '';
  // A printer that takes a .gcode.3mf (its "Use 3MF instead of G-code") gets the plate in one, named like desktop's.
  const bundle = job.kind === 'sliced' ? job.gcode3mf : undefined;
  const fileName = bundle ? gcodeName.replace(/\.gcode$/i, '') + '.gcode.3mf' : gcodeName;
  // A saved project's plate, for the print history; its G-code carries the tag line (lib/prints.ts).
  // Each send or download gets its own print id, the record a send makes.
  const printOrigin = () => {
    const projectId = useProjects.getState().current.id;
    return projectId && job.kind === 'sliced' && job.printed ? { projectId, plate: job.plate, ...job.printed, printId: newPrintId() } : undefined;
  };
  const tagged = async (origin = printOrigin()) => {
    if (job.kind !== 'sliced') throw new Error('not sliced');
    return origin ? withPrintTag(job.gcode, origin) : job.gcode;
  };
  return (
    <div className="actionbar" data-testid="actionbar">
      <div className="status" aria-live="polite">
        {engine === 'starting' && <span className="muted">Loading the engine and Snapmaker presets…</span>}
        {engine === 'ready' && !clashed && (job.kind === 'idle' || (job.kind === 'error' && !errorHere)) && (
          <span className="muted">
            {onPlate ? 'Ready to slice' : project?.objects.length ? 'This plate is empty' : 'Open a model to start'}
            {(notice || heavy || slicedAway !== null) && '.'}
          </span>
        )}
        {job.kind === 'loading' && <span className="muted">{job.label ?? `Opening ${job.name}`}…</span>}
        {job.kind === 'slicing' && (
          <SliceProgress
            pct={job.pct}
            stage={`${job.plate !== plate ? `Plate ${job.plate + 1}: ` : ''}${stageLabel(job.stage) || 'Slicing'}`}
            onCancel={cancelSlice}
          />
        )}
        {job.kind === 'sliced' && (
          // Time and filament are in the Preview's key and the layers on its slider, as on desktop.
          <span className="stats" data-testid="slice-stats" data-layers={job.result.totalLayers}>
            <span>Sliced in {(job.ms / 1000).toFixed(1)} s</span>
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
        {blocked && clearance && (
          <span className="error-text clearance-notice" role="alert" data-testid="clearance-notice">
            {' '}
            Printing object by object, the tool head needs room: {tooClose.map(sentence).join(' ')} This printer keeps {mm(clearance.radius)} round each object, objects
            printed before others in the same row up to {mm(clearance.rod)} tall and the rest up to {mm(clearance.lid)}.{' '}
            <button className="link" onClick={() => void useSlicer.getState().arrange()}>
              Arrange
            </button>{' '}
            ·{' '}
            <button className="link" onClick={() => usePresetSettings.getState().show({ type: 'printer' })}>
              Printer settings
            </button>
          </span>
        )}
        {slicedAway !== null && (
          <span className="hint" data-testid="sliced-away">
            {' '}
            Plate {slicedAway + 1} sliced ·{' '}
            <button className="link" onClick={() => void viewSlice(slicedAway)}>
              View
            </button>
          </span>
        )}
        {notice && !errorHere && <span className={noticeWarn ? 'hint warn' : 'hint'}> {notice}</span>}
        {warnings.length > 0 && <SliceWarnings warnings={warnings} />}
        {heavy && job.kind === 'idle' && (
          <span className="hint warn" data-testid="heavy-model">
            {' '}
            {(project?.plates.length ?? 0) > 1 ? 'This plate has' : 'This model has'} {triangleCount(heavy.triangles)} triangles, more than a browser can comfortably slice. Simplifying it to
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
            {/* Phones show the short words so all four buttons fit in one row. */}
            <button
              className="secondary"
              aria-label={bundle ? 'Download G-code 3MF' : 'Download G-code'}
              disabled={unprintable}
              title={unprintable ? 'The toolpaths leave the build volume' : bundle ? 'This printer takes the G-code in a .gcode.3mf file' : undefined}
              onClick={async () => download(bundle ?? (await tagged()), fileName)}
            >
              <span className="wide-only">{bundle ? 'Download G-code 3MF' : 'Download G-code'}</span>
              <span className="phone-only">Download</span>
            </button>
            <button
              className="secondary"
              aria-label="Send to printer"
              disabled={unprintable}
              title={unprintable ? 'The toolpaths leave the build volume' : undefined}
              onClick={async () => {
                const origin = printOrigin();
                sendToPrinter(bundle ?? (await tagged(origin)), fileName, useSlicer.getState().selection?.printer, bundle && job.gcode, origin);
                setTab('device');
              }}
            >
              <span className="wide-only">Send to printer</span>
              <span className="phone-only">Send</span>
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
          disabled={!onPlate || busy || engine !== 'ready' || outside.length > 0 || blocked}
          title={blocked ? 'Printing object by object, the tool head would hit an object: see the message beside this button' : undefined}
          onClick={() => void slice()}
        >
          {plateLabel}
        </button>
      </div>
    </div>
  );
}
