// The types of device/slots.ts, kept apart so code that only names them (the
// add-on types, which the relay's alerts also read) needs none of its packages.

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
