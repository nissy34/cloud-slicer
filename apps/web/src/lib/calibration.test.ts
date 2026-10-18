import { describe, expect, it } from 'vitest';
import { CALIBRATIONS, calibrationOptions, checkCalibration, defaultValues } from './calibration';

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
    expect(checkCalibration('paTower', { start: 0, end: 0.001, step: 0.002 })).not.toBe('');
    expect(checkCalibration('inputShapingDamping', { freqStartX: 30, freqStartY: 30, start: 0.5, end: 0.4 })).not.toBe('');
    expect(checkCalibration('retraction', { start: 0, end: '', step: 0.1 })).not.toBe('');
  });
});
