import { describe, expect, it } from 'vitest';
import { materialMatches, noSlotReason, slotCheck, suggestSlotMap } from '../slots';
import { nozzleGcode, parkHeadGcode, pickHeadGcode, feedChannels, feedGcode, filamentConfigGcode, purifierGcode, u1Activity, u1Addon, u1Heads, u1PrintPrepGcode, u1StartCalls, u1Purifier, u1Fans } from './u1';

const objects = {
  print_task_config: {
    filament_color_rgba: ['3E413FFF', 'E72F1DFF', '00FF00FF', 'FFFFFFFF'],
    filament_type: ['PLA', 'PETG', 'PLA', 'NONE'],
    filament_sub_type: ['Matte', 'Basic', 'Basic', 'NONE'],
    filament_vendor: ['Snapmaker', 'Generic', 'Generic', 'NONE'],
    filament_exist: [true, true, true, false],
    filament_official: [true, false, false, false],
  },
  'filament_feed left': { extruder0: { module_exist: true, channel_error: 'ok' }, extruder1: { module_exist: true, disable_auto: true, channel_error: 'ok' } },
  'filament_feed right': { extruder2: { channel_error: 'ok' }, extruder3: { channel_error: 'feed_timeout' } },
  purifier: { power_detected: true, exhaust_fan: { speed: 0.4 }, inner_fan: { speed: 0 } },
};

const words = u1Addon.filaments!.words;

