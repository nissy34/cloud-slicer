// What the loading screen over the 3D view shows: the engine starting, a
// project downloading from the account, or a file opening. null when idle.
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
  download: 'Downloading the slicing engine',
  setup: 'Starting the slicing engine',
  printers: 'Loading your printers and presets',
};

export function loadingState(
  engine: EngineStatus,
  engineLoad: SlicerState['engineLoad'],
  job: Job,
  downloading: { name: string; loaded: number; total: number } | null,
): Loading | null {
  if (engine === 'starting') {
    const { stage, loaded, total } = engineLoad;
    return stage === 'download' ? { label: ENGINE_LABELS.download, loaded, total } : { label: ENGINE_LABELS[stage] };
  }
  if (downloading) return { label: `Downloading “${downloading.name}”`, loaded: downloading.loaded, total: downloading.total };
  if (job.kind === 'loading') return { label: job.label ?? `Opening ${job.name}` };
  return null;
}

export function useLoading(): Loading | null {
  const engine = useSlicer((s) => s.engine);
  const engineLoad = useSlicer((s) => s.engineLoad);
  const job = useSlicer((s) => s.job);
  const downloading = useProjects((s) => s.downloading);
  return loadingState(engine, engineLoad, job, downloading);
}
