import { describe, expect, it } from 'vitest';
import type { PageAnswer, PageRequest } from './link/types';
import { DIRECT_RECHECK_MS, PageLimit, RELAY_DATA_LIMIT, RELAY_RECHECK_MS, conditionalCache, pageAssembler, pageCarrier, pagePath } from './printer-page';

const get = (path: string, headers: Record<string, string> = {}): PageRequest => ({ method: 'GET', path, headers });
const ok = (headers: Record<string, string>, size = 3): PageAnswer => ({ status: 200, headers, body: new ArrayBuffer(size) });

describe('pagePath', () => {
  it('keeps the address on the printer, whatever form Moonraker gives', () => {
    expect(pagePath('/screen/')).toBe('/screen/');
    expect(pagePath('http://10.0.0.1/screen/?x=1')).toBe('/screen/?x=1');
    expect(pagePath('webcam/player')).toBe('/webcam/player');
  });
});

describe('conditionalCache', () => {
  it('answers a repeated picture check itself for a second, then asks the printer again', () => {
    let now = 0;
    const cache = conditionalCache(() => now);
    expect(cache.answer(get('/screen/snapshot?ts=1', { 'If-None-Match': '"a"' }), RELAY_RECHECK_MS)).toBeNull();
    cache.learn(get('/screen/snapshot?ts=1'), ok({ ETag: '"a"' }));
    now = 400;
    expect(cache.answer(get('/screen/snapshot?ts=2', { 'if-none-match': '"a"' }), RELAY_RECHECK_MS)?.status).toBe(304);
    // Another picture than the one the page has, or no check at all: always asked.
    expect(cache.answer(get('/screen/snapshot?ts=3', { 'If-None-Match': '"b"' }), RELAY_RECHECK_MS)).toBeNull();
    expect(cache.answer(get('/screen/snapshot?ts=4'), RELAY_RECHECK_MS)).toBeNull();
    now = RELAY_RECHECK_MS;
    expect(cache.answer(get('/screen/snapshot?ts=5', { 'If-None-Match': '"a"' }), RELAY_RECHECK_MS)).toBeNull();
  });

  it('never answers a tap', () => {
    const cache = conditionalCache(() => 0);
    cache.learn(get('/screen/touch'), ok({ ETag: '"a"' }));
    expect(cache.answer({ method: 'POST', path: '/screen/touch', headers: { 'If-None-Match': '"a"' } }, RELAY_RECHECK_MS)).toBeNull();
  });

  it('asks the printer again right after a tap, and sooner over the direct link', () => {
    let now = 0;
    const cache = conditionalCache(() => now);
    const check = get('/screen/snapshot?ts=1', { 'If-None-Match': '"a"' });
    cache.learn(get('/screen/snapshot'), ok({ ETag: '"a"' }));
    now = DIRECT_RECHECK_MS - 1;
    expect(cache.answer(check, DIRECT_RECHECK_MS)?.status).toBe(304);
    now = DIRECT_RECHECK_MS;
    expect(cache.answer(check, DIRECT_RECHECK_MS)).toBeNull();
    expect(cache.answer(check, RELAY_RECHECK_MS)?.status).toBe(304);
    cache.answer({ method: 'POST', path: '/screen/touch?a=tap&x=1&y=1', headers: {} }, RELAY_RECHECK_MS);
    expect(cache.answer(check, RELAY_RECHECK_MS)).toBeNull();
  });
});

describe('pageAssembler', () => {
  it('joins each answer from its pieces, even when answers interleave', () => {
    const add = pageAssembler();
    const piece = (id: number, last: boolean, ...data: number[]) => {
      const p = new Uint8Array(5 + data.length);
      new DataView(p.buffer).setUint32(0, id);
      p[4] = last ? 1 : 0;
      p.set(data, 5);
      return p;
    };
    expect(add(piece(1, false, 1, 2))).toBeNull();
    expect(add(piece(2, false, 9))).toBeNull();
    const one = add(piece(1, true, 3))!;
    expect(one.id).toBe(1);
    expect(Array.from(new Uint8Array(one.body))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint8Array(add(piece(2, true, 8))!.body))).toEqual([9, 8]);
  });
});

describe('pageCarrier over the relay', () => {
  it('passes requests to the bridge and stops after the data limit', async () => {
    const asked: string[] = [];
    const carrier = pageCarrier({
      pageFetch: async (r) => {
        asked.push(r.path);
        return ok({}, RELAY_DATA_LIMIT / 2 + 1);
      },
    });
    await carrier.fetch(get('/screen/'));
    await carrier.fetch(get('/screen/a'));
    await expect(carrier.fetch(get('/screen/b'))).rejects.toBeInstanceOf(PageLimit);
    expect(asked).toEqual(['/screen/', '/screen/a']);
    carrier.close();
    await expect(carrier.fetch(get('/screen/'))).rejects.toThrow('closed');
  });
});
