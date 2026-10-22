// Printer pages: a page the printer serves for a camera Moonraker lists as an
// "iframe" (paxx12's remote screen, a camera's player page), opened from its
// page card on the Device tab. The page runs in a holder on the relay's own
// address (apps/device-relay/src/page-shell.ts), never on this site's, and every
// request it makes comes here and goes to the bridge: over a direct WebRTC link
// when one connects (nothing crosses the relay), else one by one over the relay.
// A page that polls (the remote screen asks for its picture ten times a second)
// has its repeated "has it changed?" checks answered here: the printer is asked
// about three times a second over the direct link, once a second over the relay,
// and again at once after a tap. Over the relay a page stops after a data limit.
import type { PageAnswer, PageRequest } from './link/types';
import { STUN, gathered } from './webrtc';

export interface PageBridge {
  pageFetch(req: PageRequest): Promise<PageAnswer>;
  pageOpen?(sdp: string): Promise<{ id: string; sdp: string }>;
  pageClose?(id: string): void;
}

/** How long the direct link gets to connect; the page meanwhile goes over the relay. */
export const DIRECT_PAGE_TIMEOUT_MS = 12_000;
/** Over the relay, a picture the page already has is asked for again at most this often. */
export const RELAY_RECHECK_MS = 1000;
/** Over the direct link, the same: the printer works out each answer, so it isn't asked ten times a second. */
export const DIRECT_RECHECK_MS = 300;
/** Over the relay a page stops after this much data; reopening it starts again. */
export const RELAY_DATA_LIMIT = 25 * 1024 * 1024;

export type PageRoute = 'connecting' | 'direct' | 'relay';

