// Desktop's settings pages as one printer shows them (TabPrinter in Tab.cpp).
import type { SettingsPage } from '../engine/protocol';

/**
 * Desktop settings a web page can't honour, left out of the pages: desktop's
 * post-processing scripts run a program on the computer after slicing.
 */
export const NOT_IN_BROWSER = new Set(['post_process']);

/**
 * Desktop settings shown greyed out, with GREYED_TIP as their tooltip: the web
 * app keeps them in the preset but doesn't act on them. The Dependencies
 * conditions pick which printers and processes a preset is offered for on
 * desktop; parallel printheads fills in desktop's excluded bed area.
 */
export const GREYED_IN_BROWSER = new Set(['compatible_printers_condition', 'compatible_prints_condition', 'parallel_printheads_count']);
export const GREYED_TIP = 'Not available in the browser';

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
