// Preset files in and out, the way desktop Orca's Import / Export Configs
// handle them: one preset is an Orca preset JSON file; several travel as a
// zip of those (desktop's .orca_printer / .orca_filament bundles, or a plain
// .zip). The engine reads each JSON with Orca's own loader (presetParse);
// this file unpacks bundles, checks limits and turns what the engine read
// into the diffs the account stores.
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import type { ParsedPreset } from '../engine/client';
import type { OptionDef, OrcaConfig, PresetSummary, SettingsLayout } from '../engine/protocol';
import type { PresetType } from '../account/api';
import { presetNameError } from '../account/api';
import { META } from '../account/preset-diff';
import { alignFlowVariants } from './flow-variants';
import { modelProcessKeys, pickProcess } from './project-import';
import { pickFilamentPreset } from './presets';

/** One preset JSON file. */
export const MAX_FILE_BYTES = 1024 * 1024;
/** A bundle as picked, and what it may unpack to. */
export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 20 * 1024 * 1024;
export const MAX_PRESETS_PER_IMPORT = 200;
/** Same limits as the account (functions/_lib/presets.ts). */
export const MAX_USER_PRESETS = 1000;
export const MAX_KEYS = 3000;
export const MAX_CONFIG_BYTES = 256 * 1024;

export const PRESET_FILE_TYPES = '.json,.orca_printer,.orca_filament,.zip,.bbscfg,.bbsflmt';

/** A preset file found in what the user picked. */
export interface PresetSource {
  /** Where it came from, for messages: "my.orca_printer › filament/PLA.json". */
  label: string;
  text: string;
}

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/**
 * The preset JSON files in `files`: JSON files as they are, zips unpacked.
 * Limits are checked before anything is unpacked, from the zip's own sizes,
 * so a zip bomb never inflates. Problems are messages for the user.
 */
export function readPresetFiles(files: { name: string; bytes: Uint8Array }[]): { sources: PresetSource[]; problems: string[] } {
  const sources: PresetSource[] = [];
  const problems: string[] = [];
  const add = (label: string, bytes: Uint8Array) => {
    if (bytes.length > MAX_FILE_BYTES) return problems.push(`${label} is ${kb(bytes.length)}; a preset file can be up to ${kb(MAX_FILE_BYTES)}.`);
    const text = strFromU8(bytes);
    try {
      const value = JSON.parse(text) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    } catch {
      return problems.push(`${label} is not a preset file (not JSON).`);
    }
    if (sources.length >= MAX_PRESETS_PER_IMPORT) return problems.push(`Only ${MAX_PRESETS_PER_IMPORT} presets can be imported at once; ${label} was left out.`);
    sources.push({ label, text });
  };
  for (const { name, bytes } of files) {
    if (!isZip(bytes)) {
      add(name, bytes);
      continue;
    }
    if (bytes.length > MAX_BUNDLE_BYTES) {
      problems.push(`${name} is ${mb(bytes.length)}; a bundle can be up to ${mb(MAX_BUNDLE_BYTES)}.`);
      continue;
    }
    let unpacked = 0;
    let tooBig = false;
    let entries: Unzipped;
    try {
      entries = unzipSync(bytes, {
        filter: (f) => {
          const base = f.name.split('/').pop() ?? '';
          if (!/\.json$/i.test(base) || base === 'bundle_structure.json' || f.name.startsWith('__MACOSX/')) return false;
          unpacked += f.originalSize;
          if (f.originalSize > MAX_FILE_BYTES || unpacked > MAX_UNPACKED_BYTES) tooBig = true;
          return !tooBig;
        },
      });
    } catch {
      problems.push(`${name} could not be opened as a zip.`);
      continue;
    }
    if (tooBig) {
      problems.push(`${name} unpacks to more than ${mb(MAX_UNPACKED_BYTES)}, or holds a file over ${kb(MAX_FILE_BYTES)}; nothing was imported from it.`);
      continue;
    }
    const names = Object.keys(entries).sort();
    if (!names.length) problems.push(`${name} has no preset files in it.`);
    for (const entry of names) add(`${name} › ${entry}`, entries[entry]);
  }
  return { sources, problems };
}

/** A name the account accepts: no / \ : * ? " < > |, at most 128 characters. */
export function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 128).trim();
}

