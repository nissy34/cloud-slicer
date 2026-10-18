import { describe, expect, it } from 'vitest';
import { fans, genericObjects, heaterLabel, heaters, job, ledIsOn, lights, mergeStatus, remainingSeconds, sensors } from './status';

describe('device status', () => {
  it('subscribes to the generic Klipper objects only', () => {
    const list = ['print_stats', 'extruder', 'extruder1', 'heater_bed', 'temperature_sensor mcu', 'print_task_config', 'gcode_macro FOO', 'led cavity_led', 'fan_generic aux'];
    expect(genericObjects(list)).toEqual(['print_stats', 'extruder', 'extruder1', 'heater_bed', 'temperature_sensor mcu', 'led cavity_led', 'fan_generic aux']);
  });

  it('labels and orders heaters', () => {
    expect(heaterLabel('extruder', 1)).toBe('Nozzle');
    expect(heaterLabel('extruder2', 4)).toBe('Nozzle 3');
    expect(heaterLabel('heater_generic chamber_heater', 1)).toBe('Chamber heater');
    const hs = heaters({
      heaters: { available_heaters: ['heater_bed', 'extruder1', 'extruder', 'heater_generic chamber'] },
      heater_bed: { temperature: 60.2, target: 60 },
      extruder: { temperature: 210, target: 215, power: 0.5 },
      extruder1: { temperature: 25, target: 0 },
      'heater_generic chamber': { temperature: 30, target: 40 },
    });
    expect(hs.map((h) => h.name)).toEqual(['extruder', 'extruder1', 'heater_bed', 'heater_generic chamber']);
    expect(hs[0]).toMatchObject({ label: 'Nozzle 1', kind: 'nozzle', power: 0.5, max: 300 });
    expect(hs[3].kind).toBe('chamber');
  });

  it('reads sensors, fans and lights', () => {
    const o = {
      'temperature_sensor chamber': { temperature: 31 },
      fan: { speed: 0.5 },
      'fan_generic aux': { speed: 1 },
      'heater_fan hotend': { speed: 1, rpm: 4000 },
      'led cavity_led': { color_data: [[0, 0, 0, 1]] },
      'neopixel strip': { color_data: [[0, 0, 0, 0]] },
    };
    expect(sensors(o)).toEqual([{ name: 'temperature_sensor chamber', label: 'Chamber', temp: 31 }]);
    expect(fans(o).map((f) => [f.label, f.settable])).toEqual([
      ['Part cooling', true],
      ['Aux', true],
      ['Hotend', false],
    ]);
    expect(lights(o).map((l) => [l.label, l.on])).toEqual([
      ['Cavity led', true],
      ['Strip', false],
    ]);
    expect(ledIsOn(undefined)).toBe(false);
  });

  it('prefers the file position for progress and estimates time left', () => {
    const j = job({ print_stats: { state: 'printing', filename: 'a.gcode', print_duration: 600, info: { current_layer: 3, total_layer: 10 } }, virtual_sdcard: { progress: 0.25 }, display_status: { progress: 0.1 } });
    expect(j).toMatchObject({ state: 'printing', progress: 0.25, layer: 3, totalLayers: 10 });
    expect(remainingSeconds(j, 4000)).toBe(3000);
    expect(remainingSeconds(j, null)).toBe(1800);
    expect(remainingSeconds({ ...j, state: 'standby' }, 4000)).toBeNull();
    expect(job({ print_stats: { state: 'weird' } }).state).toBe('standby');
  });

  it('merges status diffs without mutating the previous snapshot', () => {
    const prev = { extruder: { temperature: 20, target: 200 }, fan: { speed: 0 } };
    const next = mergeStatus(prev, { extruder: { temperature: 25 } });
    expect(next.extruder).toEqual({ temperature: 25, target: 200 });
    expect(prev.extruder.temperature).toBe(20);
    expect(next.fan).toBe(prev.fan);
  });
});
