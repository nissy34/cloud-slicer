import { create } from 'zustand';
import { EngineClient, type CutKeep, type InstanceChanges, type UserPresetFile } from '../engine/client';
import type {
  PaintOverlay,
  PaintRay,
  PaintSettings,
  OptionDef,
  OrcaConfig,
  PresetSummary,
  PreviewMesh,
  ProjectInfo,
  Selection,
  SettingsLayout,
  SliceResult,
} from '../engine/protocol';
import { calibrationOptions, CALIBRATIONS, type CalibrationMode, type CalibrationValues } from '../lib/calibration';
import { bedSize } from '../lib/colour';
import { renderThumbnails, thumbnailSizes } from '../lib/thumbnail';
import { DEFAULT_PRINTER, pickFilamentPreset, splitList, SLOT_COLOURS } from '../lib/presets';
import { modelProcessKeys, pickProcess, printerLabel, projectOverrides } from '../lib/project-import';
import { accountReady, getUserSetting, presetEditing, useAccount } from './account';
import { installedOnly, SETUP_KEY, type Setup } from '../lib/setup';
import { loadConvertPreference, loadSaved, save, saveConvertPreference } from '../lib/storage';

export type Tab = 'prepare' | 'preview' | 'device';
/** The object tool open on the 3D view, like desktop's gizmos (paint has its own state). */
export type Tool = 'move' | 'rotate' | 'scale' | 'flatten' | 'cut';
/** How a 3MF is opened: as the project (replacing it) or its objects added. */
export type OpenMode = 'project' | 'geometry';
const is3mf = (f: File) => /\.3mf$/i.test(f.name);
export type EngineStatus = 'starting' | 'ready' | 'failed';
export type Job =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string }
  | { kind: 'slicing'; pct: number; stage: string }
  | { kind: 'sliced'; plate: number; result: SliceResult; gcode: Blob; ms: number }
  | { kind: 'error'; message: string };

interface SlicerState {
  tab: Tab;
  engine: EngineStatus;
  engineMessage: string;
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
  selected: { object: number; instance: number } | null;
  job: Job;
  notice: string;
  /** The notice is a problem to fix, not just information. */
  noticeWarn: boolean;
  /** A 3MF made for a printer we don't have, waiting for the user to convert it. */
  conversion: { from: string; file: OrcaConfig } | null;
  /** Paint mode is on while set: what clicks and drags on the parts paint. */
  paint: PaintSettings | null;
  /** The object tool in use on the selected object. */
  tool: Tool | null;
  /** Files waiting for the user to say how to open the 3MF among them. */
  pendingOpen: File[] | null;
  /** Rotate in 15° steps (and move/scale in steps) without holding Shift, for touch screens. */
  snap: boolean;
  /** Support, seam or fuzzy skin paint of the plate, while painting it. */
  overlay: PaintOverlay | null;
  /** The calibration test on the plate, and the settings it changed. */
  calibration: { title: string; keys: string[]; previous: OrcaConfig } | null;

  setTab(tab: Tab): void;
  selectPrinter(name: string): Promise<void>;
  /** Filaments that work with a printer, without selecting it (for the setup wizard). */
  filamentsFor(printer: string): Promise<{ filaments: PresetSummary[]; defaults: string[] }>;
  selectProcess(name: string): Promise<void>;
  /** One preset's own settings, after inheritance. */
  presetConfig(type: 'printer' | 'filament' | 'process', name: string): Promise<OrcaConfig | null>;
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
   */
  openFiles(files: File[], mode?: OpenMode): Promise<void>;
  cancelOpen(): void;
  setTool(tool: Tool | null): void;
  setSnap(snap: boolean): void;
  clearProject(): Promise<void>;
  setPlate(plate: number): Promise<void>;
  select(sel: { object: number; instance: number } | null): void;
  moveInstance(o: number, i: number, x: number, y: number): Promise<void>;
  transformInstance(o: number, i: number, changes: InstanceChanges): Promise<void>;
  setObjectFilament(o: number, volume: number, filament: number): Promise<void>;
  deleteObject(o: number): Promise<void>;
  copyInstance(o: number, i: number): Promise<void>;
  slice(): Promise<void>;
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
  cutObject(o: number, i: number, z: number, keep: CutKeep, flipUpper: boolean): Promise<void>;
  convertProject(printer: string, keepSettings: boolean, remember: boolean): Promise<void>;
  dismissConversion(): void;
  setPaint(paint: PaintSettings | null): Promise<void>;
  /** Paints along rays; newStroke when the pointer just went down. */
  paintStroke(rays: PaintRay[], newStroke: boolean): Promise<void>;
  clearPaint(o: number): Promise<void>;
  /** Replaces the project with a calibration test, like desktop's Calibration menu. */
  startCalibration(mode: CalibrationMode, values: CalibrationValues): Promise<void>;
  /** Back to normal printing: drops the test's settings (the test model stays). */
  endCalibration(): Promise<void>;
}

