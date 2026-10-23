// Straight from the browser to a printer's Moonraker. Works when the printer
// has an https address the browser can reach (or when this page itself is
// served over plain http, as in local development). Moonraker must list this
// site in [authorization] cors_domains for the HTTP calls.
import { LinkError, type LinkHandlers, type PrinterLink, type RpcMessage } from './types';

/** "printer.example.com" -> "https://printer.example.com"; trailing slashes dropped. */
export function normalizePrinterUrl(raw: string, pageProtocol = globalThis.location?.protocol ?? 'https:'): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `${pageProtocol === 'http:' ? 'http' : 'https'}://${url}`;
  return url.replace(/\/+$/, '');
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?fe80:|\[?fd|[^.]+$|.+\.local$)/i;

/**
 * Why the browser will refuse to talk to this address from this page, or null.
 * An https page can't reach plain-http printers (mixed content), and browsers
 * increasingly block public pages from reaching private network addresses.
 */
export function directBlockedReason(printerUrl: string, pageUrl = globalThis.location?.href ?? ''): string | null {
  let printer: URL, page: URL;
  try {
    printer = new URL(printerUrl);
  } catch {
    return 'That is not a valid address.';
  }
  try {
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  const pageIsLocal = PRIVATE_HOST.test(page.hostname);
  if (page.protocol === 'https:' && printer.protocol === 'http:') {
    return 'This printer only has a plain http address, which a secure page cannot reach. Connect it through the bridge instead.';
  }
  if (!pageIsLocal && PRIVATE_HOST.test(printer.hostname)) {
    return 'This is an address on your home network, which the browser will not let a public site reach. Connect it through the bridge instead.';
  }
  return null;
}

function sameHost(a: string, b: string) {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

export class DirectLink implements PrinterLink {
  private ws: WebSocket | null = null;
  readonly label: string;

  constructor(
    readonly baseUrl: string,
    private readonly apiKey = '',
  ) {
    this.label = (() => {
      try {
        return new URL(baseUrl).host;
      } catch {
        return baseUrl;
      }
    })();
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { 'X-Api-Key': this.apiKey } : {};
  }

  private async fetch(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
    const blocked = directBlockedReason(this.baseUrl);
    if (blocked) throw new LinkError(blocked, 'blocked');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const url = this.resolve(path);
      // The API key only goes to the printer's own host, never to a camera elsewhere.
      const key = sameHost(url, this.baseUrl) ? this.headers() : {};
      const r = await fetch(url, { ...init, headers: { ...key, ...(init.headers ?? {}) }, signal: ac.signal });
      if (r.status === 401 || r.status === 403) throw new LinkError('The printer refused the API key.', 'auth');
      if (!r.ok) throw new LinkError(`The printer answered HTTP ${r.status}.`, 'http');
      return r;
    } catch (e) {
      if (e instanceof LinkError) throw e;
      if ((e as Error).name === 'AbortError') throw new LinkError('The printer did not answer in time.', 'timeout');
      throw new LinkError(
        `Could not reach ${this.label}. Check that it is on, and that moonraker.conf lists this site under [authorization] cors_domains (${location.origin}), then restart Moonraker.`,
        'network',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Relative paths resolve against the printer; absolute ones must stay on its host. */
  resolve(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
  }

  async open(h: LinkHandlers): Promise<void> {
    let url = this.baseUrl.replace(/^http/i, 'ws') + '/websocket';
    if (this.apiKey) {
      const r = await this.fetch('/access/oneshot_token');
      const body = (await r.json()) as { result?: string };
      url += `?token=${encodeURIComponent(body.result ?? '')}`;
    } else {
      const blocked = directBlockedReason(this.baseUrl);
      if (blocked) throw new LinkError(blocked, 'blocked');
    }
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new LinkError(`${this.label} did not answer in time.`, 'timeout'));
      }, 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new LinkError(`Could not open a connection to ${this.label}.`, 'network'));
      };
      ws.onmessage = (ev) => {
        try {
          h.onMessage(JSON.parse(String(ev.data)) as RpcMessage);
        } catch {
          // not JSON: ignore
        }
      };
      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          h.onClose(`Lost the connection to ${this.label}.`);
        }
      };
    });
  }

  send(msg: RpcMessage) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new LinkError('Not connected.', 'network');
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  upload(blob: Blob, path: string, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<string> {
    const blocked = directBlockedReason(this.baseUrl);
    if (blocked) return Promise.reject(new LinkError(blocked, 'blocked'));
    // XMLHttpRequest rather than fetch: it reports upload progress.
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('root', 'gcodes');
      form.append('file', blob, path);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', this.resolve('/server/files/upload'));
      for (const [k, v] of Object.entries(this.headers())) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const body = JSON.parse(xhr.responseText) as { result?: { item?: { path?: string } }; item?: { path?: string } };
            resolve(body.result?.item?.path ?? body.item?.path ?? path);
          } catch {
            resolve(path);
          }
        } else {
          reject(new LinkError(uploadRefused(xhr.status, xhr.responseText), 'http'));
        }
      };
      xhr.onerror = () => reject(new LinkError(`Upload to ${this.label} failed.`, 'network'));
      // A stopped upload leaves nothing on the printer: Moonraker drops an incomplete file.
      xhr.onabort = () => reject(new LinkError('Upload cancelled.', 'network'));
      if (signal?.aborted) return xhr.onabort(new ProgressEvent('abort'));
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(form);
    });
  }

  mediaUrl(url: string): string | null {
    return directBlockedReason(this.baseUrl) ? null : this.resolve(url);
  }

  async snapshot(url: string): Promise<Blob> {
    const sep = url.includes('?') ? '&' : '?';
    const r = await this.fetch(`${url}${sep}_t=${Date.now()}`, { cache: 'no-store' }, 5000);
    const blob = await r.blob();
    if (!blob.size) throw new LinkError('The camera sent an empty frame.', 'http');
    return blob;
  }
}

/** Why Moonraker refused an upload, in its own words when it gave them: "The printer refused the file: Forbidden (HTTP 403)." */
export function uploadRefused(status: number, body: string): string {
  let reason = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    reason = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? '');
  } catch {
    // not JSON: the status says enough
  }
  return reason ? `The printer refused the file: ${reason.replace(/\.$/, '')} (HTTP ${status}).` : `The printer refused the file (HTTP ${status}).`;
}
