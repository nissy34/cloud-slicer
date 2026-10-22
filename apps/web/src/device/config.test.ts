import { describe, expect, it } from 'vitest';
import { currentRelay, isTestRelay, LIVE_RELAY_URL, TEST_RELAY_URL } from './config';

describe('isTestRelay', () => {
  it('knows the test relay, with or without a trailing slash', () => {
    expect(isTestRelay(TEST_RELAY_URL)).toBe(true);
    expect(isTestRelay(`${TEST_RELAY_URL}/`)).toBe(true);
  });
  it('knows the test relay by its first address too', () => {
    expect(isTestRelay('https://cloud-slicer-relay-test.nissy34.workers.dev')).toBe(true);
  });
  it('is false for the live relay, a local one and none', () => {
    expect(isTestRelay(LIVE_RELAY_URL)).toBe(false);
    expect(isTestRelay('https://cloud-slicer-relay.nissy34.workers.dev')).toBe(false);
    expect(isTestRelay('http://127.0.0.1:8797')).toBe(false);
    expect(isTestRelay(undefined)).toBe(false);
  });
});

describe('currentRelay', () => {
  it('moves the first workers.dev addresses to the relays’ own ones', () => {
    expect(currentRelay('https://cloud-slicer-relay.nissy34.workers.dev')).toBe('https://cloud-slicer-relay.awesomestuff.qzz.io');
    expect(currentRelay('https://cloud-slicer-relay-test.nissy34.workers.dev/')).toBe('https://cloud-slicer-relay-test.awesomestuff.qzz.io');
  });
  it('leaves any other relay as it is, without a trailing slash', () => {
    expect(currentRelay(LIVE_RELAY_URL)).toBe(LIVE_RELAY_URL);
    expect(currentRelay('http://127.0.0.1:8797/')).toBe('http://127.0.0.1:8797');
  });
});
