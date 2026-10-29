import { describe, expect, it } from 'vitest';
import { detectAddons, takesCommands } from '.';
import { elegooStart } from './elegoo';

describe('elegoo addon', () => {
  it('knows an Elegoo printer by the brand the bridge reports, and that it takes no commands but has a camera', () => {
    const elegoo = detectAddons({
      objects: ['extruder', 'heater_bed', 'print_stats'],
      hostname: 'Carbon',
      software: 'Elegoo V1.1.25',
      brand: 'elegoo',
    });
    expect(elegoo.map((a) => a.id)).toEqual(['elegoo']);
    expect(takesCommands(elegoo)).toBe(false);
    expect(elegoo[0].noCamera).toBeFalsy();
  });

  it('starts a print with the choices and plate side Orca sends', () => {
    const base = { path: 'cube.gcode', map: {}, filamentCount: 1, slots: [], plate: null };
    expect(elegooStart({ ...base, options: { bedLevel: true, timeLapse: false }, bedType: 'Cool Plate' }).params).toEqual({
      filename: 'cube.gcode',
      options: { bed_level: 1, time_lapse_camera: 0, plate_type: 1 },
    });
    // Anything but the smooth side (or not known) is the textured side, as in Orca.
    expect(elegooStart({ ...base, options: { bedLevel: false, timeLapse: true }, bedType: 'Textured PEI Plate' }).params.options).toEqual({ bed_level: 0, time_lapse_camera: 1, plate_type: 0 });
    expect(elegooStart({ ...base, options: { bedLevel: false, timeLapse: false } }).params.options.plate_type).toBe(0);
  });
});