describe('U1 add-on', () => {
  it('recognises a U1 and asks for its own objects', () => {
    const facts = { objects: ['print_task_config', 'purifier', 'filament_feed left', 'extruder', 'led cavity_led'], hostname: '', software: '', brand: '' };
    expect(u1Addon.detect(facts)).toBe(true);
    expect(u1Addon.detect({ ...facts, objects: ['extruder'] })).toBe(false);
    expect(u1Addon.objects(facts)).toEqual(['print_task_config', 'purifier', 'filament_feed left', 'led cavity_led']);
  });

  it('reads the four tool heads', () => {
    const heads = u1Heads(objects);
    expect(heads[0]).toMatchObject({ label: 'T1', colour: '#3E413F', material: 'PLA', vendor: 'Snapmaker', loaded: true, official: true });
    expect(heads[3]).toMatchObject({ material: '', loaded: false });
    expect(heads[1].feed).toMatchObject({ module: 'left', channel: 1, auto: false });
    expect(heads[3].feed).toMatchObject({ module: 'right', channel: 1, error: 'feed_timeout' });
    expect(feedChannels({}).size).toBe(0);
  });

  it('tells filament in the head from filament waiting at the side feeder', () => {
    // After an unload the filament goes back to the feeder: filament_exist stays true, the head sensor goes empty.
    const unloaded = {
      ...objects,
      extruder: {},
      extruder1: {},
      extruder2: {},
      extruder3: {},
      'filament_feed left': { extruder0: { module_exist: true, filament_detected: true, channel_error: 'ok' } },
      'filament_motion_sensor e0_filament': { enabled: true, filament_detected: false },
      'filament_motion_sensor e1_filament': { enabled: true, filament_detected: true },
    };
    const heads = u1Heads(unloaded);
    expect(heads[0]).toMatchObject({ loaded: false, ready: true });
    expect(heads[0].feed?.filamentDetected).toBe(true);
    expect(heads[1]).toMatchObject({ loaded: true, ready: true });
    // No head sensor reported: fall back to what the printer says it can print with.
    expect(heads[2]).toMatchObject({ loaded: true, ready: true });
  });

  it('builds firmware commands that cannot be injected into', () => {
    expect(feedGcode(u1Heads(objects)[2].feed!, 'load')).toBe('FEED_AUTO MODULE=right CHANNEL=0 LOAD=1');
    expect(filamentConfigGcode(1, { material: 'PETG', subType: "Silk'; M112", vendor: 'Acme', colour: '#a0b0c0' })).toBe(
      "SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=1 FILAMENT_TYPE='PETG' FILAMENT_SUBTYPE='Silk M112' VENDOR='Acme' FILAMENT_COLOR_RGBA='A0B0C0FF'",
    );
    expect(purifierGcode('exhaust', 1.4)).toBe('SET_PURIFIER FAN=exhaust SPEED=1.00');
  });

  it('only shows the purifier when a top cover is fitted', () => {
    expect(u1Purifier(objects)).toEqual({ exhaust: 0.4, inner: 0, mode: '' });
    expect(u1Purifier({ purifier: { power_detected: false } })).toBeNull();
  });

  it('describes what the printer is busy with', () => {
    expect(u1Activity({ machine_state_manager: { main_state: 9 } })).toBe('Loading filament');
    expect(u1Activity({ machine_state_manager: { main_state: 'BED_LEVELING' } })).toBe('Levelling the bed');
    expect(u1Activity({ machine_state_manager: { main_state: 1 } })).toBeNull();
  });

  it('suggests a head per filament by material and colour', () => {
    const heads = u1Heads(objects);
    const map = suggestSlotMap(
      [
        { index: 0, colour: '#E0301E', material: 'PETG' },
        { index: 1, colour: '#00EE00', material: 'PLA' },
        { index: 2, colour: '#333333', material: 'PLA' },
      ],
      heads,
      words,
    );
    expect(map).toEqual({ 0: 1, 1: 2, 2: 0 });
  });

  it('matches filament types the way Snapmaker does', () => {
    expect(materialMatches('PLA', { material: 'PLA', subType: 'Matte' })).toBe(true);
    expect(materialMatches('pla', { material: 'PLA', subType: '' })).toBe(true);
    expect(materialMatches('PLA-CF', { material: 'PLA', subType: 'CF' })).toBe(true);
    expect(materialMatches('PLA CF', { material: 'PLA-CF', subType: '' })).toBe(true);
    expect(materialMatches('PETG', { material: 'PLA', subType: 'Basic' })).toBe(false);
    expect(materialMatches('TPU', { material: 'PLA', subType: '' })).toBe(false);
    expect(materialMatches('PLA-CF', { material: 'PLA', subType: 'Matte' })).toBe(false);
    expect(materialMatches('PLA', { material: '', subType: '' })).toBe(false);
  });

  it('blocks a filament on a head with another type, no filament or another nozzle size', () => {
    const heads = u1Heads({
      ...objects,
      extruder: { nozzle_diameter: 0.4, nozzle_volume_type: 'standard' },
      extruder1: { nozzle_diameter: 0.4, nozzle_volume_type: 'standard' },
      extruder2: { nozzle_diameter: 0.6, nozzle_volume_type: 'standard' },
    });
    const pla = { index: 0, colour: '#333333', material: 'PLA', nozzle: 0.4 };
    expect(slotCheck(pla, heads[0], words)).toEqual({ blocked: null, warning: null });
    expect(slotCheck(pla, heads[1], words).blocked).toMatch(/T2 has PETG Basic, but this filament was sliced as PLA/);
    expect(slotCheck(pla, heads[2], words).blocked).toMatch(/0\.6 mm nozzle.*0\.4 mm/);
    expect(slotCheck(pla, heads[3], words).blocked).toMatch(/T4 has no filament type/);
    // Not knowing the file's material or nozzle never blocks.
    expect(slotCheck({ ...pla, material: '', nozzle: undefined }, heads[1], words).blocked).toBeNull();
    // A high-flow file on a standard nozzle is only a warning.
    expect(slotCheck({ ...pla, highFlow: true }, heads[0], words)).toEqual({ blocked: null, warning: expect.stringMatching(/high-flow/) });
  });

  it('never suggests a head the filament is not allowed on', () => {
    const heads = u1Heads(objects);
    // No head has TPU: no head at all, never a head of another type.
    expect(suggestSlotMap([{ index: 1, colour: '#E72F1D', material: 'TPU' }], heads, words)).toEqual({ 1: -1 });
    expect(noSlotReason({ index: 1, colour: '#E72F1D', material: 'TPU' }, words)).toMatch(/^No tool head has TPU\./);
    // A red PLA goes to a PLA head, not to the red PETG one.
    expect(suggestSlotMap([{ index: 0, colour: '#E72F1D', material: 'PLA' }], heads, words)[0]).not.toBe(1);
  });

  it('maps filaments to heads and marks the used heads before a print', () => {
    expect(u1PrintPrepGcode({ 0: 3, 1: 0, 2: 3, 40: 0, 5: 7 })).toEqual([
      'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=3',
      'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=1 MAP_EXTRUDER=0',
      'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=2 MAP_EXTRUDER=3',
      'SET_PRINT_USED_EXTRUDERS EXTRUDERS=0,3',
    ]);
    // No filament mapped: nothing to send (the firmware refuses an empty used list).
    expect(u1PrintPrepGcode({})).toEqual([]);
  });

  it('starts a print like Snapmaker Orca: map, used heads, then start_local_print with the options', () => {
    const calls = u1StartCalls('cube.gcode', { 0: 1, 1: 0 }, { bedLevel: true, flowCalibrate: false, timeLapse: true }, null);
    expect(calls.map((c) => c.method)).toEqual(['printer.gcode.script', 'printer.gcode.script', 'printer.gcode.script', 'server.files.start_local_print']);
    expect(calls[2].params).toEqual({ script: 'SET_PRINT_USED_EXTRUDERS EXTRUDERS=0,1' });
    expect(calls[3].params).toEqual({
      type: 'gcode',
      path: 'cube.gcode',
      print_plate: 1,
      options: { bed_level: 1, flow_calibrate: 0, time_lapse_camera: 1, map_table: [[0, 1], [1, 0]] },
    });
    // Firmware before 1.3.0: the options as G-code, then the plain start.
    expect(calls[3].orElse).toEqual([
      { method: 'printer.gcode.script', params: { script: 'SET_PRINT_PREFERENCES BED_LEVEL=1 FLOW_CALIBRATE=0 TIME_LAPSE_CAMERA=1' }, timeoutMs: 30_000 },
      { method: 'printer.print.start', params: { filename: 'cube.gcode' }, timeoutMs: 60_000 },
    ]);
  });

  it('reads dock state, nozzle and tool-change counts per head', () => {
    const heads = u1Heads({
      extruder: { state: 'PARKED', nozzle_diameter: 0.4, nozzle_volume_type: 'standard', switch_count: 50, error_count: 1, last_maintenance_count: 20 },
      extruder1: { state: 'ACTIVATE', nozzle_diameter: 0.6, nozzle_volume_type: 'high_flow' },
      extruder2: { state: 'UNKNOWN' },
    });
    expect(heads.map((h) => h.dock)).toEqual(['parked', 'attached', 'unknown', null]);
    expect(heads[0].nozzle).toEqual({ diameter: 0.4, volumeType: 'standard' });
    expect(heads[0].switches).toEqual({ count: 50, errors: 1, sinceMaintenance: 30 });
    expect(heads[1].nozzle).toEqual({ diameter: 0.6, volumeType: 'high_flow' });
    expect(heads[1].switches).toBeNull();
    expect(heads[2].nozzle).toBeNull();
  });

  it('builds pick, park and nozzle commands with the firmware names', () => {
    expect(pickHeadGcode(0)).toBe('PICK_EXTRUDER');
    expect(pickHeadGcode(3)).toBe('PICK_EXTRUDER3');
    expect(parkHeadGcode(1)).toBe('PARK_EXTRUDER1');
    expect(nozzleGcode(2, 0.6, 'high_flow')).toBe('SET_NOZZLE_PROPERTIES EXTRUDER=extruder2 DIAMETER=0.6 VOLUME_TYPE=high_flow');
    expect(() => nozzleGcode(0, 0.5, 'standard')).toThrow();
    expect(() => nozzleGcode(0, 0.4, 'huge')).toThrow();
  });
});

