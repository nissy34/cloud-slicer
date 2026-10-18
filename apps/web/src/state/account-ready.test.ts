import { afterEach, describe, expect, it, vi } from 'vitest';

// The account API never answers (offline, or a slow Worker).
vi.mock('../account/api', async (orig) => {
  const real = await orig<typeof import('../account/api')>();
  const hang = () => new Promise<never>(() => {});
  return { ...real, api: { ...real.api, me: hang, presets: hang, settings: hang, devices: hang } };
});

describe('accountReady', () => {
  afterEach(() => vi.useRealTimers());

  it('gives up waiting when the account request hangs, so the engine still starts', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('location', { hash: '', pathname: '/', search: '' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const { accountReady, useAccount } = await import('./account');
    let done = false;
    void accountReady(5000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(useAccount.getState().status).toBe('loading');
  });
});
