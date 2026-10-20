import { describe, expect, it } from 'vitest';
import { filamentLimit, filamentLimitMessage } from './filament-limit';

describe('filamentLimit', () => {
  it('says nothing on single-nozzle printers', () => {
    const limit = filamentLimit({ printer: 'Bambu Lab X1 Carbon 0.4 nozzle', nozzleDiameter: '0.4', singleExtruderMM: '1' });
    expect(limit).toEqual({ kind: 'free' });
    expect(filamentLimitMessage(limit, 16)).toBeNull();
  });
  it('maps extra filaments onto the U1 heads', () => {
    const limit = filamentLimit({ printer: 'Snapmaker U1 (0.4 nozzle)', nozzleDiameter: '0.4,0.4,0.4,0.4', singleExtruderMM: '0' });
    expect(limit).toEqual({ kind: 'mapped', heads: 4 });
    expect(filamentLimitMessage(limit, 8)).toEqual({ text: expect.stringMatching(/^8 filaments on 4 heads: you pick/), warn: false });
    expect(filamentLimitMessage(limit, 4)).toBeNull();
  });
  it('warns on other toolchangers', () => {
    const limit = filamentLimit({ printer: 'Prusa XL 5T 0.4 nozzle', nozzleDiameter: '0.4,0.4,0.4,0.4,0.4', singleExtruderMM: '0' });
    expect(limit).toEqual({ kind: 'warn', heads: 5 });
    expect(filamentLimitMessage(limit, 6)?.warn).toBe(true);
  });
  it("leaves Bambu Lab's two-nozzle printers alone", () => {
    expect(filamentLimit({ printer: 'Bambu Lab H2D 0.4 nozzle', nozzleDiameter: '0.4,0.4', singleExtruderMM: '0' }).kind).toBe('free');
  });
});
