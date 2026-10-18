import type {
  OptionDef,
  PaintKind,
  PaintOverlay,
  PaintRay,
  PaintSettings,
  OrcaConfig,
  PresetSummary,
  PresetsLoaded,
  PreviewMesh,
  ProjectInfo,
  SelectResult,
  Selection,
  SliceResult,
  WorkerReply,
} from './protocol';

export type CutKeep = 'both' | 'upper' | 'lower';

type Pending = { resolve: (value: unknown) => void; reject: (e: Error) => void };

export interface EngineEvents {
  onReady(presets: PresetsLoaded): void;
  onProgress(pct: number, stage: string): void;
  onFatal(message: string): void;
}

/** Promise wrapper around the engine worker. Requests run in order. */
export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private events: EngineEvents) {
    this.worker = new Worker(`/engine/engine-worker.js?v=${import.meta.env.VITE_ENGINE_VERSION}`, { name: 'engine' });
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => this.receive(data);
    this.worker.onerror = (e) => events.onFatal(e.message || 'The engine worker failed to load.');
  }

  private receive(reply: WorkerReply) {
    switch (reply.type) {
      case 'ready':
        this.events.onReady(reply.presets);
        return;
      case 'progress':
        this.events.onProgress(reply.pct, reply.stage);
        return;
      case 'error':
        if (reply.id == null) {
          this.events.onFatal(reply.message);
          return;
        }
        this.pending.get(reply.id)?.reject(new Error(reply.message));
        this.pending.delete(reply.id);
        return;
      case 'result':
        this.pending.get(reply.id)?.resolve(reply.value);
        this.pending.delete(reply.id);
    }
  }

  private call<T>(method: string, args: unknown[] = [], transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, method, args }, transfer);
    });
  }

  printers = () => this.call<PresetSummary[]>('printers');
  select = (selection: Partial<Selection>) => this.call<SelectResult>('select', [selection]);
  fullConfig = (overrides: OrcaConfig) => this.call<{ config: OrcaConfig; errors: string[] }>('fullConfig', [overrides]);
  presetConfig = (type: string, name: string) => this.call<OrcaConfig | null>('presetConfig', [type, name]);
  options = () => this.call<Record<string, OptionDef>>('options');
  modelInfo = () => this.call<ProjectInfo>('modelInfo');
  fileConfig = () => this.call<OrcaConfig>('fileConfig');

  async load(file: File, plate: number, printableArea: string) {
    const bytes = await file.arrayBuffer();
    return this.call<{ objectsAdded: number; isProject: boolean; info: ProjectInfo }>(
      'load', [file.name, bytes, plate, printableArea], [bytes]);
  }
  clear = () => this.call<ProjectInfo>('clear');
  preview = (plate: number) => this.call<PreviewMesh>('preview', [plate]);
  transform = (o: number, i: number, changes: { offset?: [number, number]; plate?: number; rotation?: number[]; scale?: number[] }) =>
    this.call<ProjectInfo>('transform', [o, i, changes]);
  setExtruder = (o: number, volume: number, filament: number) => this.call<ProjectInfo>('setExtruder', [o, volume, filament]);
  deleteObject = (o: number) => this.call<ProjectInfo>('deleteObject', [o]);
  addInstance = (o: number, i: number, dx: number, dy: number) => this.call<ProjectInfo>('addInstance', [o, i, dx, dy]);
  deleteInstance = (o: number, i: number) => this.call<ProjectInfo>('deleteInstance', [o, i]);
  resizePlates = (width: number, depth: number) => this.call<ProjectInfo>('resizePlates', [width, depth]);
  arrangePlate = (plate: number, spacing: number) => this.call<ProjectInfo>('arrangePlate', [plate, spacing]);
  orientObject = (o: number) => this.call<ProjectInfo>('orientObject', [o]);
  splitObject = (o: number) => this.call<ProjectInfo>('splitObject', [o]);
  cutObject = (o: number, i: number, z: number, keep: CutKeep, flipUpper: boolean) =>
    this.call<ProjectInfo>('cutObject', [o, i, z, keep, flipUpper]);
  paint = (plate: number, options: PaintSettings & { rays: PaintRay[] }) =>
    this.call<{ info: ProjectInfo; preview?: PreviewMesh; overlay?: PaintOverlay }>('paint', [plate, options]);
  paintOverlay = (plate: number, kind: PaintKind) => this.call<PaintOverlay>('paintOverlay', [plate, kind]);
  clearPaint = (o: number, kind: PaintKind | 'all') => this.call<ProjectInfo>('clearPaint', [o, kind]);
  mirrorInstance = (o: number, i: number, axis: 0 | 1 | 2) => this.call<ProjectInfo>('mirrorInstance', [o, i, axis]);
  setObjectSettings = (o: number, volume: number, values: Record<string, string | null>) =>
    this.call<ProjectInfo>('setObjectSettings', [o, volume, values]);
  addPlate = () => this.call<ProjectInfo>('addPlate');
  deletePlate = (plate: number) => this.call<ProjectInfo>('deletePlate', [plate]);
  slice = (plate: number, overrides: OrcaConfig) =>
    this.call<{ result: SliceResult; gcode: ArrayBuffer; ms: number }>('slice', [plate, overrides]);
}
