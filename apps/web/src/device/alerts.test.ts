import { describe, expect, it } from 'vitest';
import cases from '../../../device-bridge/testdata/alert-cases.json';
import detailCases from '../../../device-bridge/testdata/alert-details-cases.json';
import cameraCases from '../../../device-bridge/testdata/camera-cases.json';
import { AlertWatcher, camerasFor, cleanPrefs, cleanPrinterPrefs, defaultPrefs, detailsOf, snapshotOf, startingPrefs, wants, watchFor, type AlertWatch, type FiredAlert, type PrintSnapshot } from './alerts';
import type { KlipperObjects } from './status';

describe('print alert rules (shared with the bridge)', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const w = new AlertWatcher();
      let snap = { ...cases.base } as PrintSnapshot;
      const got: Record<string, unknown>[] = [];
      c.steps.forEach((step, i) => {
        const { at, ...fields } = step as { at: number } & Partial<PrintSnapshot>;
        snap = { ...snap, ...fields };
        for (const a of w.update(snap, c.watch as AlertWatch, at)) got.push({ step: i, ...strip(a) });
      });
      const want = c.expect.map((e) => ({ ...e }));
      // `file` is only compared where a case names it.
      for (let i = 0; i < got.length; i++) if (!('file' in (want[i] ?? {}))) delete got[i].file;
      expect(got).toEqual(want);
    });
  }
});

describe('what an alert says about the print (shared with the bridge)', () => {
  for (const c of detailCases.cases) it(c.name, () => expect(detailsOf(c.objects as KlipperObjects, c.facts)).toEqual(c.details));
});

describe('which cameras an alert uses (shared with the bridge)', () => {
  for (const c of cameraCases.cases) it(c.name, () => expect(camerasFor(c.chosen, c.names)).toEqual(c.want));
});

const strip = (a: FiredAlert) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));

describe('snapshots from Klipper objects', () => {
  it('reads state, layers, bed and a filament sensor with nothing in it', () => {
    const s = snapshotOf(
      {
        webhooks: { state: 'ready', state_message: 'Printer is ready' },
        print_stats: { state: 'printing', filename: 'x.gcode', print_duration: 100, info: { current_layer: 3, total_layer: 9 }, message: '' },
        virtual_sdcard: { progress: 0.25 },
        heater_bed: { temperature: 61.2, target: 60 },
        'filament_switch_sensor e0': { enabled: true, filament_detected: false },
      },
      1000,
    );
    expect(s).toMatchObject({ klippy: 'ready', state: 'printing', file: 'x.gcode', progress: 0.25, duration: 100, layer: 3, totalLayers: 9, bed: 61.2, noFilament: true, left: 750 });
  });
  it('ignores a filament sensor that is switched off', () => {
    expect(snapshotOf({ 'filament_motion_sensor m': { enabled: false, filament_detected: false } }, null).noFilament).toBe(false);
  });
});

describe('who wants which alert', () => {
  it('defaults: problems and finished, nothing else', () => {
    const p = defaultPrefs();
    expect(['failed', 'paused', 'error', 'finished'].every((e) => wants(p, { event: e as FiredAlert['event'] }))).toBe(true);
    expect(wants(p, { event: 'started' })).toBe(false);
    expect(wants(p, { event: 'layer', layer: 3 })).toBe(false);
  });
  it('layer N, progress marks and hours', () => {
    const p = { ...defaultPrefs(), events: [...defaultPrefs().events, 'progress', 'stillPrinting'] as FiredAlert['event'][], percents: [50], hours: 2, layer: 7 };
    expect(wants(p, { event: 'layer', layer: 7 })).toBe(true);
    expect(wants(p, { event: 'layer', layer: 8 })).toBe(false);
    expect(wants(p, { event: 'progress', percent: 50 })).toBe(true);
    expect(wants(p, { event: 'progress', percent: 40 })).toBe(false);
    expect(wants(p, { event: 'stillPrinting', hours: 1 })).toBe(false);
    expect(wants(p, { event: 'stillPrinting', hours: 4 })).toBe(true);
    expect(watchFor([p, { ...defaultPrefs(), layer: 3 }])).toEqual({ layers: [3, 7], percents: [50], hours: true });
  });
  it('layers on every print, alongside this print\'s one', () => {
    const p = { ...defaultPrefs(), layers: [3, 10], layer: 7 };
    for (const n of [3, 7, 10]) expect(wants(p, { event: 'layer', layer: n })).toBe(true);
    expect(wants(p, { event: 'layer', layer: 5 })).toBe(false);
    expect(watchFor([p, { ...defaultPrefs(), layers: [3, 5] }]).layers).toEqual([3, 5, 7, 10]);
  });
  it('the old "Third layer" switch becomes layer 3 on every print, with its cameras', () => {
    const p = cleanPrefs({ events: ['finished', 'layer3'], layers: [10], cameras: { layer3: ['nozzle'] } });
    expect(p?.events).toEqual(['finished']);
    expect(p?.layers).toEqual([3, 10]);
    expect(p?.cameras.layer).toEqual(['nozzle']);
    expect(cleanPrefs({ events: [], layers: [0, 5, 5, 'x', 200000] })?.layers).toEqual([5]);
  });
  it('a device turned on starts from the choices saved last, without "after layer N"', () => {
    const last = { ...defaultPrefs(), events: ['finished', 'progress'], percents: [50], hours: 2, layers: [3], layer: 7, cameras: { finished: ['nozzle'] } };
    expect(startingPrefs(last)).toEqual({ ...last, layer: null });
    expect(startingPrefs(undefined)).toEqual(defaultPrefs());
    expect(startingPrefs('nonsense')).toEqual(defaultPrefs());
  });
  it('cleans what comes from storage', () => {
    expect(cleanPrefs({ events: ['finished', 'nope', 'finished'], percents: [50, 0, 150, 'x'], hours: 99, layer: 0 })).toEqual({ events: ['finished'], percents: [50], hours: 0, layers: [], layer: null, cameras: defaultPrefs().cameras });
    expect(cleanPrefs(null)).toBeNull();
  });
  it('keeps the cameras chosen for each alert', () => {
    const p = cleanPrefs({ events: [], cameras: { started: ['case', 'case', 'nozzle'], offline: ['case'], nope: ['x'], finished: [], paused: ['a', 'b', 'c', 'd', 'e', 7] } });
    expect(p?.cameras).toEqual({ started: ['case', 'nozzle'], paused: ['a', 'b', 'c', 'd'] });
  });
  it('choices from before cameras could be picked: the first camera on the key alerts, or none', () => {
    expect(cleanPrefs({ events: [], pictures: true })?.cameras).toEqual(defaultPrefs().cameras);
    expect(cleanPrefs({ events: [], pictures: false })?.cameras).toEqual({});
    expect(defaultPrefs().cameras.finished).toEqual(['*']);
    expect(defaultPrefs().cameras.started).toBeUndefined();
  });
  it('choices the relay kept from an older build come back with cameras, so its rules never read a missing list', () => {
    const kept = cleanPrinterPrefs({ voron: { events: ['finished', 'paused'], percents: [], hours: 0, layer: 4, pictures: true }, bad: 'x' });
    expect(Object.keys(kept)).toEqual(['voron']);
    expect(kept.voron.cameras).toEqual(defaultPrefs().cameras);
    expect(kept.voron.layer).toBe(4);
    expect(cleanPrinterPrefs(undefined)).toEqual({});
  });
});
