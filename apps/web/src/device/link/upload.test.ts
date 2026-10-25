import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIRECT_STALL_MS, DirectUploadLost, encodePiece, gzipped, offerDirectUpload } from './upload';

/** A direct link that opens but carries nothing: every byte sent stays queued. */
class StalledLink {
  iceGatheringState = 'complete';
  connectionState = 'connected';
  localDescription = { sdp: 'offer' };
  channel = {
    readyState: 'open',
    bufferedAmount: 0,
    binaryType: '',
    send(bytes: Uint8Array) {
      this.bufferedAmount += bytes.length;
    },
  };
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return {};
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {}
}

describe('bridge uploads', () => {
  it('frames a binary piece as length, header, bytes', () => {
    const out = encodePiece({ id: 'b1', method: 'bridge.upload_piece' }, new Uint8Array([7, 8, 9]));
    const n = new DataView(out.buffer).getUint32(0);
    expect(JSON.parse(new TextDecoder().decode(out.subarray(4, 4 + n)))).toEqual({ id: 'b1', method: 'bridge.upload_piece' });
    expect([...out.subarray(4 + n)]).toEqual([7, 8, 9]);
  });

  it('zips G-code smaller, and round-trips it', async () => {
    const text = 'G1 X10 Y10 E0.5\n'.repeat(20_000);
    const zip = await gzipped(new Blob([text]));
    expect(zip).not.toBeNull();
    expect(zip!.size).toBeLessThan(text.length / 4);
    const back = await new Response(zip!.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    expect(back).toBe(text);
  });

  it('sends a file that does not shrink as it is', async () => {
    const random = crypto.getRandomValues(new Uint8Array(4096));
    expect(await gzipped(new Blob([random]))).toBeNull();
    expect(await gzipped(new Blob([]))).toBeNull();
  });

  describe('a direct link that stalls', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('is given up, so the relay can carry on', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('RTCPeerConnection', StalledLink);
      const direct = await offerDirectUpload();
      const sent = direct!.send('answer', new Blob([new Uint8Array(100_000)]));
      const outcome = sent.then(
        () => 'finished',
        (e) => e,
      );
      await vi.advanceTimersByTimeAsync(DIRECT_STALL_MS + 1000);
      expect(await outcome).toBeInstanceOf(DirectUploadLost);
    });
  });
});
