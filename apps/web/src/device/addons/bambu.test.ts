import { describe, expect, it } from 'vitest';
import { detectAddons, takesCommands } from '.';

describe('bambu addon', () => {
  it('knows a Bambu Lab printer by the brand the bridge reports; it takes commands, has no restart button and says which models show a camera', () => {
    const bambu = detectAddons({
      objects: ['extruder', 'heater_bed', 'print_stats'],
      hostname: 'Bambu Lab 01P00A000000001',
      software: 'Bambu Lab firmware 01.08.02.00',
      brand: 'bambu',
    });
    expect(bambu.map((a) => a.id)).toEqual(['bambu']);
    expect(takesCommands(bambu)).toBe(true);
    expect(bambu[0].host?.restart).toBeUndefined();
    expect(bambu[0].cameraMissing).toMatch(/P1 and A1/);
  });
});
