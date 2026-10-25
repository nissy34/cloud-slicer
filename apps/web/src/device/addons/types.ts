// Printer add-ons layer extra controls on top of the generic Klipper screen.
// The Device screen asks each add-on whether it recognises the printer, then
// blends whatever it adds into the same cards (tool heads, print dialog,
// chamber), so the user sees one screen, not a generic one plus extras.
import type { KlipperObjects } from '../status';
import type { FilamentSlot, PrintOptions, SlotWords } from '../slot-types';

export interface PrinterFacts {
  /** printer.objects.list */
  objects: string[];
  hostname: string;
  software: string;
  /** Not Klipper: the kind of printer the bridge stands in for (printer.info's brand), else "". */
  brand: string;
}

/** A printer's built-in camera, used only when Moonraker lists no webcams. */
export interface CameraHints {
  name: string;
  /** Where the camera's latest frame can be fetched. */
  snapshotUrl: string;
  /** Frames per second to poll it at. */
  fps: number;
  /**
   * A JSON-RPC call that keeps the camera producing frames while it is
   * watched. Sent one at a time, never more often than `everyMs`.
   */
  keepalive?: { method: string; params: unknown; everyMs: number };
}

/** A problem the printer reports, in the printer maker's own words. */
export interface PrinterError {
  /** Stable for as long as the printer reports it. */
  id: string;
  /** The code as the maker's own app shows it, e.g. "0002 0523 0000 0000". */
  code: string;
  title: string;
  text: string;
  /** Announced once rather than held by the printer, so the user dismisses it. */
  once: boolean;
}

/** How a printer reports its errors beyond Klipper's own state. */
export interface PrinterErrorSource {
  /** JSON-RPC call that returns the current errors. */
  query: string;
  read(result: unknown): Promise<PrinterError[]>;
  /**
   * What a notification says about errors: the full new list, or errors
   * announced once. null when the notification is about something else.
   */
  notified(method: string, params: unknown): Promise<{ current?: PrinterError[]; once?: PrinterError[] }> | null;
}

/** One JSON-RPC call to the printer (or the bridge's stand-in for it). */
export interface PrinterCall {
  method: string;
  params?: unknown;
  timeoutMs?: number;
}

/** What the print dialog decided, for an add-on that starts prints its own way. */
export interface PrintStart {
  /** The file on the printer. */
  path: string;
  /** The slot (FilamentSlot.index) each filament in the file prints from, by the filament's index. */
  map: Record<number, number>;
  /** How many filaments the file has (its highest filament number). */
  filamentCount: number;
  options: PrintOptions;
  slots: FilamentSlot[];
  /** The plate inside a .gcode.3mf, 1-based, when the dialog could read it. */
  plate: number | null;
}

/** Where the printer holds its filaments, read from its own objects. */
export interface FilamentSlots {
  /** The list's name in the print dialog: "Tool heads". */
  title: string;
  words: SlotWords;
  /** Under the list in the print dialog: the rule it follows. */
  note: string;
  /** null until the printer has said. */
  read(o: KlipperObjects): FilamentSlot[] | null;
  /** Whether a file on the printer can have its filaments mapped (all when left out). */
  maps?(path: string): boolean;
}

export interface PrinterAddon {
  id: string;
  /** Model name shown under the printer's name. */
  model: string;
  detect(facts: PrinterFacts): boolean;
  /** Extra Klipper objects to subscribe to. */
  objects(facts: PrinterFacts): string[];
  camera?: CameraHints;
  /** A short line for the status card while the printer is busy with something of its own. */
  activity?(o: KlipperObjects): string | null;
  errors?: PrinterErrorSource;
  /**
   * Errors read from the printer's own objects (a Bambu Lab report), for a
   * printer that has no call for them: `key` changes when they may have.
   */
  objectErrors?: { key(o: KlipperObjects): string; read(o: KlipperObjects): Promise<PrinterError[]> };
  /** The bed, not the head, moves up and down, so the Move card's height arrows move the bed. */
  bedMovesInZ?: boolean;
  /**
   * Its filament motion sensors also feel filament standing still, so they say
   * whether a head is loaded (plain Klipper's only notice moving filament).
   */
  motionSensorsFeelFilament?: boolean;
  /**
   * It isn't Klipper and takes no G-code (or emergency stop, or firmware
   * restart), only prints and files, so the screen leaves out what sends them.
   */
  noCommands?: boolean;
  /**
   * It takes plain Marlin G-code rather than Klipper's macros, so the screen
   * writes its moves and temperatures in Marlin's words (commands.ts).
   */
  gcode?: 'marlin';
  /** Its camera can't be reached from outside its maker's own app, so there is no camera card. */
  noCamera?: boolean;
  /**
   * The program the printer runs instead of Klipper and Moonraker (OctoPrint),
   * in the words the screen uses where it would name those.
   */
  host?: {
    name: string;
    /** When it can't reach the printer (Klipper's "firmware stopped"). */
    stopped: string;
    /** The button that gets it going again (Klipper's "Restart firmware"); none when it has no such thing. */
    restart?: string;
    restarting?: string;
  };
  /** What the camera card says when the printer lists no camera, in place of "no camera set up". */
  cameraMissing?: string;
  /** File types it prints beyond G-code (".3mf"), offered by the Files card's upload. */
  uploads?: string[];
  /** It says what filament it holds where: "From printer" and the print dialog's map use it. */
  filaments?: FilamentSlots;
  /** The "Before printing" choices it takes, as it has them now. */
  printOptions?(o: KlipperObjects): PrintOptions;
  /** How a print starts with the print dialog's choices; without it, Moonraker's printer.print.start. */
  startPrint?(s: PrintStart): PrinterCall[];
}
