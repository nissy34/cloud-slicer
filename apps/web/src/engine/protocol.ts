// Types of what public/engine/engine-worker.js returns. The engine speaks
// Orca's own vocabulary: preset names, option keys and serialized values.
import type { MixMode } from '../lib/mixing';
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
  /** The printer's flushing (engine/src/flush_api.cpp); missing from an older engine. */
  flush?: import('../lib/flush').FlushInfo;
}

/** Which engine is running and what it can do (engine/src/presets_api.cpp engineInfo). */
export interface EngineInfo {
  flavor: 'snapmaker' | 'orca';
  name: string;
  version: string;
  /** Mixed filaments (colour mixing): Snapmaker Orca's, or OrcaSlicer 2.5's. */
  mixing: boolean;
  /** The Add Mix window's ways of making a mix this engine has (OrcaSlicer has no Cycle). */
  mixModes?: MixMode[];
  /** Standard / high flow values per option (Snapmaker Orca 2.4). */
  flowVariants: boolean;
}

export interface PresetsLoaded {
  counts: { printers: number; filaments: number; processes: number };
  selection: Selection;
  vendorVersion: string;
  /** Snapmaker's filament_allow_list.json text ('' for engines without it). */
  filamentAllowList?: string;
  engine: EngineInfo;
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
  /**
   * A "mm or %" value above this (and above 100) is probably meant as a
   * percentage, so desktop asks which one. 1 when left out.
   */
  maxLiteral?: number;
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
  /** Desktop's Extruder 1, 2, ... pages: one per extruder, each editing its own entry. */
  extruder?: boolean;
  /** Options with a Normal and a Silent value (entries 0 and 1), as on Motion ability. */
  limits?: string[];
  /** Only for these gcode_flavor values. */
  flavors?: string[];
  /** The filament Setting Overrides page: unset (nil) values use the printer's. */
  overrides?: boolean;
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
  /** Where it sits in its object: mm, degrees and factors (desktop's part fields). */
  offset: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  /** Its mesh's size before its own scale, mm. */
  meshSize: [number, number, number];
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
  /** Unrotated and unscaled: an instance's size along its own axes is this times its scale. */
  meshSize: [number, number, number];
  /** Converted from inches or meters by the object menu ('' when not). */
  units: '' | 'inch' | 'meter';
  extruder: number;
  /** The object's own settings, on top of the process (Orca option key -> value). */
  settings: OrcaConfig;
  volumes: VolumeInfo[];
  instances: InstanceInfo[];
}
/**
 * An item of desktop's layer slider (Orca's CustomGCode::Item), run at the
 * start of the layer whose top is at z mm: a pause, a change to filament
 * `filament` (1-based), Orca's custom template, or the G-code in `gcode`.
 * "colour" (M600) only comes from older files; desktop no longer adds it.
 */
export interface LayerCode {
  z: number;
  type: 'pause' | 'filament' | 'custom' | 'template' | 'colour';
  filament: number;
  colour: string;
  gcode: string;
}

export interface ProjectInfo {
  fileName: string;
  plateWidth: number;
  plateDepth: number;
  /**
   * filaments: what the plate's parts print with (1-based, support left out);
   * layerCodes: its pauses, filament changes and custom G-code at layers;
   * settings: its own settings instead of the project's (lib/plate-settings.ts).
   */
  plates: { index: number; name: string; locked?: boolean; objects: number[]; filaments: number[]; layerCodes: LayerCode[]; settings: OrcaConfig }[];
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
/** Brushes, fills, and desktop's height range (a band all round the object). */
export type PaintTool = 'circle' | 'sphere' | 'fill' | 'bucket' | 'height';
export interface PaintSettings {
  kind: PaintKind;
  /** Filament number for colour; 1 enforce / 2 block for supports and seams; 1 for fuzzy skin; 0 erases. */
  state: number;
  tool: PaintTool;
  /** Brush radius, mm. */
  radius: number;
  /** Smart fill: faces up to this many degrees apart are filled together. */
  angle: number;
  /** Height range: the band's height, mm, from where it is clicked up. */
  height: number;
  /** Section view: nothing above this height (mm over the plate) is drawn, hit or painted; undefined for none. */
  clip?: number;
  /** Supports: show faces overhanging more than overhangAngle (degrees from straight down, desktop's). */
  highlightOverhangs?: boolean;
  /** Supports: paint only those faces (desktop's "On overhangs only"). */
  overhangsOnly?: boolean;
  overhangAngle?: number;
}
/** Support, seam or fuzzy skin paint to draw over the parts. */
export interface PaintOverlay {
  positions: Float32Array;
  /** 1 enforce / 2 block per triangle. */
  states: Uint8Array;
}
/** A ray from the camera through the pointer: origin then direction, plate coordinates. */
export type PaintRay = [number, number, number, number, number, number];

/**
 * A warning from a slice, as desktop shows it in a notification: a warning, or
 * a serious one (empty layers, G-code path conflicts). `object` names the
 * object it is about; `option` the setting.
 */
export interface SliceWarning {
  text: string;
  level: 'warning' | 'serious';
  object?: string;
  option?: string;
}

/** Where a filament went: the model, its support, the prime tower, or flushed when changing filament. */
export type FilamentPart = 'model' | 'support' | 'tower' | 'flushed';

export interface SliceResult {
  success: boolean;
  error: string;
  warnings: SliceWarning[];
  gcodePath: string;
  totalLayers: number;
  estimatedTimeSeconds: number;
  /** Desktop's "Prepare time": the part of estimatedTimeSeconds spent on the start G-code. */
  prepareSeconds?: number;
  filamentMm: Record<string, number>;
  totalFilamentMm: number;
  totalFilamentGrams: number;
  /** Desktop's Cost: the filaments' price plus the printer's time cost per hour of printing. */
  totalCost?: number;
  /** The G-code's file name as desktop makes it, from the process preset's filename_format. */
  fileName?: string;
  /** Set when the printer takes a .gcode.3mf (its use_3mf): the slice made one too. */
  gcode3mfPath?: string;
  /** Each filament's use (1-based) split like desktop's Filament view; parts it has none of are left out. */
  filamentParts?: Record<string, Partial<Record<FilamentPart, { mm: number; g: number }>>>;
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

/** A point on the plate (mm). */
export type PlatePoint = [number, number];

/**
 * Printing object by object (desktop's By object print sequence): the tool
 * head's clearance round each object on a plate, as desktop draws it, and the
 * slice's own check of it (Print::sequential_print_clearance_valid).
 * `radius`, `rod` and `lid` are the printer's extruder_clearance_radius,
 * _height_to_rod and _height_to_lid; `short`: every object is lower than the
 * nozzle, so only the skirt needs room. Each outline is an object's copy seen
 * from above, grown by half the radius; `order` is when it prints (1 first).
 * `collisions` are the outlines that touch; `tall` the objects higher than
 * their place in the order lets them be. `error` is the slice's message.
 */
export type Clearance =
  | { byObject: false; error?: string }
  | {
      byObject: true;
      radius: number;
      rod: number;
      lid: number;
      short: boolean;
      spacing: number;
      outlines: { object: number; instance: number; order: number; points: PlatePoint[] }[];
      collisions: PlatePoint[][];
      tall: { points: PlatePoint[]; height: number }[];
      error: string;
    };

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
