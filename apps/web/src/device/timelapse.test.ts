import { describe, expect, it, vi } from 'vitest';
import type { PageAnswer, PageRequest } from './link/types';
import { PageRefused } from './printer-page';
import { BridgeFiles, PIECE, RELAY_VIDEO_LIMIT, VideoSource, fileAddress, pickTimelapses, playable, rangeTotal, type RangeReader } from './timelapse';

describe('pickTimelapses', () => {
  it('keeps videos newest first, each with its picture', () => {
    const list = pickTimelapses('timelapse', [
      { path: 'old.mp4', modified: 1, size: 10 },
      { path: 'benchy.mp4', modified: 5, size: 20 },
      { path: 'benchy.jpg', modified: 5, size: 2 },
      { path: 'monitor.jpg', modified: 9, size: 2 },
      { path: 'notes.txt', modified: 9, size: 2 },
    ]);
    expect(list).toEqual([
      { root: 'timelapse', path: 'benchy.mp4', modified: 5, size: 20, picture: 'benchy.jpg' },
      { root: 'timelapse', path: 'old.mp4', modified: 1, size: 10 },
    ]);
  });
  it('knows what a browser plays', () => {
    expect(playable('a.mp4')).toBe(true);
    expect(playable('a.avi')).toBe(false);
  });
  it('escapes each part of the address', () => {
    expect(fileAddress('camera', 'my print #1.mp4')).toBe('/server/files/camera/my%20print%20%231.mp4');
  });
});

/** A bridge with no direct links: every piece over the relay, served from `bytes`. */
function relayBridge(bytes: Uint8Array, opts: { range?: boolean; refuse?: string } = {}) {
  const asked: string[] = [];
  return {
    asked,
    pageFetch: async (r: PageRequest): Promise<PageAnswer> => {
      asked.push(r.headers.Range ?? '');
      if (opts.refuse) throw new PageRefused(opts.refuse);
      if (!opts.range) return { status: 200, headers: {}, body: bytes.slice().buffer };
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(r.headers.Range)!.map(Number);
      const end = Math.min(b, bytes.length - 1);
      return { status: 206, headers: { 'Content-Range': `bytes ${a}-${end}/${bytes.length}` }, body: bytes.slice(a, end + 1).buffer };
    },
  };
}

function counting(n: number) {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = i % 251;
  return bytes;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

describe('BridgeFiles', () => {
  it('reads a piece over the relay', async () => {
    const bridge = relayBridge(counting(10), { range: true });
    const a = await new BridgeFiles(bridge).readRange('/server/files/timelapse/a.mp4', 2, 5);
    expect([...a.bytes]).toEqual([2, 3, 4, 5]);
    expect(a.total).toBe(10);
    expect(a.route).toBe('relay');
    expect(bridge.asked).toEqual(['bytes=2-5']);
  });
  it('cuts the piece from a printer that ignores Range', async () => {
    const a = await new BridgeFiles(relayBridge(counting(10))).readRange('/server/files/camera/a.mp4', 8, 20);
    expect([...a.bytes]).toEqual([8, 9]);
    expect(a.total).toBe(10);
  });
  it('never goes through the relay when told not to', async () => {
    const bridge = relayBridge(counting(4), { range: true });
    await expect(new BridgeFiles(bridge).readRange('/server/files/timelapse/a.jpg', 0, 3, { directOnly: true })).rejects.toThrow();
    expect(bridge.asked).toEqual([]);
  });
  it('asks for a bridge update when the bridge is too old', async () => {
    const bridge = relayBridge(counting(4), { refuse: 'This address is not part of a page the printer lists.' });
    await expect(new BridgeFiles(bridge).readRange('/server/files/timelapse/a.mp4', 0, 3)).rejects.toThrow(/Update the bridge/);
  });
  it('after a drop, waits for the direct link while it is up instead of going over the relay', async () => {
    vi.stubGlobal('RTCPeerConnection', class {});
    // A pretend direct link that answers every piece with 4 bytes.
    const dc = {
      readyState: 'connecting',
      binaryType: '',
      onopen: null as null | (() => void),
      onmessage: null as null | ((e: { data: unknown }) => void),
      onclose: null,
      close() {},
      send(text: string) {
        const { id } = JSON.parse(text) as { id: number };
        queueMicrotask(() => {
          this.onmessage?.({ data: JSON.stringify({ id, status: 206, headers: { 'Content-Range': 'bytes 0-3/4' }, size: 4 }) });
          const piece = new Uint8Array(9);
          new DataView(piece.buffer).setUint32(0, id);
          piece[4] = 1;
          piece.set([1, 2, 3, 4], 5);
          this.onmessage?.({ data: piece.buffer });
        });
      },
    };
    const up = { id: 'l', pc: { createDataChannel: () => (setTimeout(() => ((dc.readyState = 'open'), dc.onopen?.())), dc) } };
    let drop = () => {};
    const shared = { current: () => up, ready: async () => up, onDrop: (f: () => void) => ((drop = f), () => {}) };
    const bridge = { ...relayBridge(counting(4), { range: true }), shared: shared as never };
    const files = new BridgeFiles(bridge);
    expect((await files.readRange('/server/files/timelapse/a.mp4', 0, 3)).route).toBe('direct');
    drop(); // the channel dropped, but the link came back at once
    expect((await files.readRange('/server/files/timelapse/a.mp4', 0, 3)).route).toBe('direct');
    expect(bridge.asked).toEqual([]);
    vi.unstubAllGlobals();
  });
  it('reads the whole size from a Range answer', () => {
    expect(rangeTotal({ status: 206, headers: { 'content-range': 'bytes 0-3/10' }, body: new ArrayBuffer(0) })).toBe(10);
  });
});

/** A reader over `bytes` that counts what it was asked. */
function reader(bytes: Uint8Array) {
  const asked: number[] = [];
  const read: RangeReader = async (start, end) => {
    asked.push(start);
    return { bytes: bytes.subarray(start, Math.min(end, bytes.length - 1) + 1), total: bytes.length, route: 'relay' };
  };
  return { asked, read };
}

describe('VideoSource', () => {
  it('fetches the whole video in pieces, and only once', async () => {
    const bytes = counting(PIECE * 2 + 10);
    const r = reader(bytes);
    const src = new VideoSource(r.read, bytes.length, 'video/mp4');
    const progress: number[] = [];
    const blob = await src.all((f) => progress.push(f));
    expect(same(new Uint8Array(await blob.arrayBuffer()), bytes)).toBe(true);
    expect(r.asked.sort((a, b) => a - b)).toEqual([0, PIECE, PIECE * 2]);
    expect(progress.at(-1)).toBe(1);
    await src.all();
    expect(r.asked.length).toBe(3);
  });
  it('keeps big videos off the relay', async () => {
    const seen: boolean[] = [];
    const src = new VideoSource(
      async (_s, _e, o) => {
        seen.push(!!o.directOnly);
        return { bytes: new Uint8Array(1), total: 1, route: 'direct' };
      },
      RELAY_VIDEO_LIMIT + 1,
      'video/mp4',
    );
    await src.all();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });
  it('tries a failed piece again', async () => {
    let fail = true;
    const src = new VideoSource(
      async () => {
        if (fail) throw new Error('dropped');
        return { bytes: new Uint8Array([1]), total: 1, route: 'relay' };
      },
      1,
      'video/mp4',
    );
    await expect(src.all()).rejects.toThrow('dropped');
    fail = false;
    expect((await src.all()).size).toBe(1);
  });
});
