// Through the LAN bridge: the browser holds one websocket to the relay (a
// Cloudflare Durable Object), which pipes it to the bridge agent running on a
// computer next to the printer, which pipes it to the printer's Moonraker.
// The relay is a dumb pipe, so this speaks plain Moonraker JSON-RPC; upload
// and camera frames become bridge.* calls the agent answers itself.
import type { DirectCamera } from '../camera';
import { LinkError, type BridgeStatus, type DirectAnswer, type LinkHandlers, type PageAnswer, type PageRequest, type PrinterLink, type RpcMessage } from './types';
import { DirectUploadRefused, UPLOAD_CHUNK, UPLOAD_PIECE, encodePiece, gzipped, offerDirectUpload } from './upload';

export interface BridgeTarget {
  relay: string;
  bridgeId: string;
  key: string;
  /** Printer id in the agent's list; empty to only ask the bridge what it has. */
  printer: string;
  /**
   * The site's ticket for this bridge (signed-in accounts only), or null when
   * the site doesn't use tickets. Throws a LinkError when the account may not.
   */
  ticket?: () => Promise<{ ticket: string; expiresAt: number } | null>;
}

type TicketSource = (relay: string, bridgeId: string) => Promise<{ ticket: string; expiresAt: number } | null>;
let ticketSource: TicketSource | null = null;
/** Where every bridge link gets its relay tickets (the account store sets it), unless its target has its own. */
export function setBridgeTickets(source: TicketSource) {
  ticketSource = source;
}

/** The relay's close code for a bridge that was removed on its own computer. */
export const BRIDGE_REMOVED = 4410;
let removedListener: ((relay: string, bridgeId: string) => void) | null = null;
/** Told when the relay says a bridge was removed on its own computer (the device store tidies up the list). */
export function onBridgeRemoved(fn: (relay: string, bridgeId: string) => void) {
  removedListener = fn;
}

