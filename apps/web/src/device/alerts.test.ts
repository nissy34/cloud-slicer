import { describe, expect, it } from 'vitest';
import cases from '../../../device-bridge/testdata/alert-cases.json';
import { AlertWatcher, cleanPrefs, defaultPrefs, snapshotOf, wants, watchFor, type AlertWatch, type FiredAlert, type PrintSnapshot } from './alerts';

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
  it('cleans what comes from storage', () => {
    expect(cleanPrefs({ events: ['finished', 'nope', 'finished'], percents: [50, 0, 150, 'x'], hours: 99, layer: 0 })).toEqual({ events: ['finished'], percents: [50], hours: 0, layer: null, pictures: true });
    expect(cleanPrefs(null)).toBeNull();
  });
});
