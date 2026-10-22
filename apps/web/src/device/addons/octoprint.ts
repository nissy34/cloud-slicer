// Printers run by OctoPrint (often a Marlin printer with a Raspberry Pi beside it).
// They don't run Klipper: the bridge stands in for Moonraker and turns OctoPrint's
// answers into the same objects (apps/device-bridge/octoprint.go), and says so in
// printer.info's brand. OctoPrint takes G-code, so Move, Console and temperatures
// stay; the bridge puts the Klipper commands the screen sends in Marlin's words.
// Its cameras come from OctoPrint's own settings.
import type { PrinterAddon } from './types';

export const octoPrintAddon: PrinterAddon = {
  id: 'octoprint',
  model: 'OctoPrint',
  detect: (f) => f.brand === 'octoprint',
  objects: () => [],
  host: {
    name: 'OctoPrint',
    stopped: "OctoPrint isn't connected to the printer.",
    restart: 'Connect again',
    restarting: 'Connecting OctoPrint to the printer',
  },
};
