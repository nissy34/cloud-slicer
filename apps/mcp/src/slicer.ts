// What the MCP tools work on: one engine, one open project, the chosen presets
// and the setting changes on top, like a site tab. Everything is in Orca's own
// words (preset names, option keys, values as Orca writes them), and every
// rule comes from the engine or from the site's own helpers, never a copy.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import type { OrcaConfig, PresetSummary, Selection } from '../../web/src/engine/protocol';
import { emptyProjectMessage, pickProcess, printerLabel, projectOverrides } from '../../web/src/lib/project-import';
import { objectSettingGroups } from '../../web/src/lib/object-settings';
import { checkOptionValue } from '../../web/src/lib/option-check';
import { pickFilamentPreset, splitList } from '../../web/src/lib/presets';
import { bedSize } from '../../web/src/lib/colour';
import { thumbnailSizes } from '../../web/src/lib/thumbnail';
import { EngineClient, EngineStopped, type EngineInfo, type Progress } from './engine-client';
import { drawThumbnails, type PlateMesh } from './picture';

export type Flavor = 'snapmaker' | 'orca';
export const ENGINES: Record<Flavor, string> = { snapmaker: 'Snapmaker Orca', orca: 'OrcaSlicer' };
export const DEFAULT_PRINTER = 'Snapmaker U1 (0.4 nozzle)';

interface CatalogVendor {
  id: string;
  name: string;
  file: string;
  models: { model: string; nozzles: { name: string; nozzle: string }[] }[];
}
interface OptionDef {
  label: string;
  maxLiteral?: number;
  nullable?: boolean;
  fullLabel?: string;
  category?: string;
  tooltip?: string;
  sidetext?: string;
  type: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  enumLabels?: string[];
}
interface SelectResult {
  selection: Selection;
  processes: PresetSummary[];
  filaments: PresetSummary[];
}
export interface ModelInfo {
  fileName: string;
  objects: {
    name: string;
    size: number[];
    /** Filament slot (1-based); 0 = the default, slot 1. */
    extruder: number;
    settings: OrcaConfig;
    volumes: { name: string; kind: string; extruder: number; painted?: boolean; settings: OrcaConfig }[];
    instances: { offset: number[]; plate: number; printable: boolean; loose?: boolean; rotation: number[]; scale: number[] }[];
  }[];
  plates: unknown[];
  file?: { printer?: string; process?: string; filamentColours?: string; filamentPresets?: string; filamentTypes?: string; hasConfig?: boolean };
}

export class Slicer {
  private client: EngineClient | null = null;
  info: EngineInfo | null = null;
  flavor: Flavor = 'snapmaker';
  options: Record<string, OptionDef> = {};
  private catalog: CatalogVendor[] = [];
  lists: SelectResult | null = null;
  /** Setting changes on top of the presets (a project's own settings, then Claude's). */
  overrides: OrcaConfig = {};
  base: OrcaConfig = {};
  model: ModelInfo | null = null;
  modelFile: string | null = null;

  /** `root`: the folder with engines/<flavor>/ (the build output). */
  constructor(private root: string, private here: string) {}

  private engineDir(flavor: Flavor) {
    return resolve(this.root, 'engines', flavor);
  }

  /** The engine of `flavor`, started (again) when needed; a new engine forgets the project. */
  async engine(flavor: Flavor = this.flavor): Promise<EngineClient> {
    if (this.client && !this.client.stopped && flavor === this.flavor) return this.client;
    const restarted = this.client?.stopped && flavor === this.flavor;
    await this.client?.close();
    this.client = new EngineClient(this.engineDir(flavor), this.here);
    this.flavor = flavor;
    this.info = await this.client.ready;
    this.options = await this.client.request('read', ['configOptionsJson']);
    this.catalog = JSON.parse(readFileSync(resolve(this.engineDir(flavor), 'profiles/catalog.json'), 'utf8')).vendors;
    this.model = null;
    this.modelFile = null;
    this.overrides = {};
    await this.select({ printer: this.lists?.selection.printer ?? DEFAULT_PRINTER });
    if (restarted) throw new EngineStopped('The engine stopped (often: it ran out of memory). It has started again; open the model again.');
    return this.client;
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    return (await this.engine()).request<T>(method, args);
  }

