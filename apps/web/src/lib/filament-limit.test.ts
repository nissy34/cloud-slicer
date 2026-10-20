import { describe, expect, it } from 'vitest';
import { canAddFilament, filamentLimit, filamentLimitMessage } from './filament-limit';

const u1 = {
  printer: 'Snapmaker U1 (0.4 nozzle)',
  nozzleDiameter: '0.4,0.4,0.4,0.4',
  singleExtruderMM: '0',
};

describe('filamentLimit', () => {
  it('lets single-nozzle printers take any number', () => {
    for (const flavor of ['snapmaker', 'orca'] as const) {
      const limit = filamentLimit({
        flavor,
        printer: 'Bambu Lab X1 Carbon 0.4 nozzle',
        nozzleDiameter: '0.4',
        singleExtruderMM: '1',
      });
      expect(limit).toEqual({ kind: 'free' });
      expect(filamentLimitMessage(limit, 16)).toBeNull();
      expect(canAddFilament(limit, 16)).toBe(true);
    }
  });
  it('maps extra filaments onto the U1 heads in Snapmaker Orca', () => {
    const limit = filamentLimit({ flavor: 'snapmaker', ...u1 });
    expect(limit).toEqual({ kind: 'mapped', heads: 4 });
    expect(filamentLimitMessage(limit, 8)?.blocks).toBe(false);
    expect(filamentLimitMessage(limit, 4)).toBeNull();
    expect(canAddFilament(limit, 8)).toBe(true);
  });
  it('allows one filament per head on the U1 in OrcaSlicer', () => {
    const limit = filamentLimit({ flavor: 'orca', ...u1 });
    expect(limit).toEqual({ kind: 'perHead', heads: 4, useSnapmaker: true });
    const msg = filamentLimitMessage(limit, 8);
    expect(msg?.blocks).toBe(true);
    expect(msg?.text).toMatch(/Snapmaker Orca/);
    expect(canAddFilament(limit, 3)).toBe(true);
    expect(canAddFilament(limit, 4)).toBe(false);
  });
  it('treats other toolchangers the same in OrcaSlicer, without suggesting Snapmaker Orca', () => {
    const limit = filamentLimit({
      flavor: 'orca',
      printer: 'Prusa XL 5T 0.4 nozzle',
      nozzleDiameter: '0.4,0.4,0.4,0.4,0.4',
      singleExtruderMM: '0',
    });
    expect(limit).toEqual({ kind: 'perHead', heads: 5, useSnapmaker: false });
    expect(filamentLimitMessage(limit, 6)?.text).not.toMatch(/Snapmaker/);
  });
  it("leaves Bambu Lab's two-nozzle printers free in OrcaSlicer", () => {
    const limit = filamentLimit({
      flavor: 'orca',
      printer: 'Bambu Lab H2D 0.4 nozzle',
      nozzleDiameter: '0.4,0.4',
      singleExtruderMM: '1',
    });
    expect(limit.kind).toBe('free');
    expect(
      filamentLimit({
        flavor: 'orca',
        printer: 'Bambu Lab H2D 0.4 nozzle',
        nozzleDiameter: '0.4,0.4',
        singleExtruderMM: '0',
      }).kind,
    ).toBe('free');
  });
});
