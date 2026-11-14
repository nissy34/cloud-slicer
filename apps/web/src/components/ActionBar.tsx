import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingText } from '../i18n';
import { sendToPrinter } from '../device';
import type { SliceWarning } from '../engine/protocol';
import { sentence, stageLabel } from '../lib/format';
import { clearanceProblems } from '../lib/clearance';
import { physicalFilaments } from '../lib/mixing';
import { usesPlaAndPetg } from '../lib/option-toggles';
import { blocksPrinting, OBJECT_CLASHED, printedObjects } from '../lib/outside';
import { newPrintId, withPrintTag } from '../lib/prints';
import { LIGHT_TRIANGLES, triangleCount } from '../lib/simplify';
import { useProjects } from '../state/projects';
import { useObjectsOutside, useSlicer } from '../state/store';
import { usePresetSettings } from './PresetSettingsDialog';
import { TriangleAlert } from 'lucide-react';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The engine start-up error in full, with a button that copies it (and the build and browser) for a bug report. */
function EngineFailed({ message }: { message: string }) {
  const { t } = useTranslation();
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
        {t('actionbar.engineFailed', { error: summary })}
        <pre className="error-details" data-testid="engine-error">{report}</pre>
      </div>
      <div className="actions">
        <button className="secondary" onClick={() => void copy()}>
          {copied ? t('common.copied') : t('common.copyError')}
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
  const { t } = useTranslation();
  const shown = Math.floor(pct);
  return (
    <span className="progress" data-testid="slice-progress">
      <span className="progress-row">
        <span className="progress-bar" role="progressbar" aria-label={t('actionbar.slicing')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown} aria-valuetext={`${shown}%, ${stage}`}>
          <span className="progress-fill" style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
        <span className="progress-pct">{shown}%</span>
        <button className="secondary" onClick={onCancel}>
          {t('common.cancel')}
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
  const { t } = useTranslation();
  const options = useSlicer((s) => s.options);
  const gcode = useSlicer((s) => (s.job.kind === 'sliced' ? s.job.gcode : null));
  const [open, setOpen] = useState(true);
  // A new slice shows its warnings again.
  useEffect(() => setOpen(true), [gcode]);
  const serious = warnings.filter((w) => w.level === 'serious').length;
  const sorted = [...warnings].sort((a, b) => Number(b.level === 'serious') - Number(a.level === 'serious'));
  const count = t('actionbar.warnings', { count: warnings.length });
  return (
    <div className="slice-warnings" data-testid="slice-warnings">
      <button className={`warnings-toggle${serious ? ' serious' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <TriangleAlert size={14} aria-hidden /> {count}
        <span className="muted"> · {open ? t('common.hide') : t('common.show')}</span>
      </button>
      {open && (
        <ul className="warnings-list">
          {sorted.map((w, k) => (
            <li key={k} className={w.level === 'serious' ? 'serious' : 'warning'}>
              {w.object && !w.text.includes(w.object) && <b>{w.object}: </b>}
              {sentence(w.text)}
              {w.option && <span className="muted"> {t('actionbar.warningSetting', { setting: settingText(options[w.option]?.label ?? '') || w.option })}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Snapmaker's guide to printing PLA and PETG as support for each other (the link desktop's notice has).
const PLA_PETG_GUIDE = 'https://wiki.snapmaker.com/en/snapmaker_u1/printing_guides/pla_and_petg';
const busy0 = (kind: string) => kind === 'loading' || kind === 'slicing';
const mm = (v: number) => `${Math.round(v * 10) / 10} mm`;

export function ActionBar() {
  const { t } = useTranslation();
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

  // Snapmaker Orca 2.4.1's plate notice: PLA and PETG don't stick to each other.
  const plaPetg = useSlicer(
    (s) => s.flavor === 'snapmaker' && !!s.project && usesPlaAndPetg({ ...s.baseConfig, ...s.overrides }, physicalFilaments(s.project.plates[s.plate]?.filaments ?? [], s.mixes)),
  );

  if (engine === 'failed') return <EngineFailed message={engineMessage} />;

  // Objects off every plate are shown on it, but not printed.
  const onPlate = printedObjects(project, plate).length;
  const busy = job.kind === 'loading' || job.kind === 'slicing';
  // As desktop: once sliced, Slice greys out until something changes (a change drops the slice).
  const upToDate = job.kind === 'sliced' && !job.outdated;
  const plateLabel = (project?.plates.length ?? 0) > 1 ? t('actionbar.slicePlateN', { n: plate + 1 }) : t('actionbar.slicePlate');
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
        {engine === 'starting' && <span className="muted">{t('actionbar.loadingEngine')}</span>}
        {engine === 'ready' && !clashed && (job.kind === 'idle' || (job.kind === 'error' && !errorHere)) && (
          <span className="muted">
            {onPlate ? t('actionbar.ready') : project?.objects.length ? t('actionbar.plateEmpty') : t('actionbar.openToStart')}
            {(notice || heavy || slicedAway !== null) && '.'}
          </span>
        )}
        {job.kind === 'loading' && <span className="muted">{job.label ?? t('actionbar.opening', { name: job.name })}…</span>}
        {job.kind === 'slicing' && (
          <SliceProgress
            pct={job.pct}
            stage={`${job.plate !== plate ? t('actionbar.platePrefix', { n: job.plate + 1 }) : ''}${stageLabel(job.stage) || t('actionbar.slicing')}`}
            onCancel={cancelSlice}
          />
        )}
        {job.kind === 'sliced' && (
          // Time and filament are in the Preview's key and the layers on its slider, as on desktop.
          <span className="stats" data-testid="slice-stats" data-layers={job.result.totalLayers}>
            <span>{t('actionbar.slicedIn', { seconds: (job.ms / 1000).toFixed(1) })}</span>
          </span>
        )}
        {job.kind === 'sliced' && job.outdated && (
          <span className="hint warn" data-testid="layer-codes-outdated">
            {' '}
            {t('actionbar.layerCodesOutdated')}
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
            {t('actionbar.clearance', { problems: tooClose.map(sentence).join(' '), radius: mm(clearance.radius), rod: mm(clearance.rod), lid: mm(clearance.lid) })}{' '}
            <button className="quiet" onClick={() => void useSlicer.getState().arrange()}>
              {t('actionbar.arrange')}
            </button>{' '}
            ·{' '}
            <button className="quiet" onClick={() => usePresetSettings.getState().show({ type: 'printer' })}>
              {t('actionbar.printerSettings')}
            </button>
          </span>
        )}
        {slicedAway !== null && (
          <span className="hint" data-testid="sliced-away">
            {' '}
            {t('actionbar.plateSliced', { n: slicedAway + 1 })} ·{' '}
            <button className="quiet" onClick={() => void viewSlice(slicedAway)}>
              {t('actionbar.view')}
            </button>
          </span>
        )}
        {notice && !errorHere && <span className={noticeWarn ? 'hint warn' : 'hint'}> {notice}</span>}
        {plaPetg && !busy && (
          <span className="hint warn" data-testid="pla-petg">
            {' '}
            {t('actionbar.plaPetg')}{' '}
            <a href={PLA_PETG_GUIDE} target="_blank" rel="noreferrer">
              {t('actionbar.howTo')}
            </a>
          </span>
        )}
        {warnings.length > 0 && <SliceWarnings warnings={warnings} />}
        {heavy && job.kind === 'idle' && (
          <span className="hint warn" data-testid="heavy-model">
            {' '}
            {t((project?.plates.length ?? 0) > 1 ? 'actionbar.heavyPlate' : 'actionbar.heavyModel', { triangles: triangleCount(heavy.triangles), light: triangleCount(LIGHT_TRIANGLES) })}
          </span>
        )}
      </div>
      <div className="actions">
        {job.kind === 'sliced' && (
          <>
            {/* Phones have the Preview tab right below the bar. */}
            {tab !== 'preview' && (
              <button className="secondary wide-only-button" onClick={() => setTab('preview')}>
                {t('topbar.preview')}
              </button>
            )}
            {/* Phones show the short words so all four buttons fit in one row. */}
            <button
              className="secondary"
              aria-label={bundle ? t('actionbar.downloadGcode3mf') : t('actionbar.downloadGcode')}
              disabled={unprintable}
              title={unprintable ? t('actionbar.leavesVolume') : bundle ? t('actionbar.takes3mf') : undefined}
              onClick={async () => download(bundle ?? (await tagged()), fileName)}
            >
              <span className="wide-only">{bundle ? t('actionbar.downloadGcode3mf') : t('actionbar.downloadGcode')}</span>
              <span className="phone-only">{t('actionbar.download')}</span>
            </button>
            <button
              className="secondary"
              aria-label={t('actionbar.send')}
              disabled={unprintable}
              title={unprintable ? t('actionbar.leavesVolume') : undefined}
              onClick={async () => {
                const origin = printOrigin();
                sendToPrinter(bundle ?? (await tagged(origin)), fileName, useSlicer.getState().selection?.printer, bundle && job.gcode, origin);
                setTab('device');
              }}
            >
              <span className="wide-only">{t('actionbar.send')}</span>
              <span className="phone-only">{t('actionbar.sendShort')}</span>
            </button>
          </>
        )}
        {heavy && job.kind === 'idle' && (
          <button className="secondary" onClick={() => void simplifyHeavy()}>
            {t('actionbar.simplify')}
          </button>
        )}
        <button
          className="primary"
          disabled={!onPlate || busy || engine !== 'ready' || outside.length > 0 || blocked || upToDate}
          title={
            blocked
              ? t('actionbar.blockedTip')
              : upToDate
                ? t('actionbar.upToDateTip')
                : undefined
          }
          onClick={() => void slice()}
        >
          {plateLabel}
        </button>
      </div>
    </div>
  );
}
