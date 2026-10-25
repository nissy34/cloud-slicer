import { describe, expect, it } from 'vitest';
import { extrudeGcode, fanGcode, jogGcode, lightGcode, ownName, setHeaterGcode, uploadName } from './commands';
import { metaFromMoonraker, parseDuration, parseGcodeMeta, thumbnailUrl } from './gcode-meta';
import { directBlockedReason, normalizePrinterUrl } from './link/direct';
import { decodePairing, encodePairing } from './pairing';

describe('device commands', () => {
  it('clamps values and rejects odd object names', () => {
    expect(setHeaterGcode('heater_bed', 500, 120)).toBe('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=120');
    expect(setHeaterGcode('heater_generic chamber', 45.4, 80)).toBe('SET_HEATER_TEMPERATURE HEATER=chamber TARGET=45');
    expect(() => ownName('led x\nM112')).toThrow();
    expect(jogGcode('z', -0.1, 600)).toBe('SAVE_GCODE_STATE NAME=_device_jog\nG91\nG1 Z-0.1 F600\nRESTORE_GCODE_STATE NAME=_device_jog');
    expect(fanGcode('fan', 0.5)).toBe('M106 S128');
    expect(fanGcode('fan_generic aux', 2)).toBe('SET_FAN_SPEED FAN=aux SPEED=1');
    expect(lightGcode('neopixel strip', true)).toBe('SET_LED LED=strip RED=1 GREEN=1 BLUE=1 WHITE=1');
    expect(uploadName('my plate (2).gcode')).toBe('my_plate_2.gcode');
    expect(uploadName('Benchy plate 1.gcode.3mf')).toBe('Benchy_plate_1.gcode.3mf');
  });

  it("writes the same controls in Marlin's words for printers that aren't Klipper", () => {
    expect(setHeaterGcode('heater_bed', 500, 120, 'marlin')).toBe('M140 S120');
    expect(setHeaterGcode('extruder', 215.4, 300, 'marlin')).toBe('M104 T0 S215');
    expect(setHeaterGcode('extruder1', 200, 300, 'marlin')).toBe('M104 T1 S200');
    expect(setHeaterGcode('heater_generic chamber', 45, 80, 'marlin')).toBe('M141 S45');
    expect(() => setHeaterGcode('heater_generic dryer', 45, 80, 'marlin')).toThrow();
    expect(jogGcode('x', -10, 6000, 'marlin')).toBe('G91\nG1 X-10 F6000\nG90');
    expect(extrudeGcode(-10, 300, 'marlin')).toBe('M83\nG1 E-10 F300\nM82');
  });
});

