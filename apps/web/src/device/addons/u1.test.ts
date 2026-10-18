import { describe, expect, it } from 'vitest';
import { nozzleGcode, parkHeadGcode, pickHeadGcode, feedChannels, feedGcode, filamentConfigGcode, purifierGcode, suggestToolMap, u1Activity, u1Addon, u1Heads, u1PrintPrepGcode, u1Purifier } from './u1';

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

describe('U1 add-on', () => {
  it('recognises a U1 and asks for its own objects', () => {
    const facts = { objects: ['print_task_config', 'purifier', 'filament_feed left', 'extruder', 'led cavity_led'], hostname: '', software: '' };
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
    const map = suggestToolMap(
      [
        { index: 0, colour: '#E0301E', material: 'PETG' },
        { index: 1, colour: '#00EE00', material: 'PLA' },
        { index: 2, colour: '#333333', material: 'PLA' },
      ],
      heads,
    );
    expect(map).toEqual({ 0: 1, 1: 2, 2: 0 });
  });

  it('sends preferences and the tool map before a print', () => {
    expect(u1PrintPrepGcode({ bedLevel: true, flowCalibrate: false, timeLapse: true }, { 0: 2, 1: 7, 40: 0 })).toEqual([
      'SET_PRINT_PREFERENCES BED_LEVEL=1 FLOW_CALIBRATE=0 TIME_LAPSE_CAMERA=1',
      'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=2',
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
