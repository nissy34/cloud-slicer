import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatGrams, gcodeFileName, sentence, stageLabel } from './format';

describe('formatClock', () => {
  it('shows hours, minutes and seconds like desktop', () => {
    expect(formatClock(3007)).toBe('50m 7s');
    expect(formatClock(5045)).toBe('1h 24m 5s');
    expect(formatClock(3600)).toBe('1h 0m 0s');
    expect(formatClock(19.4)).toBe('19s');
    expect(formatClock(0)).toBe('0s');
  });
  it('shows a dash for missing values', () => {
    expect(formatClock(Number.NaN)).toBe('–');
  });
});

describe('formatDuration', () => {
  it('rounds to minutes and shows hours', () => {
    expect(formatDuration(5025)).toBe('1 h 24 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(59)).toBe('1 min');
  });
  it('shows a dash for missing values', () => {
    expect(formatDuration(0)).toBe('–');
    expect(formatDuration(Number.NaN)).toBe('–');
  });
});

describe('formatGrams', () => {
  it('keeps one decimal under 10 g', () => {
    expect(formatGrams(3.64)).toBe('3.6 g');
    expect(formatGrams(12.6)).toBe('13 g');
    expect(formatGrams(0)).toBe('–');
  });
});

describe('gcodeFileName', () => {
  it('swaps the extension', () => {
    expect(gcodeFileName('3DBenchy.stl')).toBe('3DBenchy.gcode');
    expect(gcodeFileName('Dragon Scale.3mf')).toBe('Dragon Scale.gcode');
    expect(gcodeFileName('.stl')).toBe('model.gcode');
  });
});

describe('stageLabel', () => {
  it('sentence-cases engine stages', () => {
    expect(stageLabel('GENERATING SUPPORT')).toBe('Generating support');
    expect(stageLabel('')).toBe('');
    expect(stageLabel('Generating G-code: layer 12')).toBe('Generating G-code: layer 12');
  });
});

describe('sentence', () => {
  it('starts with a capital and ends with a full stop', () => {
    expect(sentence("the letters can't be set along this surface")).toBe("The letters can't be set along this surface.");
    expect(sentence('Already a sentence.')).toBe('Already a sentence.');
    expect(sentence('')).toBe('');
  });
});
