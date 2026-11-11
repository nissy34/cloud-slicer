// Printers run by OctoPrint (often a Marlin printer with a Raspberry Pi beside it).
// They don't run Klipper: the bridge stands in for Moonraker and turns OctoPrint's
// answers into the same objects (apps/device-bridge/octoprint.go), and says so in
// printer.info's brand. OctoPrint takes G-code, so Move, Console and temperatures
// stay, written in Marlin's words. Its cameras come from OctoPrint's own settings.
import { i18n } from '../../i18n';
import type { PrinterAddon } from './types';

export const octoPrintAddon: PrinterAddon = {
  id: 'octoprint',
  model: 'OctoPrint',
  detect: (f) => f.brand === 'octoprint',
  objects: () => [],
  gcode: 'marlin',
  // Getters: the words are read in the reader's language when shown.
  host: {
    name: 'OctoPrint',
    get stopped() {
      return i18n.t('deviceAddons.octoprintStopped');
    },
    get restart() {
      return i18n.t('deviceAddons.octoprintRestart');
    },
    get restarting() {
      return i18n.t('deviceAddons.octoprintRestarting');
    },
  },
};