/** The address on the printer a page opens at: "/screen/" from "/screen/" or "http://printer/screen/". */
export function pagePath(streamUrl: string): string {
  try {
    const u = new URL(streamUrl, 'http://printer.invalid');
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

/**
 * Answers a request the page repeats with "If-None-Match" for the picture it
 * already has (Not Modified) without asking the printer, when the printer said
 * the same less than `recheckMs` ago. Anything else the page sends (a tap)
 * makes the next check go to the printer, so the screen answers it at once.
 */
export function conditionalCache(now: () => number = Date.now) {
  const seen = new Map<string, { etag: string; at: number }>();
  const key = (r: PageRequest) => r.path.replace(/\?.*$/, '');
  const header = (h: Record<string, string>, name: string) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
  return {
    answer(r: PageRequest, recheckMs: number): PageAnswer | null {
      if (r.method !== 'GET' && r.method !== 'HEAD') {
        seen.clear();
        return null;
      }
      const asked = header(r.headers, 'if-none-match');
      const last = seen.get(key(r));
      if (!asked || !last || last.etag !== asked || now() - last.at >= recheckMs) return null;
      return { status: 304, headers: { ETag: last.etag }, body: new ArrayBuffer(0) };
    },
    learn(r: PageRequest, a: PageAnswer) {
      const etag = header(a.headers, 'etag');
      if (r.method === 'GET' && etag && (a.status === 200 || a.status === 304)) seen.set(key(r), { etag, at: now() });
    },
  };
}

/** Joins the pieces of each answer on a direct page link (4 bytes id, 1 byte "last piece", data). */
export function pageAssembler() {
  const parts = new Map<number, Uint8Array[]>();
  return (piece: Uint8Array): { id: number; body: ArrayBuffer } | null => {
    if (piece.length < 5) return null;
    const id = new DataView(piece.buffer, piece.byteOffset, 4).getUint32(0);
    const list = parts.get(id) ?? [];
    list.push(piece.slice(5));
    parts.set(id, list);
    if (piece[4] !== 1) return null;
    parts.delete(id);
    const size = list.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of list) {
      out.set(p, at);
      at += p.length;
    }
    return { id, body: out.buffer };
  };
}

/** A page that used its share of relay data: it stops until opened again. */
export class PageLimit extends Error {}

/** The bridge's own answer that a request can't be done (not a lost link): the relay would say the same. */
export class PageRefused extends Error {}

interface DirectPageLink {
  fetch(r: PageRequest): Promise<PageAnswer>;
  close(): void;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A direct WebRTC link to the bridge for page requests; resolves once its channel is open. */
async function openDirect(bridge: Required<PageBridge>, onLost: () => void): Promise<DirectPageLink> {
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const dc = pc.createDataChannel('page');
  dc.binaryType = 'arraybuffer';
  let id = '';
  let closed = false;
  let seq = 0;
  const waiting = new Map<number, { head?: { status: number; headers: Record<string, string> }; ok(a: PageAnswer): void; fail(e: Error): void }>();
  const close = () => {
    if (closed) return;
    closed = true;
    pc.close();
    if (id) bridge.pageClose(id);
    for (const w of waiting.values()) w.fail(new Error('The direct page link closed.'));
    waiting.clear();
  };
  const assemble = pageAssembler();
  dc.onmessage = (e) => {
    if (typeof e.data === 'string') {
      let h: { id: number; error?: string; status?: number; headers?: Record<string, string>; size?: number };
      try {
        h = JSON.parse(e.data);
      } catch {
        return;
      }
      const w = waiting.get(h.id);
      if (!w) return;
      if (h.error) {
        waiting.delete(h.id);
        w.fail(new PageRefused(h.error));
      } else if (!h.size) {
        waiting.delete(h.id);
        w.ok({ status: h.status ?? 502, headers: h.headers ?? {}, body: new ArrayBuffer(0) });
      } else w.head = { status: h.status ?? 502, headers: h.headers ?? {} };
      return;
    }
    const done = assemble(new Uint8Array(e.data as ArrayBuffer));
    const w = done && waiting.get(done.id);
    if (!done || !w?.head) return;
    waiting.delete(done.id);
    w.ok({ ...w.head, body: done.body });
  };
  pc.onconnectionstatechange = () => {
    if (!closed && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
      close();
      onLost();
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const open = new Promise<void>((ok, fail) => {
      timer = setTimeout(() => fail(new Error('The direct page link did not connect in time.')), DIRECT_PAGE_TIMEOUT_MS);
      dc.onopen = () => ok();
    });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const answer = await bridge.pageOpen(pc.localDescription?.sdp ?? '');
    id = answer.id;
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    await open;
  } catch (e) {
    close();
    throw e;
  } finally {
    clearTimeout(timer);
  }
  return {
    close,
    fetch: (r) =>
      new Promise<PageAnswer>((ok, fail) => {
        if (closed || dc.readyState !== 'open') return fail(new Error('The direct page link closed.'));
        const n = ++seq;
        waiting.set(n, { ok, fail });
        dc.send(JSON.stringify({ id: n, method: r.method, path: r.path, headers: r.headers, body: r.body && r.body.byteLength ? toBase64(r.body) : '' }));
      }),
  };
}

/**
 * Carries one open page's requests to the bridge: straight away over the relay,
 * and over a direct link from when it connects. `onRoute` says which way they go.
 */
export function pageCarrier(bridge: PageBridge, onRoute: (route: PageRoute) => void = () => {}) {
  let direct: DirectPageLink | null = null;
  let stopped = false;
  let relayed = 0;
  const cache = conditionalCache();
  onRoute('connecting');
  if (bridge.pageOpen && bridge.pageClose && typeof RTCPeerConnection !== 'undefined') {
    openDirect(bridge as Required<PageBridge>, () => {
      direct = null;
      if (!stopped) onRoute('relay');
    })
      .then((d) => {
        if (stopped) return d.close();
        direct = d;
        onRoute('direct');
      })
      .catch(() => !stopped && onRoute('relay'));
  } else onRoute('relay');

  const viaRelay = async (r: PageRequest): Promise<PageAnswer> => {
    const kept = cache.answer(r, RELAY_RECHECK_MS);
    if (kept) return kept;
    if (relayed > RELAY_DATA_LIMIT) throw new PageLimit('Paused to save data: this page has used its share through the relay.');
    const a = await bridge.pageFetch(r);
    relayed += a.body.byteLength;
    cache.learn(r, a);
    return a;
  };
  return {
    async fetch(r: PageRequest): Promise<PageAnswer> {
      if (stopped) throw new Error('The page was closed.');
      if (direct) {
        const kept = cache.answer(r, DIRECT_RECHECK_MS);
        if (kept) return kept;
        try {
          const a = await direct.fetch(r);
          cache.learn(r, a);
          return a;
        } catch (e) {
          if (e instanceof PageRefused) throw e;
          // A link that dropped mid-request: the relay answers this one.
        }
      }
      return viaRelay(r);
    },
    close() {
      stopped = true;
      direct?.close();
      direct = null;
    },
  };
}
