// Messages exchanged with public/engine/slicer-worker.js.

export interface ModelInfo {
  filename: string;
  format: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  triangleCount: number;
  volumeCount: number;
  isManifold: boolean;
}

export interface SliceResult {
  success: boolean;
  error: string;
  gcodePath: string;
  totalLayers: number;
  estimatedTimeSeconds: number;
  estimatedFilamentMm: number;
  estimatedFilamentGrams: number;
}

export interface SliceOptions {
  material: string;
  plate: string;
}

export type WorkerReply =
  | { type: 'ready'; core: string }
  | { type: 'loaded'; id: number; info: ModelInfo; positions: Float32Array; ms: number }
  | { type: 'progress'; id: number; pct: number; stage: string }
  | { type: 'sliced'; id: number; result: SliceResult; gcode: ArrayBuffer; ms: number }
  | { type: 'log'; line: string }
  | { type: 'error'; id: number | null; message: string };
