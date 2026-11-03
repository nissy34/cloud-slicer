import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_TIMEOUT_MS, RETRY_AFTER_MS, SharedLink, VIDEO_SLOTS, type LinkCalls } from './shared-link';
import { LINK_MEND_MS } from './webrtc';

/** A pretend browser connection: `go` moves it to a state, as the network would. */
class FakePc {
  static made: FakePc[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'complete';
  localDescription: { sdp: string } | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((e: { streams: { id: string }[] }) => void) | null = null;
  transceivers = 0;
  channels: string[] = [];
  closed = false;
  constructor() {
    FakePc.made.push(this);
  }
  addTransceiver() {
    this.transceivers++;
  }
  createDataChannel(label: string) {
    this.channels.push(label);
    return {};
  }
  async createOffer() {
    return { type: 'offer', sdp: 'offer' };
  }
  async setLocalDescription(d: { sdp: string }) {
    this.localDescription = d;
  }
  async setRemoteDescription() {}
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }
  go(st: RTCPeerConnectionState) {
    this.connectionState = st;
    this.onconnectionstatechange?.();
  }
}

function calls(): LinkCalls & { opened: number; closedIds: string[] } {
  const c = {
    opened: 0,
    closedIds: [] as string[],
    linkOpen: async () => {
      c.opened++;
      return { id: `link${c.opened}`, sdp: 'answer', videoSlots: VIDEO_SLOTS };
    },
    linkClose: (id: string) => void c.closedIds.push(id),
    linkCamera: async () => ({ slot: 0, mode: 'pictures' as const }),
    linkCameraClose: () => {},
  };
  return c;
}

/** Lets the link's awaits run, then connects the newest connection. */
async function connectNewest() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  FakePc.made.at(-1)!.go('connected');
}

describe('SharedLink', () => {
  let now = 1_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    FakePc.made = [];
    vi.stubGlobal('RTCPeerConnection', FakePc);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('makes one link for everyone who asks, with the video slots and a first channel', async () => {
    const c = calls();
    const link = new SharedLink(c, () => now);
    const a = link.ready();
    const b = link.ready();
    await connectNewest();
    expect(await a).toBe(await b);
    expect(c.opened).toBe(1);
    expect(FakePc.made[0].transceivers).toBe(VIDEO_SLOTS);
    expect(FakePc.made[0].channels).toEqual(['link']);
    expect(link.current()?.id).toBe('link1');
  });

  it('rides out a short blip, and tells everyone on it when it really drops', async () => {
    const c = calls();
    const link = new SharedLink(c, () => now);
    const p = link.ready();
    await connectNewest();
    await p;
    const dropped = vi.fn();
    link.onDrop(dropped);
    const pc = FakePc.made[0];
    pc.go('disconnected');
    vi.advanceTimersByTime(LINK_MEND_MS - 1000);
    pc.go('connected');
    vi.advanceTimersByTime(LINK_MEND_MS * 2);
    expect(dropped).not.toHaveBeenCalled();
    pc.go('failed');
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(pc.closed).toBe(true);
    expect(c.closedIds).toEqual(['link1']);
    // A drop is not a blocked network: the next ask makes a new link at once.
    expect(link.blocked).toBe(false);
    const again = link.ready();
    await connectNewest();
    expect((await again).id).toBe('link2');
  });

  it('a link that never connects says the network blocks it, and waits before trying again', async () => {
    const c = calls();
    const link = new SharedLink(c, () => now);
    const p = link.ready();
    p.catch(() => {});
    for (let i = 0; i < 5; i++) await Promise.resolve();
    vi.advanceTimersByTime(LINK_TIMEOUT_MS);
    await expect(p).rejects.toThrow(/did not connect/);
    expect(link.blocked).toBe(true);
    expect(c.closedIds).toEqual(['link1']);
    await expect(link.ready()).rejects.toThrow();
    expect(c.opened).toBe(1);
    now += RETRY_AFTER_MS;
    const later = link.ready();
    await connectNewest();
    expect((await later).id).toBe('link2');
    expect(link.blocked).toBe(false);
  });

  it('a relay call that fails (the page is reconnecting) is not a blocked network: the next ask tries at once and everyone hears when it is up', async () => {
    const c = calls();
    const real = c.linkOpen;
    let relayDown = true;
    c.linkOpen = async (sdp: string) => {
      if (relayDown) throw new Error('Not connected.');
      return real(sdp);
    };
    const link = new SharedLink(c, () => now);
    await expect(link.ready()).rejects.toThrow(/Not connected/);
    expect(link.blocked).toBe(false);
    const up = vi.fn();
    link.onUp(up);
    relayDown = false;
    const again = link.ready();
    await connectNewest();
    await again;
    expect(up).toHaveBeenCalledTimes(1);
  });
});
