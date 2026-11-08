import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cancelled, fetchWithin, TimedOut, unlessCancelled, within } from './time-limit';

/** A fetch that never answers, until it is aborted. */
const hangingFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit = {}) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('time limits (#276)', () => {
  it('fails a request that gets no answer in time', async () => {
    vi.useFakeTimers();
    hangingFetch();
    const done = fetchWithin(30_000, 'https://example.com/');
    const caught = done.catch((e) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await caught).toBeInstanceOf(TimedOut);
  });

  it('says Cancelled, not timed out, when Cancel stopped it', async () => {
    hangingFetch();
    const ctl = new AbortController();
    const done = fetchWithin(30_000, 'https://example.com/', {}, ctl.signal);
    ctl.abort();
    await expect(done).rejects.toBeInstanceOf(Cancelled);
    await expect(fetchWithin(30_000, 'https://example.com/', {}, ctl.signal)).rejects.toBeInstanceOf(Cancelled);
  });

  it('has no limit for Infinity', async () => {
    vi.useFakeTimers();
    const s = within(Infinity);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.aborted).toBe(false);
  });

  it('stops waiting for work the moment Cancel is pressed', async () => {
    const ctl = new AbortController();
    const never = new Promise<number>(() => {});
    const waiting = unlessCancelled(never, ctl.signal);
    ctl.abort();
    await expect(waiting).rejects.toBeInstanceOf(Cancelled);
    expect(await unlessCancelled(Promise.resolve(7), new AbortController().signal)).toBe(7);
  });
});
