// Bambu Lab printers (X1, P1, P2S, A1, H2) on the local network. They don't run
// Klipper: the bridge stands in for Moonraker and turns the printer's MQTT
// reports into the same objects (apps/device-bridge/bambu.go), and says so in
// printer.info's brand. With LAN Only mode and Developer Mode on, the printer
// takes G-code, so Move, temperatures and the Console stay (the bridge puts the
// Klipper commands the screen sends in Marlin's words; the printer sends no
// replies back). Without Developer Mode it still reports how it is, and the
// bridge passes on the printer's refusal of anything else. The P1 and A1
// camera shows through the bridge; X1, H2 and P2S stream video it can't pass on.
import type { PrinterAddon } from './types';

export const bambuAddon: PrinterAddon = {
  id: 'bambu',
  model: 'Bambu Lab',
  detect: (f) => f.brand === 'bambu',
  objects: () => [],
  // It restarts from its own screen: no restart button.
  host: { name: 'Bambu Lab', stopped: 'The printer stopped answering: check that it is on and on the network.' },
  cameraMissing: 'Only P1 and A1 printers show their camera here: X1, H2 and P2S send video that only Bambu\'s own apps play.',
};
