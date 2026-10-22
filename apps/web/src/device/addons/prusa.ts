// Prusa printers through PrusaLink (MK4/MK4S, Core One, XL, Mini, MK3 with PrusaLink).
// They don't run Klipper: the bridge stands in for Moonraker and turns PrusaLink's
// answers into the same objects (apps/device-bridge/prusalink.go), and says so in
// printer.info's brand. PrusaLink takes prints and files, but no G-code, so the
// screen leaves out the controls that would send it (Move, Console, temperatures),
// and the camera card: Prusa's camera only shows in Prusa Connect.
import type { PrinterAddon } from './types';

export const prusaAddon: PrinterAddon = {
  id: 'prusalink',
  model: 'Prusa',
  detect: (f) => f.brand === 'prusalink',
  objects: () => [],
  noCommands: true,
  // The Prusa camera sends its pictures to Prusa Connect only.
  noCamera: true,
};