/** "PLA" -> "PLA (2)", "PLA (2)" -> "PLA (3)", the first one `taken` says is free. */
export function freeName(name: string, taken: (n: string) => boolean): string {
  const base = name.replace(/ \(\d+\)$/, '');
  for (let i = 2; ; i++) {
    const next = `${base.slice(0, 128 - ` (${i})`.length)} (${i})`;
    if (!taken(next)) return next;
  }
}

/**
 * Filament settings that belong to the printer a filament preset was made for,
 * not to the material: dropped when it moves onto one of our presets.
 */
const FILAMENT_MACHINE_KEYS = new Set([
  'filament_start_gcode',
  'filament_end_gcode',
  'filament_extruder_variant',
  'filament_flow_support',
  'filament_flow_step_size',
  'filament_ids',
]);

/** Keys of `config` an import keeps when the preset moves onto another base. */
export function convertedKeys(type: PresetType, config: OrcaConfig, layout: SettingsLayout | null): string[] {
  const keys = Object.keys(config);
  if (type === 'process') {
    const model = modelProcessKeys(layout);
    return keys.filter((k) => model.has(k));
  }
  if (type === 'filament') return keys.filter((k) => !FILAMENT_MACHINE_KEYS.has(k));
  return keys;
}

/**
 * The diff a user preset stores, from what the engine read of a file: its
 * values with flow variants laid out like the base preset's (a Snapmaker Orca
 * 2.2 file has one value where 2.4 has standard and high flow), minus preset
 * bookkeeping, options this build doesn't have and values equal to the base.
 */
export function importDiff(own: OrcaConfig, base: OrcaConfig, options: Record<string, OptionDef>, keep?: string[]): OrcaConfig {
  const only = keep && new Set(keep);
  const aligned = alignFlowVariants(own, base, options);
  const diff: OrcaConfig = {};
  for (const [key, value] of Object.entries(aligned)) {
    if (META.has(key) || !(key in options) || (only && !only.has(key))) continue;
    if (value !== base[key]) diff[key] = value;
  }
  return diff;
}

/** G-code options a preset changes, by label: they run on the printer as written. */
export function changedGcode(diff: OrcaConfig, options: Record<string, OptionDef>): string[] {
  return Object.keys(diff)
    .filter((k) => /gcode$/.test(k))
    .map((k) => options[k]?.label || k);
}

/** Why a diff can't be stored, or null. */
export function limitError(diff: OrcaConfig): string | null {
  if (Object.keys(diff).length > MAX_KEYS) return `It changes more than ${MAX_KEYS} settings.`;
  if (new TextEncoder().encode(JSON.stringify(diff)).length > MAX_CONFIG_BYTES) return `Its settings are over ${kb(MAX_CONFIG_BYTES)}.`;
  return null;
}

/** What an import does with a preset whose name is taken. */
export type Collision = 'overwrite' | 'keep' | 'skip';

/** One preset of an import, as the dialog shows it. */
export interface ImportItem {
  key: string;
  label: string;
  type: PresetType;
  /** Name it is saved under. */
  name: string;
  /** Name in the file. */
  fileName: string;
  /** The preset the file inherits, as written. */
  inherits: string;
  /** System preset it goes on: the one it inherits, or one the user picks. */
  base: string;
  /** The system preset it inherits isn't here: `base` is a choice. */
  converted: boolean;
  /** It can't be imported, and why. */
  rejected?: string;
  /** Another preset of this type has the name already: a user preset (yours) or a system one. */
  taken?: 'user' | 'system';
  collision: Collision;
  /** Settings Orca dropped: unknown here, or not this preset type's. */
  dropped: string[];
  parsed: Extract<ParsedPreset, { ok: true }> | null;
}

const typeLabel = (t: PresetType) => (t === 'printer' ? 'printer' : t);

/**
 * The import plan for what the engine read: which presets go on which base,
 * which are rejected (not a preset, a printer we don't have) and which
 * names are taken. `systemNames` and `userNames` are the presets of each type
 * already here; `processes` and `filaments` the system presets a preset
 * from another printer can move onto, best match first.
 */
