import { strToU8, zipSync } from 'fflate';
import { readGcode3mf } from '../gcode-meta';
import { describe, expect, it } from 'vitest';
import { detectAddons, takesCommands } from '.';
import { slotCheck, suggestSlotMap } from '../slots';
import { bambuAddon, bambuProjectStart, bambuSlots } from './bambu';

const tray = (id: string, type: string, colour: string, line: string) => ({ id, tray_type: type, tray_color: colour, tray_sub_brands: line });
// What a P1S with one AMS reports (OpenBambuAPI's pushall), as the bridge passes it on.
const report = {
  bambu: {
    ams: { ams: [{ id: '0', tray: [tray('0', 'PLA', 'FFFFFFFF', 'PLA Basic'), { id: '1' }, tray('2', 'PLA', 'C12E1FFF', 'PLA Matte'), tray('3', 'PETG', '000000FF', 'Generic PETG')] }] },
    vt_tray: { id: '254', tray_type: 'TPU', tray_color: '00FF00FF', tray_sub_brands: '' },
    ipcam: { timelapse: 'enable' },
  },
};

describe('bambu addon', () => {
  it('knows a Bambu Lab printer by the brand the bridge reports; it takes commands, has no restart button and says which models show a camera', () => {
    const bambu = detectAddons({
      objects: ['extruder', 'heater_bed', 'print_stats', 'bambu'],
      hostname: 'Bambu Lab 01P00A000000001',
      software: 'Bambu Lab firmware 01.08.02.00',
      brand: 'bambu',
    });
    expect(bambu.map((a) => a.id)).toEqual(['bambu']);
    expect(takesCommands(bambu)).toBe(true);
    expect(bambu[0].host?.restart).toBeUndefined();
    expect(bambu[0].cameraMissing).toMatch(/P1 and A1/);
    expect(bambu[0].objects({ objects: [], hostname: '', software: '', brand: 'bambu' })).toEqual(['bambu']);
  });

  it('reads the AMS slots and the outside spool from the printer’s own report', () => {
    expect(bambuSlots({})).toBeNull();
    const slots = bambuSlots(report)!;
    expect(slots.map((s) => [s.label, s.material, s.subType, s.vendor, s.colour, s.loaded])).toEqual([
      ['A1', 'PLA', 'Basic', 'Bambu', '#FFFFFF', true],
      ['A2', '', '', '', '#808080', false],
      ['A3', 'PLA', 'Matte', 'Bambu', '#C12E1F', true],
      ['A4', 'PETG', '', 'Generic', '#000000', true],
      ['Outside spool', 'TPU', '', '', '#00FF00', true],
    ]);
    expect(slots.map((s) => [s.amsId, s.slotId])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [254, 254]]);
  });

  it('maps by filament type like Bambu Studio, and only for a .gcode.3mf', () => {
    const slots = bambuSlots(report)!;
    const words = bambuAddon.filaments!.words;
    const red = { index: 0, colour: '#D02020', material: 'PLA' };
    expect(suggestSlotMap([red, { index: 1, colour: '#111111', material: 'PETG' }], slots, words)).toEqual({ 0: 2, 1: 3 });
    expect(slotCheck(red, slots[3], words).blocked).toMatch(/A4 has PETG, but this filament was sliced as PLA/);
    expect(slotCheck(red, slots[1], words).blocked).toMatch(/A2 has no filament type set\. Load filament there/);
    expect(bambuAddon.filaments!.maps!('cube.gcode.3mf')).toBe(true);
    expect(bambuAddon.filaments!.maps!('cube.gcode')).toBe(false);
    expect(bambuAddon.printOptions!(report)).toEqual({ bedLevel: true, flowCalibrate: true, timeLapse: true });
  });

  it('starts a .gcode.3mf with the chosen slots, the way Bambu Studio does', () => {
    const slots = bambuSlots(report)!;
    const start = { path: 'cube.gcode.3mf', map: { 0: 2, 2: 0 }, filamentCount: 3, options: { bedLevel: true, flowCalibrate: false, timeLapse: false }, slots, plate: 2 };
    const call = bambuProjectStart(start);
    expect(call.method).toBe('printer.request');
    const print = (call.params as { message: { print: Record<string, unknown> } }).message.print;
    expect(print).toMatchObject({
      command: 'project_file',
      param: 'Metadata/plate_2.gcode',
      url: 'file:///sdcard/cube.gcode.3mf',
      subtask_name: 'cube',
      bed_leveling: true,
      flow_cali: false,
      timelapse: false,
      use_ams: true,
      ams_mapping: [2, -1, 0],
      ams_mapping2: [{ ams_id: 0, slot_id: 2 }, { ams_id: 255, slot_id: 255 }, { ams_id: 0, slot_id: 0 }],
    });
    // Everything from the outside spool: the AMS stays out of it.
    const outside = (bambuProjectStart({ ...start, map: { 0: 4 }, filamentCount: 1 }).params as { message: { print: Record<string, unknown> } }).message.print;
    expect(outside).toMatchObject({ use_ams: false, ams_mapping: [-1], ams_mapping2: [{ ams_id: 255, slot_id: 0 }] });
    // Plain G-code starts as before; its filaments print from slots in order.
    expect(bambuAddon.startPrint!({ ...start, path: 'cube.gcode' })).toEqual([{ method: 'printer.print.start', params: { filename: 'cube.gcode' }, timeoutMs: 60_000 }]);
  });

  it('finds the plate and its G-code inside a .gcode.3mf', async () => {
    const zip = zipSync({ 'Metadata/plate_3.gcode': strToU8('G28'), 'Metadata/slice_info.config': strToU8('<config/>') });
    const read = await readGcode3mf(new Blob([zip as Uint8Array<ArrayBuffer>]));
    expect(read?.plate).toBe(3);
    expect(await read?.gcode.text()).toBe('G28');
    expect(await readGcode3mf(new Blob(['not a zip']))).toBeNull();
    expect(bambuAddon.uploads).toEqual(['.3mf']);
  });
});
