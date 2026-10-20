// How many filaments a project can slice with, by printer and engine, like
// desktop. Neither engine limits the count itself (64 each). A single-nozzle
// printer (an AMS, an MMU) takes as many filaments as the file or the user
// adds. A printer with several heads differs by engine:
// - Snapmaker Orca slices any number; the U1 then maps the file's filaments
//   onto its 4 heads when the print is sent (Device tab).
// - OrcaSlicer prints one filament per head (desktop hides Add/Remove for
//   toolchangers), so more filaments than heads can't slice. Bambu Lab's
//   two-nozzle printers are the exception: they map filaments to nozzles.
import type { EngineFlavor } from './engines';

export type FilamentLimit =
  /** Any number of filaments. */
  | { kind: 'free' }
  /** More filaments than heads; each gets a head when the print is sent. */
  | { kind: 'mapped'; heads: number }
  /** More filaments than heads; the printer's heads are fixed but slicing goes ahead (old Snapmaker behaviour). */
  | { kind: 'warn'; heads: number }
  /** One filament per head: slicing is blocked while there are more filaments. */
  | { kind: 'perHead'; heads: number; useSnapmaker: boolean };

export function filamentLimit(p: {
  flavor: EngineFlavor;
  printer: string;
  nozzleDiameter: string | undefined;
  singleExtruderMM: string | undefined;
}): FilamentLimit {
  const heads = (p.nozzleDiameter ?? '').split(',').filter((v) => v.trim() !== '').length;
  if (heads <= 1 || p.singleExtruderMM === '1' || p.singleExtruderMM === 'true') return { kind: 'free' };
  const u1 = /^Snapmaker U1\b/.test(p.printer);
  if (p.flavor === 'orca') return p.printer.startsWith('Bambu Lab') ? { kind: 'free' } : { kind: 'perHead', heads, useSnapmaker: u1 };
  return u1 ? { kind: 'mapped', heads } : { kind: 'warn', heads };
}

/** What to tell the user about `count` filaments, or null when nothing applies. */
export function filamentLimitMessage(limit: FilamentLimit, count: number): { text: string; blocks: boolean } | null {
  if (limit.kind === 'free' || count <= limit.heads) return null;
  const { heads } = limit;
  if (limit.kind === 'mapped')
    return {
      text: `${count} filaments on ${heads} heads: you pick which head prints each one when you send the print.`,
      blocks: false,
    };
  if (limit.kind === 'warn')
    return {
      text: `${count} filaments on a printer with ${heads} heads.`,
      blocks: false,
    };
  return {
    text:
      `OrcaSlicer prints one filament per head, and this printer has ${heads}. Remove filaments down to ${heads}` +
      (limit.useSnapmaker ? ', or switch this project to Snapmaker Orca, which maps them onto the heads when you print.' : ' to slice.'),
    blocks: true,
  };
}

/** Whether "+ Add" makes sense: not when every head already has its filament and the engine prints one per head. */
export const canAddFilament = (limit: FilamentLimit, count: number) => limit.kind !== 'perHead' || count < limit.heads;
