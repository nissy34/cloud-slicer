import { describe, expect, it } from 'vitest';
import { changesBetween, fingerprintOf, nextStatus, plateMark, plateMarks, progressOf, sameFile, summarize, type PlateFingerprint, type PrintRecord } from './prints';

const fp = (over: Partial<PlateFingerprint['objects'][0]> = {}): PlateFingerprint => ({
  objects: [{ name: 'Benchy', copies: 1, shape: 's1', place: 'p1', settings: 'o1', paint: 'n1', ...over }],
  plate: 'pl1',
});
const config = { layer_height: '0.2', sparse_infill_density: '15%', wipe_tower_x: '10,20', print_settings_id: 'A' };

let n = 0;
const rec = (over: Partial<PrintRecord>): PrintRecord => ({
  id: `r${++n}`,
  projectId: 'p',
  plate: 0,
  status: 'printed',
  at: n * 1000,
  endedAt: null,
  duration: null,
  progress: null,
  printer: 'u1',
  printerName: 'U1',
  file: 'Benchy_plate_1.gcode',
  fingerprint: 'F1',
  summary: null,
  ...over,
});

describe('print history', () => {
  it('fingerprints the same plate the same, and anything that prints differently differently', () => {
    const a = fingerprintOf(summarize(fp(), config, 0));
    expect(fingerprintOf(summarize(fp(), { ...config }, 0))).toBe(a);
    expect(fingerprintOf(summarize(fp({ place: 'p2' }), config, 0))).not.toBe(a);
    expect(fingerprintOf(summarize(fp(), { ...config, layer_height: '0.3' }, 0))).not.toBe(a);
    // Another plate's prime tower, or a renamed preset, isn't this plate's print.
    expect(fingerprintOf(summarize(fp(), { ...config, wipe_tower_x: '10,99' }, 0))).toBe(a);
    expect(fingerprintOf(summarize(fp(), { ...config, print_settings_id: 'B' }, 0))).toBe(a);
    expect(fingerprintOf(summarize(fp(), { ...config, wipe_tower_x: '11,20' }, 0))).not.toBe(a);
  });

  it('marks a plate from its newest print or mark', () => {
    expect(plateMark([], 'F1')).toEqual({ state: 'none' });
    expect(plateMark([rec({ status: 'printed' })], 'F1').state).toBe('printed');
    expect(plateMark([rec({ status: 'printed' })], 'F2').state).toBe('changed');
    expect(plateMark([rec({ status: 'printed' })], undefined).state).toBe('printed');
    // An upload alone doesn't mark; starting it does.
    expect(plateMark([rec({ status: 'uploaded' })], 'F1').state).toBe('none');
    expect(plateMark([rec({ status: 'printed' }), rec({ status: 'sent' })], 'F1').state).toBe('sent');
    // A failed print after a good one keeps the plate printed.
    expect(plateMark([rec({ status: 'printed' }), rec({ status: 'failed' })], 'F1').state).toBe('printed');
    expect(plateMark([rec({ status: 'failed' })], 'F1').state).toBe('none');
    // By hand.
    expect(plateMark([rec({ status: 'printed' }), rec({ status: 'unmarked', fingerprint: null })], 'F1').state).toBe('none');
    expect(plateMark([rec({ status: 'sent' }), rec({ status: 'marked' })], 'F1').state).toBe('printed');
  });

  it('counts printed plates and finds the next one, skipping empty plates', () => {
    const records = [rec({ plate: 0 }), rec({ plate: 1, fingerprint: 'old' }), rec({ plate: 3, status: 'sent' })];
    const marks = plateMarks(records, 5, { 0: 'F1', 1: 'F1', 3: 'F1' });
    expect(marks.map((m) => m.state)).toEqual(['printed', 'changed', 'none', 'sent', 'none']);
    expect(progressOf(marks, (p) => p === 2)).toEqual({ printed: 2, changed: 1, total: 4, next: 1 });
  });

  it('says what changed in plain words', () => {
    const then = summarize({ objects: [fp().objects[0], { ...fp().objects[0], name: 'Cube' }], plate: 'pl1' }, config, 0);
    const now = summarize({ objects: [fp({ place: 'p2', settings: 'o2' }).objects[0], { ...fp().objects[0], name: 'Cone' }], plate: 'pl2' }, { ...config, layer_height: '0.3' }, 0);
    expect(changesBetween(then, now, (k) => ({ layer_height: 'Layer height' })[k])).toEqual([
      'Added: Cone',
      'Removed: Cube',
      'Moved: Benchy',
      'Object settings: Benchy',
      'Plate settings, pauses or custom G-code',
      'Settings: Layer height',
    ]);
    expect(changesBetween(then, then, () => undefined)).toEqual([]);
  });

  it('follows the printer: printing, then how it ended', () => {
    const job = (state: string, filename = 'gcodes/Benchy_plate_1.gcode') => ({ state, filename });
    expect(sameFile('Benchy_plate_1.gcode', '/gcodes/benchy_plate_1.gcode')).toBe(true);
    expect(nextStatus(rec({ status: 'sent' }), 'u1', job('printing'))).toBe('printing');
    expect(nextStatus(rec({ status: 'uploaded' }), 'u1', job('printing'))).toBe('printing');
    expect(nextStatus(rec({ status: 'printing' }), 'u1', job('complete'))).toBe('printed');
    expect(nextStatus(rec({ status: 'printing' }), 'u1', job('error'))).toBe('failed');
    expect(nextStatus(rec({ status: 'printing' }), 'u1', job('cancelled'))).toBe('cancelled');
    // An earlier finished print of the same file name, another file, another printer: nothing.
    expect(nextStatus(rec({ status: 'sent' }), 'u1', job('complete'))).toBeNull();
    expect(nextStatus(rec({ status: 'printing' }), 'u1', job('complete', 'other.gcode'))).toBeNull();
    expect(nextStatus(rec({ status: 'printing' }), 'ender', job('complete'))).toBeNull();
    expect(nextStatus(rec({ status: 'printed' }), 'u1', job('printing'))).toBeNull();
  });
});
