import { describe, expect, it } from 'vitest';
import { isTestRelay, LIVE_RELAY_URL, TEST_RELAY_URL } from './config';

describe('isTestRelay', () => {
  it('knows the test relay, with or without a trailing slash', () => {
    expect(isTestRelay(TEST_RELAY_URL)).toBe(true);
    expect(isTestRelay(`${TEST_RELAY_URL}/`)).toBe(true);
  });
  it('is false for the live relay, a local one and none', () => {
    expect(isTestRelay(LIVE_RELAY_URL)).toBe(false);
    expect(isTestRelay('http://127.0.0.1:8797')).toBe(false);
    expect(isTestRelay(undefined)).toBe(false);
  });
});