describe('U1 fans', () => {
  const fan = (name: string, label: string, settable = true) => ({ name, label, speed: 0, rpm: null, settable });
  const list = [
    fan('fan', 'Part cooling'),
    fan('fan_generic cavity_fan', 'Cavity fan'),
    fan('heater_fan e0_nozzle_fan', 'E0 nozzle fan', false),
    fan('fan_generic e1_fan', 'E1 fan'),
    fan('heater_fan e1_nozzle_fan', 'E1 nozzle fan', false),
    fan('fan_generic e2_fan', 'E2 fan'),
    fan('heater_fan e2_nozzle_fan', 'E2 nozzle fan', false),
  ];
  it('shows one part fan and the hotend fan of the head on the carriage', () => {
    expect(u1Fans(list, 'extruder1').map((f) => f.label)).toEqual(['Part cooling', 'Cavity fan', 'Hotend fan T2']);
    expect(u1Fans(list, 'extruder1').find((f) => f.label === 'Hotend fan T2')?.name).toBe('heater_fan e1_nozzle_fan');
    expect(u1Fans(list, 'extruder').map((f) => f.label)).toEqual(['Part cooling', 'Cavity fan', 'Hotend fan T1']);
  });
  it('also shows a parked head whose hotend fan is still spinning', () => {
    const cooling = list.map((f) => (f.name === 'heater_fan e2_nozzle_fan' ? { ...f, speed: 1 } : f));
    expect(u1Fans(cooling, 'extruder').map((f) => f.label)).toEqual(['Part cooling', 'Cavity fan', 'Hotend fan T1', 'Hotend fan T3']);
  });
});

