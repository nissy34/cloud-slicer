// What the loading screen over the 3D view shows: the engine starting, a
// project downloading from the account, or a file opening. null when idle.
import { i18n } from '../i18n';
import { useProjects } from './projects';
import { useSlicer, type EngineStatus, type Job, type SlicerState } from './store';

export interface Loading {
  label: string;
  /** Bytes so far, of `total` (0 or missing when unknown). */
  loaded?: number;
  total?: number;
  /** 0..1, when known some other way than bytes. */
  progress?: number;
  /** A second line; by default the downloaded bytes. */
  detail?: string;
}

const ENGINE_LABELS = {
  download: 'loadingScreen.download',
  setup: 'loadingScreen.setup',
  printers: 'loadingScreen.printers',
};

export function loadingState(
  engine: EngineStatus,
  engineLoad: SlicerState['engineLoad'],
  job: Job,
  downloading: { name: string; loaded: number; total: number } | null,
): Loading | null {
  if (engine === 'starting') {
    const { stage, loaded, total } = engineLoad;
    return stage === 'download' ? { label: i18n.t(ENGINE_LABELS.download), loaded, total } : { label: i18n.t(ENGINE_LABELS[stage]) };
  }
  if (downloading) return { label: i18n.t('loadingScreen.downloadingProject', { name: downloading.name }), loaded: downloading.loaded, total: downloading.total };
  if (job.kind === 'loading') return { label: job.label ?? i18n.t('loadingScreen.opening', { name: job.name }) };
  return null;
}

export function useLoading(): Loading | null {
  const engine = useSlicer((s) => s.engine);
  const engineLoad = useSlicer((s) => s.engineLoad);
  const job = useSlicer((s) => s.job);
  const downloading = useProjects((s) => s.downloading);
  return loadingState(engine, engineLoad, job, downloading);
}