export function bridgeSocketUrl(t: BridgeTarget, ticket?: string): string {
  const base = t.relay.replace(/\/+$/, '').replace(/^http/i, 'ws');
  const q = new URLSearchParams({ key: t.key });
  if (t.printer) q.set('printer', t.printer);
  if (ticket) q.set('ticket', ticket);
  return `${base}/v1/bridges/${encodeURIComponent(t.bridgeId)}/client?${q}`;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class BridgeLink implements PrinterLink {
  private ws: WebSocket | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  readonly label = 'through the bridge';

  constructor(readonly target: BridgeTarget) {}

  async open(h: LinkHandlers): Promise<void> {
    const t = await this.fetchTicket();
    await this.connect(h, t?.ticket);
    if (t) this.renewBefore(t.expiresAt);
  }

  private fetchTicket() {
    const { ticket, relay, bridgeId } = this.target;
    if (ticket) return ticket();
    return ticketSource ? ticketSource(relay, bridgeId) : Promise.resolve(null);
  }

  /** Renews the ticket over the open socket ten minutes before it runs out. */
  private renewBefore(expiresAt: number) {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = setTimeout(async () => {
      const ws = this.ws;
      try {
        const t = await this.fetchTicket();
        if (!t || this.ws !== ws || !ws) return;
        ws.send(JSON.stringify({ relay: 'ticket', ticket: t.ticket }));
        this.renewBefore(t.expiresAt);
      } catch {
        // the relay closes the socket when the old one runs out, and the session reconnects
      }
    }, Math.max(30_000, expiresAt - Date.now() - 10 * 60_000));
  }

  private connect(h: LinkHandlers, ticket?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(bridgeSocketUrl(this.target, ticket));
      let opened = false;
      const timer = setTimeout(() => {
        ws.close();
        reject(new LinkError('The bridge relay did not answer in time.', 'timeout'));
      }, 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        opened = true;
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        if (!opened) reject(new LinkError('Could not reach the bridge relay.', 'bridge'));
      };
      ws.onmessage = (ev) => {
        let msg: RpcMessage;
        try {
          msg = JSON.parse(String(ev.data)) as RpcMessage;
        } catch {
          return;
        }
        // Answers to our own bridge.* calls carry string ids.
        if (typeof msg.id === 'string' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new LinkError(msg.error.message ?? 'Bridge error', 'bridge'));
          else p.resolve(msg.result);
          return;
        }
        if (msg.method === 'notify_bridge_status') {
          h.onBridge?.((msg.params as BridgeStatus[])[0]);
          return;
        }
        h.onMessage(msg);
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new LinkError('The bridge connection closed.', 'bridge'));
        }
        this.pending.clear();
        if (ev.code === BRIDGE_REMOVED) removedListener?.(this.target.relay, this.target.bridgeId);
        if (!opened) {
          reject(new LinkError(ev.reason || 'The relay refused this bridge. Check the pairing code.', 'auth'));
        } else if (this.ws === ws) {
          this.ws = null;
          h.onClose(ev.reason || 'Lost the connection to the bridge relay.');
        }
      };
    });
  }

  send(msg: RpcMessage) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new LinkError('Not connected.', 'network');
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  /** A call the bridge answers itself, such as adding a printer to it (bridge.add_printer). */
  manage<T>(method: `bridge.${string}`, params: unknown, timeoutMs = 20_000): Promise<T> {
    return this.call<T>(method, params, timeoutMs);
  }

  /** A call the relay answers itself, such as this browser's print alerts (relay.alerts). Works with the bridge offline. */
  relay<T>(method: `relay.${string}`, params: unknown, timeoutMs = 20_000): Promise<T> {
    return this.call<T>(method, params, timeoutMs);
  }

  private call<T>(method: string, params: unknown, timeoutMs = 30_000, bytes?: Uint8Array): Promise<T> {
    const id = `b${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LinkError(`${method} timed out.`, 'timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        const msg = { jsonrpc: '2.0', id, method, params };
        // An upload piece goes as raw bytes behind its JSON header.
        this.ws?.send(bytes ? encodePiece(msg, bytes) : JSON.stringify(msg));
        if (!this.ws) throw new Error();
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new LinkError('Not connected.', 'network'));
      }
    });
  }

  async upload(blob: Blob, path: string, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<string> {
    const cancelled = () => new LinkError('Upload cancelled.', 'network');
    const zip = await gzipped(blob);
    const wire = zip ?? blob;
    const direct = await offerDirectUpload();
    if (signal?.aborted) {
      direct?.close();
      throw cancelled();
    }
    let start: { uploadId: string; sdp?: string };
    try {
      start = await this.call('bridge.upload_start', { path, size: blob.size, wire: wire.size, zipped: !!zip, sdp: direct?.sdp ?? '' }, 15_000);
    } catch (e) {
      direct?.close();
      // A bridge from before zipped uploads.
      if (e instanceof LinkError && e.message.startsWith('Unknown bridge call')) return this.uploadAsIs(blob, path, onProgress, signal);
      throw e;
    }
    const { uploadId } = start;
    // Stopping: the bridge drops the upload, so Moonraker gets an incomplete file and keeps nothing.
    const stop = () => {
      direct?.close();
      this.call('bridge.upload_cancel', { uploadId }, 5000).catch(() => {});
    };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      if (signal?.aborted) {
        // Stopped while the bridge was opening it.
        stop();
        throw cancelled();
      }
      const progress = (sent: number) => onProgress?.(Math.min(1, sent / Math.max(1, wire.size)));
      if (direct && start.sdp) {
        try {
          return await direct.send(start.sdp, wire, progress);
        } catch (e) {
          if (signal?.aborted) throw cancelled();
          if (e instanceof DirectUploadRefused) throw new LinkError(e.message, 'bridge');
          // The link didn't connect or dropped: carry on over the relay from what arrived.
        } finally {
          direct.close();
        }
      } else direct?.close();
      let { received } = await this.call<{ received: number }>('bridge.upload_resume', { uploadId });
      const binary = (await this.relayInfo()).binary === true;
      const piece = binary ? UPLOAD_PIECE : UPLOAD_CHUNK;
      while (received < wire.size) {
        if (signal?.aborted) throw cancelled();
        const bytes = new Uint8Array(await wire.slice(received, received + piece).arrayBuffer());
        const params = { uploadId, offset: received };
        if (binary) await this.call('bridge.upload_piece', params, 120_000, bytes);
        else await this.call('bridge.upload_chunk', { ...params, data: toBase64(bytes) }, 60_000);
        received += bytes.length;
        progress(received);
      }
      if (signal?.aborted) throw cancelled();
      const done = await this.call<{ path: string }>('bridge.upload_end', { uploadId }, 300_000);
      return done.path;
    } catch (e) {
      throw signal?.aborted ? cancelled() : e;
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }

  /** The file as it is, in base64 chunks, one at a time: for a bridge from before zipped uploads. */
  private async uploadAsIs(blob: Blob, path: string, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<string> {
    const { uploadId } = await this.call<{ uploadId: string }>('bridge.upload_begin', { path, size: blob.size });
    for (let offset = 0; offset < blob.size || offset === 0; offset += UPLOAD_CHUNK) {
      // Such a bridge drops the half-sent file when this browser leaves.
      if (signal?.aborted) throw new LinkError('Upload cancelled.', 'network');
      const bytes = new Uint8Array(await blob.slice(offset, offset + UPLOAD_CHUNK).arrayBuffer());
      await this.call('bridge.upload_chunk', { uploadId, offset, data: toBase64(bytes) });
      onProgress?.(Math.min(1, (offset + bytes.length) / Math.max(1, blob.size)));
      if (!blob.size) break;
    }
    const done = await this.call<{ path: string }>('bridge.upload_end', { uploadId }, 300_000);
    return done.path;
  }

  private info: Promise<{ pages?: string; binary?: boolean }> | null = null;
  /** The relay's /v1/info, asked once per link: where pages are held, and whether it passes raw upload pieces on. */
  private relayInfo() {
    const relay = this.target.relay.replace(/\/+$/, '');
    this.info ??= fetch(`${relay}/v1/info`)
      .then((r) => r.json() as Promise<{ pages?: string; binary?: boolean }>)
      .catch(() => ({}));
    return this.info;
  }

  /** The browser can't reach the printer's network: cameras come as single frames only. */
  mediaUrl(): string | null {
    return null;
  }

  async snapshot(url: string): Promise<Blob> {
    const r = await this.call<{ contentType: string; data: string }>('bridge.snapshot', { url }, 8000);
    return new Blob([fromBase64(r.data) as BlobPart], { type: r.contentType || 'image/jpeg' });
  }

  cameraOpen(camera: DirectCamera, sdp: string): Promise<DirectAnswer> {
    // The bridge first tries the camera's own live video, which can take a few seconds.
    return this.call<DirectAnswer>('bridge.camera_open', { ...camera, sdp }, 15_000);
  }

  cameraClose(id: string) {
    this.call('bridge.camera_close', { id }, 5000).catch(() => {});
  }

  /**
   * Printer pages are held on the relay's own address, away from the site; a
   * relay on a name next to the site's says where else to hold them (/v1/info "pages").
   */
  async pageHolder(): Promise<string> {
    const info = await this.relayInfo();
    if (info.pages && /^https?:\/\//.test(info.pages)) {
      try {
        return new URL(info.pages).origin;
      } catch {
        // not an address: the relay's own
      }
    }
    return this.target.relay.replace(/\/+$/, '');
  }

  async pageFetch(req: PageRequest): Promise<PageAnswer> {
    const body = req.body && req.body.byteLength ? toBase64(new Uint8Array(req.body)) : '';
    const r = await this.call<{ status: number; headers?: Record<string, string>; data?: string }>(
      'bridge.page_fetch',
      { method: req.method, path: req.path, headers: req.headers, body },
      20_000,
    );
    const bytes = fromBase64(r.data ?? '');
    return { status: r.status, headers: r.headers ?? {}, body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  }

  pageOpen(sdp: string): Promise<{ id: string; sdp: string }> {
    return this.call('bridge.page_open', { sdp }, 15_000);
  }

  pageClose(id: string) {
    this.call('bridge.page_close', { id }, 5000).catch(() => {});
  }
}