let client: EngineClient | null = null;

const presetFile = ({ type, name, inherits, config }: UserPresetFile): UserPresetFile => ({ type, name, inherits, config });
/** The user presets the engine has loaded. */
let enginePresets: UserPresetFile[] = [];

export const useSlicer = create<SlicerState>((set, get) => {
  const engine = () => {
    client ??= new EngineClient({
      onReady: (presets) => {
        set({ vendorVersion: presets.vendorVersion });
        void start();
      },
      onProgress: (pct, stage) => set({ job: { kind: 'slicing', pct, stage } }),
      onFatal: (message) => set({ engine: 'failed', engineMessage: message }),
    });
    return client;
  };

  // Pictures of the plate for the G-code, in the sizes the printer asks for.
  // Without WebGL the G-code just has none, as desktop's would without a GPU.
  const plateThumbnails = () => {
    const { preview, selection, overrides, baseConfig } = get();
    try {
      return renderThumbnails(preview, selection?.colours ?? [], thumbnailSizes(overrides.thumbnails ?? baseConfig.thumbnails));
    } catch (e) {
      console.warn('No plate thumbnail:', e);
      return [];
    }
  };

  const fail = (e: unknown) => set({ job: { kind: 'error', message: (e as Error).message } });

  // Anything that changes what would be sliced makes the last result stale.
  const stale = () => (get().job.kind === 'sliced' ? { job: { kind: 'idle' } as Job } : {});

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
      useAccount.subscribe((a) => {
        if (a.presets !== enginePresets && get().engine === 'ready' && !presetEditing())
          void get().setUserPresets(a.presets).catch(fail);
      });
      const [printers, options, layout] = await Promise.all([
        e.printers(),
        e.options(),
        fetch(`/engine/settings-layout.json?v=${import.meta.env.VITE_ENGINE_VERSION}`).then((r) => (r.ok ? (r.json() as Promise<SettingsLayout>) : null)),
      ]);
      set({ printers, options, layout, overrides: saved?.overrides ?? {} });
      const known = saved?.selection && printers.some((p) => p.name === saved.selection?.printer);
      await applySelection(known && saved?.selection ? saved.selection : { printer: DEFAULT_PRINTER });
      set({ engine: 'ready' });
    } catch (err) {
      set({ engine: 'failed', engineMessage: (err as Error).message });
    }
  }

  async function applySelection(selection: Partial<Selection>) {
    const e = engine();
    const res = await e.select(selection);
    const { config } = await e.fullConfig({});
    set({ selection: res.selection, processes: res.processes, filaments: res.filaments, baseConfig: config, ...stale() });
    persist();
  }

  // A filament preset for a material: one of the user's installed filaments
  // when one matches, else any compatible preset.
  function pickFilament(filaments: PresetSummary[], type: string | undefined, fallback?: string) {
    const installed = installedOnly(filaments, getUserSetting<Setup>(SETUP_KEY)?.filaments);
    const want = (type ?? '').toUpperCase();
    const mine = installed.length < filaments.length && installed.some((f) => (f.filamentType ?? '').toUpperCase() === want);
    return pickFilamentPreset(mine ? installed : filaments, type, fallback);
  }

  async function refreshPreview(info?: ProjectInfo) {
    const e = engine();
    const project = info ?? (await e.modelInfo());
    const plate = Math.min(get().plate, Math.max(0, project.plates.length - 1));
    const preview = project.objects.length ? await e.preview(plate) : null;
    const paint = get().paint;
    const overlay = paint && paint.kind !== 'color' && project.objects.length ? await e.paintOverlay(plate, paint.kind) : null;
    set({ project, plate, preview, overlay, ...stale() });
  }

  // Paint dabs queue up while the engine is busy and go over in one call, so
  // a fast drag never falls behind. The last ray of a batch starts the next,
  // so the brush joins them without a gap.
  let strokeQueue: PaintRay[] = [];
  let lastRay: PaintRay | null = null;
  let painting = false;

  // A 3MF brings its own filaments: one slot per file filament, coloured like
  // the file, with the closest compatible preset of the same material
  // (what desktop Orca does when it opens a project's geometry).
  async function adoptFileFilaments(info: ProjectInfo) {
    const colours = splitList(info.file.filamentColours);
    if (!colours.length) return;
    const types = splitList(info.file.filamentTypes);
    const { filaments, selection } = get();
    const names = colours.map((_, i) => pickFilament(filaments, types[i], selection?.filaments[0]));
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
    set({ overrides, ...stale() });
    persist();
  }

  // Saves the selection and the user's overrides; a calibration test's
  // settings are saved as they were before it, since the test isn't there
  // after a reload.
  function persist() {
    const { selection, overrides, calibration: c } = get();
    const keep = c ? { ...Object.fromEntries(Object.entries(overrides).filter(([k]) => !c.keys.includes(k))), ...c.previous } : overrides;
    save({ selection, overrides: keep });
  }

  const settingsNotice = (n: number, from: string) =>
    n ? `Loaded ${n} setting${n === 1 ? '' : 's'} from ${from}. Changed values are marked in Settings.` : '';

  // A 3MF's own settings: with a printer we have, select the project's presets
  // and apply its changes on top (like opening the project in desktop Orca);
  // otherwise offer to convert it to one of our printers.
  async function importProject(info: ProjectInfo) {
    const e = engine();
    const file = await e.fileConfig();
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
      filaments.some((f) => f.name === presets[i]) ? presets[i] : pickFilament(filaments, types[i], selection?.filaments[0]),
    );
    // The engine also finds a process by its old name, and keeps the current one when it can't.
    const process = info.file.process || (selection?.process ?? '');
    await applySelection({ printer: info.file.printer, process, filaments: names.length ? names : selection?.filaments, colours: colours.length ? colours : selection?.colours });
    const overrides = projectOverrides(file, get().baseConfig, get().options);
    setOverrides(overrides);
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
    const names = colours.map((_, i) => pickFilament(filaments, types[i], selection?.filaments[0]));
    await applySelection({
      printer,
      process: pickProcess(processes, file.layer_height, selection?.process ?? ''),
      filaments: names.length ? names : selection?.filaments,
      colours: colours.length ? colours : selection?.colours,
    });
    const overrides = keepSettings ? projectOverrides(file, get().baseConfig, get().options, modelProcessKeys(get().layout)) : {};
    setOverrides(overrides);
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

  const projectEdit = async (op: () => Promise<ProjectInfo>) => {
    try {
      await refreshPreview(await op());
    } catch (e) {
      fail(e);
    }
  };

  return {
    tab: 'prepare',
    engine: 'starting',
    engineMessage: '',
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
    conversion: null,
    paint: null,
    tool: null,
    pendingOpen: null,
    snap: false,
    overlay: null,
    calibration: null,

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
    removeFilament: (slot) =>
      editSelection((s) => ({
        filaments: s.filaments.filter((_, i) => i !== slot),
        colours: s.colours.filter((_, i) => i !== slot),
      })),

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
        return;
      }
      await get().endCalibration();
      set({ tab: 'prepare', notice: '', conversion: null, pendingOpen: null, tool: null });
      // The project first, so the other files land on it.
      const ordered = [...files].sort((a, b) => Number(is3mf(b)) - Number(is3mf(a)));
      for (const file of ordered) {
        set({ job: { kind: 'loading', name: file.name } });
        try {
          const area = get().overrides.printable_area ?? get().baseConfig.printable_area ?? '';
          const geometryOnly = is3mf(file) && (mode === 'geometry' || threeMfs > 1);
          const res = await e.load(file, get().plate, area, geometryOnly);
          if (res.isProject) set({ plate: 0, selected: null });
          await refreshPreview(res.info);
          if (res.isProject && res.info.file.hasConfig) await importProject(res.info);
          set({ job: { kind: 'idle' } });
        } catch (err) {
          fail(err);
          return;
        }
      }
    },
    cancelOpen: () => set({ pendingOpen: null }),
    setSnap: (snap) => set({ snap }),
    setTool: (tool) => {
      if (tool && get().paint) void get().setPaint(null);
      set({ tool });
    },
    clearProject: () =>
      projectEdit(async () => {
        await get().endCalibration();
        set({ selected: null, tool: null });
        return engine().clear();
      }),

    async setPlate(plate) {
      set({ plate, selected: null, tool: null });
      await refreshPreview(get().project ?? undefined);
    },
    select: (selected) => set(selected ? { selected } : { selected, tool: null }),
    moveInstance: (o, i, x, y) => projectEdit(() => engine().transform(o, i, { offset: [x, y], plate: get().plate })),
    transformInstance: (o, i, changes) => projectEdit(() => engine().transform(o, i, changes)),
    setObjectFilament: (o, volume, filament) => projectEdit(() => engine().setExtruder(o, volume, filament)),
    deleteObject: (o) =>
      projectEdit(() => {
        set({ selected: null, tool: null });
        return engine().deleteObject(o);
      }),
    copyInstance: (o, i) => {
      const size = get().project?.objects[o]?.size ?? [20, 20, 0];
      return projectEdit(() => engine().addInstance(o, i, size[0] + 5, 0));
    },

    // 6 mm apart, like desktop's default arrange distance.
    arrange: () => projectEdit(() => engine().arrangePlate(get().plate, 6)),
    setObjectSettings: (o, volume, values) => projectEdit(() => engine().setObjectSettings(o, volume, values)),
    addPlate: async () => {
      await projectEdit(() => engine().addPlate());
      const n = get().project?.plates.length ?? 1;
      await get().setPlate(n - 1);
    },
    deletePlate: () =>
      projectEdit(() => {
        set({ selected: null });
        return engine().deletePlate(get().plate);
      }),
    orientObject: (o) => projectEdit(() => engine().orientObject(o)),
    splitObject: (o) =>
      projectEdit(() => {
        set({ selected: null, tool: null });
        return engine().splitObject(o);
      }),
    splitParts: (o) => projectEdit(() => engine().splitParts(o)),
    orient: (o) =>
      projectEdit(async () => {
        const { project, plate } = get();
        const objects = o !== undefined ? [o] : (project?.plates[plate]?.objects ?? []);
        let info = project!;
        for (const obj of objects) info = await engine().orientObject(obj);
        return info;
      }),
    mirror: (o, i, axis) => projectEdit(() => engine().mirrorInstance(o, i, axis)),
    cutObject: (o, i, z, keep, flipUpper) =>
      projectEdit(() => {
        set({ selected: null, tool: null });
        return engine().cutObject(o, i, z, keep, flipUpper);
      }),

    async convertProject(printer, keepSettings, remember) {
      const c = get().conversion;
      if (!c) return;
      saveConvertPreference(remember ? { printer, keepSettings, auto: true } : null);
      try {
        await convert(c.file, printer, keepSettings);
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
      if (newStroke) lastRay = null;
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
    clearPaint: (o) => projectEdit(() => engine().clearPaint(o, get().paint?.kind ?? 'all')),

    async startCalibration(mode, values) {
      const title = CALIBRATIONS.find((c) => c.mode === mode)?.title ?? mode;
      await get().endCalibration();
      set({ tab: 'prepare', paint: null, overlay: null, selected: null, plate: 0, conversion: null, job: { kind: 'loading', name: `${title} test` } });
      try {
        const res = await engine().calibrate(calibrationOptions(mode, values), get().overrides);
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

    async slice() {
      const { project, plate, overrides } = get();
      if (!project?.objects.length) return;
      set({ job: { kind: 'slicing', pct: 0, stage: '' } });
      try {
        const { result, gcode, ms } = await engine().slice(plate, overrides, plateThumbnails());
        set({ job: { kind: 'sliced', plate, result, gcode: new Blob([gcode], { type: 'text/plain' }), ms }, notice: '' });
        // Like desktop Orca: show the result as soon as slicing finishes.
        get().setTab('preview');
      } catch (e) {
        fail(e);
      }
    },
  };
});

/** Stable empty list for selectors (a fresh [] each render loops React). */
export const NO_COLOURS: string[] = [];

/** Value of an option as it will be sliced: the user's override, else the preset's. */
export const useOption = (key: string) => useSlicer((s) => s.overrides[key] ?? s.baseConfig[key]);