describe('G-code metadata', () => {
  it('reads filaments and time from Orca comments, skipping unused filaments', () => {
    const m = parseGcodeMeta(
      ['; estimated printing time (normal mode) = 1h 2m 3s', '; total layer number: 120', '; filament used [g] = 3.20, 0.00, 1.10', '; filament_colour = #E72F1D;#FFFFFF;#3e413f', '; filament_type = PETG;PLA;PLA'].join('\n'),
    );
    expect(m.estimatedSeconds).toBe(3723);
    expect(m.layers).toBe(120);
    expect(m.filaments).toEqual([
      { index: 0, colour: '#E72F1D', material: 'PETG', grams: 3.2 },
      { index: 2, colour: '#3E413F', material: 'PLA', grams: 1.1 },
    ]);
    expect(parseDuration('2d 1s')).toBe(172801);
  });

  it('reads the nozzle size and flow type each filament was sliced for', () => {
    const m = parseGcodeMeta(['; filament_type = PLA;PETG', '; filament used [g] = 1,2', '; nozzle_diameter = 0.4,0.6', '; filament_volume_type = standard,high_flow'].join('\n'));
    expect(m.filaments.map((f) => [f.nozzle, f.highFlow])).toEqual([
      [0.4, false],
      [0.6, true],
    ]);
    expect(parseGcodeMeta('; filament_type = PLA;PLA\n; nozzle_diameter = 0.4').filaments.map((f) => f.nozzle)).toEqual([0.4, 0.4]);
    expect(metaFromMoonraker({ filament_type: 'PLA', filament_weights: [1], nozzle_diameter: 0.4 }).filaments[0].nozzle).toBe(0.4);
  });

  it('reads the printer profile the file was sliced for', () => {
    expect(parseGcodeMeta('; printer_settings_id = "Snapmaker U1 (0.4 nozzle)"').printer).toBe('Snapmaker U1 (0.4 nozzle)');
    expect(parseGcodeMeta('; filament_type = PLA').printer).toBeUndefined();
  });

  it('reads Moonraker metadata the same way', () => {
    expect(metaFromMoonraker({ filament_colors: ['FF0000', '#00ff00'], filament_type: 'PLA;PETG', filament_weights: [1, 2], estimated_time: 60 }).filaments).toEqual([
      { index: 0, colour: '#FF0000', material: 'PLA', grams: 1 },
      { index: 1, colour: '#00FF00', material: 'PETG', grams: 2 },
    ]);
  });

  it('reads the materials of a multi-colour file as Moonraker sends them', () => {
    // Moonraker turns "PLA;PETG" into a JSON list in a string (seen on a real Moonraker, test/device-klipper.mjs).
    const materials = (filament_type: unknown) => metaFromMoonraker({ filament_colors: ['#FF0000', '#00FF00'], filament_type }).filaments.map((f) => f.material);
    expect(materials('["PLA", "PETG"]')).toEqual(['PLA', 'PETG']);
    expect(materials(['PLA', 'PETG'])).toEqual(['PLA', 'PETG']);
    expect(materials('PLA;PETG')).toEqual(['PLA', 'PETG']);
  });
});

describe('connections', () => {
  it('round-trips pairing codes and links', () => {
    const p = { relay: 'https://relay.example.com', bridgeId: 'abcDEF123456', key: 'k'.repeat(32) };
    const code = encodePairing(p);
    expect(decodePairing(code)).toEqual(p);
    expect(decodePairing(`https://slicer.example.com/#pair=${code}`)).toEqual(p);
    expect(decodePairing('hello world')).toBeNull();
    expect(decodePairing(encodePairing({ ...p, relay: 'javascript:alert(1)' }))).toBeNull();
  });

  it('explains when a browser cannot reach a printer directly', () => {
    expect(normalizePrinterUrl('printer.example.com/', 'https:')).toBe('https://printer.example.com');
    expect(directBlockedReason('http://192.168.1.5:7125', 'https://slicer.example.com/')).toMatch(/secure page/);
    expect(directBlockedReason('https://192.168.1.5', 'https://slicer.example.com/')).toMatch(/home network/);
    expect(directBlockedReason('https://u1.local', 'https://slicer.example.com/')).toMatch(/home network/);
    expect(directBlockedReason('https://printer.example.com', 'https://slicer.example.com/')).toBeNull();
    expect(directBlockedReason('http://127.0.0.1:7125', 'http://localhost:5173/')).toBeNull();
  });
});

describe('file thumbnails', () => {
  const thumbs = { thumbnails: [{ width: 300, relative_path: '.thumbs/a b-300x300.png' }, { width: 32, relative_path: '.thumbs/a b-32x32.png' }, { width: 96, relative_path: '.thumbs/a b-96x96.png' }] };
  it('picks the smallest thumbnail big enough for a row, relative to the file folder', () => {
    expect(thumbnailUrl(thumbs, 'a b.gcode')).toBe('/server/files/gcodes/.thumbs/a%20b-96x96.png');
    expect(thumbnailUrl(thumbs, 'jobs/a b.gcode')).toBe('/server/files/gcodes/jobs/.thumbs/a%20b-96x96.png');
    expect(thumbnailUrl(thumbs, 'a b.gcode', 400)).toBe('/server/files/gcodes/.thumbs/a%20b-300x300.png');
  });
  it('has none when Moonraker found none', () => {
    expect(thumbnailUrl(null, 'x.gcode')).toBeNull();
    expect(thumbnailUrl({ thumbnails: [] }, 'x.gcode')).toBeNull();
  });
});
