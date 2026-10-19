import { create } from 'zustand';
import { EngineClient, type CutKeep, type History, type InstanceChanges, type MixedReply, type MixedRequest, type ParsedPreset, type ProjectThumbnail, type UserPresetFile } from '../engine/client';
import type {
  PaintOverlay,
  PaintRay,
  PaintSettings,
  EngineLoading,
  OptionDef,
  OrcaConfig,
  PresetSummary,
  PreviewMesh,
  ProjectInfo,
  Selection,
  SettingsLayout,
  SliceResult,
  WipeTower,
} from '../engine/protocol';
import { calibrationOptions, CALIBRATIONS, type CalibrationMode, type CalibrationValues } from '../lib/calibration';
import { bedSize } from '../lib/colour';
import { renderThumbnails, thumbnailSizes } from '../lib/thumbnail';
import { DEFAULT_PRINTER, pickFilamentPreset, splitList, SLOT_COLOURS } from '../lib/presets';
import { emptyProjectMessage, modelProcessKeys, pickProcess, printerLabel, projectOverrides } from '../lib/project-import';
import { accountReady, getUserSetting, presetEditing, useAccount } from './account';
import { installedOnly, SETUP_KEY, type Setup } from '../lib/setup';
import { loadConvertPreference, loadSaved, save, saveConvertPreference } from '../lib/storage';
import { heavyModel, type HeavyModel, type SimplifyBy, type SimplifyResult } from '../lib/simplify';
import type { BrimEars, BrimRequest } from '../lib/brim';
import type { LayerProfile, LayerRequest } from '../lib/layers';
import { sameFeature, type MeasureFeature, type Measurement } from '../lib/measure';
import { mixSettings, palette as mixPalette, type MatchResult, type MixRecipe, type MixRow } from '../lib/mixing';
import { dropPlateTower, moveTower, towerOptions, towersFromConfig, type TowerSpot } from '../lib/wipe-tower';
import { stlName, type ObjectAction } from '../lib/objectMenu';
import type { VolumeAction } from '../lib/volumes';
import type { BooleanRequest } from '../lib/boolean';
import type { TextStyle } from '../lib/fonts';
import { fontInEngine } from './fonts';
import { cameraPosition } from './view';
import { saveFile } from '../lib/preset-files';
import { estimateLayers, slicePercent } from '../lib/slice-progress';

export type Tab = 'prepare' | 'preview' | 'device';
/** The object tool open on the 3D view, like desktop's gizmos (paint has its own state). */
export type Tool = 'move' | 'rotate' | 'scale' | 'flatten' | 'cut' | 'measure' | 'layers' | 'brim' | 'simplify' | 'boolean' | 'text' | 'svg';
/** How a 3MF is opened: as the project (replacing it) or its objects added. */
export type OpenMode = 'project' | 'geometry';
const is3mf = (f: File) => /\.3mf$/i.test(f.name);
const isSvg = (f: File) => /\.svg$/i.test(f.name);
/** How deep a new SVG shape is, mm. */
const SVG_DEPTH = 2;
export type EngineStatus = 'starting' | 'ready' | 'failed';
export type Job =
  | { kind: 'idle' }
  /** label: what the loading screen says, when not "Opening <name>". */
  | { kind: 'loading'; name: string; label?: string }
  | { kind: 'slicing'; pct: number; stage: string }
  | { kind: 'sliced'; plate: number; result: SliceResult; gcode: Blob; ms: number }
  | { kind: 'error'; message: string };

export interface SlicerState {
  tab: Tab;
  engine: EngineStatus;
  engineMessage: string;
  /** While the engine starts: download progress, then setting it up and loading the printers. */
  engineLoad: EngineLoading | { stage: 'printers'; loaded: number; total: number };
  vendorVersion: string;

  printers: PresetSummary[];
  processes: PresetSummary[];
  filaments: PresetSummary[];
  selection: Selection | null;
  /** Full config of the selected presets, before overrides. */
  baseConfig: OrcaConfig;
  /** Values the user changed on top of the presets (Orca option key -> value). */
  overrides: OrcaConfig;
  options: Record<string, OptionDef>;
  layout: SettingsLayout | null;
  /**
   * Flow variant (index into process_flow_support) the settings show and edit
   * for flow-variant options, like desktop's [Standard flow] [High flow] switch.
   */
  flowVariant: number;

  project: ProjectInfo | null;
  plate: number;
  preview: PreviewMesh | null;
  /** The selected instance, and one of its object's volumes when that is picked (in the object list or the 3D view). */
  selected: { object: number; instance: number; volume?: number } | null;
  job: Job;
  notice: string;
  /** The notice is a problem to fix, not just information. */
  noticeWarn: boolean;
  /** The open project has too many triangles to slice comfortably: what Simplify would do. */
  heavy: HeavyModel | null;
  /** Simplifies the heavy project's big objects (see heavy), as one undo step. */
  simplifyHeavy(): Promise<void>;
  /** A 3MF made for a printer we don't have, waiting for the user to convert it. */
  conversion: { from: string; file: OrcaConfig } | null;
  /** Paint mode is on while set: what clicks and drags on the parts paint. */
  paint: PaintSettings | null;
  /** The object tool in use on the selected object. */
  tool: Tool | null;
  /** The object menu (right click, long press or the object list's ⋯), at a point on the page. */
  /** The object menu, or with `volume` the menu of one of its parts, modifiers..., at (x, y) on the page. */
  objectMenu: { object: number; instance: number; volume?: number; x: number; y: number } | null;
  /** Files waiting for the user to say how to open the 3MF among them. */
  pendingOpen: File[] | null;
  /** Rotate in 15° steps (and move/scale in steps) without holding Shift, for touch screens. */
  snap: boolean;
  /** Support, seam or fuzzy skin paint of the plate, while painting it. */
  overlay: PaintOverlay | null;
  /** The calibration test on the plate, and the settings it changed. */
  calibration: { title: string; keys: string[]; previous: OrcaConfig } | null;
  /**
   * Colour mixing: the project's mixed filaments, as Orca saves them
   * (mixed_filament_definitions), and the rows the engine reads from them.
   */
  mixDefinitions: string;
  mixes: MixRow[];
  /** Colour of every filament number: the physical filaments, then the mixes. */
  palette: string[];
  /**
   * Where the prime tower stands on each plate (wipe_tower_x / wipe_tower_y),
   * kept with the project like the mixes, outside the changed settings.
   */
  towers: TowerSpot[];
  /** The prime tower on the plate shown, when it has one (the engine's estimate, or the last slice's size). */
  wipeTower: Extract<WipeTower, { show: true }> | null;

