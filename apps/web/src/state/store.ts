import { create } from 'zustand';
import { EngineClient } from '../engine/client';
import type { ModelInfo, SliceResult } from '../engine/protocol';

export type Tab = 'prepare' | 'preview' | 'device';
export type EngineStatus = 'starting' | 'ready' | 'failed';
export type Job =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string }
  | { kind: 'slicing'; pct: number; stage: string }
  | { kind: 'sliced'; result: SliceResult; gcode: Blob; ms: number }
  | { kind: 'error'; message: string };

interface SlicerState {
  tab: Tab;
  engine: EngineStatus;
  engineMessage: string;
  material: string;
  plate: string;
  model: { name: string; info: ModelInfo; positions: Float32Array } | null;
  job: Job;
  setTab(tab: Tab): void;
  setMaterial(material: string): void;
  setPlate(plate: string): void;
  openModel(file: File): Promise<void>;
  slice(): Promise<void>;
}

let client: EngineClient | null = null;

export const useSlicer = create<SlicerState>((set, get) => {
  const engine = () => {
    client ??= new EngineClient({
      onReady: (core) => set({ engine: 'ready', engineMessage: core }),
      onProgress: (pct, stage) => set({ job: { kind: 'slicing', pct, stage } }),
      onFatal: (message) => set({ engine: 'failed', engineMessage: message }),
    });
    return client;
  };
  // Start the download as soon as the store exists: the engine is several MB.
  if (typeof Worker !== 'undefined') queueMicrotask(engine);

  // A settings change makes the last result stale.
  const staleResult = () => (get().job.kind === 'sliced' ? { job: { kind: 'idle' } as Job } : {});

  return {
    tab: 'prepare',
    engine: 'starting',
    engineMessage: '',
    material: 'PLA',
    plate: 'TEXTURED_PEI',
    model: null,
    job: { kind: 'idle' },
    setTab: (tab) => set({ tab }),
    setMaterial: (material) => set({ material, ...staleResult() }),
    setPlate: (plate) => set({ plate, ...staleResult() }),

    async openModel(file) {
      set({ job: { kind: 'loading', name: file.name }, tab: 'prepare' });
      try {
        const { info, positions } = await engine().load(file);
        set({ model: { name: file.name, info, positions }, job: { kind: 'idle' } });
      } catch (e) {
        set({ job: { kind: 'error', message: (e as Error).message } });
      }
    },

    async slice() {
      const { material, plate, model } = get();
      if (!model) return;
      set({ job: { kind: 'slicing', pct: 0, stage: '' } });
      try {
        const { result, gcode, ms } = await engine().slice({ material, plate });
        set({ job: { kind: 'sliced', result, gcode: new Blob([gcode], { type: 'text/plain' }), ms } });
      } catch (e) {
        set({ job: { kind: 'error', message: (e as Error).message } });
      }
    },
  };
});
