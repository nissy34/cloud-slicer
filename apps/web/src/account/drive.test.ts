import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  api: { driveToken: async () => ({ accessToken: 'key', expiresAt: Date.now() + 3600_000 }) },
}));
const { CHUNK, downloadFromDrive, downloadTotal, rangeEnd, uploadToDrive } = await import('./drive');

/** Google Drive's upload API, as much as uploadToDrive uses: one folder, one resumable upload. */
function fakeDrive({ dropAfterPieces = Infinity } = {}) {
  let got = new Uint8Array(0);
  let pieces = 0;
  const calls: string[] = [];
  const range = () => (got.length ? { Range: `bytes=0-${got.length - 1}` } : undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push(`${method} ${url.replace(/\?.*/, '')}`);
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && method === 'GET') return Response.json({ files: [{ id: 'folder' }] });
      if (url.startsWith('https://www.googleapis.com/upload/')) return new Response(null, { headers: { Location: 'https://upload.example/session' } });
      const cr = /bytes (?:(\d+)-(\d+)|\*)\/(\d+)/.exec(new Headers(init.headers).get('Content-Range') ?? '')!;
      const total = Number(cr[3]);
      if (cr[1] !== undefined) {
        const body = new Uint8Array(await (init.body as Blob).arrayBuffer());
        if (Number(cr[1]) === got.length) {
          const next = new Uint8Array(got.length + body.length);
          next.set(got);
          next.set(body, got.length);
          got = next;
        }
        if (++pieces === dropAfterPieces) throw new TypeError('Failed to fetch');
      }
      if (got.length < total) return new Response(null, { status: 308, headers: range() });
      return Response.json({ id: 'file-1' });
    }),
  );
  return { calls, bytes: () => got };
}

afterEach(() => vi.unstubAllGlobals());

describe('Google Drive uploads', () => {
  it('goes on after the bytes Google says it has', () => {
    expect(rangeEnd('bytes=0-4194303')).toBe(4194304);
    expect(rangeEnd(null)).toBe(0);
    expect(CHUNK % (256 * 1024)).toBe(0);
  });

  it('sends a big project in pieces and says how far it got', async () => {
    const drive = fakeDrive();
    const file = new Blob([new Uint8Array(CHUNK * 2 + 1000).fill(7)]);
    const progress: number[] = [];
    expect(await uploadToDrive(file, 'Benchy', { onProgress: (sent) => progress.push(sent) })).toBe('file-1');
    expect(drive.bytes().length).toBe(file.size);
    expect(progress).toEqual([0, CHUNK, CHUNK * 2, file.size]);
  });

  it('carries on after a dropped connection from what Google has', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const drive = fakeDrive({ dropAfterPieces: 2 });
    const file = new Blob([new Uint8Array(CHUNK * 3).map((_, i) => i % 251)]);
    const done = uploadToDrive(file, 'Benchy');
    await vi.runAllTimersAsync();
    expect(await done).toBe('file-1');
    vi.useRealTimers();
    const sent = new Uint8Array(await file.arrayBuffer());
    expect(drive.bytes().length).toBe(sent.length);
    expect(drive.bytes().every((b, i) => b === sent[i])).toBe(true);
    // The piece that dropped was asked about (bytes */total), then the upload went on, not over.
    expect(drive.calls.filter((c) => c.startsWith('PUT')).length).toBe(4);
  });
});

describe('Google Drive downloads', () => {
  it('knows the total from Drive, or from the size we keep when Drive sends it compressed', () => {
    expect(downloadTotal(new Headers({ 'Content-Length': '4000000' }), 3900000)).toBe(4000000);
    expect(downloadTotal(new Headers({ 'Content-Length': '1000', 'Content-Encoding': 'gzip' }), 4000000)).toBe(4000000);
    expect(downloadTotal(new Headers(), 4000000)).toBe(4000000);
    expect(downloadTotal(new Headers(), 0)).toBe(0);
  });

  it('reports bytes of the known size as they arrive, never past it', async () => {
    const piece = new Uint8Array(1000);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 3; i++) c.enqueue(piece);
        c.close();
      },
    });
    // Compressed on the way: no usable length, so the list's size (a bit small here) is the total.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Encoding': 'gzip' } })));
    const seen: [number, number][] = [];
    const bytes = await downloadFromDrive('file-1', (loaded, total) => seen.push([loaded, total]), 2500);
    expect(bytes.byteLength).toBe(3000);
    expect(seen).toEqual([
      [1000, 2500],
      [2000, 2500],
      [3000, 3000],
    ]);
  });
});
