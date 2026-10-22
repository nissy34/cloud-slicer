import { describe, expect, it } from 'vitest';
import { filamentInExtruders, headMood, sensorExtruder, type HeadMoodInput } from './heads';

const head = (o: Partial<HeadMoodInput>): HeadMoodInput => ({ temp: 25, target: 0, inUse: false, printing: false, loaded: true, ...o });

describe('tool head mood', () => {
  it('reads the temperatures on any printer', () => {
    expect(headMood(head({ loaded: null }))).toBe('napping');
    expect(headMood(head({ loaded: null, inUse: true }))).toBe('ready');
    expect(headMood(head({ loaded: null, temp: 120, target: 210 }))).toBe('heating');
    expect(headMood(head({ loaded: null, temp: 208, target: 210 }))).toBe('hot');
    expect(headMood(head({ loaded: null, temp: 142 }))).toBe('cooling');
    expect(headMood(head({ loaded: null, temp: 49 }))).toBe('napping');
  });

  it('prints only on the head in use', () => {
    expect(headMood(head({ inUse: true, printing: true, temp: 215, target: 215 }))).toBe('printing');
    // A docked head that is kept warm for its next turn.
    expect(headMood(head({ printing: true, temp: 170, target: 170 }))).toBe('hot');
  });

  it('asks for filament and for a look at the dock first', () => {
    expect(headMood(head({ loaded: false, inUse: true, printing: true, temp: 215, target: 215 }))).toBe('hungry');
    expect(headMood(head({ dock: 'unknown', loaded: false }))).toBe('worried');
    expect(headMood(head({ feedError: 'filament jammed' }))).toBe('worried');
  });
});

describe('filament in each extruder', () => {
  it('finds the extruder a sensor watches by its name', () => {
    expect(sensorExtruder('filament_motion_sensor e2_filament', 4)).toBe(2);
    expect(sensorExtruder('filament_switch_sensor extruder1_runout', 2)).toBe(1);
    expect(sensorExtruder('filament_switch_sensor T0', 2)).toBe(0);
    expect(sensorExtruder('filament_switch_sensor tool_3', 4)).toBe(3);
    expect(sensorExtruder('filament_switch_sensor runout', 1)).toBe(0);
    expect(sensorExtruder('filament_switch_sensor runout', 2)).toBe(null);
    expect(sensorExtruder('filament_switch_sensor e7', 2)).toBe(null);
  });

  it('reads switch sensors on any printer and skips disabled ones', () => {
    const o = {
      extruder: {},
      extruder1: {},
      'filament_switch_sensor t0': { enabled: true, filament_detected: true },
      'filament_switch_sensor t1': { enabled: true, filament_detected: false },
    };
    expect([...filamentInExtruders(o)]).toEqual([
      [0, true],
      [1, false],
    ]);
    expect(filamentInExtruders({ ...o, 'filament_switch_sensor t1': { enabled: false, filament_detected: false } }).has(1)).toBe(false);
  });

  it('needs every sensor on an extruder to feel filament', () => {
    const o = {
      extruder: {},
      'filament_switch_sensor spool': { enabled: true, filament_detected: true },
      'filament_switch_sensor toolhead': { enabled: true, filament_detected: false },
    };
    expect(filamentInExtruders(o).get(0)).toBe(false);
  });

  it('trusts motion sensors only when the printer says they feel standing filament', () => {
    const o = { extruder: {}, 'filament_motion_sensor encoder': { enabled: true, filament_detected: false } };
    expect(filamentInExtruders(o).size).toBe(0);
    expect(filamentInExtruders(o, { motionSensorsFeelFilament: true }).get(0)).toBe(false);
  });
});
