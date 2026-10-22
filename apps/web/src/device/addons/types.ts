// Printer add-ons layer extra controls on top of the generic Klipper screen.
// The Device screen asks each add-on whether it recognises the printer, then
// blends whatever it adds into the same cards (tool heads, print dialog,
// chamber), so the user sees one screen, not a generic one plus extras.
import type { KlipperObjects } from '../status';

export interface PrinterFacts {
  /** printer.objects.list */
  objects: string[];
  hostname: string;
  software: string;
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
  /** The bed, not the head, moves up and down, so the Move card's height arrows move the bed. */
  bedMovesInZ?: boolean;
  /**
   * Its filament motion sensors also feel filament standing still, so they say
   * whether a head is loaded (plain Klipper's only notice moving filament).
   */
  motionSensorsFeelFilament?: boolean;
}
