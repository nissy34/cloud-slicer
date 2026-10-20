// Desktop's settings pages as one printer shows them (TabPrinter in Tab.cpp).
import type { SettingsPage } from '../engine/protocol';

/** The layout's pages as this printer shows them: Extruder 1..n, and the ones its flavor has. */
export function shownPages(layout: SettingsPage[], extruders: number, flavor: string | undefined): (SettingsPage & { index?: number })[] {
  return layout
    .filter((p) => !p.flavors || (flavor !== undefined && p.flavors.includes(flavor)))
    .flatMap((p) => (p.extruder ? Array.from({ length: extruders }, (_, i) => ({ ...p, page: `${p.page} ${i + 1}`, index: i })) : [p]));
}
