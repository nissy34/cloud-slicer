// Loading the printer's filaments into the project, like desktop Snapmaker
// Orca's Sync filament button (Plater.cpp show_sync_filament_dialog and
// filamentsync/SyncFilamentColorDialog.cpp). Two ways:
//   match:   the project keeps its filaments (and what each object prints
//            with); each takes the printer filament of the same material with
//            the closest colour (CIEDE2000, FilamentSyncAlgorithm.cpp), or any
//            closest colour when no material matches. Optionally the heads no
//            project filament took are added at the end.
//   replace: the project's filaments become the printer's loaded ones, head by
//            head; objects on filament n go to the ((n - 1) mod loaded) + 1-th,
//            and colour mixes are removed (their filaments changed).
// Desktop's replace only looks at as many heads as the project has filaments;
// here every loaded head comes in, which is what loading a printer means.
import { differenceCiede2000 } from 'culori';
import type { PresetSummary } from '../engine/protocol';
import type { FilamentSlot } from '../device/slots';
import { pickFilamentPreset } from './presets';

/** One of the printer's filaments (a tool head's, an AMS slot's) as the slicer sees it. */
export interface PrinterFilament {
  head: number;
  /** "T1", "A1" */
  label: string;
  /** #RRGGBB */
  colour: string;
  /** Material, '' when the head has none. */
  type: string;
  /** The name desktop matches presets by, e.g. "Snapmaker PLA Matte". */
  name: string;
}

export type SyncMode = 'match' | 'replace';

/** The project's filament i as the dialog shows it. */
export interface ProjectFilament {
  colour: string;
  type: string;
  preset: string;
}

/** What syncing does: the new filament list, and where objects move. */
export interface SyncPlan {
  filaments: PrinterFilament[];
  /** New 1-based filament for each old one; null when nothing moves. */
  remap: number[] | null;
  dropMixes: boolean;
}

/**
 * The printer's filament name the way desktop builds it from the head's RFID
 * data (SSWCP.cpp): vendor, type and sub-type, or "<vendor> Support For <type>".
 */
export function printerFilamentName(vendor: string, type: string, subType: string): string {
  const v = vendor || 'Generic';
  if (subType === 'Support') return `${v} Support For ${type}`;
  return [v, type, subType].filter(Boolean).join(' ');
}

export function printerFilaments(heads: FilamentSlot[]): PrinterFilament[] {
  return heads.map((h) => ({
    head: h.index,
    label: h.label,
    colour: h.colour,
    type: h.material,
    name: h.material ? printerFilamentName(h.vendor, h.material, h.subType) : '',
  }));
}

export const isLoaded = (f: PrinterFilament) => Boolean(f.type) && f.type !== 'NONE';

const ciede2000 = differenceCiede2000();
const distance = (a: string, b: string) => {
  const d = ciede2000(a, b);
  return Number.isFinite(d) ? d : Infinity;
};

/**
 * Desktop's compute_color_match: for each project filament the index (into
 * `printer`) of the closest loaded filament of the same material, else the
 * closest loaded one; -1 when nothing is loaded. Heads can be used twice.
 */
export function matchByColour(project: Pick<ProjectFilament, 'colour' | 'type'>[], printer: PrinterFilament[]): number[] {
  return project.map((p) => {
    const closest = (same: boolean) => {
      let best = -1;
      let bestD = Infinity;
      printer.forEach((m, j) => {
        if (!isLoaded(m) || (same && m.type !== p.type)) return;
        const d = distance(p.colour, m.colour);
        if (best < 0 || d < bestD) {
          best = j;
          bestD = d;
        }
      });
      return best;
    };
    const same = closest(true);
    return same >= 0 ? same : closest(false);
  });
}

/**
 * The plan for `mode`. `choice` (match mode) is the printer index picked for
 * each project filament; `addRest` adds the loaded heads none of them took.
 */
export function syncPlan(mode: SyncMode, projectCount: number, printer: PrinterFilament[], choice: number[], addRest: boolean): SyncPlan {
  const loaded = printer.filter(isLoaded);
  if (mode === 'replace') {
    const remap = Array.from({ length: projectCount }, (_, i) => (i % loaded.length) + 1);
    return { filaments: loaded, remap, dropMixes: true };
  }
  const picked = choice.slice(0, projectCount).map((j) => printer[j]).filter((f): f is PrinterFilament => Boolean(f && isLoaded(f)));
  if (picked.length !== projectCount) return { filaments: [], remap: null, dropMixes: false };
  const rest = addRest ? loaded.filter((f) => !picked.includes(f)) : [];
  const filaments = [...picked, ...rest];
  // Filaments added at the end move colour mixes to later numbers.
  return { filaments, remap: rest.length ? Array.from({ length: projectCount }, (_, i) => i + 1) : null, dropMixes: false };
}

const baseName = (name: string) => name.replace(/\s*@.*$/, '').trim().toLowerCase();

/**
 * The filament preset for a printer filament, as desktop's
 * resolve_filament_preset: a system preset with the same name ("Snapmaker PLA
 * Matte @U1"), else "Generic <type>"; then, beyond desktop, the closest preset
 * of that material from the user's installed ones. `current` when none fits.
 */
export function syncPreset(presets: PresetSummary[], installed: PresetSummary[], f: PrinterFilament, current: string): string {
  const system = presets.filter((p) => p.system && p.compatible);
  const byName = system.find((p) => baseName(p.name) === f.name.toLowerCase());
  if (byName) return byName.name;
  const type = f.type.toLowerCase();
  const generic = system.find((p) => (p.filamentType ?? '').toLowerCase() === type && baseName(p.name) === `generic ${type}`);
  if (generic) return generic.name;
  const sameType = (list: PresetSummary[]) => list.some((p) => (p.filamentType ?? '').toLowerCase() === type);
  if (sameType(installed)) return pickFilamentPreset(installed, f.type, current, f.name);
  if (sameType(presets)) return pickFilamentPreset(presets, f.type, current, f.name);
  return current;
}
