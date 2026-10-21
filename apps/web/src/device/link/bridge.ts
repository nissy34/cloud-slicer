// Through the LAN bridge: the browser holds one websocket to the relay (a
// Cloudflare Durable Object), which pipes it to the bridge agent running on a
// computer next to the printer, which pipes it to the printer's Moonraker.
// The relay is a dumb pipe, so this speaks plain Moonraker JSON-RPC; upload
// and camera frames become bridge.* calls the agent answers itself.
import { LinkError, type BridgeStatus, type LinkHandlers, type PrinterLink, type RpcMessage } from './types';

/** Chunk size for uploads: well under the relay's 1 MiB message limit once base64-encoded. */
export const UPLOAD_CHUNK = 512 * 1024;

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

  private call<T>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    const id = `b${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LinkError(`${method} timed out.`, 'timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.ws?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        if (!this.ws) throw new Error();
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new LinkError('Not connected.', 'network'));
      }
    });
  }

  async upload(blob: Blob, path: string, onProgress?: (f: number) => void): Promise<string> {
    const { uploadId } = await this.call<{ uploadId: string }>('bridge.upload_begin', { path, size: blob.size });
    for (let offset = 0; offset < blob.size || offset === 0; offset += UPLOAD_CHUNK) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + UPLOAD_CHUNK).arrayBuffer());
      await this.call('bridge.upload_chunk', { uploadId, offset, data: toBase64(bytes) });
      onProgress?.(Math.min(1, (offset + bytes.length) / Math.max(1, blob.size)));
      if (!blob.size) break;
    }
    const done = await this.call<{ path: string }>('bridge.upload_end', { uploadId }, 300_000);
    return done.path;
  }

  /** The browser can't reach the printer's network: cameras come as single frames only. */
  mediaUrl(): string | null {
    return null;
  }

  async snapshot(url: string): Promise<Blob> {
    const r = await this.call<{ contentType: string; data: string }>('bridge.snapshot', { url }, 8000);
    return new Blob([fromBase64(r.data) as BlobPart], { type: r.contentType || 'image/jpeg' });
  }
}
