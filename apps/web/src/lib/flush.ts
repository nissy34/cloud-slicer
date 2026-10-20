// Flushing volumes: how much a single-nozzle multi-material printer (AMS, MMU,
// CFS...) purges when it changes filament, like desktop's "Flushing volumes"
// window. The engine fills the table from the filament colours after every
// selection (engine/src/flush_api.cpp), into the base config; values the user
// typed are the setting flush_volumes_matrix of the project, on top.
//
// The table is flush_volumes_matrix: per nozzle, an n x n block of n filaments,
// row = the filament changed from, column = the one changed to. Upstream
// OrcaSlicer keeps a block per nozzle and a flush_multiplier per nozzle;
// Snapmaker Orca one block and one multiplier. The purge printed is the table
// value times the multiplier, and the window shows that product, as desktop does.

/** What the engine said about the selected printer's flushing (presetsSelect "flush"). */
export interface FlushInfo {
  /** Whether the printer purges between filaments (single-extruder multi-material or Bambu Lab). */
  flushes: boolean;
  /** A Bambu Lab printer: its prime tower always purges the table's amounts. */
  bambu: boolean;
  nozzles: number;
  /** The smallest purge that clears each nozzle, in mm³ (desktop's suggested range). */
  min: number[];
  max: number;
}

export const MATRIX = 'flush_volumes_matrix';
export const MULTIPLIER = 'flush_multiplier';
export const MULTIPLIER_RANGE = [0, 3] as const;
/** Desktop's options for where the purge goes besides the prime tower (process, Multimaterial page). */
export const FLUSH_OPTIONS = ['flush_into_infill', 'flush_into_objects', 'flush_into_support'];

const numbers = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map(Number);

/** The table as blocks[nozzle][from][to]; missing entries read as 0 on the diagonal, else 280 (desktop's default). */
export function parseMatrix(value: string | undefined, filaments: number, nozzles: number): number[][][] {
  const v = numbers(value);
  const n = filaments;
  // A table for fewer filaments (the engine pads it the same way before slicing).
  const k = v.length === n * n * nozzles ? n : Math.round(Math.sqrt(v.length / nozzles));
  const old = k * k * nozzles === v.length ? k : n;
  return Array.from({ length: nozzles }, (_, b) =>
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 0;
        if (i >= old || j >= old) return 280;
        const x = v[b * old * old + i * old + j];
        return Number.isFinite(x) ? x : 280;
      }),
    ),
  );
}

export const serializeMatrix = (blocks: number[][][]) => blocks.flat(2).map(fmt).join(',');

/** One multiplier per nozzle (Snapmaker Orca keeps one for all). */
export function parseMultipliers(value: string | undefined, nozzles: number): number[] {
  const v = numbers(value);
  return Array.from({ length: nozzles }, (_, i) => (Number.isFinite(v[i]) ? v[i] : Number.isFinite(v[v.length - 1]) ? v[v.length - 1] : 1));
}

/** Multipliers in the engine's form: one value for Snapmaker Orca, one per nozzle for OrcaSlicer. */
export const serializeMultipliers = (values: number[], perNozzle: boolean) => (perNozzle ? values : values.slice(0, 1)).map(fmt).join(',');

function fmt(x: number): string {
  return String(Math.round(x * 1e6) / 1e6);
}

/** The purge the window shows for a table value: rounded like desktop's boxes. */
export const shown = (raw: number, multiplier: number) => Math.round(raw * multiplier);
/** The table value for a purge typed in the window (desktop divides by the multiplier). */
export const stored = (purge: number, multiplier: number) => (multiplier > 0 ? purge / multiplier : purge);

/**
 * Keeps the user's own values across a change of filaments. `mapping[i]` is
 * the old slot new slot i was, or null for a new or changed filament (a new
 * colour or preset), whose row and column come from `base` (the engine's
 * automatic table for the new filaments). Returns null when nothing of the
 * user's is left, so the automatic table is used.
 */
export function remapMatrix(own: string, oldFilaments: number, base: string | undefined, mapping: (number | null)[], nozzles: number): string | null {
  const before = parseMatrix(own, oldFilaments, nozzles);
  const auto = parseMatrix(base, mapping.length, nozzles);
  const next = auto.map((block, b) =>
    block.map((row, i) =>
      row.map((value, j) => {
        const from = mapping[i];
        const to = mapping[j];
        return i !== j && from != null && to != null ? before[b][from][to] : value;
      }),
    ),
  );
  const text = serializeMatrix(next);
  return text === serializeMatrix(auto) ? null : text;
}

/** Whether the Flushing volumes window applies: a printer that purges, with more than one filament. */
export const flushShown = (info: FlushInfo | null, filaments: number) => !!info?.flushes && filaments > 1;

/**
 * Why the table may not be what the printer purges: desktop's own rule
 * (WipeTower2) uses it only with "Purge in prime tower" on for non-Bambu
 * printers; otherwise every change purges the prime volume.
 */
export function flushNote(config: { purge_in_prime_tower?: string; prime_volume?: string }, info: FlushInfo): string {
  if (info.bambu) return '';
  if (config.purge_in_prime_tower === '0')
    return `"Purge in prime tower" is off in this printer's settings (Multimaterial page), so each filament change purges the prime volume (${config.prime_volume ?? '?'} mm³) instead of these amounts. They still set the flush length the printer's change G-code gets.`;
  return '';
}

/** A purge outside desktop's suggested range shows in red, as desktop does. */
export const outOfRange = (purge: number, min: number, max: number) => purge < min || purge > max;