  /** Printers in the bundled presets, by brand: [{brand, models: [{model, printers}]}]; `search` filters. */
  printers(search = '') {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
    return this.catalog
      .map((v) => ({
        brand: v.name,
        models: v.models
          .map((m) => ({ model: m.model, printers: m.nozzles.map((n) => n.name).filter((name) => hit(`${v.name} ${m.model} ${name}`)) }))
          .filter((m) => m.printers.length),
      }))
      .filter((v) => v.models.length);
  }

  /**
   * Loads the brand of `printer` when it isn't in yet (bundle-profiles.mjs keeps
   * one file per brand; the start-up brands have none, they are always in).
   */
  private async loadBrandOf(printer: string) {
    const vendor = this.catalog.find((v) => v.models.some((m) => m.nozzles.some((n) => n.name === printer)));
    if (vendor?.file) await this.call('brands', [vendor.file]);
  }

  /**
   * Chooses presets like the site's pickers. Leaving `process` out takes the
   * printer's default; `filaments` and `colours` are per slot. Plates follow
   * the new printer's bed.
   */
  async select(choice: { printer?: string; process?: string; filaments?: string[]; colours?: string[] }) {
    const printer = choice.printer ?? this.lists?.selection.printer ?? DEFAULT_PRINTER;
    await this.loadBrandOf(printer);
    const before = this.lists?.selection.printer;
    const want = {
      printer,
      ...(choice.process !== undefined ? { process: choice.process } : printer === before ? { process: this.lists?.selection.process } : {}),
      ...(choice.filaments ? { filaments: choice.filaments } : printer === before ? { filaments: this.lists?.selection.filaments } : {}),
      ...(choice.colours ? { colours: choice.colours } : printer === before ? { colours: this.lists?.selection.colours } : {}),
    };
    this.lists = await this.call<SelectResult>('json', 'presetsSelect', JSON.stringify(want));
    const got = this.lists.selection;
    const missing: string[] = [];
    if (got.printer !== printer) missing.push(`printer "${printer}"`);
    if (choice.process && got.process !== choice.process) missing.push(`process "${choice.process}"`);
    choice.filaments?.forEach((f, i) => got.filaments[i] !== f && missing.push(`filament "${f}"`));
    this.base = (await this.call<{ config: OrcaConfig }>('json', 'presetsFullConfig', '{}')).config;
    if (this.model && got.printer !== before) await this.fitPlates();
    return { selection: got, missing };
  }

  private async fitPlates() {
    const { w, d } = bedSize(this.base.printable_area);
    await this.call('json', 'resizePlates', w, d);
    this.model = await this.call('read', 'modelInfoJson');
  }

  /** The full settings: presets plus changes, and what the engine refused. */
  async fullConfig(extra: OrcaConfig = {}) {
    return this.call<{ config: OrcaConfig; errors: string[] }>('json', 'presetsFullConfig', JSON.stringify({ ...this.overrides, ...extra }));
  }

  /**
   * Changes settings by Orca option key; "" or null takes a change back. Each
   * value is checked like the site's settings boxes do (lib/option-check.ts,
   * from the engine's own option descriptions): not a number or not one of the
   * choices is refused, out of range is set to the nearest allowed value.
   */
  async change(settings: Record<string, string | number | boolean | null>) {
    const next = { ...this.overrides };
    const applied: string[] = [];
    const refused: string[] = [];
    const notes: string[] = [];
    for (const [key, raw] of Object.entries(settings)) {
      const def = this.options[key];
      if (!def) {
        refused.push(`${key}: not a setting this engine knows (find_settings looks keys up)`);
        continue;
      }
      if (raw === null || raw === '') {
        delete next[key];
        applied.push(key);
        continue;
      }
      const r = this.check(key, raw);
      if ('problem' in r) refused.push(r.problem);
      else {
        next[key] = r.value;
        applied.push(key);
        if (r.note) notes.push(r.note);
      }
    }
    const { errors } = await this.call<{ errors: string[] }>('json', 'presetsFullConfig', JSON.stringify(next));
    if (errors.length) return { applied: [], refused: [...refused, ...errors], notes };
    this.overrides = next;
    return { applied, refused, notes };
  }

