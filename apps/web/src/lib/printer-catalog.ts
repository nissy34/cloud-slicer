// Every printer brand the running engine ships (engine/scripts/bundle-profiles.mjs):
// a small catalog of each brand's models lists them all in the setup wizard,
// while the engine loads only Snapmaker's presets at start and each other brand's
// the first time one of its printers is picked or used. "Can send" printers run
// Klipper, so the Device tab can send to them through Moonraker, or are Prusa
// printers, the Elegoo Centauri Carbon or Bambu Lab printers, which it reaches
// through PrusaLink or the maker's own local protocol (the bridge stands in for Moonraker).
import type { PresetSummary } from '../engine/protocol';
import { engineFolder, type EngineFlavor } from './engines';

export interface CatalogModel {
  model: string;
  /** Picture path under profiles/, or ''. */
  cover: string;
  /** Runs Klipper, or is a Prusa, Centauri Carbon or Bambu Lab: the Device tab can send prints to it. */
  send: boolean;
  /** One printer preset per nozzle size, smallest first. */
  nozzles: { name: string; nozzle: string }[];
}

export interface CatalogVendor {
  /** The vendor's folder name in Orca's profiles. */
  id: string;
  name: string;
  /** Its preset file under profiles/; '' when the engine loads it at start. */
  file: string;
  /** Download size of that file (compressed). */
  bytes: number;
  /** Its bed index under profiles/beds/ (lib/bed.ts); '' or missing when it ships no beds. */
  beds?: string;
  models: CatalogModel[];
}

export interface PrinterCatalog {
  version: string;
  vendors: CatalogVendor[];
}

const loads = new Map<EngineFlavor, Promise<PrinterCatalog | null>>();

/** The engine's catalog (fetched once per engine); null when the build has none. */
export function loadCatalog(flavor: EngineFlavor): Promise<PrinterCatalog | null> {
  if (!loads.has(flavor)) {
    const url = `/${engineFolder(flavor)}/profiles/catalog.json?v=${import.meta.env.VITE_ENGINE_VERSION}`;
    loads.set(
      flavor,
      fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<PrinterCatalog>) : null))
        .then((c) => c && withDirectPrint(c))
        .catch(() => null),
    );
  }
  return loads.get(flavor)!;
}

/**
 * Printers the Device tab reaches without Klipper (the engine's catalog only knows
 * Klipper by its G-code flavor), by brand: every model, or the models named.
 * The Centauri Carbon 2 speaks another protocol, so only the first Carbon. Bambu
 * Lab's folder is BBL.
 */
const DIRECT_PRINT: Record<string, ((model: string) => boolean) | true> = {
  Prusa: true,
  Elegoo: (model) => /^(Elegoo )?Centauri Carbon$/i.test(model.trim()),
  BBL: true,
};

/** Marks the printers of DIRECT_PRINT as ones the Device tab can send to. */
export function withDirectPrint(catalog: PrinterCatalog): PrinterCatalog {
  return {
    ...catalog,
    vendors: catalog.vendors.map((v) => {
      const rule = DIRECT_PRINT[v.id];
      return rule ? { ...v, models: v.models.map((m) => (rule === true || rule(m.model) ? { ...m, send: true } : m)) } : v;
    }),
  };
}

/** The address of a model's picture. */
export const coverUrl = (flavor: EngineFlavor, cover: string) => `/${engineFolder(flavor)}/profiles/${cover}?v=${import.meta.env.VITE_ENGINE_VERSION}`;

/** Each system printer preset's vendor and model, by name. */
export function catalogIndex(catalog: PrinterCatalog | null): Map<string, { vendor: CatalogVendor; model: CatalogModel }> {
  const index = new Map<string, { vendor: CatalogVendor; model: CatalogModel }>();
  for (const vendor of catalog?.vendors ?? []) for (const model of vendor.models) for (const n of model.nozzles) index.set(n.name, { vendor, model });
  return index;
}

/** The brand files the engine needs for these printer preset names (unknown names and start-up brands need none). */
export function vendorFilesFor(catalog: PrinterCatalog | null, names: Iterable<string>): string[] {
  const index = catalogIndex(catalog);
  const files = new Set<string>();
  for (const name of names) {
    const file = index.get(name)?.vendor.file;
    if (file) files.add(file);
  }
  return [...files].sort();
}

/**
 * Whether the Device tab can send to a printer preset: a Klipper, Prusa, Centauri Carbon or Bambu Lab system
 * printer, or a user printer built on one. Null when the catalog doesn't know it.
 */
export function canSend(catalog: PrinterCatalog | null, name: string, printers: PresetSummary[] = []): boolean | null {
  const index = catalogIndex(catalog);
  const seen = new Set<string>();
  for (let n: string | undefined = name; n && !seen.has(n); n = printers.find((p) => p.name === n)?.inherits) {
    seen.add(n);
    const hit = index.get(n);
    if (hit) return hit.model.send;
  }
  return null;
}
