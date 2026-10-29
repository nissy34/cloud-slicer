// How each printer type starts a print, written down from its maker's own app,
// with where it was read. Our start must match it; a difference is on purpose
// and says why here. When a maker's app or firmware changes how it starts a
// print, update the reference first (docs/architecture/send-to-printer.md).
//
// The wire format past the bridge (OctoPrint, PrusaLink, Elegoo SDCP, Bambu
// MQTT) is checked in apps/device-bridge/*_test.go against fakes that refuse
// what the real printer refuses.
import { describe, expect, it } from 'vitest';
import { ADDONS, type PrinterAddon, type PrintStart } from '.';
import { bambuProjectStart } from './bambu';
import type { BambuSlot } from './bambu';
import { elegooStart } from './elegoo';
import { u1StartCalls } from './u1';

/** Every add-on that starts prints its own way, and where its reference comes from. */
const REFERENCES: Record<string, string> = {
  u1: 'Snapmaker Orca 2.4.1 resources/web/flutter_web main.*.js: setPrePrintConfiguration, then startPrintMachineLocalFileWithOptions (server.files.start_local_print on firmware 1.3.0+, else SET_PRINT_PREFERENCES + printer.print.start)',
  bambu: 'Bambu Studio print job (OrcaSlicer bambu_networking.hpp PrintParams; the MQTT print.project_file fields as ha-bambulab pybambu/commands.py sends them)',
  elegoo: 'OrcaSlicer src/slic3r/Utils/ElegooLink.cpp print(): SDCP Cmd 128 with Calibration_switch, PrintPlatformType, Tlp_Switch',
};

const start = (o: Partial<PrintStart>): PrintStart => ({
  path: 'cube.gcode',
  map: {},
  filamentCount: 1,
  options: { bedLevel: false, flowCalibrate: false, timeLapse: false },
  slots: [],
  plate: null,
  ...o,
});

describe('print start references', () => {
  it('every add-on that starts prints its own way has a reference', () => {
    const own = ADDONS.filter((a: PrinterAddon) => a.startPrint).map((a) => a.id);
    expect(own.sort()).toEqual(Object.keys(REFERENCES).sort());
  });

  it('Klipper, OctoPrint and PrusaLink start with Moonraker\'s printer.print.start, as Mainsail and Fluidd do', () => {
    // The bridge turns it into OctoPrint's select + print and PrusaLink's POST on the file.
    for (const id of ['prusalink', 'octoprint']) expect(ADDONS.find((a) => a.id === id)?.startPrint).toBeUndefined();
  });

  it('U1 (Snapmaker Orca): map, used heads, then start_local_print with the options and map table', () => {
    const calls = u1StartCalls('cube.gcode', { 0: 2, 1: 0 }, { bedLevel: false, flowCalibrate: true, timeLapse: false }, null);
    const scripts = calls.filter((c) => c.method === 'printer.gcode.script').map((c) => (c.params as { script: string }).script);
    expect(scripts).toEqual(['SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=2', 'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=1 MAP_EXTRUDER=0', 'SET_PRINT_USED_EXTRUDERS EXTRUDERS=0,2']);
    const last = calls[calls.length - 1];
    expect(last.method).toBe('server.files.start_local_print');
    // Snapmaker Orca's options: bed_level, flow_calibrate, time_lapse_camera as 0/1 and map_table as [filament, head] pairs.
    expect(Object.keys((last.params as { options: object }).options).sort()).toEqual(['bed_level', 'flow_calibrate', 'map_table', 'time_lapse_camera']);
    expect(last.orElse?.map((c) => c.method)).toEqual(['printer.gcode.script', 'printer.print.start']);
  });

  it('Bambu Lab: the project_file fields Bambu Studio sends', () => {
    const slot: BambuSlot = { index: 0, amsId: 0, slotId: 2 } as BambuSlot;
    const call = bambuProjectStart(start({ path: 'cube.gcode.3mf', map: { 0: 0 }, slots: [slot], plate: 2 }));
    const print = (call.params as { message: { print: Record<string, unknown> } }).message.print;
    for (const key of ['command', 'param', 'url', 'subtask_name', 'project_id', 'profile_id', 'task_id', 'subtask_id', 'bed_type', 'timelapse', 'bed_leveling', 'flow_cali', 'vibration_cali', 'layer_inspect', 'use_ams', 'ams_mapping']) {
      expect(print, key).toHaveProperty(key);
    }
    expect(print).toMatchObject({ command: 'project_file', param: 'Metadata/plate_2.gcode', url: 'file:///sdcard/cube.gcode.3mf', ams_mapping: [2], use_ams: true });
    // Not sent, on purpose: nozzle_mapping (two-nozzle H2D) waits until someone can try a real H2D.
    expect(print).not.toHaveProperty('nozzle_mapping');
  });

  it('Elegoo: bed levelling, time-lapse and the plate side, as Orca\'s send window sends them', () => {
    expect(elegooStart(start({ options: { bedLevel: true, timeLapse: true }, bedType: 'Cool Plate' })).params.options).toEqual({ bed_level: 1, time_lapse_camera: 1, plate_type: 1 });
  });

  it('names a source for each reference', () => {
    for (const [id, source] of Object.entries(REFERENCES)) expect(source.length, id).toBeGreaterThan(20);
  });
});
