import { describe, expect, it } from 'vitest';
import { detectAddons, takesCommands } from '.';

describe('prusa addon', () => {
  it('knows a Prusa printer by the brand the bridge reports, and that it takes no commands', () => {
    const prusa = detectAddons({ objects: ['extruder', 'heater_bed', 'print_stats'], hostname: 'Prusa MK4', software: 'PrusaLink 2.1.2', brand: 'prusalink' });
    expect(prusa.map((a) => a.id)).toEqual(['prusalink']);
    expect(takesCommands(prusa)).toBe(false);
    expect(prusa[0].noCamera).toBe(true);
  });

  it('leaves Klipper printers alone', () => {
    const klipper = detectAddons({ objects: ['extruder', 'heater_bed'], hostname: 'voron', software: 'v0.12', brand: '' });
    expect(klipper).toEqual([]);
    expect(takesCommands(klipper)).toBe(true);
  });
});
