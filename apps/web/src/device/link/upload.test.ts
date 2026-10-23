import { describe, expect, it } from 'vitest';
import { encodePiece, gzipped } from './upload';

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
});
