import { describe, expect, it } from 'vitest';
import { detectAddons, takesCommands } from '.';

describe('octoprint addon', () => {
  it('knows an OctoPrint printer by the brand the bridge reports, and that it takes commands', () => {
    const octo = detectAddons({ objects: ['extruder', 'heater_bed', 'print_stats'], hostname: 'Ender 3', software: 'OctoPrint 1.11.8', brand: 'octoprint' });
    expect(octo.map((a) => a.id)).toEqual(['octoprint']);
    expect(takesCommands(octo)).toBe(true);
    expect(octo[0].noCamera).toBeFalsy();
    expect(octo[0].host?.name).toBe('OctoPrint');
  });
});