  /** Current values (and what each setting is) for `keys`. */
  async read(keys: string[]) {
    const { config } = await this.fullConfig();
    return Object.fromEntries(
      keys.map((k) => {
        const def = this.options[k];
        if (!def) return [k, { error: 'not a setting this engine knows' }];
        return [k, {
          value: config[k],
          default: this.base[k],
          changed: k in this.overrides,
          label: def.fullLabel || def.label || k,
          ...(def.category && { page: def.category }),
          ...(def.sidetext && { unit: def.sidetext }),
          ...(def.tooltip && { help: def.tooltip }),
          ...(def.enumValues && { choices: Object.fromEntries(def.enumValues.map((v, i) => [v, def.enumLabels?.[i] ?? v])) }),
          ...(def.min !== undefined && { min: def.min }),
          ...(def.max !== undefined && { max: def.max }),
        }];
      }),
    );
  }

  /** Settings whose name or key matches all words of `query`. */
  find(query: string, limit = 25) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out: { key: string; label: string; page?: string }[] = [];
    for (const [key, def] of Object.entries(this.options)) {
      const text = `${key} ${def.fullLabel || ''} ${def.label || ''} ${def.category || ''}`.toLowerCase();
      if (def.label && words.every((w) => text.includes(w))) out.push({ key, label: def.fullLabel || def.label, page: def.category || undefined });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Opens a model file (STL, 3MF, OBJ, AMF). A 3MF made for a printer we
   * have brings its presets, filaments and own settings, as on the site; one
   * made for another printer keeps the current printer, with its filaments
   * matched by material. `add` puts it beside what is open instead.
   */
  async open(file: string, opts: { add?: boolean; engine?: Flavor; plate?: number } = {}) {
    const path = resolve(file);
    if (!existsSync(path)) throw new Error(`No file at ${path}`);
    if (opts.engine && opts.engine !== this.flavor) await this.engine(opts.engine);
    const { info } = await this.call<{ info: ModelInfo }>('open', path, { add: !!opts.add, plate: opts.plate ?? 0, config: this.base });
    this.model = info;
    if (!opts.add) {
      this.modelFile = path;
      this.overrides = {};
    }
    if (!info.objects.length) throw new Error(emptyProjectMessage(basename(path)));
    const notes: string[] = [];
    if (!opts.add && info.file?.hasConfig) notes.push(await this.importProject(info));
    return { info: this.model, notes: notes.filter(Boolean) };
  }

  // The site's importProject (state/store.ts), without the questions it asks a
  // person: a project for an unknown printer is opened on the current printer.
  private async importProject(info: ModelInfo): Promise<string> {
    const fileConfig = await this.call<OrcaConfig>('read', 'fileConfigJson');
    const colours = splitList(info.file?.filamentColours);
    const types = splitList(info.file?.filamentTypes);
    const presets = splitList(info.file?.filamentPresets);
    const printer = info.file?.printer ?? '';
    await this.loadBrandOf(printer);
    const known = (await this.call<PresetSummary[]>('read', 'presetsPrinters')).some((p) => p.name === printer);
    if (known) {
      await this.select({ printer, process: '' });
      const names = colours.map((_, i) =>
        this.lists!.filaments.some((f) => f.name === presets[i]) ? presets[i] : pickFilamentPreset(this.lists!.filaments, types[i], this.lists!.selection.filaments[0], presets[i]),
      );
      await this.select({ printer, process: info.file?.process || this.lists!.selection.process, filaments: names.length ? names : undefined, colours: colours.length ? colours : undefined });
      this.overrides = projectOverrides(fileConfig, this.base, this.options);
      const n = Object.keys(this.overrides).length;
      return n ? `Opened with the project's presets and its ${n} own setting${n === 1 ? '' : 's'}.` : "Opened with the project's presets.";
    }
    const current = this.lists!.selection.printer;
    const names = colours.map((_, i) => pickFilamentPreset(this.lists!.filaments, types[i], this.lists!.selection.filaments[0], presets[i]));
    await this.select({
      printer: current,
      process: pickProcess(this.lists!.processes, fileConfig.layer_height, this.lists!.selection.process),
      filaments: names.length ? names : undefined,
      colours: colours.length ? colours : undefined,
    });
    return `This project was made for ${printerLabel(fileConfig)}, which isn't in the presets here. It is set up for ${current} instead, with its filaments matched by material; its own print settings were not carried over.`;
  }

  async refreshModel() {
    this.model = await this.call('read', 'modelInfoJson');
    return this.model!;
  }

  /** Moves, turns or scales one copy. Offsets are millimetres from the plate's front left corner. */
  async transform(object: number, instance: number, change: { offset?: number[]; rotation?: number[]; scale?: number[]; plate?: number }) {
    // Moving to the plate after the last one makes it, as dragging there does on the site.
    if (change.plate !== undefined) {
      const plates = this.model?.plates.length ?? 1;
      if (change.plate > plates) throw new Error(`There ${plates === 1 ? 'is 1 plate' : `are ${plates} plates`}; plate ${plates} (a new one) is the furthest an object can go.`);
      if (change.plate === plates) await this.call('json', 'addPlate');
    }
    await this.call('json', 'setInstanceTransform', object, instance, JSON.stringify(change));
    return this.refreshModel();
  }

  async copies(object: number, count: number) {
    const have = this.model?.objects[object]?.instances.length ?? 0;
    for (let i = have; i < count; i++) await this.call('json', 'addInstance', object, 0, 10, 10);
    for (let i = have - 1; i >= count; i--) await this.call('json', 'deleteInstance', object, i);
    return this.refreshModel();
  }

  async remove(object: number) {
    await this.call('json', 'deleteObject', object);
    return this.refreshModel();
  }

  async arrange(plate: number, spacing: number) {
    const { config } = await this.fullConfig();
    const tall = config.print_sequence === 'by object' ? Number(config.extruder_clearance_height_to_rod) || 0 : 0;
    await this.call('json', 'arrangePlate', plate, spacing, tall);
    return this.refreshModel();
  }

  /** Prints an object (or one of its parts) with filament `slot` (1-based). */
  async setFilament(object: number, part: number | undefined, slot: number) {
    const slots = this.lists?.selection.filaments.length ?? 1;
    if (slot < 1 || slot > slots) throw new Error(`There ${slots === 1 ? 'is 1 filament slot' : `are ${slots} filament slots`}; choose_presets adds more.`);
    await this.call('json', 'setExtruder', object, part ?? -1, slot);
    return this.refreshModel();
  }

  /**
   * Settings for one object (or part) only, like desktop's object list "Add
   * settings": only the settings desktop offers there (lib/object-settings.ts),
   * each checked like change(). null takes one back.
   */
  async objectSettings(object: number, part: number | undefined, settings: Record<string, string | number | boolean | null>) {
    const slots = this.lists?.selection.filaments.length ?? 1;
    const allowed = new Set(objectSettingGroups(this.options as never, part !== undefined, slots, false).flatMap((g) => g.settings.map((x) => x.key)));
    const values: Record<string, string | null> = {};
    const refused: string[] = [];
    const notes: string[] = [];
    for (const [key, raw] of Object.entries(settings)) {
      if (!allowed.has(key)) {
        refused.push(`${key}: not a setting ${part === undefined ? 'an object' : 'a part'} can have on its own${key === 'extruder' ? ' (set_filament does this)' : ''}`);
        continue;
      }
      if (raw === null || raw === '') {
        values[key] = null;
        continue;
      }
      const r = this.check(key, raw);
      if ('problem' in r) refused.push(r.problem);
      else {
        values[key] = r.value;
        if (r.note) notes.push(r.note);
      }
    }
    if (Object.keys(values).length) await this.call('json', 'setObjectSettings', object, part ?? -1, JSON.stringify(values));
    return { model: await this.refreshModel(), refused, notes };
  }

  /** One value checked like the site's settings boxes. */
  private check(key: string, raw: string | number | boolean): { value: string; note?: string } | { problem: string } {
    const def = this.options[key];
    const text = typeof raw === 'boolean' ? (raw ? '1' : '0') : String(raw);
    if (def.type === 'enum' && def.enumValues && !def.enumValues.includes(text)) return { problem: `${key}: "${text}" is not one of ${def.enumValues.join(', ')}` };
    const r = checkOptionValue(def, def.type, text);
    if (r.kind === 'invalid') return { problem: `${key}: ${r.problem}` };
    if (r.kind === 'ask') return { problem: `${key}: say "${r.number}%" for a percentage or "${r.number}${r.unit === 'mm' ? 'mm' : ''}" for ${r.unit}` };
    return { value: r.value, ...(r.kind === 'clamped' && { note: `${key}: ${r.note}` }) };
  }

  /** A picture of a plate as the printer's screen shows it, for Claude to look at. */
  async picture(plate: number, size = 512) {
    const { config } = await this.fullConfig();
    const mesh = await this.call<PlateMesh>('preview', plate);
    return drawThumbnails(mesh, splitList(config.filament_colour), [{ width: size, height: size }])[0] ?? null;
  }

  async orient(object: number) {
    await this.call('json', 'orientObject', object);
    return this.refreshModel();
  }

  private async pictures(plate: number, config: OrcaConfig) {
    const mesh = await this.call<PlateMesh>('preview', plate);
    return drawThumbnails(mesh, splitList(config.filament_colour), thumbnailSizes(config.thumbnails));
  }

  /**
   * Slices a plate and writes the G-code to `out` (a file or a folder; default:
   * beside the model, named by the printer's file name format).
   */
  async slice(opts: { plate?: number; out?: string; settings?: OrcaConfig }, progress?: Progress) {
    if (!this.model) throw new Error('Open a model first.');
    const plate = opts.plate ?? 0;
    const { config, errors } = await this.fullConfig(opts.settings);
    if (errors.length) throw new Error(`These settings can't be used: ${errors.join('; ')}`);
    const thumbnails = await this.pictures(plate, config);
    const name = this.modelFile ? basename(this.modelFile, extname(this.modelFile)) : 'plate';
    const client = await this.engine();
    const result = await client.request<SliceResult>('slice', [config, { plate, name, thumbnails }], progress);
    if (!result.success) throw new Error(result.error || 'The slice failed.');
    const file = outputPath(opts.out, this.modelFile, result.fileName);
    writeFileSync(file, result.gcode);
    let file3mf: string | undefined;
    if (result.gcode3mf) writeFileSync((file3mf = `${file.replace(/\.gcode$/i, '')}.gcode.3mf`), result.gcode3mf);
    return { file, file3mf, result, pictures: thumbnails.map((t) => `${t.width}x${t.height}`) };
  }

  /** Saves the project (models, presets and changes) as a 3MF that the site and desktop Orca open. */
  async save(file: string) {
    const { config, errors } = await this.fullConfig();
    if (errors.length) throw new Error(`These settings can't be used: ${errors.join('; ')}`);
    const [picture] = await this.pictures(0, { ...config, thumbnails: '512x512' });
    const path = resolve(file);
    await this.call('saveProject', path, config, picture ? { plate: 0, ...picture } : null);
    return path;
  }

  async close() {
    await this.client?.close();
  }
}

export interface SliceResult {
  success: boolean;
  error?: string;
  cancelled?: boolean;
  fileName: string;
  estimatedTimeSeconds: number;
  totalLayers: number;
  totalFilamentGrams: number;
  totalFilamentMm: number;
  totalCost: number;
  filamentParts: Record<string, Record<string, { g: number; mm: number }>>;
  objectsOutside: unknown[];
  warnings: unknown[];
  gcode: Uint8Array;
  gcode3mf?: Uint8Array;
}

function outputPath(out: string | undefined, model: string | null, fileName: string) {
  const name = fileName || 'plate.gcode';
  if (!out) return resolve(model ? dirname(model) : process.cwd(), name);
  const path = resolve(out);
  return /\.gcode$/i.test(path) ? path : resolve(path, name);
}
