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

export interface CameraHints {
  /** Snapshot path tried before Moonraker's configured webcams. */
  snapshotUrl?: string;
  /** A JSON-RPC call that keeps the camera producing frames while it is watched. */
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
