import { describe, expect, it } from 'vitest';
import { DEG } from './placement';
import { ringScale, ringTurn, turnBetween, turnedText, turnLines } from './rotate-marks';

describe('rotate ring, like desktop', () => {
  it('steps in 5° on the marks, 45° on the middle spokes, free elsewhere', () => {
    // On the ring and its marks.
    expect(ringTurn(37.4 * DEG, 1)).toBeCloseTo(35 * DEG);
    expect(ringTurn(38 * DEG, 1.08)).toBeCloseTo(40 * DEG);
    expect(ringTurn(-12 * DEG, 0.9)).toBeCloseTo(-10 * DEG);
    // In the middle third.
    expect(ringTurn(60 * DEG, 0.5)).toBeCloseTo(45 * DEG);
    expect(ringTurn(70 * DEG, 0.4)).toBeCloseTo(90 * DEG);
    // Between them, and far outside.
    expect(ringTurn(37.4 * DEG, 0.75)).toBeCloseTo(37.4 * DEG);
    expect(ringTurn(37.4 * DEG, 2)).toBeCloseTo(37.4 * DEG);
    expect(ringTurn(37.4 * DEG, 0.1)).toBeCloseTo(37.4 * DEG);
    // Shift or the snap setting: 15° anywhere.
    expect(ringTurn(37.4 * DEG, 0.75, 15 * DEG)).toBeCloseTo(30 * DEG);
    expect(ringTurn(-1 * DEG, 1)).toBe(0);
  });

  it('measures the turn round the ring, left positive', () => {
    expect(turnBetween([1, 0], [0, 2])).toBeCloseTo(90 * DEG);
    expect(turnBetween([1, 0], [0, -1])).toBeCloseTo(-90 * DEG);
    expect(turnBetween([0, 1], [-1, 1])).toBeCloseTo(45 * DEG);
  });

  it('draws 72 marks, every second longer, and 8 spokes in the middle third', () => {
    const s = ringScale();
    expect(s.length).toBe((72 + 8) * 6);
    const len = (k: number) => Math.hypot(s[k * 6 + 3] - s[k * 6], s[k * 6 + 4] - s[k * 6 + 1]);
    expect(len(0)).toBeCloseTo(0.1);
    expect(len(1)).toBeCloseTo(0.05);
    expect(len(2)).toBeCloseTo(0.1);
    // Marks start on the ring; the 90° one points straight up it.
    expect(Math.hypot(s[0], s[1])).toBeCloseTo(1);
    expect(s[18 * 6]).toBeCloseTo(0);
    expect(s[18 * 6 + 1]).toBeCloseTo(1);
    // The first spoke runs from a third to two thirds out.
    expect(s[72 * 6]).toBeCloseTo(1 / 3);
    expect(s[72 * 6 + 3]).toBeCloseTo(2 / 3);
  });

  it('draws the turn: start line, end line and the arc between', () => {
    const t = turnLines(90 * DEG);
    expect(t[3]).toBeCloseTo(1);
    expect(t[9]).toBeCloseTo(0);
    expect(t[10]).toBeCloseTo(1);
    expect(t.length).toBe(12 + 18 * 6);
  });

  it('reads the angle in whole degrees with its sign', () => {
    expect(turnedText(45 * DEG)).toBe('+45°');
    expect(turnedText(-30.2 * DEG)).toBe('-30°');
    expect(turnedText(0)).toBe('0°');
  });
});