  setTab(tab: Tab): void;
  selectPrinter(name: string): Promise<void>;
  /** Filaments that work with a printer, without selecting it (for the setup wizard). */
  filamentsFor(printer: string): Promise<{ filaments: PresetSummary[]; defaults: string[] }>;
  selectProcess(name: string): Promise<void>;
  /** One preset's own settings, after inheritance. */
  presetConfig(type: 'printer' | 'filament' | 'process', name: string): Promise<OrcaConfig | null>;
  /** A saved user preset as desktop Orca's preset file (JSON text). */
  presetExport(type: 'printer' | 'filament' | 'process', name: string): Promise<string>;
  /** Reads preset files the way desktop's import does, without adding them. */
  presetParse(files: { text: string; rebase?: string }[]): Promise<ParsedPreset[]>;
  /**
   * Gives the engine the user's saved presets (it reloads every preset) and
   * selects again, with `selection` on top of the current one. Changes now
   * saved in a preset stop counting as changes.
   */
  setUserPresets(presets: UserPresetFile[], selection?: Partial<Selection>): Promise<void>;
  setFilament(slot: number, name: string): Promise<void>;
  setColour(slot: number, colour: string): Promise<void>;
  addFilament(): Promise<void>;
  removeFilament(slot: number): Promise<void>;
  setOverride(key: string, value: string | null): void;
  setFlowVariant(index: number): void;
  resetOverrides(keys?: string[]): void;
  /**
   * Adds model files to the project. A single 3MF opens as the project when
   * nothing is loaded; with objects already there the user is asked first
   * (pendingOpen) unless `mode` says. Several 3MFs at once add their objects.
   * Resolves true when a 3MF was opened as the project.
   */
  openFiles(files: File[], mode?: OpenMode): Promise<boolean>;
  cancelOpen(): void;
  setTool(tool: Tool | null): void;
  setSnap(snap: boolean): void;
  /** Height of the Cut tool's plane above the bed, in mm; the 3D view shows it. */
  cutZ: number;
  /** The variable layer height tool's object and its profile, while that tool is open. */
  layers: (LayerProfile & { object: number }) | null;
  /** Reads (op "get") or edits object o's layer height profile; an edit starts a new undo step unless `continues`. */
  editLayers(o: number, request: LayerRequest, continues?: boolean): Promise<void>;
  /**
   * The Measure tool: the feature under the pointer, the (up to two) picked
   * ones and what lies between them, like desktop's Measure gizmo.
   */
  measure: { hover: MeasureFeature | null; picks: MeasureFeature[]; result: Measurement | null; onlyPlane: boolean };
  /** Looks up the feature under a ray from the camera (null: the pointer left the parts). */
  measureHover(ray: PaintRay | null): void;
  /** Picks the feature under `ray` (a tap), else the hovered one; off the parts it starts over. */
  measurePick(ray?: PaintRay): Promise<void>;
  measureReset(): void;
  setMeasureOnlyPlane(onlyPlane: boolean): void;
  setCutZ(z: number): void;
  /** Moves the prime tower on the plate shown (front-left corner, mm). */
  moveWipeTower(x: number, y: number): void;
  /** Asks the engine again for the prime tower of the plate shown. */
  refreshWipeTower(): void;
  /** Object o's triangles, and (with `by`) how many simplifying would leave; changes nothing. */
  simplifyPreview(o: number, by?: SimplifyBy): Promise<SimplifyResult | null>;
  /** Simplifies object o, like desktop's Simplify, as one undo step. */
  simplifyObject(o: number, by: SimplifyBy): Promise<void>;
  /** The brim ears tool's object and its ears, while that tool is open. */
  brim: (BrimEars & { object: number; instance: number }) | null;
  /** Ears picked in the brim ears tool (indices into brim.ears), for removing or resizing. */
  brimPicked: number[];
  /** Size of new ears, mm; null until the tool has read the object's default. */
  brimDiameter: number | null;
  setBrimDiameter(diameter: number): void;
  /** Picks ear i (alone, or added to the picked ones), or clears the picks (-1). */
  pickEar(i: number, add?: boolean): void;
  /** Reads (op "get") or edits the selected object's brim ears; an edit is one undo step. */
  editBrim(request: BrimRequest): Promise<void>;
  /** The open project as an Orca 3MF project file, with the current settings. */
  projectFile(thumbnail: ProjectThumbnail | null): Promise<ArrayBuffer>;
  clearProject(): Promise<void>;
  setPlate(plate: number): Promise<void>;
  select(sel: { object: number; instance: number; volume?: number } | null): void;
  moveInstance(o: number, i: number, x: number, y: number): Promise<void>;
  transformInstance(o: number, i: number, changes: InstanceChanges): Promise<void>;
  setObjectFilament(o: number, volume: number, filament: number): Promise<void>;
  deleteObject(o: number): Promise<void>;
  copyInstance(o: number, i: number): Promise<void>;
  slice(): Promise<void>;
  /** Stops the running slice (desktop's Cancel next to the progress bar). */
  cancelSlice(): void;
  arrange(): Promise<void>;
  /** Object (volume -1) or part settings; null removes a setting. */
  setObjectSettings(o: number, volume: number, values: Record<string, string | null>): Promise<void>;
  addPlate(): Promise<void>;
  deletePlate(): Promise<void>;
  orientObject(o: number): Promise<void>;
  splitObject(o: number): Promise<void>;
  splitParts(o: number): Promise<void>;
  /** Auto-orients one object, or every object on the plate. */
  orient(o?: number): Promise<void>;
  mirror(o: number, i: number, axis: 0 | 1 | 2): Promise<void>;
  openObjectMenu(menu: SlicerState['objectMenu']): void;
  /** One of the object menu's edits (rename, printable, center, scale to fit, units...); one undo step. */
  objectAction(o: number, i: number, request: ObjectAction, label: string): Promise<void>;
  /** Desktop's Clone: `count` copies as new objects, then (optionally) Arrange. */
  cloneObject(o: number, count: number, arrange: boolean): Promise<void>;
  /** Replaces part `volume` of object o with the mesh in an STL file, keeping its place. */
  replaceWithStl(o: number, volume: number, file: File): Promise<void>;
  /**
   * A part, negative part, modifier or support enforcer/blocker of object o
   * added (a shape, or the mesh in `file`), renamed, moved, retyped or deleted;
   * one undo step. The added or changed volume is selected.
   */
  volumeAction(o: number, request: VolumeAction, label: string, file?: File): Promise<void>;
  /**
   * A text shape, like desktop's Text tool, as one undo step: added to object o
   * (null: a new object on the plate) or `volume`'s text and style changed. Picks
   * it; false if it failed.
   */
  textVolume(o: number | null, style: TextStyle, edit: { type: 'part' | 'negative' | 'modifier' } | { volume: number }): Promise<boolean>;
  /**
   * An SVG shape like desktop's SVG tool, as one undo step: from a file onto
   * object o (null: an object of its own), or a new depth or size for one. Picks it; false if it failed.
   */
  svgVolume(
    o: number | null,
    edit: { type: 'part' | 'negative' | 'modifier'; file: File } | { volume: number; depth?: number; width?: number; height?: number },
  ): Promise<boolean>;
  /** Two volumes of object o combined, like desktop's Mesh boolean, as one undo step; picks the result. False if it failed. */
  meshBoolean(o: number, request: BooleanRequest): Promise<boolean>;
  /** Saves instance i of object o as an STL file. */
  exportStl(o: number, i: number): Promise<void>;
  cutObject(o: number, i: number, z: number, keep: CutKeep, flipUpper: boolean): Promise<void>;
  convertProject(printer: string, keepSettings: boolean, remember: boolean): Promise<void>;
  dismissConversion(): void;
  setPaint(paint: PaintSettings | null): Promise<void>;
  /** Paints along rays; newStroke when the pointer just went down. */
  paintStroke(rays: PaintRay[], newStroke: boolean): Promise<void>;
  clearPaint(o: number): Promise<void>;
  /** Labels of the edits undo and redo would take back or redo next. */
  history: History;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Replaces the project with a calibration test, like desktop's Calibration menu. */
  startCalibration(mode: CalibrationMode, values: CalibrationValues): Promise<void>;
  /** Back to normal printing: drops the test's settings (the test model stays). */
  endCalibration(): Promise<void>;
  addMix(recipe: MixRecipe): Promise<void>;
  updateMix(index: number, recipe: MixRecipe): Promise<void>;
  deleteMix(index: number): Promise<void>;
  /** How a recipe would look, and whether its materials can be mixed. */
  previewMix(recipe: MixRecipe): Promise<{ colour: string; compatible: boolean }>;
  /** FilamentMixer blends of the physical filaments, one per weight list. */
  blendFilaments(ids: number[], weights: number[][]): Promise<string[]>;
  /** The closest mix of the physical filaments to a colour (desktop's Match mode). */
  matchColour(target: string, minPercent: number): Promise<MatchResult>;
}

