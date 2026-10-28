// The filament list grouped by brand, like Snapmaker Orca 2.4.1's filament
// menu (PlaterFilamentComboBox + FilamentSort.cpp): the user's own presets
// first, then a heading per brand with Snapmaker first and Generic second,
// Snapmaker's filaments in the order its filament_allow_list.json gives
// (sections.filament_order), everything else by name.
import type { PresetSummary } from '../engine/protocol';

/** Each brand's filament products in the order its presets suggest ({ Snapmaker: ["PLA SnapSpeed", ...] }). */
export type FilamentOrder = Record<string, string[]>;

const SNAPMAKER = 'Snapmaker';
const GENERIC = 'Generic';

/** sections.filament_order of a filament_allow_list.json, or {} when it has none (or is not schema 1). */
export function readFilamentOrder(text: string | undefined): FilamentOrder {
  try {
    const root = JSON.parse((text ?? '').replace(/^﻿/, ''));
    const order = root?.schema_version === 1 ? root.sections?.filament_order : undefined;
    if (!order || typeof order !== 'object') return {};
    const out: FilamentOrder = {};
    for (const [vendor, list] of Object.entries(order)) {
      if (!vendor || !Array.isArray(list) || !list.length || !list.every((v) => typeof v === 'string' && v)) return {};
      out[vendor] = list as string[];
    }
    return out;
  } catch {
    return {};
  }
}

/** Snapmaker and Generic spelled the one way, other brands as written (canonical_vendor). */
export function canonicalVendor(vendor: string): string {
  if (vendor.toLowerCase() === SNAPMAKER.toLowerCase()) return SNAPMAKER;
  if (vendor.toLowerCase() === GENERIC.toLowerCase()) return GENERIC;
  return vendor;
}

/** A preset's brand: its filament_vendor, else the first word of its name. */
export function filamentBrand(p: PresetSummary): string {
  const vendor = (p.filamentVendor ?? '').replace(/^"(.*)"$/, '$1').trim();
  const name = p.name.trim();
  return canonicalVendor(vendor && vendor !== '(Undefined)' ? vendor : name.split(/\s+/)[0] ?? '');
}

/** The product a preset is ("Snapmaker PLA Matte @U1" -> "PLA Matte"), as filament_product_key. */
export function filamentProduct(name: string, vendor: string): string {
  let product = name.trim();
  const owner = vendor.trim() || product.split(/[ \t]/)[0];
  if (owner && product.length > owner.length && product.slice(0, owner.length).toLowerCase() === owner.toLowerCase() && product[owner.length] === ' ')
    product = product.slice(owner.length + 1);
  const at = product.indexOf(' @');
  return (at >= 0 ? product.slice(0, at) : product).trim();
}

const vendorRank = (v: string) => (v === SNAPMAKER ? 0 : v === GENERIC ? 1 : 2);
// Desktop compares names by code point, not by locale.
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function rank(order: FilamentOrder, vendor: string, product: string): number {
  const key = Object.keys(order).find((k) => k.toLowerCase() === vendor.toLowerCase());
  const at = key ? order[key].findIndex((p) => p.toLowerCase() === product.toLowerCase()) : -1;
  return at < 0 ? Infinity : at;
}

/** System filaments grouped by brand: [brand, presets][] in desktop's order. */
export function filamentsByBrand(presets: PresetSummary[], order: FilamentOrder, label: (p: PresetSummary) => string): [string, PresetSummary[]][] {
  const groups = new Map<string, PresetSummary[]>();
  for (const p of presets) {
    const brand = filamentBrand(p);
    if (brand) groups.set(brand, [...(groups.get(brand) ?? []), p]);
  }
  const brands = [...groups.keys()].sort((a, b) => vendorRank(a) - vendorRank(b) || byCodePoint(a, b));
  return brands.map((brand) => {
    const list = groups.get(brand)!.map((p, i) => ({ p, i, rank: brand === SNAPMAKER ? rank(order, brand, filamentProduct(p.name, brand)) : Infinity, text: label(p) }));
    list.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : byCodePoint(a.text, b.text) || a.i - b.i));
    return [brand, list.map((x) => x.p)];
  });
}
