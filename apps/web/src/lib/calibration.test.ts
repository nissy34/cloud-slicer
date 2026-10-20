import { describe, expect, it } from 'vitest';
import { CALIBRATIONS, calibrationOptions, changeChoice, checkCalibration, defaultValues, parseList, visibleFields } from './calibration';

describe('calibration', () => {
  it("accepts desktop's defaults for every test", () => {
    for (const t of CALIBRATIONS) expect(checkCalibration(t.mode, defaultValues(t)), t.mode).toBe('');
  });

  it('picks the test model like desktop does', () => {
    expect(calibrationOptions('flowRate', { method: 'pass2' })).toMatchObject({ model: 'filament_flow/flowrate-test-pass2.3mf', linear: false, pass: 2 });
    expect(calibrationOptions('flowRate', { method: 'yoloFine' })).toMatchObject({ model: 'filament_flow/Orca-LinearFlow_fine.3mf', linear: true });
    expect(calibrationOptions('junctionDeviation', { start: 0, end: 0.2, testModel: '1' }).model).toBe('input_shaping/fast_tower_test.stl');
    expect(calibrationOptions('volumetricSpeed', {}).model).toMatch(/\.stl$/);
  });

  it('rejects values desktop rejects', () => {
    expect(checkCalibration('temperature', { start: 200, end: 230, step: 5 })).not.toBe('');
    expect(checkCalibration('pressureAdvance', { method: 'tower', start: 0, end: 0.001, step: 0.002 })).not.toBe('');
    expect(checkCalibration('pressureAdvance', { method: 'pattern', start: 0, end: 0.08, step: 0.0005 })).not.toBe('');
    expect(checkCalibration('inputShapingDamping', { freqStartX: 30, freqStartY: 30, start: 0.5, end: 0.4 })).not.toBe('');
    expect(checkCalibration('retraction', { start: 0, end: '', step: 0.1 })).not.toBe('');
  });

  it("resets pressure advance ranges like desktop's PA dialog", () => {
    const pa = CALIBRATIONS.find((t) => t.mode === 'pressureAdvance')!;
    let v = defaultValues(pa);
    expect(v).toMatchObject({ extruder: 'direct', method: 'tower', start: 0, end: 0.1, step: 0.002 });
    v = changeChoice(pa, v, 'method', 'pattern');
    expect(v).toMatchObject({ end: 0.08, step: 0.005 });
    expect(visibleFields(pa, v).map((f) => f.key)).toEqual(['start', 'end', 'step', 'accelerations', 'speeds']);
    v = changeChoice(pa, v, 'extruder', 'bowden');
    expect(v).toMatchObject({ end: 1, step: 0.05 });
    expect(changeChoice(pa, v, 'method', 'line')).toMatchObject({ end: 1, step: 0.02 });
    expect(visibleFields(pa, changeChoice(pa, v, 'method', 'line')).map((f) => f.key)).toContain('printNumbers');
  });

  it('sends the pattern with its speed and acceleration lists', () => {
    expect(parseList('1000, 3000,,0 ,x 7')).toEqual([1000, 3000, 7]);
    const o = calibrationOptions('pressureAdvance', { method: 'pattern', start: 0, end: 0.08, step: 0.005, speeds: '100,200', accelerations: '' });
    expect(o).toMatchObject({ mode: 'paPattern', speeds: [100, 200], accelerations: [], end: 0.08 });
    expect(o).not.toHaveProperty('model');
    expect(calibrationOptions('pressureAdvance', { method: 'line', printNumbers: false })).toMatchObject({ mode: 'paLine', printNumbers: false });
    expect(calibrationOptions('pressureAdvance', { method: 'tower' }).model).toBe('pressure_advance/tower_with_seam.stl');
  });
});
