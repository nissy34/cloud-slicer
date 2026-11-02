import { describe, expect, it } from 'vitest';
import type { PageAnswer, PageRequest } from './link/types';
import { PageRefused } from './printer-page';
import { BridgeFiles, RELAY_PIECE, RELAY_VIDEO_LIMIT, fileAddress, pickTimelapses, playable, rangeTotal } from './timelapse';

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

describe('BridgeFiles', () => {
  it('fetches a video over the relay in pieces', async () => {
    const bytes = new Uint8Array(RELAY_PIECE * 2 + 10).map((_, i) => i % 251);
    const bridge = relayBridge(bytes, { range: true });
    const progress: number[] = [];
    const routes: string[] = [];
    const blob = await new BridgeFiles(bridge).download('/server/files/timelapse/a.mp4', bytes.length, { onProgress: (f) => progress.push(f), onRoute: (r) => routes.push(r) });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(bridge.asked).toEqual([`bytes=0-${RELAY_PIECE - 1}`, `bytes=${RELAY_PIECE}-${2 * RELAY_PIECE - 1}`, `bytes=${2 * RELAY_PIECE}-${3 * RELAY_PIECE - 1}`]);
    expect(progress.at(-1)).toBe(1);
    expect(routes).toEqual(['relay']);
  });
  it('takes a whole answer from a printer without Range', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const blob = await new BridgeFiles(relayBridge(bytes)).download('/server/files/camera/a.mp4', 3);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });
  it('never sends big videos or row pictures through the relay', async () => {
    const bridge = relayBridge(new Uint8Array(4), { range: true });
    await expect(new BridgeFiles(bridge).download('/server/files/timelapse/big.mp4', RELAY_VIDEO_LIMIT + 1)).rejects.toThrow(/too big/);
    await expect(new BridgeFiles(bridge).download('/server/files/timelapse/a.jpg', 4, { directOnly: true })).rejects.toThrow();
    expect(bridge.asked).toEqual([]);
  });
  it('asks for a bridge update when the bridge is too old', async () => {
    const bridge = relayBridge(new Uint8Array(4), { refuse: 'This address is not part of a page the printer lists.' });
    await expect(new BridgeFiles(bridge).download('/server/files/timelapse/a.mp4', 4)).rejects.toThrow(/Update the bridge/);
  });
  it('reads the whole size from a Range answer', () => {
    expect(rangeTotal({ status: 206, headers: { 'content-range': 'bytes 0-3/10' }, body: new ArrayBuffer(0) })).toBe(10);
  });
});
