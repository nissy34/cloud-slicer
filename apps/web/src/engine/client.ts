import type {
  EngineLoading,
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
import type { Thumbnail } from '../lib/thumbnail';
import type { BrimEars, BrimRequest } from '../lib/brim';
import type { LayerProfile, LayerRequest } from '../lib/layers';
import type { MatchResult, MixRecipe, MixRow } from '../lib/mixing';
import type { SimplifyBy, SimplifyResult } from '../lib/simplify';
import type { MeasureFeature, Measurement } from '../lib/measure';

/** A request to the engine's mixed-filament list (engine/src/mixed_api.cpp). */
export interface MixedRequest {
  definitions: string;
  colours: string[];
  types?: string[];
  nozzles?: number[];
  settings?: Record<string, number | boolean>;
  op?:
    | { kind: 'add'; row: MixRecipe }
    | { kind: 'update'; index: number; row: MixRecipe }
    | { kind: 'delete'; index: number }
    | { kind: 'removePhysical'; filament: number };
  draft?: MixRecipe;
}
export interface MixedReply {
  definitions: string;
  rows: MixRow[];
  draftColour?: string;
  draftCompatible?: boolean;
  /** The project, after an edit that moved its filament IDs. */
  info?: ProjectInfo;
}

export type CutKeep = 'both' | 'upper' | 'lower';

/** Instance changes: offset is on `plate` (mm from its corner), rotation in degrees. */
/** The labels of the edits undo and redo would take back or redo next, or null. */
export interface History {
  undo: string | null;
  redo: string | null;
}

export interface InstanceChanges {
  offset?: [number, number];
  plate?: number;
  rotation?: number[];
  scale?: number[];
}

/** An Orca user preset: `config` is the diff over the system preset it inherits. */
export interface UserPresetFile {
  type: 'printer' | 'filament' | 'process';
  name: string;
  inherits: string;
  config: OrcaConfig;
}

/**
 * A preset file as the engine reads it (desktop Orca's import): `parent` is
 * the system preset it goes on, "" when the one it inherits isn't here;
 * `config` its own settings, serialized; `unknown` and `invalid` the keys
 * Orca dropped (not an option here, or not one of this preset type's).
 */
export type ParsedPreset =
  | { ok: false; error: string }
  | {
      ok: true;
      type: 'printer' | 'filament' | 'process';
      name: string;
      version: string;
      inherits: string;
      parent: string;
      filamentId: string;
      unknown: string[];
      invalid: string[];
      config: OrcaConfig;
    };

/** A plate thumbnail for a saved 3MF: RGBA pixels, rows top first. */
export interface ProjectThumbnail {
  plate: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

type Pending = { resolve: (value: unknown) => void; reject: (e: Error) => void; progress?: (pct: number, stage: string) => void };

export interface EngineEvents {
  onLoading(loading: EngineLoading): void;
  onReady(presets: PresetsLoaded): void;
  onFatal(message: string): void;
}

/** Engine methods that only read: anything else changes what a slice would make. */
const READS = new Set(['printers', 'filamentsFor', 'fullConfig', 'presetConfig', 'options', 'modelInfo', 'fileConfig', 'saveProject', 'preview', 'paintOverlay', 'mixedBlend', 'mixedMatch', 'measureFeature', 'measureBetween', 'slice']);

/** Promise wrapper around the engine worker. Requests run in order. */
export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** The engine's slice cancel cells (see slice in engine-worker.js), when it has them. */
  private cancelCells: Int32Array | null = null;
  /** Request id of the slice the engine is running or will run next, else 0. */
  private sliceId = 0;
  /**
   * Called before a request that changes the project or presets is sent while
   * a slice is running, so the slice can be cancelled instead of finishing
   * first (requests run in order).
   */
  onEditWhileSlicing: (() => void) | null = null;

  constructor(private events: EngineEvents) {
    // bytes: what the engine downloads (wasm + presets), for its progress; the
    // server may compress them, so the response can't tell.
    const query = `v=${import.meta.env.VITE_ENGINE_VERSION}&bytes=${import.meta.env.VITE_ENGINE_BYTES}`;
    this.worker = new Worker(`/engine/engine-worker.js?${query}`, { name: 'engine' });
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => this.receive(data);
    this.worker.onerror = (e) => events.onFatal(e.message || 'The engine worker failed to load.');
  }

  private receive(reply: WorkerReply) {
    switch (reply.type) {
      case 'loading':
        this.events.onLoading(reply.loading);
        return;
      case 'ready':
        this.cancelCells = reply.cancel ?? null;
        this.events.onReady(reply.presets);
        return;
      case 'progress':
        this.pending.get(reply.id)?.progress?.(reply.pct, reply.stage);
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

  private call<T>(method: string, args: unknown[] = [], transfer: Transferable[] = [], progress?: Pending['progress']): Promise<T> {
    // The mix list is only read unless the request edits it.
    const edits =
      !READS.has(method) &&
      !(method === 'mixed' && !(args[0] as MixedRequest).op) &&
      !(method === 'simplify' && (args[1] as { op: string }).op !== 'apply') &&
      !(method === 'brimEars' && (args[3] as BrimRequest).op === 'get') &&
      !(method === 'layerHeights' && (args[2] as LayerRequest).op === 'get');
    if (edits && this.sliceId) this.onEditWhileSlicing?.();
    const id = this.nextId++;
    const done = () => {
      if (this.sliceId === id) this.sliceId = 0;
    };
    if (method === 'slice') this.sliceId = id;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => (done(), resolve(v as T)),
        reject: (e) => (done(), reject(e)),
        progress,
      });
      this.worker.postMessage({ id, method, args }, transfer);
    });
  }

  /** Whether this engine build can cancel a running slice. */
  get canCancel() {
    return this.cancelCells != null;
  }

  /** Stops the running (or queued) slice; its promise rejects with "cancelled". */
  cancelSlice() {
    if (this.sliceId && this.cancelCells) Atomics.store(this.cancelCells, 0, this.sliceId);
  }

  printers = () => this.call<PresetSummary[]>('printers');
  select = (selection: Partial<Selection>) => this.call<SelectResult>('select', [selection]);
  filamentsFor = (printer: string) => this.call<{ filaments: PresetSummary[]; defaults: string[] }>('filamentsFor', [printer]);
  fullConfig = (overrides: OrcaConfig) => this.call<{ config: OrcaConfig; errors: string[] }>('fullConfig', [overrides]);
  presetConfig = (type: string, name: string) => this.call<OrcaConfig | null>('presetConfig', [type, name]);
  /** A user preset as desktop Orca's preset file (JSON text). */
  presetExport = (type: string, name: string) => this.call<string>('presetExport', [type, name]);
  /** Reads preset files without adding them (see ParsedPreset). */
  presetParse = (files: { text: string; rebase?: string }[]) => this.call<ParsedPreset[]>('presetParse', [files]);
  /** Replaces the user presets and reloads all presets (the selection resets). */
  userPresets = (presets: UserPresetFile[]) =>
    this.call<{ printers: number; filaments: number; processes: number }>('userPresets', [presets]);
  options = () => this.call<Record<string, OptionDef>>('options');
  modelInfo = () => this.call<ProjectInfo>('modelInfo');
  fileConfig = () => this.call<OrcaConfig>('fileConfig');

  /** Adds a model file's objects, or opens a 3MF as the project unless geometryOnly. */
  async load(file: File, plate: number, printableArea: string, geometryOnly = false) {
    const bytes = await file.arrayBuffer();
    return this.call<{ objectsAdded: number; isProject: boolean; info: ProjectInfo }>(
      'load', [file.name, bytes, plate, printableArea, geometryOnly], [bytes]);
  }
  /** The open project as an Orca 3MF project file (desktop's Save project). */
  saveProject = (overrides: OrcaConfig, thumbnail: ProjectThumbnail | null) =>
    this.call<ArrayBuffer>('saveProject', [overrides, thumbnail], thumbnail ? [thumbnail.pixels.buffer] : []);
  clear = () => this.call<ProjectInfo>('clear');
  preview = (plate: number) => this.call<PreviewMesh>('preview', [plate]);
  transform = (o: number, i: number, changes: InstanceChanges) =>
    this.call<ProjectInfo>('transform', [o, i, changes]);
  setExtruder = (o: number, volume: number, filament: number) => this.call<ProjectInfo>('setExtruder', [o, volume, filament]);
  deleteObject = (o: number) => this.call<ProjectInfo>('deleteObject', [o]);
  addInstance = (o: number, i: number, dx: number, dy: number) => this.call<ProjectInfo>('addInstance', [o, i, dx, dy]);
  deleteInstance = (o: number, i: number) => this.call<ProjectInfo>('deleteInstance', [o, i]);
  resizePlates = (width: number, depth: number) => this.call<ProjectInfo>('resizePlates', [width, depth]);
  arrangePlate = (plate: number, spacing: number) => this.call<ProjectInfo>('arrangePlate', [plate, spacing]);
  orientObject = (o: number) => this.call<ProjectInfo>('orientObject', [o]);
  splitObject = (o: number) => this.call<ProjectInfo>('splitObject', [o]);
  splitParts = (o: number) => this.call<ProjectInfo>('splitParts', [o]);
  cutObject = (o: number, i: number, z: number, keep: CutKeep, flipUpper: boolean) =>
    this.call<ProjectInfo>('cutObject', [o, i, z, keep, flipUpper]);
  paint = (plate: number, options: PaintSettings & { rays: PaintRay[] }) =>
    this.call<{ info: ProjectInfo; preview?: PreviewMesh; overlay?: PaintOverlay }>('paint', [plate, options]);
  paintOverlay = (plate: number, kind: PaintKind) => this.call<PaintOverlay>('paintOverlay', [plate, kind]);
  mixed = (request: MixedRequest) => this.call<MixedReply>('mixed', [request]);
  /** FilamentMixer blends of `colours`, one per weight list. */
  mixedBlend = (colours: string[], weights: number[][]) => this.call<string[]>('mixedBlend', [{ colours, weights }]);
  mixedMatch = (request: { colours: string[]; types: string[]; target: string; minPercent: number }) =>
    this.call<MatchResult>('mixedMatch', [request]);
  /** Object o's triangle count, and with `by` its count after simplifying (nothing changes). */
  simplifyPreview = (o: number, by?: SimplifyBy) => this.call<SimplifyResult>('simplify', [o, by ? { op: 'preview', ...by } : { op: 'get' }]);
  /** Simplifies object o's parts, like desktop's Simplify (its paint goes). */
  simplifyApply = (o: number, by: SimplifyBy) => this.call<ProjectInfo>('simplify', [o, { op: 'apply', ...by }]);
  /** Object o's brim ears (seen from instance i), after the edit in `request` (see BrimRequest). */
  brimEars = (o: number, i: number, overrides: OrcaConfig, request: BrimRequest) =>
    this.call<BrimEars>('brimEars', [o, i, overrides, request]);

  /** Object o's variable layer height profile, after the edit in `request` (see LayerRequest). */
  layerHeights = (o: number, overrides: OrcaConfig, request: LayerRequest) =>
    this.call<LayerProfile>('layerHeights', [o, overrides, request]);
  /** Measure tool: the point, edge, circle or plane under a ray (`keep`: feature ids still in use). */
  measureFeature = (plate: number, options: { ray: PaintRay; onlyPlane?: boolean; keep: number[] }) =>
    this.call<MeasureFeature | null>('measureFeature', [plate, options]);
  measureBetween = (a: number, b: number) => this.call<Measurement>('measureBetween', [a, b]);
  clearPaint = (o: number, kind: PaintKind | 'all') => this.call<ProjectInfo>('clearPaint', [o, kind]);
  /** Remembers the project before an edit called `label`, for undo. */
  snapshot = (label: string) => this.call<History>('snapshot', [label]);
  dropSnapshot = () => this.call<History>('dropSnapshot');
  clearHistory = () => this.call<History>('clearHistory');
  undo = () => this.call<{ history: History; info: ProjectInfo }>('undo');
  redo = () => this.call<{ history: History; info: ProjectInfo }>('redo');
  mirrorInstance = (o: number, i: number, axis: 0 | 1 | 2) => this.call<ProjectInfo>('mirrorInstance', [o, i, axis]);
  setObjectSettings = (o: number, volume: number, values: Record<string, string | null>) =>
    this.call<ProjectInfo>('setObjectSettings', [o, volume, values]);
  addPlate = () => this.call<ProjectInfo>('addPlate');
  deletePlate = (plate: number) => this.call<ProjectInfo>('deletePlate', [plate]);
  calibrate = (options: Record<string, unknown>, overrides: OrcaConfig) =>
    this.call<{ overrides: OrcaConfig; info: ProjectInfo }>('calibrate', [options, overrides]);
  calibrationStop = () => this.call<void>('calibrationStop');
  /** `thumbnails`: plate pictures for the G-code (see lib/thumbnail.ts). */
  slice = (plate: number, overrides: OrcaConfig, thumbnails: Thumbnail[], progress: (pct: number, stage: string) => void) =>
    this.call<{ result: SliceResult; gcode: ArrayBuffer; ms: number }>(
      'slice', [plate, overrides, thumbnails], thumbnails.map((t) => t.pixels.buffer as ArrayBuffer), progress);
}
