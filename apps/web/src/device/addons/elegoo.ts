// The Elegoo Centauri Carbon, through Elegoo's own local protocol (SDCP). It
// doesn't run Klipper: the bridge stands in for Moonraker and turns the
// printer's answers into the same objects (apps/device-bridge/elegoo.go), and
// says so in printer.info's brand. It takes prints and files but no G-code, so
// the screen leaves out the controls that would send it (Move, Console,
// temperatures). Its camera shows through the bridge.
import type { PrinterAddon } from './types';

export const elegooAddon: PrinterAddon = {
  id: 'elegoo',
  model: 'Elegoo Centauri Carbon',
  detect: (f) => f.brand === 'elegoo',
  objects: () => [],
  noCommands: true,
};
