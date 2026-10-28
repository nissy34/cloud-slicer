import { describe, expect, it } from 'vitest';
import { DEG } from './placement';
import { holdOnMark, markSegments, turnedText } from './rotate-marks';

describe('rotate ring marks', () => {
  it('holds the angle on a mark only when it is close', () => {
    expect(holdOnMark(44 * DEG)).toBeCloseTo(45 * DEG);
    expect(holdOnMark(-16.5 * DEG)).toBeCloseTo(-15 * DEG);
    expect(holdOnMark(37 * DEG)).toBeCloseTo(37 * DEG);
    expect(holdOnMark(0.5 * DEG)).toBe(0);
  });

  it('draws 24 marks, every third one longer', () => {
    const s = markSegments(0.1, 0.2, 0);
    expect(s.length).toBe(24 * 6);
    const len = (k: number) => Math.hypot(s[k * 6 + 3] - s[k * 6], s[k * 6 + 4] - s[k * 6 + 1]);
    expect(len(0)).toBeCloseTo(0.2);
    expect(len(1)).toBeCloseTo(0.1);
    expect(len(3)).toBeCloseTo(0.2);
    // The 90° mark points straight up the ring.
    expect(s[6 * 6]).toBeCloseTo(0);
    expect(s[6 * 6 + 1]).toBeCloseTo(1);
  });

  it('reads the angle in whole degrees with its sign', () => {
    expect(turnedText(45 * DEG)).toBe('+45°');
    expect(turnedText(-30.2 * DEG)).toBe('-30°');
    expect(turnedText(0)).toBe('0°');
  });
});
