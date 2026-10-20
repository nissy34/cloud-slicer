// What to say about how many filaments a project has, by printer. Neither
// engine limits the count (64 each). A single-nozzle printer (an AMS, an MMU)
// takes as many filaments as the file has or the user adds. A printer with
// several heads slices them too (in OrcaSlicer the engine gives it one
// extruder per filament, see engine/src/slice_api.cpp); the U1 then maps the
// file's filaments onto its 4 heads when the print is sent (Device tab).
// Other toolchangers have no such map, so they get a warning.

export type FilamentLimit =
  /** Any number of filaments. */
  | { kind: 'free' }
  /** More filaments than heads; each gets a head when the print is sent. */
  | { kind: 'mapped'; heads: number }
  /** More filaments than heads, and nothing maps them onto the heads. */
  | { kind: 'warn'; heads: number };

export function filamentLimit(p: { printer: string; nozzleDiameter: string | undefined; singleExtruderMM: string | undefined }): FilamentLimit {
  const heads = (p.nozzleDiameter ?? '').split(',').filter((v) => v.trim() !== '').length;
  // Bambu Lab's two-nozzle printers map filaments onto their nozzles themselves.
  if (heads <= 1 || p.singleExtruderMM === '1' || p.singleExtruderMM === 'true' || p.printer.startsWith('Bambu Lab')) return { kind: 'free' };
  return /^Snapmaker U1\b/.test(p.printer) ? { kind: 'mapped', heads } : { kind: 'warn', heads };
}

/** What to tell the user about `count` filaments, or null when nothing applies. */
export function filamentLimitMessage(limit: FilamentLimit, count: number): { text: string; warn: boolean } | null {
  if (limit.kind === 'free' || count <= limit.heads) return null;
  if (limit.kind === 'mapped')
    return { text: `${count} filaments on ${limit.heads} heads: you pick which head prints each one when you send the print.`, warn: false };
  return { text: `${count} filaments on a printer with ${limit.heads} heads.`, warn: true };
}
