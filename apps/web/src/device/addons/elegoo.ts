// The Elegoo Centauri Carbon, through Elegoo's own local protocol (SDCP). It
// doesn't run Klipper: the bridge stands in for Moonraker and turns the
// printer's answers into the same objects (apps/device-bridge/elegoo.go), and
// says so in printer.info's brand. It takes prints and files but no G-code, so
// the screen leaves out the controls that would send it (Move, Console,
// temperatures). Its camera shows through the bridge.
import type { PrinterAddon, PrintStart } from './types';

/**
 * The print start Orca's ElegooLink sends (SDCP Cmd 128, Orca's own send
 * window): bed levelling and time-lapse as chosen, and which side of the plate
 * the file was sliced for (1 = the smooth PC side, Orca's "Cool Plate"; 0 =
 * the textured PEI side). The bridge turns these into the printer's own fields.
 */
export function elegooStart({ path, options, bedType }: PrintStart) {
  return {
    method: 'printer.print.start',
    params: { filename: path, options: { bed_level: options.bedLevel ? 1 : 0, time_lapse_camera: options.timeLapse ? 1 : 0, plate_type: bedType === 'Cool Plate' ? 1 : 0 } },
    timeoutMs: 60_000,
  };
}

export const elegooAddon: PrinterAddon = {
  id: 'elegoo',
  model: 'Elegoo Centauri Carbon',
  detect: (f) => f.brand === 'elegoo',
  objects: () => [],
  noCommands: true,
  // Orca's send window: both off unless chosen. It has no flow calibration.
  printOptions: () => ({ bedLevel: false, timeLapse: false }),
  startPrint: (st) => [elegooStart(st)],
};
