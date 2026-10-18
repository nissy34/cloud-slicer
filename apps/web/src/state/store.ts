import { create } from 'zustand';
import { EngineClient, type CutKeep } from '../engine/client';
import type {
  OptionDef,
  OrcaConfig,
  PresetSummary,
  PreviewMesh,
  ProjectInfo,
  Selection,
  SettingsLayout,
  SliceResult,
} from '../engine/protocol';
import { bedSize } from '../lib/colour';
import { DEFAULT_PRINTER, pickFilamentPreset, splitList, SLOT_COLOURS } from '../lib/presets';
import { pickProcess, printerLabel, processKeys, projectOverrides } from '../lib/project-import';
import { loadConvertPreference, loadSaved, save, saveConvertPreference } from '../lib/storage';

export type Tab = 'prepare' | 'preview' | 'device';
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

  setTab(tab: Tab): void;
  selectPrinter(name: string): Promise<void>;
  selectProcess(name: string): Promise<void>;
  setFilament(slot: number, name: string): Promise<void>;
  setColour(slot: number, colour: string): Promise<void>;
  addFilament(): Promise<void>;
  removeFilament(slot: number): Promise<void>;
  setOverride(key: string, value: string | null): void;
  resetOverrides(keys?: string[]): void;
  openFiles(files: File[]): Promise<void>;
  clearProject(): Promise<void>;
  setPlate(plate: number): Promise<void>;
  select(sel: { object: number; instance: number } | null): void;
  moveInstance(o: number, i: number, x: number, y: number): Promise<void>;
  transformInstance(o: number, i: number, changes: { rotation?: number[]; scale?: number[] }): Promise<void>;
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
  mirror(o: number, i: number, axis: 0 | 1 | 2): Promise<void>;
  cutObject(o: number, i: number, z: number, keep: CutKeep, flipUpper: boolean): Promise<void>;
  convertProject(printer: string, keepSettings: boolean, remember: boolean): Promise<void>;
  dismissConversion(): void;
}

let client: EngineClient | null = null;

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

  const fail = (e: unknown) => set({ job: { kind: 'error', message: (e as Error).message } });

  // Anything that changes what would be sliced makes the last result stale.
  const stale = () => (get().job.kind === 'sliced' ? { job: { kind: 'idle' } as Job } : {});

  async function start() {
    const e = engine();
    try {
      const saved = loadSaved();
      const [printers, options, layout] = await Promise.all([
        e.printers(),
        e.options(),
        fetch('/engine/settings-layout.json').then((r) => (r.ok ? (r.json() as Promise<SettingsLayout>) : null)),
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
    save({ selection: res.selection, overrides: get().overrides });
  }

  async function refreshPreview(info?: ProjectInfo) {
    const e = engine();
    const project = info ?? (await e.modelInfo());
    const plate = Math.min(get().plate, Math.max(0, project.plates.length - 1));
    const preview = project.objects.length ? await e.preview(plate) : null;
    set({ project, plate, preview, ...stale() });
  }

  // A 3MF brings its own filaments: one slot per file filament, coloured like
  // the file, with the closest compatible preset of the same material
  // (what desktop Orca does when it opens a project's geometry).
  async function adoptFileFilaments(info: ProjectInfo) {
    const colours = splitList(info.file.filamentColours);
    if (!colours.length) return;
    const types = splitList(info.file.filamentTypes);
    const { filaments, selection } = get();
    const names = colours.map((_, i) => pickFilamentPreset(filaments, types[i], selection?.filaments[0]));
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
    save({ selection: get().selection, overrides });
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
      filaments.some((f) => f.name === presets[i]) ? presets[i] : pickFilamentPreset(filaments, types[i], selection?.filaments[0]),
    );
    const process = get().processes.some((p) => p.name === info.file.process) ? info.file.process : (selection?.process ?? '');
    await applySelection({ printer: info.file.printer, process, filaments: names.length ? names : selection?.filaments, colours: colours.length ? colours : selection?.colours });
    const overrides = projectOverrides(file, get().baseConfig, get().options);
    setOverrides(overrides);
    set({ notice: settingsNotice(Object.keys(overrides).length, 'the project'), noticeWarn: false });
  }

  // Moves a project to `printer`: its default process of the same layer height,
  // filaments matched by material in the file's colours, and (when asked) the
  // project's print settings on top. Machine and filament settings are not carried.
  async function convert(file: OrcaConfig, printer: string, keepSettings: boolean) {
    await applySelection({ printer, process: '' });
    const { filaments, selection, processes } = get();
    const colours = splitList(file.filament_colour);
    const types = splitList(file.filament_type);
    const names = colours.map((_, i) => pickFilamentPreset(filaments, types[i], selection?.filaments[0]));
    await applySelection({
      printer,
      process: pickProcess(processes, file.layer_height, selection?.process ?? ''),
      filaments: names.length ? names : selection?.filaments,
      colours: colours.length ? colours : selection?.colours,
    });
    const overrides = keepSettings ? projectOverrides(file, get().baseConfig, get().options, processKeys(get().layout)) : {};
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
    project: null,
    plate: 0,
    preview: null,
    selected: null,
    job: { kind: 'idle' },
    notice: '',
    noticeWarn: false,
    conversion: null,

    setTab: (tab) => {
      set({ tab });
      // On a phone the page scrolls; show the new tab from the top.
      document.querySelector('.body')?.scrollTo({ top: 0 });
    },

    selectPrinter: async (name) => {
      await editSelection(() => ({ printer: name, process: '' }));
      await fitPlates().catch(fail);
    },
    selectProcess: (name) => editSelection(() => ({ process: name })),
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
    resetOverrides(keys) {
      setOverrides(keys ? Object.fromEntries(Object.entries(get().overrides).filter(([k]) => !keys.includes(k))) : {});
    },

    async openFiles(files) {
      const e = engine();
      set({ tab: 'prepare', notice: '', conversion: null });
      for (const file of files) {
        set({ job: { kind: 'loading', name: file.name } });
        try {
          const area = get().overrides.printable_area ?? get().baseConfig.printable_area ?? '';
          const res = await e.load(file, get().plate, area);
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
    clearProject: () =>
      projectEdit(() => {
        set({ selected: null });
        return engine().clear();
      }),

    async setPlate(plate) {
      set({ plate, selected: null });
      await refreshPreview(get().project ?? undefined);
    },
    select: (selected) => set({ selected }),
    moveInstance: (o, i, x, y) => projectEdit(() => engine().transform(o, i, { offset: [x, y], plate: get().plate })),
    transformInstance: (o, i, changes) => projectEdit(() => engine().transform(o, i, changes)),
    setObjectFilament: (o, volume, filament) => projectEdit(() => engine().setExtruder(o, volume, filament)),
    deleteObject: (o) =>
      projectEdit(() => {
        set({ selected: null });
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
        set({ selected: null });
        return engine().splitObject(o);
      }),
    mirror: (o, i, axis) => projectEdit(() => engine().mirrorInstance(o, i, axis)),
    cutObject: (o, i, z, keep, flipUpper) =>
      projectEdit(() => {
        set({ selected: null });
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

    async slice() {
      const { project, plate, overrides } = get();
      if (!project?.objects.length) return;
      set({ job: { kind: 'slicing', pct: 0, stage: '' } });
      try {
        const { result, gcode, ms } = await engine().slice(plate, overrides);
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
