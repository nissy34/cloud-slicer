// The setup wizard's choices: which printers and filaments the user has
// installed, as desktop Orca's first-run wizard asks. They are saved as
// account settings (this browser when signed out, the account when signed in).
import type { PresetSummary } from '../engine/protocol';
import type { EngineFlavor } from './engines';
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

/** Filament presets grouped by brand, for the wizard's filament page. */
export function filamentGroups(filaments: PresetSummary[], names: Set<string>): { vendor: string; filaments: PresetSummary[] }[] {
  const groups = new Map<string, PresetSummary[]>();
  for (const f of filaments) {
    if (!names.has(f.name)) continue;
    const vendor = (f.filamentVendor || f.vendor || 'Generic').replace(/^"(.*)"$/, '$1');
    if (!groups.has(vendor)) groups.set(vendor, []);
    groups.get(vendor)!.push(f);
  }
  return [...groups]
    .map(([vendor, list]) => ({ vendor, filaments: list.sort((a, b) => a.name.localeCompare(b.name)) }))
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
