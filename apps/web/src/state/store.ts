import { create } from 'zustand';
import { EngineClient } from '../engine/client';
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
import { DEFAULT_PRINTER, pickFilamentPreset, splitList, SLOT_COLOURS } from '../lib/presets';
import { loadSaved, save } from '../lib/storage';

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
      set({ notice: `This file uses ${colours.length} filaments; the printer has ${extruders} extruders.` });
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

    setTab: (tab) => {
      set({ tab });
      // On a phone the page scrolls; show the new tab from the top.
      document.querySelector('.body')?.scrollTo({ top: 0 });
    },

    selectPrinter: (name) => editSelection(() => ({ printer: name, process: '' })),
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
      set({ overrides, ...stale() });
      save({ selection: get().selection, overrides });
    },
    resetOverrides(keys) {
      const overrides = keys ? Object.fromEntries(Object.entries(get().overrides).filter(([k]) => !keys.includes(k))) : {};
      set({ overrides, ...stale() });
      save({ selection: get().selection, overrides });
    },

    async openFiles(files) {
      const e = engine();
      set({ tab: 'prepare', notice: '' });
      for (const file of files) {
        set({ job: { kind: 'loading', name: file.name } });
        try {
          const area = get().overrides.printable_area ?? get().baseConfig.printable_area ?? '';
          const res = await e.load(file, get().plate, area);
          if (res.isProject) {
            set({ plate: 0, selected: null });
            if (res.info.file.hasConfig) await adoptFileFilaments(res.info);
          }
          await refreshPreview(res.info);
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

    async slice() {
      const { project, plate, overrides } = get();
      if (!project?.objects.length) return;
      set({ job: { kind: 'slicing', pct: 0, stage: '' } });
      try {
        const { result, gcode, ms } = await engine().slice(plate, overrides);
        set({ job: { kind: 'sliced', plate, result, gcode: new Blob([gcode], { type: 'text/plain' }), ms }, notice: '' });
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
