import { describe, expect, it } from 'vitest';
import { detectAddons, takesCommands } from '.';

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
});
