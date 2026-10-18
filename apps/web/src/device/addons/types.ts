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
}
