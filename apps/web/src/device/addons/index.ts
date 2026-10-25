import type { PrinterAddon, PrinterFacts } from './types';
import { bambuAddon } from './bambu';
import { elegooAddon } from './elegoo';
import { octoPrintAddon } from './octoprint';
import { prusaAddon } from './prusa';
import { u1Addon } from './u1';

/** Every printer gets the generic Klipper screen; these add to it when they recognise the printer. */
export const ADDONS: PrinterAddon[] = [u1Addon, prusaAddon, octoPrintAddon, elegooAddon, bambuAddon];

/** Whether the printer takes G-code and the other Klipper commands (see PrinterAddon.noCommands). */
export function takesCommands(addons: PrinterAddon[]): boolean {
  return !addons.some((a) => a.noCommands);
}

export function detectAddons(facts: PrinterFacts): PrinterAddon[] {
  return ADDONS.filter((a) => a.detect(facts));
}

export type { PrinterAddon, PrinterError, PrinterFacts } from './types';
