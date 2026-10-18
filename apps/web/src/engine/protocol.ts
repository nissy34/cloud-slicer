// Types of what public/engine/engine-worker.js returns. The engine speaks
// Orca's own vocabulary: preset names, option keys and serialized values.

export type OrcaConfig = Record<string, string>;

export interface PresetSummary {
  name: string;
  label: string;
  type: 'printer' | 'filament' | 'process';
  system: boolean;
  user: boolean;
  compatible: boolean;
  inherits: string;
  vendor: string;
  // printer
  model?: string;
  nozzle?: string;
  // filament
  filamentType?: string;
  filamentVendor?: string;
  colour?: string;
  // process
  layerHeight?: string;
}

export interface Selection {
  printer: string;
  process: string;
  filaments: string[];
  colours: string[];
}

export interface SelectResult {
  selection: Selection;
  processes: PresetSummary[];
  filaments: PresetSummary[];
}

export interface PresetsLoaded {
  counts: { printers: number; filaments: number; processes: number };
  selection: Selection;
  vendorVersion: string;
}

export interface OptionDef {
  type: string;
  label: string;
  fullLabel: string;
  category: string;
  tooltip: string;
  sidetext: string;
  mode: 'simple' | 'advanced' | 'develop';
  min?: number;
  max?: number;
  enumValues?: string[];
  enumLabels?: string[];
  default?: string;
  nullable?: boolean;
  multiline?: boolean;
  readonly?: boolean;
}

export interface SettingsLayout {
  print: SettingsPage[];
  filament: SettingsPage[];
  printer: SettingsPage[];
}
export interface SettingsPage {
  page: string;
  groups: { title: string; options: string[] }[];
}

export interface VolumeInfo {
  name: string;
  kind: 'part' | 'negative' | 'modifier' | 'supportEnforcer' | 'supportBlocker' | 'other';
  extruder: number;
  painted: boolean;
}
export interface InstanceInfo {
  plate: number;
  offset: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  printable: boolean;
}
export interface ObjectInfo {
  name: string;
  size: [number, number, number];
  extruder: number;
  volumes: VolumeInfo[];
  instances: InstanceInfo[];
}
export interface ProjectInfo {
  fileName: string;
  plateWidth: number;
  plateDepth: number;
  plates: { index: number; name: string; objects: number[] }[];
  objects: ObjectInfo[];
  file: {
    bambu: boolean;
    hasConfig: boolean;
    printer: string;
    filamentColours: string;
    filamentTypes: string;
    filamentPresets: string;
    process: string;
  };
}

export interface PreviewMesh {
  positions: Float32Array;
  filaments: Uint8Array;
  objectTriangles: Int32Array;
}

export interface SliceResult {
  success: boolean;
  error: string;
  warnings: string[];
  gcodePath: string;
  totalLayers: number;
  estimatedTimeSeconds: number;
  filamentMm: Record<string, number>;
  totalFilamentMm: number;
  totalFilamentGrams: number;
}

export type WorkerReply =
  | { type: 'ready'; presets: PresetsLoaded }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'progress'; id: number; pct: number; stage: string }
  | { type: 'error'; id: number | null; message: string };
