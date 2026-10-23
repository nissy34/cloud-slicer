// Desktop's settings pages as one printer shows them (TabPrinter in Tab.cpp).
import type { SettingsPage } from '../engine/protocol';

/**
 * Desktop settings a web page can't honour, left out of the pages: desktop's
 * post-processing scripts run a program on the computer after slicing.
 */
export const NOT_IN_BROWSER = new Set(['post_process']);

/** The layout's pages as this printer shows them: Extruder 1..n, and the ones its flavor has. */
export function shownPages(layout: SettingsPage[], extruders: number, flavor: string | undefined): (SettingsPage & { index?: number })[] {
  return layout
    .filter((p) => !p.flavors || (flavor !== undefined && p.flavors.includes(flavor)))
    .map((p) => ({
      ...p,
      groups: p.groups.map((g) => ({ ...g, options: g.options.filter((k) => !NOT_IN_BROWSER.has(k)) })).filter((g) => g.options.length),
    }))
    .filter((p) => p.groups.length)
    .flatMap((p) => (p.extruder ? Array.from({ length: extruders }, (_, i) => ({ ...p, page: `${p.page} ${i + 1}`, index: i })) : [p]));
}