export function planImport(args: {
  sources: PresetSource[];
  parsed: ParsedPreset[];
  systemNames: Record<PresetType, Set<string>>;
  userNames: Record<PresetType, Set<string>>;
  processes: PresetSummary[];
  filaments: PresetSummary[];
  defaultProcess: string;
}): ImportItem[] {
  const { sources, parsed, systemNames, userNames } = args;
  const seen: Record<PresetType, Set<string>> = { printer: new Set(), filament: new Set(), process: new Set() };
  const items = parsed.map((p, i): ImportItem => {
    const label = sources[i]?.label ?? `file ${i + 1}`;
    const base = { key: `${i}`, label, fileName: '', inherits: '', base: '', converted: false, collision: 'keep' as Collision, dropped: [] };
    if (!p.ok) return { ...base, type: 'process', name: label, parsed: null, rejected: `Not a preset Orca can read: ${p.error}.` };
    const fileName = p.name || label.replace(/^.*[›/]\s*/, '').replace(/\.json$/i, '');
    const item: ImportItem = {
      ...base,
      type: p.type,
      fileName,
      name: cleanName(fileName),
      inherits: p.inherits,
      base: p.parent,
      dropped: [...p.unknown, ...p.invalid],
      parsed: p,
    };
    if (!item.name || presetNameError(item.name)) return { ...item, rejected: 'It has no usable name.' };
    if (!p.parent) {
      const made = p.config.printer_model || p.inherits || 'another printer';
      if (p.type === 'printer')
        return {
          ...item,
          rejected: p.inherits
            ? `It is for ${made}, which this app doesn't have. Printer settings are specific to the machine, so it can't be moved onto another printer.`
            : `It isn't based on a printer this app has.`,
        };
      item.converted = true;
      item.base =
        p.type === 'filament'
          ? pickFilamentPreset(args.filaments, p.config.filament_type, undefined, p.inherits || fileName)
          : pickProcess(args.processes, p.config.layer_height, args.defaultProcess);
      if (!item.base) return { ...item, rejected: `There is no ${typeLabel(p.type)} preset to put it on.` };
    }
    if (systemNames[p.type].has(item.name)) item.taken = 'system';
    else if (userNames[p.type].has(item.name)) item.taken = 'user';
    // A system preset's name can't be reused; the same name twice in one import keeps both.
    if (item.taken === 'system' || seen[p.type].has(item.name)) {
      item.name = freeName(item.name, (n) => systemNames[p.type].has(n) || userNames[p.type].has(n) || seen[p.type].has(n));
      item.taken = undefined;
    }
    seen[p.type].add(item.name);
    if (item.taken === 'user') item.collision = 'overwrite';
    return item;
  });
  // Printers first, like desktop's bundles, then filaments and processes.
  const order: Record<PresetType, number> = { printer: 0, filament: 1, process: 2 };
  return items.sort((a, b) => Number(!!a.rejected) - Number(!!b.rejected) || order[a.type] - order[b.type] || a.name.localeCompare(b.name));
}

/** The name an item is saved under for a collision choice. */
export function finalName(item: ImportItem, taken: (n: string) => boolean): string | null {
  if (item.taken !== 'user' || item.collision === 'overwrite') return item.name;
  if (item.collision === 'skip') return null;
  return freeName(item.name, taken);
}

/** Desktop's folder names inside a bundle. */
const BUNDLE_FOLDER: Record<PresetType, string> = { printer: 'printer', filament: 'filament', process: 'process' };

/**
 * A zip of preset files that desktop Orca's Import Configs reads (it takes
 * every JSON in a .zip), laid out like its printer bundles.
 */
export function presetBundle(files: { type: PresetType; name: string; json: string }[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const structure: Record<string, unknown> = {
    version: '',
    bundle_id: `cloud-slicer_${new Date().toISOString().slice(0, 10)}`,
    bundle_type: 'user presets',
    printer_config: [] as string[],
    filament_config: [] as string[],
    process_config: [] as string[],
  };
  for (const f of files) {
    const path = `${BUNDLE_FOLDER[f.type]}/${cleanName(f.name)}.json`;
    entries[path] = strToU8(f.json);
    (structure[`${f.type}_config`] as string[]).push(path);
  }
  entries['bundle_structure.json'] = strToU8(JSON.stringify(structure));
  return zipSync(entries, { level: 6 });
}

/** File name for an exported preset. */
export const presetFileName = (name: string) => `${cleanName(name) || 'preset'}.json`;

/**
 * Hands a file to the user: the share sheet where the device has one for
 * files (phones), when `share` is set, else a download.
 */
export async function saveFile(blob: Blob, name: string, share = false): Promise<void> {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (share && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The device can share files (a phone's share sheet). */
export const canShareFiles = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.canShare === 'function' &&
  navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });
