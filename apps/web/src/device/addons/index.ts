import type { PrinterAddon, PrinterFacts } from './types';
import { u1Addon } from './u1';

/** Every printer gets the generic Klipper screen; these add to it when they recognise the printer. */
export const ADDONS: PrinterAddon[] = [u1Addon];

export function detectAddons(facts: PrinterFacts): PrinterAddon[] {
  return ADDONS.filter((a) => a.detect(facts));
}

export type { PrinterAddon, PrinterError, PrinterFacts } from './types';
