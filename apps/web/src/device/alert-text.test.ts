import { describe, expect, it } from 'vitest';
import { alertText, readable } from './alert-text';
import type { PrintDetails } from './alerts';

// 12:00 UTC; the reader is in UTC on a 24-hour clock unless a test says otherwise.
const clock = { timeZone: 'UTC', hour12: false, now: Date.UTC(2026, 9, 22, 12, 0) };
const mid: PrintDetails = { percent: 47, layer: 120, total: 250, left: 4320, printed: 3000, estimate: 7400, usedMm: 1350, totalMm: 2700, totalG: 81 };
const text = (a: Parameters<typeof alertText>[0], c = clock) => alertText(a, 'U1', undefined, c);

describe('alert words with where the print stands', () => {
  it('progress: layer, time left with the clock time, filament so far', () => {
    expect(text({ event: 'progress', file: 'Benchy.gcode', percent: 50, left: 4320, details: mid })).toEqual({
      title: 'Benchy 50% done',
      body: 'U1 · layer 120 of 250\n1 h 12 min left · done about 13:12\nfilament 41 g of 81 g',
    });
  });
  it('the clock time follows the reader: their zone and 12-hour clock', () => {
    const b = text({ event: 'layer3', file: 'Benchy.gcode', layer: 3, total: 250, left: 4320, details: { ...mid, percent: 4, layer: 4 } }, { ...clock, timeZone: 'America/New_York', hour12: true }).body;
    expect(b).toBe('U1 · 4% · layer 4 of 250\n1 h 12 min left · done about 9:12 AM');
  });
  it('an unknown time zone leaves the clock time out', () => {
    expect(text({ event: 'resumed', file: 'a.gcode', left: 600, details: { percent: 90 } }, { ...clock, timeZone: 'Mars/Olympus' }).body).toBe('U1 · 90%\n10 min left');
  });
  it('finished: how long against the estimate, filament and layers', () => {
    expect(text({ event: 'finished', file: 'Benchy.gcode', duration: 8640, details: { ...mid, percent: 100, layer: 250, left: 0 } }).body).toBe('U1 · 2 h 24 min (estimate 2 h 3 min)\n81 g filament · 250 layers');
  });
  it('cancelled and failed: where it stopped, time and filament spent, and why', () => {
    expect(text({ event: 'failed', file: 'Benchy.gcode', reason: 'cancelled', layer: 120, details: mid }).body).toBe('U1 · stopped at 47%, layer 120 of 250\nafter 50 min · 41 g filament used');
    expect(text({ event: 'failed', file: 'Benchy.gcode', reason: '!! Move out of range: 300.0 0.0 1.0 [0.0]\nOnce the underlying issue is corrected, use the "RESTART" command', layer: 120, details: mid }).body).toBe(
      'U1 · stopped at 47%, layer 120 of 250\nafter 50 min · 41 g filament used\nMove out of range: 300.0 0.0 1.0 [0.0]',
    );
  });
  it('paused for filament: which head ran out and what to do', () => {
    expect(text({ event: 'paused', file: 'Benchy.gcode', reason: 'filament', details: { ...mid, runout: 'T3' } })).toEqual({
      title: 'Print paused: T3 ran out of filament',
      body: 'U1 · Benchy · 47% · layer 120 of 250\nLoad filament in T3, then resume in the Device tab.',
    });
    expect(text({ event: 'paused', file: 'a.gcode', reason: 'filament', details: {} }).title).toBe('Print paused: filament ran out');
  });
  it('printer error: the printer’s own words and code, and where the print stopped', () => {
    const error = { title: 'Nozzle temperature abnormal', text: 'The nozzle of head 2 can’t reach its temperature.', code: '0002 0523 0000 0000' };
    expect(text({ event: 'error', file: 'Benchy.gcode', details: { ...mid, error } })).toEqual({
      title: 'Printer error: Nozzle temperature abnormal',
      body: 'U1 · Benchy stopped at 47%, layer 120 of 250\nThe nozzle of head 2 can’t reach its temperature.\nCode 0002 0523 0000 0000',
    });
    expect(text({ event: 'error', file: '', reason: 'MCU \'mcu\' shutdown: Timer too close' }).body).toBe("U1\nMCU 'mcu' shutdown: Timer too close");
  });
  it('without details the words are as short as before', () => {
    expect(text({ event: 'finished', file: 'x.gcode', duration: 600 })).toEqual({ title: 'x finished', body: 'U1 · 10 min' });
    expect(readable('')).toBe('');
  });
});
