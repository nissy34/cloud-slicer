// The setup wizard's choices: which printers and filaments the user has
// installed, as desktop Orca's first-run wizard asks. They are saved as
// account settings (this browser when signed out, the account when signed in).
import type { PresetSummary } from '../engine/protocol';
import type { EngineFlavor } from './engines';
import { standIn } from './preset-engines';
import { DEFAULT_PRINTER, shortName } from './presets';
import type { PrinterCatalog } from './printer-catalog';

/** Account setting key; signing in merges this browser's lists into the account's. */
export const SETUP_KEY = 'setup';

export interface Setup {
  /** Printer preset names. */
  printers: string[];
  /** Filament preset names. */
  filaments: string[];
  /** The engine new projects use (left out before the wizard asked: Snapmaker Orca). */
  engine?: EngineFlavor;
  /** The engine whose printer list the wizard showed, so `printers` names its presets (left out: Snapmaker Orca). */
  printersIn?: EngineFlavor;
  /** The engine whose filament list the wizard showed (left out: the same as `printersIn`). */
  filamentsIn?: EngineFlavor;
}

/**
 * The installed printers as engine `flavor` names them: the wizard lists one
 * engine's printers, and the other has its own name for some (or a stand-in).
 */
export function installedPrinters(setup: Setup | undefined, flavor: EngineFlavor): string[] | undefined {
  if (!setup?.printers) return undefined;
  const from = setup.printersIn ?? 'snapmaker';
  return [...new Set(setup.printers.map((name) => standIn('printer', name, from, flavor)))];
}

/**
 * The installed filaments as engine `flavor` names them. The other engine has
 * its own names for many ("Snapmaker PETG HF" is "Snapmaker PETG @U1" there),
 * so without this its pickers would offer only the few that share a name.
 */
export function installedFilaments(setup: Setup | undefined, flavor: EngineFlavor): string[] | undefined {
  if (!setup?.filaments) return undefined;
  const from = setup.filamentsIn ?? setup.printersIn ?? 'snapmaker';
  return [...new Set(setup.filaments.map((name) => standIn('filament', name, from, flavor)))];
}

/** The printer a project starts on when nothing was selected before: the first one installed that the engine has. */
export function startPrinter(printers: { name: string }[], installed: string[] | undefined): string {
  return installed?.find((name) => printers.some((p) => p.name === name)) ?? DEFAULT_PRINTER;
}

export interface PrinterModel {
  vendor: string;
  model: string;
  /** One preset per nozzle size, smallest first. */
  nozzles: { name: string; nozzle: string }[];
}

/** System printers by vendor and model, with a preset per nozzle (like the wizard's printer page). */
export function printerModels(printers: PresetSummary[]): PrinterModel[] {
  const models = new Map<string, PrinterModel>();
  for (const p of printers) {
    if (!p.system) continue;
    const vendor = p.vendor || 'Other';
    const model = p.model || p.name.replace(/\s*\([\d.]+ nozzle\)$/, '');
    const key = `${vendor}\u0000${model}`;
    if (!models.has(key)) models.set(key, { vendor, model, nozzles: [] });
    models.get(key)!.nozzles.push({ name: p.name, nozzle: (p.nozzle ?? '').split(',')[0] || '?' });
  }
  for (const m of models.values()) m.nozzles.sort((a, b) => Number(a.nozzle) - Number(b.nozzle));
  return [...models.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model));
}

/**
 * The presets a picker offers: the installed ones (plus the current value, so
 * it never disappears), or everything before the wizard has run or when
 * none of the installed ones fit.
 */
export function installedOnly<T extends { name: string }>(list: T[], installed: string[] | undefined, current?: string | string[]): T[] {
  // None of them fit this list (e.g. filaments installed for another printer): offer everything.
  if (!installed?.length || !list.some((p) => installed.includes(p.name))) return list;
  const keep = new Set([...installed, ...(Array.isArray(current) ? current : current ? [current] : [])]);
  return list.filter((p) => keep.has(p.name));
}

/** One row on the wizard's filament page: a filament by its short name, and every preset behind it. */
export interface FilamentRow {
  label: string;
  /** The presets with this short name, one per printer or nozzle ("Generic PLA @U1", "Generic PLA @Voron"). */
  names: string[];
}

/**
 * Filament presets grouped by brand, for the wizard's filament page. Each
 * filament is one row: presets that differ only by the printer they're for
 * share a row, and brands spelt differently ("snapmaker", "Snapmaker") share a group.
 */
export function filamentGroups(filaments: PresetSummary[], names: Set<string>): { vendor: string; rows: FilamentRow[] }[] {
  const groups = new Map<string, { vendor: string; rows: Map<string, FilamentRow> }>();
  for (const f of filaments) {
    if (!names.has(f.name)) continue;
    const vendor = (f.filamentVendor || f.vendor || 'Generic').replace(/^"(.*)"$/, '$1');
    const key = vendor.toLowerCase();
    if (!groups.has(key)) groups.set(key, { vendor, rows: new Map() });
    const g = groups.get(key)!;
    // The capitalised spelling names the group.
    if (g.vendor === g.vendor.toLowerCase() && vendor !== vendor.toLowerCase()) g.vendor = vendor;
    const label = shortName(f.name);
    if (!g.rows.has(label)) g.rows.set(label, { label, names: [] });
    g.rows.get(label)!.names.push(f.name);
  }
  return [...groups.values()]
    .map((g) => ({ vendor: g.vendor, rows: [...g.rows.values()].sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.vendor.localeCompare(b.vendor));
}

export interface WizardModel extends PrinterModel {
  /** Picture path under profiles/, or ''. */
  cover: string;
  /** Runs Klipper, so the Device tab can send to it; null when unknown. */
  send: boolean | null;
}

/**
 * The wizard's printer page: every brand in the engine's catalog, the ones
 * holding a picked printer first, then Snapmaker, then by name. Without a
 * catalog (an engine build from before it), the printers the engine loaded.
 */
export function wizardBrands(catalog: PrinterCatalog | null, printers: PresetSummary[], picked: string[]): { vendor: string; models: WizardModel[] }[] {
  const brands = catalog
    ? catalog.vendors.map((v) => ({ vendor: v.name, models: v.models.map((m) => ({ ...m, vendor: v.name })) }))
    : [...new Set(printerModels(printers).map((m) => m.vendor))].map((vendor) => ({
        vendor,
        models: printerModels(printers)
          .filter((m) => m.vendor === vendor)
          .map((m) => ({ ...m, cover: '', send: null })),
      }));
  // Within a brand, the picked models first too.
  const mine = (m: WizardModel) => (m.nozzles.some((n) => picked.includes(n.name)) ? 0 : 1);
  for (const b of brands) b.models.sort((x, y) => mine(x) - mine(y));
  const rank = (b: (typeof brands)[number]) => (b.models.some((m) => m.nozzles.some((n) => picked.includes(n.name))) ? 0 : b.vendor === 'Snapmaker' ? 1 : 2);
  return brands.sort((a, b) => rank(a) - rank(b) || a.vendor.localeCompare(b.vendor));
}

/** The models matching a search (brand or model name, any word order). */
export function matchModels<T extends { vendor: string; model: string }>(models: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return models;
  return models.filter((m) => {
    const text = `${m.vendor} ${m.model}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
