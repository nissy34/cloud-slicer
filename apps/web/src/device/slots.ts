// Where a printer holds its filaments (a U1's tool heads, a Bambu Lab AMS), the
// same for every printer whose add-on can read them (PrinterAddon.filaments):
// "From printer" in the Filament section loads them into the project, and the
// print dialog maps each filament in the file to one of them.
import { differenceCie76 } from 'culori';

export interface FilamentSlot {
  /** Position in the printer's list. */
  index: number;
  /** "T1", "A1", "Ext" */
  label: string;
  /** #RRGGBB */
  colour: string;
  /** '' when the printer doesn't know. */
  material: string;
  subType: string;
  vendor: string;
  /** Filament in the slot itself. */
  loaded: boolean;
  /** Filament it can print with now (a U1 head also counts its side feeder). */
  ready: boolean;
  /** Read from the maker's filament tag, so the printer won't let it be edited. */
  official: boolean;
  nozzle: { diameter: number; volumeType: string } | null;
}

/** What the print dialog knows about one filament in the file. */
export interface MappedFilament {
  index: number;
  colour: string;
  material: string;
  /** Nozzle diameter the file was sliced for, in mm. */
  nozzle?: number;
  /** The file was sliced for a high-flow nozzle. */
  highFlow?: boolean;
}

/** How the print dialog names a printer's slots, from its add-on. */
export interface SlotWords {
  /** "tool head" */
  noun: string;
  /** What to do about a slot with no filament type: "Load filament, or set its type on the Tool heads card." */
  unset: string;
}

/** Print options a printer can be asked for before a print starts. */
export interface PrintOptions {
  bedLevel: boolean;
  flowCalibrate: boolean;
  timeLapse: boolean;
}

/** Snapmaker's way of comparing material names: case, dashes, underscores and spaces don't count. */
const materialKey = (v: string) => v.toLowerCase().replace(/[-_ ]/g, '');

/**
 * Whether a slot's filament is the type the file asks for, the way Snapmaker's
 * and Bambu Lab's print dialogs decide it: the same material name, or the
 * slot's type and sub-type together spelling it ("PLA" + "CF" for a "PLA-CF"
 * file). Brand and colour don't matter.
 */
export function materialMatches(fileMaterial: string, slot: Pick<FilamentSlot, 'material' | 'subType'>): boolean {
  const want = materialKey(fileMaterial);
  const type = materialKey(slot.material);
  if (!want || !type) return false;
  if (want === type) return true;
  const sub = materialKey(slot.subType);
  return Boolean(sub) && sub !== type && want === type + sub;
}

/** Why a filament has no slot: none of the loaded ones is allowed. */
export const noSlotReason = (f: MappedFilament, words: SlotWords) =>
  `No ${words.noun} has ${f.material || 'a matching filament'}${f.nozzle ? ` with a ${f.nozzle} mm nozzle` : ''}. Load it, or change the filament in the slicer and slice again.`;

/**
 * Whether a filament can go to a slot, with the same rules as the printer
 * makers' print dialogs: a slot with another filament type, no filament
 * identified or another nozzle size can't be picked; a standard nozzle for a
 * file sliced for high flow is allowed with a warning.
 */
export function slotCheck(f: MappedFilament, slot: FilamentSlot, words: SlotWords): { blocked: string | null; warning: string | null } {
  let blocked: string | null = null;
  if (!slot.material) blocked = `${slot.label} has no filament type set. ${words.unset}`;
  else if (f.material && !materialMatches(f.material, slot))
    blocked = `${slot.label} has ${[slot.material, slot.subType].filter(Boolean).join(' ')}, but this filament was sliced as ${f.material}.`;
  else if (f.nozzle && slot.nozzle && Math.abs(f.nozzle - slot.nozzle.diameter) >= 0.001)
    blocked = `${slot.label} has a ${slot.nozzle.diameter} mm nozzle, but the file was sliced for ${f.nozzle} mm.`;
  const warning =
    !blocked && f.highFlow && slot.nozzle && slot.nozzle.volumeType !== 'high_flow'
      ? `The file was sliced for a high-flow nozzle, but ${slot.label} has a standard one.`
      : null;
  return { blocked, warning };
}

const cie76 = differenceCie76();
/** CIE76 distance between two #RRGGBB colours, for suggesting a slot per filament. */
export function colourDistance(a: string, b: string): number {
  return cie76(a, b);
}

/**
 * Suggested slot for each file filament: one it is allowed on (see
 * slotCheck), ready ones first, then the closest colour, each slot used once
 * while there are spares; -1 (no slot) when nothing fits.
 */
export function suggestSlotMap(filaments: MappedFilament[], slots: FilamentSlot[], words: SlotWords): Record<number, number> {
  const map: Record<number, number> = {};
  const used = new Set<number>();
  for (const f of filaments) {
    const candidates = slots
      .filter((s) => !slotCheck(f, s, words).blocked)
      .map((s) => ({ s, d: colourDistance(f.colour, s.colour) + (used.has(s.index) ? 1000 : 0) + (s.ready ? 0 : 2000) }))
      .sort((a, b) => a.d - b.d);
    const pick = candidates[0]?.s.index ?? -1;
    map[f.index] = pick;
    if (pick >= 0) used.add(pick);
  }
  return map;
}