let client: EngineClient | null = null;
/** Counts slices started and stopped; a slice whose number is no longer current is dropped. */
let sliceRun = 0;
/**
 * A copy of the project the engine can reopen if it crashes (the project lives
 * in the engine, so a new engine starts empty): the 3MF it was opened from, or
 * one saved before slicing, with the engine's edit count when it was made.
 */
let saved3mf: { file: File; edits: number } | null = null;
/** What to put back once a restarted engine is up. */
let pendingRestore: { file: File | null; current: boolean; plate: number; slicing: boolean; message: string } | null = null;
/** The engine is restarting: requests the old one dropped are not errors to show. */
let restarting = false;
let presetsWatched = false;

const presetFile = ({ type, name, inherits, config }: UserPresetFile): UserPresetFile => ({ type, name, inherits, config });
/** The user presets the engine has loaded. */
let enginePresets: UserPresetFile[] = [];

export const useSlicer = create<SlicerState>((set, get) => {
  const engine = () => {
    client ??= new EngineClient({
      onLoading: (engineLoad) => set({ engineLoad }),
      onReady: (presets) => {
        set({ vendorVersion: presets.vendorVersion, engineLoad: { ...get().engineLoad, stage: 'printers' } });
        void start();
      },
      onFatal: (message) => {
        // A crash once the engine was up (most likely out of memory while
        // slicing) restarts it; a crash while starting it, or while reopening
        // the project after a restart, leaves it stopped as before.
        if (get().engine === 'ready' || (restarting && pendingRestore?.file)) restart(message);
        else set({ engine: 'failed', engineMessage: message });
      },
    });
    // Like desktop: an edit while slicing stops the slice rather than waiting for it.
    // (Something else may already have replaced the slicing state, like opening a file.)
    client.onEditWhileSlicing = () => (get().job.kind === 'slicing' ? set(stale()) : stopSlice());
    return client;
  };

  // Pictures of the plate for the G-code, in the sizes the printer asks for.
  // Without WebGL the G-code just has none, as desktop's would without a GPU.
  const plateThumbnails = () => {
    const { preview, selection, overrides, baseConfig } = get();
    try {
      return renderThumbnails(preview, get().palette.length ? get().palette : (selection?.colours ?? []), thumbnailSizes(overrides.thumbnails ?? baseConfig.thumbnails));
    } catch (e) {
      console.warn('No plate thumbnail:', e);
      return [];
    }
  };

  const fail = (e: unknown) => {
    if (restarting) return console.warn('While the engine restarted:', e);
    set({ job: { kind: 'error', message: (e as Error).message } });
  };

  // Replaces a crashed engine with a new one, which reopens the project when
  // it is up (see start).
  function restart(message: string) {
    console.warn('The slicing engine crashed and restarts:', message);
    const retry = restarting;
    sliceRun++;
    const old = client;
    client = null;
    restarting = true;
    old?.terminate('The slicing engine restarted.');
    const { project, plate, job } = get();
    // If reopening the project crashed the new engine too, start without it.
    pendingRestore = retry
      ? { file: null, current: false, plate: 0, slicing: false, message: pendingRestore?.message ?? message }
      : {
          file: project?.objects.length ? (saved3mf?.file ?? null) : null,
          current: !!saved3mf && saved3mf.edits === old?.projectEdits,
          plate,
          slicing: job.kind === 'slicing',
          message,
        };
    saved3mf = null;
    set({
      engine: 'starting',
      engineLoad: { stage: 'download', loaded: 0, total: 0 },
      job: { kind: 'idle' },
      project: retry || !pendingRestore.file ? null : project,
      preview: retry || !pendingRestore.file ? null : get().preview,
      selected: null, tool: null, paint: null, overlay: null, layers: null, brim: null, brimPicked: [],
      measure: { ...NO_MEASURE, onlyPlane: get().measure.onlyPlane },
      history: { undo: null, redo: null },
    });
    engine();
  }

  // Puts the project back into a restarted engine, keeping the page's settings,
  // mixes and tower spots (they were never lost).
  async function restore(r: NonNullable<typeof pendingRestore>) {
    const e = engine();
    const crashed = r.slicing ? 'The slicing engine crashed while slicing, most likely because it needed more memory than this browser allows' : 'The slicing engine crashed';
    if (!r.file) {
      set({ project: null, preview: null, notice: `${crashed}, so it restarted. Your project could not be reopened. (${r.message})`, noticeWarn: true });
      return;
    }
    set({ job: { kind: 'loading', name: r.file.name, label: 'Reopening your project' } });
    const area = get().overrides.printable_area ?? get().baseConfig.printable_area ?? '';
    const res = await e.load(r.file, 0, area, false);
    set({ plate: Math.min(r.plate, Math.max(0, res.info.plates.length - 1)), history: await e.clearHistory() });
    await refreshPreview(res.info);
    await checkHeavy().catch((err) => console.warn('Triangle count:', err));
    saved3mf = { file: r.file, edits: e.projectEdits };
    const lost = r.current ? '' : ' Changes made since your last slice were lost.';
    set({ job: { kind: 'idle' }, notice: `${crashed}, so it restarted and reopened your project.${lost} (${r.message})`, noticeWarn: true });
  }

  // The settings as the engine slices and saves them: the user's changes plus
  // the project's mixed filaments.
  const engineOverrides = (): OrcaConfig => ({
    ...get().overrides,
    mixed_filament_definitions: get().mixDefinitions,
    ...towerOptions(get().towers, get().project?.plates.length ?? 1),
  });

  // The prime tower on the plate shown, again after anything that may move,
  // size or remove it. Only the latest request's answer is kept.
  let towerRun = 0;
  async function refreshTower() {
    const run = ++towerRun;
    const { project, plate, job } = get();
    if (!project?.plates[plate]?.objects.length) return set({ wipeTower: null });
    const sliced = job.kind === 'sliced' && job.plate === plate ? job.result.wipeTowerDepth : undefined;
    try {
      const tower = await engine().wipeTower(plate, engineOverrides(), sliced);
      if (run === towerRun) set({ wipeTower: tower.show ? tower : null });
    } catch (e) {
      console.warn('Prime tower:', e);
      if (run === towerRun) set({ wipeTower: null });
    }
  }
  // Coalesced: one look after a burst of changes.
  let towerQueued = false;
  const queueTower = () => {
    if (towerQueued) return;
    towerQueued = true;
    queueMicrotask(() => {
      towerQueued = false;
      if (get().engine === 'ready') void refreshTower();
    });
  };


  // A request about the mix list, with what colours its rows.
  const mixRequest = (extra: Partial<MixedRequest> = {}): MixedRequest => {
    const config = { ...get().baseConfig, ...get().overrides };
    return {
      definitions: get().mixDefinitions,
      colours: get().selection?.colours ?? [],
      types: splitList(config.filament_type),
      ...mixSettings(config),
      ...extra,
    };
  };

  // Keeps the mix rows and the palette in step with the definitions and the
  // filament colours. Edits pass the engine's reply in.
  async function refreshMixes(reply?: MixedReply) {
    const colours = get().selection?.colours ?? [];
    const res = reply ?? (await engine().mixed(mixRequest()));
    set({ mixDefinitions: res.definitions, mixes: res.rows, palette: mixPalette(colours, res.rows) });
  }

  async function editMixes(op: MixedRequest['op']) {
    const res = await engine().mixed(mixRequest({ op }));
    await refreshMixes(res);
    if (res.info) await refreshPreview(res.info);
    else set(stale());
  }

  // Stops the running slice; whatever it returns is dropped.
  const stopSlice = () => {
    sliceRun++;
    client?.cancelSlice();
  };

  // Anything that changes what would be sliced makes the last result stale,
  // and, as on desktop, stops a slice that is running.
  const stale = (): Partial<SlicerState> => {
    const { kind } = get().job;
    if (kind === 'sliced') return { job: { kind: 'idle' } };
    if (kind !== 'slicing') return {};
    stopSlice();
    return { job: { kind: 'idle' }, notice: 'Slicing stopped because something changed. Slice again when ready.', noticeWarn: false };
  };

  async function start() {
    const e = engine();
    try {
      const saved = loadSaved();
      // The user's own presets (this browser's, or the account's) load before
      // the saved selection, which may name one of them.
      // Waits at most a few seconds: offline, the engine starts without user presets
      // and the subscription below adds them when the account answers.
      await accountReady();
      enginePresets = useAccount.getState().presets;
      if (enginePresets.length) await e.userPresets(enginePresets.map(presetFile));
      // Presets saved on another device (or merged at sign-in) reach the engine too.
      if (!presetsWatched) {
        presetsWatched = true;
        useAccount.subscribe((a) => {
          if (a.presets !== enginePresets && get().engine === 'ready' && !presetEditing())
            void get().setUserPresets(a.presets).catch(fail);
        });
      }
      const [printers, options, layout] = await Promise.all([
        e.printers(),
        e.options(),
        fetch(`/engine/settings-layout.json?v=${import.meta.env.VITE_ENGINE_VERSION}`).then((r) => (r.ok ? (r.json() as Promise<SettingsLayout>) : null)),
      ]);
      set({ printers, options, layout });
      const known = saved?.selection && printers.some((p) => p.name === saved.selection?.printer);
      await applySelection(known && saved?.selection ? saved.selection : { printer: DEFAULT_PRINTER });
      const r = pendingRestore;
      if (r) await restore(r);
      pendingRestore = null;
      restarting = false;
      set({ engine: 'ready' });
    } catch (err) {
      // The engine was replaced while starting (it crashed): the new one carries on.
      if (e !== client) return;
      pendingRestore = null;
      restarting = false;
      set({ engine: 'failed', engineMessage: (err as Error).message, job: { kind: 'idle' } });
    }
  }

  async function applySelection(selection: Partial<Selection>) {
    const e = engine();
    const res = await e.select(selection);
    const { config } = await e.fullConfig({});
    set({ selection: res.selection, processes: res.processes, filaments: res.filaments, baseConfig: config, ...stale() });
    persist();
    await refreshMixes();
  }

  // A filament preset for a material: one of the user's installed filaments
  // when one matches, else any compatible preset.
  function pickFilament(filaments: PresetSummary[], type: string | undefined, fallback?: string, source?: string) {
    const installed = installedOnly(filaments, getUserSetting<Setup>(SETUP_KEY)?.filaments);
    const want = (type ?? '').toUpperCase();
    const mine = installed.length < filaments.length && installed.some((f) => (f.filamentType ?? '').toUpperCase() === want);
    return pickFilamentPreset(mine ? installed : filaments, type, fallback, source);
  }

  async function refreshPreview(info?: ProjectInfo) {
    const e = engine();
    const project = info ?? (await e.modelInfo());
    const plate = Math.min(get().plate, Math.max(0, project.plates.length - 1));
    const preview = project.objects.length ? await e.preview(plate) : null;
    const paint = get().paint;
    const overlay = paint && paint.kind !== 'color' && project.objects.length ? await e.paintOverlay(plate, paint.kind) : null;
    const heavy = get().heavy && get().project?.objects.length === project.objects.length ? get().heavy : null;
    set({ project, plate, preview, overlay, heavy, ...stale() });
  }

  // A model with millions of triangles can need more memory to slice than a
  // browser page may have; offer to simplify it as soon as it opens.
  async function checkHeavy() {
    const e = engine();
    const objects = get().project?.objects ?? [];
    const counts = await Promise.all(objects.map((_, o) => e.simplifyPreview(o)));
    const plan = heavyModel(counts.map((c) => c.triangles));
    // Simplifying removes paint, so say so when it would.
    if (get().project?.objects.length === counts.length)
      set({ heavy: plan && { ...plan, painted: plan.objects.some((o) => counts[o].painted) } });
  }

  // Paint dabs queue up while the engine is busy and go over in one call, so
  // a fast drag never falls behind. The last ray of a batch starts the next,
  // so the brush joins them without a gap.
  let strokeQueue: PaintRay[] = [];
  let lastRay: PaintRay | null = null;
  // Measure hovers: one engine lookup at a time, then the latest pointer ray.
  let hoverRay: PaintRay | null | undefined;
  let hovering = false;
  const NO_MEASURE: SlicerState['measure'] = { hover: null, picks: [], result: null, onlyPlane: false };
  let painting = false;
  let strokeStarts = false;  // the next dab begins a stroke: remember the project for undo

  // A 3MF brings its own filaments: one slot per file filament, coloured like
  // the file, with the closest compatible preset of the same material
  // (what desktop Orca does when it opens a project's geometry).
  async function adoptFileFilaments(info: ProjectInfo) {
    const colours = splitList(info.file.filamentColours);
    if (!colours.length) return;
    const types = splitList(info.file.filamentTypes);
    const sources = splitList(info.file.filamentPresets);
    const { filaments, selection } = get();
    const names = colours.map((_, i) => pickFilament(filaments, types[i], selection?.filaments[0], sources[i]));
    await applySelection({ ...selection, filaments: names, colours });
    const extruders = splitList(get().baseConfig.nozzle_diameter ?? '').length;
    if (extruders && colours.length > extruders)
      set({ notice: `This file uses ${colours.length} filaments; the printer has ${extruders} extruders.`, noticeWarn: true });
  }

  // Plates follow the selected printer's bed; objects keep their place
  // relative to the plate centre (desktop does the same when the bed changes).
  async function fitPlates() {
    const { project, overrides, baseConfig } = get();
    if (!project?.objects.length) return;
    const { w, d } = bedSize(overrides.printable_area ?? baseConfig.printable_area);
    if (Math.abs(project.plateWidth - w) < 0.5 && Math.abs(project.plateDepth - d) < 0.5) return;
    await refreshPreview(await engine().resizePlates(w, d));
  }

  function setOverrides(overrides: OrcaConfig) {
    const before = get().overrides;
    set({ overrides, ...stale() });
    // Mix colours follow the colour-mixing settings (bias, Local-Z ...) and the nozzles.
    const affects = (k: string) => k.startsWith('mixed_') || k.startsWith('dithering_') || k === 'nozzle_diameter' || k === 'filament_type';
    if ([...new Set([...Object.keys(before), ...Object.keys(overrides)])].some((k) => affects(k) && before[k] !== overrides[k]))
      void refreshMixes().catch(fail);
  }

  // Saves the preset selection. Changed settings and mixes go with the
  // project (Save / Download 3MF), not across reloads.
  function persist() {
    save({ selection: get().selection });
  }

  const settingsNotice = (n: number, from: string) =>
    n ? `Loaded ${n} setting${n === 1 ? '' : 's'} from ${from}. Changed values are marked in Settings.` : '';

  // A 3MF's own settings: with a printer we have, select the project's presets
  // and apply its changes on top (like opening the project in desktop Orca);
  // otherwise offer to convert it to one of our printers.
  async function importProject(info: ProjectInfo) {
    const e = engine();
    const file = await e.fileConfig();
    // Desktop keeps the project's prime tower spots, whatever printer it was for.
    set({ towers: towersFromConfig(file) });
    const { printers } = get();
    if (!printers.some((p) => p.name === info.file.printer)) {
      const pref = loadConvertPreference();
      if (pref?.auto && printers.some((p) => p.name === pref.printer)) {
        await convert(file, pref.printer, pref.keepSettings);
        return;
      }
      await adoptFileFilaments(info);
      set({ conversion: { from: printerLabel(file), file } });
      return;
    }
    const colours = splitList(info.file.filamentColours);
    const types = splitList(info.file.filamentTypes);
    const presets = splitList(info.file.filamentPresets);
    await applySelection({ printer: info.file.printer, process: '' });
    const { filaments, selection } = get();
    const names = colours.map((_, i) =>
      filaments.some((f) => f.name === presets[i]) ? presets[i] : pickFilament(filaments, types[i], selection?.filaments[0], presets[i]),
    );
    // The engine also finds a process by its old name, and keeps the current one when it can't.
    const process = info.file.process || (selection?.process ?? '');
    await applySelection({ printer: info.file.printer, process, filaments: names.length ? names : selection?.filaments, colours: colours.length ? colours : selection?.colours });
    const { mixed_filament_definitions: mixes = '', ...overrides } = projectOverrides(file, get().baseConfig, get().options);
    // The project's own mixes replace the current ones, as opening it in desktop does.
    set({ mixDefinitions: file.mixed_filament_definitions ?? mixes });
    setOverrides(overrides);
    await refreshMixes();
    set({ notice: settingsNotice(Object.keys(overrides).length, 'the project'), noticeWarn: false });
  }

  // Moves a project to `printer`: its default process of the same layer height,
  // filaments matched by material in the file's colours, and (when asked) the
  // project's model settings on top (layers, walls, infill, supports...).
  // Machine settings (speeds, acceleration, jerk, line widths, calibration,
  // prime tower) and filament settings come from the new printer's presets.
  async function convert(file: OrcaConfig, printer: string, keepSettings: boolean) {
    await applySelection({ printer, process: '' });
    const { filaments, selection, processes } = get();
    const colours = splitList(file.filament_colour);
    const types = splitList(file.filament_type);
    const sources = splitList(file.filament_settings_id);
    const names = colours.map((_, i) => pickFilament(filaments, types[i], selection?.filaments[0], sources[i]));
    await applySelection({
      printer,
      process: pickProcess(processes, file.layer_height, selection?.process ?? ''),
      filaments: names.length ? names : selection?.filaments,
      colours: colours.length ? colours : selection?.colours,
    });
    const overrides = keepSettings ? projectOverrides(file, get().baseConfig, get().options, modelProcessKeys(get().layout)) : {};
    set({ mixDefinitions: file.mixed_filament_definitions ?? '' });
    setOverrides(overrides);
    await refreshMixes();
    set({ conversion: null });
    await fitPlates();
    const from = printerLabel(file);
    const n = Object.keys(overrides).length;
    set({ notice: `Converted from ${from} to ${printer}.${n ? ' ' + settingsNotice(n, 'the project') : ''}`, noticeWarn: false });
  }

  if (typeof Worker !== 'undefined') queueMicrotask(engine);

  const editSelection = async (change: (s: Selection) => Partial<Selection>) => {
    const s = get().selection;
    if (!s) return;
    try {
      await applySelection({ ...s, ...change(s) });
    } catch (e) {
      fail(e);
    }
  };

  // An edit of the project: remembered first, so undo can take it back.
  const projectEdit = async (label: string, op: () => Promise<ProjectInfo>) => {
    const e = engine();
    let remembered = false;
    try {
      set({ history: await e.snapshot(label) });
      remembered = true;
      await refreshPreview(await op());
    } catch (err) {
      if (remembered) set({ history: await e.dropSnapshot().catch(() => get().history) });
      fail(err);
    }
  };

  const stepHistory = async (step: 'undo' | 'redo') => {
    if (!get().history[step]) return;
    try {
      const { history, info } = await engine()[step]();
      const sel = get().selected;
      const gone = sel && !info.objects[sel.object]?.instances[sel.instance];
      const volumeGone = sel && sel.volume !== undefined && !info.objects[sel.object]?.volumes[sel.volume];
      set(gone ? { history, selected: null, tool: null } : volumeGone ? { history, selected: { object: sel.object, instance: sel.instance } } : { history });
      await refreshPreview(info);
    } catch (e) {
      fail(e);
    }
  };

  return {
    // A bridge pairing link opens straight on the Device tab, where its add-printer dialog waits.
    tab: typeof location !== 'undefined' && /[#&]pair=/.test(location.hash) ? 'device' : 'prepare',
    engine: 'starting',
    engineMessage: '',
    engineLoad: { stage: 'download', loaded: 0, total: 0 },
    vendorVersion: '',
    printers: [],
    processes: [],
    filaments: [],
    selection: null,
    baseConfig: {},
    overrides: {},
    options: {},
    layout: null,
    flowVariant: 0,
    project: null,
    plate: 0,
    preview: null,
    selected: null,
    job: { kind: 'idle' },
    notice: '',
    noticeWarn: false,
    heavy: null,
    conversion: null,
    paint: null,
    tool: null,
    objectMenu: null,
    pendingOpen: null,
    snap: false,
    history: { undo: null, redo: null },
    cutZ: 0,
    brim: null,
    brimPicked: [],
    brimDiameter: null,
    layers: null,
    measure: NO_MEASURE,
    overlay: null,
    calibration: null,
    mixDefinitions: '',
    mixes: [],
    palette: [],
    towers: [],
    wipeTower: null,

    setTab: (tab) => {
      set({ tab });
      // On a phone the page scrolls; show the new tab from the top.
      document.querySelector('.body')?.scrollTo({ top: 0 });
    },

    selectPrinter: async (name) => {
      await editSelection(() => ({ printer: name, process: '' }));
      await fitPlates().catch(fail);
    },
    filamentsFor: (printer) => engine().filamentsFor(printer),
    selectProcess: (name) => editSelection(() => ({ process: name })),
    presetConfig: (type, name) => engine().presetConfig(type, name),
    presetExport: (type, name) => engine().presetExport(type, name),
    presetParse: (files) => engine().presetParse(files),
    setUserPresets: async (presets, selection) => {
      const e = engine();
      enginePresets = presets;
      await e.userPresets(presets.map(presetFile));
      const printers = await e.printers();
      set({ printers });
      const want = { ...get().selection, ...selection };
      if (!printers.some((p) => p.name === want.printer)) want.printer = DEFAULT_PRINTER;
      await applySelection(want);
      const base = get().baseConfig;
      const overrides = get().overrides;
      if (Object.keys(overrides).some((k) => overrides[k] === base[k]))
        setOverrides(Object.fromEntries(Object.entries(overrides).filter(([k, v]) => base[k] !== v)));
    },
    setFilament: (slot, name) => editSelection((s) => ({ filaments: s.filaments.map((f, i) => (i === slot ? name : f)) })),
    setColour: (slot, colour) => editSelection((s) => ({ colours: s.colours.map((c, i) => (i === slot ? colour : c)) })),
    addFilament: () =>
      editSelection((s) => ({
        filaments: [...s.filaments, s.filaments[s.filaments.length - 1]],
        colours: [...s.colours, SLOT_COLOURS[s.colours.length % SLOT_COLOURS.length]],
      })),
    // Like desktop, mixes that use the filament go, and objects, parts and
    // paint on later filaments (mixes included) move down one number.
    removeFilament: async (slot) => {
      try {
        await editMixes({ kind: 'removePhysical', filament: slot + 1 });
      } catch (e) {
        return fail(e);
      }
      await editSelection((s) => ({
        filaments: s.filaments.filter((_, i) => i !== slot),
        colours: s.colours.filter((_, i) => i !== slot),
      }));
    },

    setOverride(key, value) {
      const overrides = { ...get().overrides };
      if (value === null || value === get().baseConfig[key]) delete overrides[key];
      else overrides[key] = value;
      setOverrides(overrides);
    },
    setFlowVariant: (flowVariant) => set({ flowVariant }),
    resetOverrides(keys) {
      setOverrides(keys ? Object.fromEntries(Object.entries(get().overrides).filter(([k]) => !keys.includes(k))) : {});
    },

    async openFiles(files, mode) {
      const e = engine();
      const threeMfs = files.filter(is3mf).length;
      if (!mode && threeMfs === 1 && (get().project?.objects.length ?? 0) > 0) {
        set({ pendingOpen: files });
        return false;
      }
      await get().endCalibration();
      set({ tab: 'prepare', notice: '', conversion: null, pendingOpen: null, tool: null });
      // The project first, so the other files land on it.
      const ordered = [...files].sort((a, b) => Number(is3mf(b)) - Number(is3mf(a)));
      let opened = false;
      saved3mf = null;
      for (const file of ordered) {
        // An SVG becomes a shape lying on the plate, like dropping one on desktop.
        if (isSvg(file)) {
          if (await get().svgVolume(null, { type: 'part', file })) set({ tool: 'svg' });
          continue;
        }
        set({ job: { kind: 'loading', name: file.name } });
        try {
          const area = get().overrides.printable_area ?? get().baseConfig.printable_area ?? '';
          const geometryOnly = is3mf(file) && (mode === 'geometry' || threeMfs > 1);
          // Adding a model can be undone; opening a project starts a new history, like desktop.
          const opensProject = is3mf(file) && !geometryOnly;
          if (!opensProject) set({ history: await e.snapshot('Add model') });
          const res = await e.load(file, get().plate, area, geometryOnly);
          if (res.isProject) {
            opened = true;
            set({ plate: 0, selected: null, towers: [], history: await e.clearHistory() });
          }
          await refreshPreview(res.info);
          if (res.isProject && !res.info.objects.length) throw new Error(emptyProjectMessage(file.name));
          if (res.isProject && res.info.file.hasConfig) await importProject(res.info);
          set({ job: { kind: 'idle' } });
        } catch (err) {
          fail(err);
          return opened;
        }
      }
      // A single project file is its own copy to reopen after a crash.
      if (opened && files.length === 1) saved3mf = { file: files[0], edits: e.projectEdits };
      await checkHeavy().catch((err) => console.warn('Triangle count:', err));
      return opened;
    },
    cancelOpen: () => set({ pendingOpen: null }),
    setSnap: (snap) => set({ snap }),
    setTool: (tool) => {
      if (tool && get().paint) void get().setPaint(null);
      const { selected, project } = get();
      // The cut plane starts half way up, like desktop.
      const height = selected ? project?.objects[selected.object]?.size[2] : undefined;
      const measure = { ...NO_MEASURE, onlyPlane: get().measure.onlyPlane };
      const reset = { tool, measure, layers: null, brim: null, brimPicked: [] as number[] };
      set(tool === 'cut' && height ? { ...reset, cutZ: Math.round(height * 50) / 100 } : reset);
    },
    setCutZ: (cutZ) => set({ cutZ }),
    refreshWipeTower: queueTower,
    moveWipeTower(x, y) {
      const towers = moveTower(get().towers, get().plate, [x, y]);
      set({ towers, ...stale() });
    },
    simplifyPreview: (o, by) =>
      engine()
        .simplifyPreview(o, by)
        .catch((err) => (fail(err), null)),
    simplifyObject: (o, by) => projectEdit('Simplify', () => engine().simplifyApply(o, by)),
    async simplifyHeavy() {
      const plan = get().heavy;
      if (!plan) return;
      set({ heavy: null, job: { kind: 'loading', name: '', label: 'Simplifying' } });
      await projectEdit('Simplify', async () => {
        let info = get().project!;
        for (const o of plan.objects) info = await engine().simplifyApply(o, { ratio: plan.ratio });
        return info;
      });
      if (get().job.kind === 'loading') set({ job: { kind: 'idle' } });
    },
    async measureHover(ray) {
      hoverRay = ray;
      if (hovering) return;
      hovering = true;
      try {
        while (hoverRay !== undefined) {
          const next = hoverRay;
          hoverRay = undefined;
          const m = get().measure;
          if (get().tool !== 'measure') break;
          const hover = next
            ? await engine().measureFeature(get().plate, { ray: next, onlyPlane: m.onlyPlane, keep: m.picks.map((f) => f.id) })
            : null;
          if (get().tool !== 'measure') break;
          if (!sameFeature(hover, get().measure.hover)) set({ measure: { ...get().measure, hover } });
        }
      } catch (e) {
        fail(e);
      } finally {
        hovering = false;
      }
    },
    async measurePick(ray) {
      if (ray) {
        try {
          const { onlyPlane, picks } = get().measure;
          const hover = await engine().measureFeature(get().plate, { ray, onlyPlane, keep: picks.map((f) => f.id) });
          set({ measure: { ...get().measure, hover } });
        } catch (e) {
          return fail(e);
        }
      }
      const { hover, picks, onlyPlane } = get().measure;
      // Like desktop: a click off the parts starts over, a third pick starts a new pair.
      if (!hover) return set({ measure: { ...NO_MEASURE, onlyPlane } });
      if (picks.some((p) => sameFeature(p, hover))) return;
      const next = picks.length === 1 ? [picks[0], hover] : [hover];
      set({ measure: { ...get().measure, picks: next, result: null } });
      if (next.length < 2) return;
      try {
        const result = await engine().measureBetween(next[0].id, next[1].id);
        if (get().measure.picks === next) set({ measure: { ...get().measure, result } });
      } catch (e) {
        fail(e);
      }
    },
    measureReset: () => set({ measure: { ...NO_MEASURE, onlyPlane: get().measure.onlyPlane } }),
    setMeasureOnlyPlane: (onlyPlane) => set({ measure: { ...NO_MEASURE, onlyPlane } }),
    setBrimDiameter: (brimDiameter) => set({ brimDiameter }),
    pickEar: (i, add = false) => {
      const picked = get().brimPicked;
      if (i < 0) return set({ brimPicked: [] });
      if (!add) return set({ brimPicked: [i] });
      set({ brimPicked: picked.includes(i) ? picked.filter((k) => k !== i) : [...picked, i] });
    },
    async editBrim(request) {
      const { selected } = get();
      if (!selected) return;
      const e = engine();
      const edit = request.op !== 'get';
      try {
        if (edit) set({ history: await e.snapshot('Brim ears') });
        const ears = await e.brimEars(selected.object, selected.instance, engineOverrides(), request);
        if (get().tool !== 'brim') return;
        const same = get().brim?.object === selected.object;
        set({
          brim: { ...ears, ...selected },
          // Picks point at ears by index, so they go when the ears change.
          brimPicked: edit || !same ? [] : get().brimPicked.filter((i) => i < ears.ears.length),
          brimDiameter: get().brimDiameter ?? ears.defaultDiameter,
        });
        if (edit) set(stale());
      } catch (err) {
        fail(err);
      }
    },
    async editLayers(o, request, continues = false) {
      const e = engine();
      const edit = request.op !== 'get';
      try {
        if (edit && !continues) set({ history: await e.snapshot('Variable layer height') });
        const profile = await e.layerHeights(o, engineOverrides(), request);
        if (get().tool === 'layers') set({ layers: { ...profile, object: o } });
        if (edit) set(stale());
      } catch (err) {
        fail(err);
      }
    },
    projectFile: (thumbnail) => engine().saveProject(engineOverrides(), thumbnail),
    clearProject: () =>
      projectEdit('Delete all', async () => {
        await get().endCalibration();
        set({ selected: null, tool: null });
        return engine().clear();
      }),

    async setPlate(plate) {
      set({ plate, selected: null, tool: null });
      await refreshPreview(get().project ?? undefined);
    },
    // Measure works on every part on the plate, so it stays open without a selection.
    select: (selected) => set(selected ? { selected } : { selected, tool: get().tool === 'measure' ? 'measure' : null }),
    moveInstance: (o, i, x, y) => projectEdit('Move', () => engine().transform(o, i, { offset: [x, y], plate: get().plate })),
    transformInstance: (o, i, changes) =>
      projectEdit(changes.rotation ? 'Rotate' : changes.scale ? 'Scale' : 'Move', () => engine().transform(o, i, changes)),
    setObjectFilament: (o, volume, filament) => projectEdit('Change filament', () => engine().setExtruder(o, volume, filament)),
    deleteObject: (o) =>
      projectEdit('Delete', () => {
        set({ selected: null, tool: null });
        return engine().deleteObject(o);
      }),
    copyInstance: (o, i) => {
      const size = get().project?.objects[o]?.size ?? [20, 20, 0];
      return projectEdit('Add copy', () => engine().addInstance(o, i, size[0] + 5, 0));
    },

    // 6 mm apart, like desktop's default arrange distance.
    arrange: () => projectEdit('Arrange', () => engine().arrangePlate(get().plate, 6)),
    setObjectSettings: (o, volume, values) => projectEdit('Change object settings', () => engine().setObjectSettings(o, volume, values)),
    addPlate: async () => {
      await projectEdit('Add plate', () => engine().addPlate());
      const n = get().project?.plates.length ?? 1;
      await get().setPlate(n - 1);
    },
    deletePlate: () =>
      projectEdit('Delete plate', () => {
        set({ selected: null, towers: dropPlateTower(get().towers, get().plate) });
        return engine().deletePlate(get().plate);
      }),
    orientObject: (o) => projectEdit('Auto orient', () => engine().orientObject(o)),
    splitObject: (o) =>
      projectEdit('Split to objects', () => {
        set({ selected: null, tool: null });
        return engine().splitObject(o);
      }),
    splitParts: (o) => projectEdit('Split to parts', () => engine().splitParts(o)),
    orient: (o) =>
      projectEdit('Auto orient', async () => {
        const { project, plate } = get();
        const objects = o !== undefined ? [o] : (project?.plates[plate]?.objects ?? []);
        let info = project!;
        for (const obj of objects) info = await engine().orientObject(obj);
        return info;
      }),
    mirror: (o, i, axis) => projectEdit('Mirror', () => engine().mirrorInstance(o, i, axis)),
    openObjectMenu: (objectMenu) => set({ objectMenu }),
    objectAction: (o, i, request, label) => projectEdit(label, () => engine().objectAction(o, i, request)),
    cloneObject: async (o, count, arrange) => {
      await projectEdit('Clone', () => engine().objectAction(o, 0, { op: 'clone', count }));
      if (arrange) await get().arrange();
    },
    replaceWithStl: async (o, volume, file) =>
      projectEdit('Replace with STL', async () => engine().objectAction(o, 0, { op: 'replace', volume }, await file.arrayBuffer())),
    volumeAction: async (o, request, label, file) => {
      let volume: number | undefined;
      const instance = get().selected?.object === o ? get().selected!.instance : 'instance' in request ? request.instance : 0;
      await projectEdit(label, async () => {
        const out = await engine().volumeAction(o, file ? ({ ...request, name: file.name } as VolumeAction) : request, file ? await file.arrayBuffer() : undefined);
        volume = out.volume;
        return out.info;
      });
      if (get().project?.objects[o]) set({ selected: { object: o, instance, volume } });
    },
    textVolume: async (o, style, edit) => {
      let out: { object: number; volume: number } | undefined;
      const label = 'volume' in edit ? 'Edit text' : 'Add text';
      await projectEdit(label, async () => {
        const e = engine();
        const fontPath = await fontInEngine(e, style.font);
        const request =
          'volume' in edit
            ? { ...style, fontPath, op: 'update' as const, volume: edit.volume }
            : { ...style, fontPath, op: 'add' as const, type: edit.type, camera: cameraPosition() };
        const r = await e.textVolume(o ?? -1, get().plate, request);
        out = { object: r.object, volume: r.volume };
        return r.info;
      });
      if (!out) return false;
      const sel = get().selected;
      const instance = sel?.object === out.object ? sel.instance : 0;
      set({ selected: { object: out.object, instance, volume: out.volume } });
      return true;
    },
    svgVolume: async (o, edit) => {
      let out: { object: number; volume: number } | undefined;
      await projectEdit('file' in edit ? 'Add SVG' : 'Edit SVG', async () => {
        const e = engine();
        const r =
          'file' in edit
            ? await e.svgVolume(
                o ?? -1,
                get().plate,
                { op: 'add', type: edit.type, name: edit.file.name, depth: SVG_DEPTH, camera: cameraPosition() },
                await edit.file.arrayBuffer(),
              )
            : await e.svgVolume(o ?? -1, get().plate, { op: 'update', ...edit });
        out = { object: r.object, volume: r.volume };
        return r.info;
      });
      if (!out) return false;
      const sel = get().selected;
      const instance = sel?.object === out.object ? sel.instance : 0;
      set({ selected: { object: out.object, instance, volume: out.volume } });
      return true;
    },
    meshBoolean: async (o, request) => {
      let volume: number | undefined;
      const label = request.op === 'union' ? 'Union' : request.op === 'difference' ? 'Difference' : 'Intersection';
      await projectEdit(label, async () => {
        const out = await engine().meshBoolean(o, request);
        volume = out.volume;
        return out.info;
      });
      if (volume === undefined) return false;
      const instance = get().selected?.object === o ? get().selected!.instance : 0;
      set({ selected: { object: o, instance, volume } });
      return true;
    },
    exportStl: async (o, i) => {
      try {
        const bytes = await engine().exportStl(o, i);
        await saveFile(new Blob([bytes], { type: 'model/stl' }), stlName(get().project?.objects[o]?.name ?? ''));
      } catch (err) {
        fail(err);
      }
    },
    cutObject: (o, i, z, keep, flipUpper) =>
      projectEdit('Cut', () => {
        set({ selected: null, tool: null });
        return engine().cutObject(o, i, z, keep, flipUpper);
      }),

    async convertProject(printer, keepSettings, remember) {
      const c = get().conversion;
      if (!c) return;
      saveConvertPreference(remember ? { printer, keepSettings, auto: true } : null);
      set({ job: { kind: 'loading', name: c.from, label: `Converting to ${printer}` } });
      try {
        await convert(c.file, printer, keepSettings);
        set({ job: { kind: 'idle' } });
      } catch (e) {
        fail(e);
      }
    },
    dismissConversion: () => set({ conversion: null }),

    async setPaint(paint) {
      const before = get().paint;
      set(paint ? { paint, tool: null } : { paint });
      if (!paint || paint.kind === 'color') return set({ overlay: null });
      if (before?.kind === paint.kind && get().overlay) return;
      try {
        set({ overlay: await engine().paintOverlay(get().plate, paint.kind) });
      } catch (e) {
        fail(e);
      }
    },
    async paintStroke(rays, newStroke) {
      if (newStroke) {
        lastRay = null;
        strokeStarts = true;
      }
      strokeQueue.push(...rays);
      if (painting) return;
      painting = true;
      try {
        while (strokeQueue.length) {
          const paint = get().paint;
          if (!paint) break;
          const fills = paint.tool === 'fill' || paint.tool === 'bucket';
          const batch = lastRay && !fills ? [lastRay, ...strokeQueue] : strokeQueue;
          lastRay = strokeQueue[strokeQueue.length - 1];
          strokeQueue = [];
          if (strokeStarts) {
            strokeStarts = false;
            set({ history: await engine().snapshot('Paint') });
          }
          const res = await engine().paint(get().plate, { ...paint, rays: batch });
          set({ project: res.info, ...(res.preview && { preview: res.preview }), ...(res.overlay && { overlay: res.overlay }), ...stale() });
        }
      } catch (e) {
        fail(e);
      } finally {
        strokeQueue = [];
        painting = false;
      }
    },
    undo: () => stepHistory('undo'),
    redo: () => stepHistory('redo'),
    clearPaint: (o) => projectEdit('Clear paint', () => engine().clearPaint(o, get().paint?.kind ?? 'all')),

    async startCalibration(mode, values) {
      const title = CALIBRATIONS.find((c) => c.mode === mode)?.title ?? mode;
      await get().endCalibration();
      set({ tab: 'prepare', paint: null, overlay: null, selected: null, plate: 0, conversion: null, job: { kind: 'loading', name: `${title} test`, label: `Setting up the ${title} test` } });
      try {
        const res = await engine().calibrate(calibrationOptions(mode, values), get().overrides);
        set({ history: await engine().clearHistory() });
        const keys = Object.keys(res.overrides);
        const previous = Object.fromEntries(keys.filter((k) => k in get().overrides).map((k) => [k, get().overrides[k]]));
        set({ calibration: { title, keys, previous } });
        setOverrides({ ...get().overrides, ...res.overrides });
        await refreshPreview(res.info);
        set({
          job: { kind: 'idle' },
          notice: `${title} test ready. It changed ${keys.length} setting${keys.length === 1 ? '' : 's'}, marked in Settings.`,
          noticeWarn: false,
        });
      } catch (e) {
        set({ calibration: null });
        fail(e);
      }
    },
    async endCalibration() {
      const c = get().calibration;
      if (!c) return;
      set({ calibration: null });
      const rest = Object.fromEntries(Object.entries(get().overrides).filter(([k]) => !c.keys.includes(k)));
      setOverrides({ ...rest, ...c.previous });
      await engine().calibrationStop();
    },

    addMix: (recipe) => editMixes({ kind: 'add', row: recipe }).catch(fail),
    updateMix: (index, recipe) => editMixes({ kind: 'update', index, row: recipe }).catch(fail),
    deleteMix: (index) => editMixes({ kind: 'delete', index }).catch(fail),
    async previewMix(recipe) {
      const res = await engine().mixed(mixRequest({ draft: recipe }));
      return { colour: res.draftColour ?? '#26A69A', compatible: res.draftCompatible ?? true };
    },
    blendFilaments(ids, weights) {
      const colours = get().selection?.colours ?? [];
      return engine().mixedBlend(ids.map((i) => colours[i - 1] ?? '#26A69A'), weights);
    },
    matchColour(target, minPercent) {
      const { colours, types } = mixRequest();
      return engine().mixedMatch({ colours, types: types ?? [], target, minPercent });
    },

    async slice() {
      const { project, plate } = get();
      if (!project?.objects.length) return;
      // Desktop refuses to slice a mix of materials that can't be mixed.
      if (get().mixes.some((m) => m.enabled && !m.compatible))
        return fail(new Error('Mixed filaments contain incompatible material types. Please correct the mixed filaments settings before slicing.'));
      const run = ++sliceRun;
      set({ job: { kind: 'slicing', pct: 0, stage: '' }, notice: '' });
      // For the G-code step's percentage (lib/slice-progress).
      const config = { ...get().baseConfig, ...get().overrides };
      const onPlate = project.plates[plate]?.objects ?? [];
      const layers = Math.max(
        0,
        ...onPlate.map((i) => {
          const o = project.objects[i];
          const layerHeight = parseFloat(o?.settings.layer_height ?? config.layer_height);
          return o ? estimateLayers([o.size[2]], layerHeight, parseFloat(config.initial_layer_print_height)) : 0;
        }),
      );
      try {
        // Slicing is what runs out of memory; keep a copy to reopen if it does.
        const e = engine();
        if (saved3mf?.edits !== e.projectEdits) {
          const bytes = await e.saveProject(engineOverrides(), null);
          saved3mf = { file: new File([bytes], `${project.fileName.replace(/\.\w+$/, '') || 'project'}.3mf`), edits: e.projectEdits };
          if (run !== sliceRun) return;
        }
        const { result, gcode, ms } = await engine().slice(plate, engineOverrides(), plateThumbnails(), (pct, stage) => {
          const job = get().job;
          if (run === sliceRun && job.kind === 'slicing') set({ job: { kind: 'slicing', pct: slicePercent(job.pct, pct, stage, layers), stage } });
        });
        if (run !== sliceRun) return;
        set({ job: { kind: 'sliced', plate, result, gcode: new Blob([gcode], { type: 'text/plain' }), ms }, notice: '', heavy: null });
        // Like desktop Orca: show the result as soon as slicing finishes.
        get().setTab('preview');
      } catch (e) {
        if (run === sliceRun) fail(e);
      }
    },
    cancelSlice() {
      if (get().job.kind !== 'slicing') return;
      stopSlice();
      set({ job: { kind: 'idle' }, notice: 'Slicing cancelled.', noticeWarn: false });
    },
  };
});

// The prime tower follows the plate, its objects, the settings, the tower
// spots and the last slice (desktop shows the sliced tower's real size).
useSlicer.subscribe((s, prev) => {
  if (
    s.engine !== prev.engine || s.project !== prev.project || s.plate !== prev.plate || s.overrides !== prev.overrides ||
    s.baseConfig !== prev.baseConfig || s.mixDefinitions !== prev.mixDefinitions || s.towers !== prev.towers ||
    (s.job !== prev.job && (s.job.kind === 'sliced' || prev.job.kind === 'sliced'))
  )
    useSlicer.getState().refreshWipeTower();
});

/** Stable empty list for selectors (a fresh [] each render loops React). */
export const NO_COLOURS: string[] = [];

/** Value of an option as it will be sliced: the user's override, else the preset's. */
export const useOption = (key: string) => useSlicer((s) => s.overrides[key] ?? s.baseConfig[key]);
