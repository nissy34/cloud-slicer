import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_MEND_MS, watchLink } from './webrtc';

function fakePc() {
  const pc = { connectionState: 'connected' as RTCPeerConnectionState, onconnectionstatechange: null as (() => void) | null };
  const go = (st: RTCPeerConnectionState) => {
    pc.connectionState = st;
    pc.onconnectionstatechange?.();
  };
  return { pc: pc as unknown as RTCPeerConnection, go };
}

describe('watchLink', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps a link that mends itself after a short "disconnected"', () => {
    const { pc, go } = fakePc();
    const lost = vi.fn();
    watchLink(pc, lost);
    go('disconnected');
    vi.advanceTimersByTime(LINK_MEND_MS - 1000);
    go('connected');
    vi.advanceTimersByTime(LINK_MEND_MS * 2);
    expect(lost).not.toHaveBeenCalled();
  });

  it('gives up when "disconnected" lasts', () => {
    const { pc, go } = fakePc();
    const lost = vi.fn();
    watchLink(pc, lost);
    go('disconnected');
    vi.advanceTimersByTime(LINK_MEND_MS);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('gives up at once on "failed", and only once', () => {
    const { pc, go } = fakePc();
    const lost = vi.fn();
    watchLink(pc, lost);
    go('disconnected');
    go('failed');
    expect(lost).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LINK_MEND_MS * 2);
    go('failed');
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('says nothing after it is stopped', () => {
    const { pc, go } = fakePc();
    const lost = vi.fn();
    const unwatch = watchLink(pc, lost);
    go('disconnected');
    unwatch();
    vi.advanceTimersByTime(LINK_MEND_MS * 2);
    go('failed');
    expect(lost).not.toHaveBeenCalled();
  });
});
