import { describe, expect, it } from 'vitest';
import { activeFilterCount, DEFAULT_CONSOLE_FILTERS, isHidden, readConsoleFilters, type ConsoleFilters } from './console-filters';
import type { ConsoleLine } from './session';

const reply = (text: string): ConsoleLine => ({ at: 0, kind: 'response', text });
const off: ConsoleFilters = { temps: false, timelapse: false, progress: false, ok: false, custom: [] };

describe('console filters', () => {
  it('hides the temperature reports Klipper prints while heating', () => {
    const f = DEFAULT_CONSOLE_FILTERS;
    expect(isHidden(reply('B:60.0 /60.0 T0:215.0 /215.0'), f)).toBe(true);
    expect(isHidden(reply('ok B:22.1 /0.0 T0:21.9 /0.0'), f)).toBe(true);
    expect(isHidden(reply('T:200.3 /210.0 B:60.0 /60.0'), f)).toBe(true);
    expect(isHidden(reply('T1:180.0 /0.0'), f)).toBe(true);
    expect(isHidden(reply('B:60.0 /60.0 T0:215.0 /215.0'), off)).toBe(false);
  });

  it('keeps useful lines that only mention a temperature', () => {
    expect(isHidden(reply('Toolhead: x=10 y=20'), DEFAULT_CONSOLE_FILTERS)).toBe(false);
    expect(isHidden(reply('Bed mesh: profile default loaded'), DEFAULT_CONSOLE_FILTERS)).toBe(false);
    expect(isHidden(reply('probe at 10.000,10.000 is z=1.234'), DEFAULT_CONSOLE_FILTERS)).toBe(false);
  });

  it('hides progress, timelapse and plain ok lines', () => {
    const f = DEFAULT_CONSOLE_FILTERS;
    expect(isHidden(reply('SD printing byte 1234/5678'), f)).toBe(true);
    expect(isHidden(reply('Not SD printing.'), f)).toBe(true);
    expect(isHidden(reply('TIMELAPSE_TAKE_FRAME'), f)).toBe(true);
    expect(isHidden(reply('ok'), f)).toBe(true);
    expect(isHidden(reply('ok FIRMWARE_NAME:Klipper'), f)).toBe(false);
  });

  it('never hides what the user typed or errors', () => {
    expect(isHidden({ at: 0, kind: 'command', text: 'M105' }, { ...DEFAULT_CONSOLE_FILTERS, custom: [{ text: 'M105', on: true }] })).toBe(false);
    expect(isHidden({ at: 0, kind: 'error', text: 'ok' }, DEFAULT_CONSOLE_FILTERS)).toBe(false);
  });

  it('hides lines containing the user’s own words when switched on', () => {
    const f = { ...off, custom: [{ text: 'Probe', on: true }, { text: 'mesh', on: false }] };
    expect(isHidden(reply('probe at 10,10 is z=1.2'), f)).toBe(true);
    expect(isHidden(reply('Bed mesh loaded'), f)).toBe(false);
    expect(activeFilterCount(f)).toBe(1);
    expect(activeFilterCount(DEFAULT_CONSOLE_FILTERS)).toBe(4);
  });

  it('reads saved filters safely', () => {
    expect(readConsoleFilters(null)).toEqual(DEFAULT_CONSOLE_FILTERS);
    expect(readConsoleFilters({ temps: false, custom: [{ text: ' probe ' }, { text: '' }, 3] })).toEqual({ ...DEFAULT_CONSOLE_FILTERS, temps: false, custom: [{ text: 'probe', on: true }] });
  });
});
