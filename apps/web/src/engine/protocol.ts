// Types of what public/engine/engine-worker.js returns. The engine speaks
// Orca's own vocabulary: preset names, option keys and serialized values.
import type { TextStyle } from '../lib/fonts';

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
  /**
   * Snapmaker flow-variant option: one value per flow variant (standard /
   * high flow), in the order of process_flow_support (or, per filament,
   * filament_flow_support).
   */
  flow?: 'process' | 'filament';
  /**
   * What can carry this option on its own: "region" options a part, modifier
   * or object can (PrintRegionConfig), "object" ones only an object can.
   */
  scope?: 'region' | 'object';
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
  /** Painted with filament colours. */
  painted: boolean;
  /** Other paint on the part. */
  paint: { support: boolean; seam: boolean; fuzzy: boolean };
  /** The part's own settings (Orca option key -> value). */
  settings: OrcaConfig;
  /** A text shape's text and font settings (the Text tool edits them). */
  text?: TextStyle;
  /** An SVG shape's depth and size across its face, mm (the SVG tool edits them). */
  svg?: { depth: number; width: number; height: number; useSurface: boolean };
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
  /** Converted from inches or meters by the object menu ('' when not). */
  units: '' | 'inch' | 'meter';
  extruder: number;
  /** The object's own settings, on top of the process (Orca option key -> value). */
  settings: OrcaConfig;
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
  /** Negative parts, modifiers and support enforcers/blockers (lib/volumes). */
  volumePositions: Float32Array;
  volumeList: Int32Array;
  /** [object, volume, first triangle, triangles] of each part of each instance. */
  partList: Int32Array;
}

/** What a paint stroke paints: filament colours, supports, seams or fuzzy skin. */
export type PaintKind = 'color' | 'support' | 'seam' | 'fuzzy';
/** Brushes (circle paints the visible side, sphere goes through), smart fill, bucket fill. */
export type PaintTool = 'circle' | 'sphere' | 'fill' | 'bucket';
export interface PaintSettings {
  kind: PaintKind;
  /** Filament number for colour; 1 enforce / 2 block for supports and seams; 1 for fuzzy skin; 0 erases. */
  state: number;
  tool: PaintTool;
  /** Brush radius, mm. */
  radius: number;
  /** Smart fill: faces up to this many degrees apart are filled together. */
  angle: number;
}
/** Support, seam or fuzzy skin paint to draw over the parts. */
export interface PaintOverlay {
  positions: Float32Array;
  /** 1 enforce / 2 block per triangle. */
  states: Uint8Array;
}
/** A ray from the camera through the pointer: origin then direction, plate coordinates. */
export type PaintRay = [number, number, number, number, number, number];

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
  /** Depth of the prime tower the slice made (mm), when it made one. */
  wipeTowerDepth?: number;
}

/**
 * The prime tower on a plate, as desktop's Prepare view shows it: x, y is its
 * front-left corner on the plate (mm), rotated `rotation` degrees about it;
 * `filaments` are the plate's (1-based), one coloured band each.
 */
export type WipeTower =
  | { show: false }
  | { show: true; x: number; y: number; width: number; depth: number; height: number; rotation: number; brim: number; filaments: number[] };

/**
 * Engine start-up before 'ready': downloading the engine and presets (bytes so
 * far of `total`, 0 when unknown), then setting the engine up.
 */
export interface EngineLoading {
  stage: 'download' | 'setup';
  loaded: number;
  total: number;
}

export type WorkerReply =
  | { type: 'loading'; loading: EngineLoading }
  | { type: 'ready'; presets: PresetsLoaded; cancel: Int32Array | null }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'progress'; id: number; pct: number; stage: string }
  | { type: 'error'; id: number | null; message: string };
