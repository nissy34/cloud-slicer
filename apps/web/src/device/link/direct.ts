// Straight from the browser to a printer's Moonraker. Works when the printer
// has an https address the browser can reach (or when this page itself is
// served over plain http, as in local development). Moonraker must list this
// site in [authorization] cors_domains for the HTTP calls.
import { i18n } from '../../i18n';
import { LinkError, type LinkHandlers, type PrinterLink, type RpcMessage } from './types';
import { rangeAnswer, rangeTotal, type RangeAnswer, type ReadOptions } from '../timelapse';

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
    return i18n.t('deviceLink.badAddress');
  }
  try {
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  const pageIsLocal = PRIVATE_HOST.test(page.hostname);
  if (page.protocol === 'https:' && printer.protocol === 'http:') {
    return i18n.t('deviceLink.plainHttp');
  }
  if (!pageIsLocal && PRIVATE_HOST.test(printer.hostname)) {
    return i18n.t('deviceLink.homeNetwork');
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
      if (r.status === 401 || r.status === 403) throw new LinkError(i18n.t('deviceLink.refusedKey'), 'auth');
      if (!r.ok) throw new LinkError(i18n.t('deviceLink.httpStatus', { status: r.status }), 'http');
      return r;
    } catch (e) {
      if (e instanceof LinkError) throw e;
      if ((e as Error).name === 'AbortError') throw new LinkError(i18n.t('deviceLink.printerTimeout'), 'timeout');
      throw new LinkError(
        i18n.t('deviceLink.corsHelp', { target: this.label, origin: globalThis.location?.origin ?? i18n.t('deviceLink.thisSite') }),
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
        reject(new LinkError(i18n.t('deviceLink.targetTimeout', { target: this.label }), 'timeout'));
      }, 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new LinkError(i18n.t('deviceLink.cannotOpen', { target: this.label }), 'network'));
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
          h.onClose(i18n.t('deviceLink.lost', { target: this.label }));
        }
      };
    });
  }

  send(msg: RpcMessage) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new LinkError(i18n.t('deviceLink.notConnectedShort'), 'network');
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
    const form = new FormData();
    form.append('root', 'gcodes');
    form.append('file', blob, path);
    // Outside a browser (the AI app add-on, apps/mcp) there is no XMLHttpRequest: fetch, without progress.
    if (typeof XMLHttpRequest === 'undefined') return this.fetchUpload(form, path, signal);
    // XMLHttpRequest rather than fetch: it reports upload progress.
    return new Promise((resolve, reject) => {
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
      xhr.onerror = () => reject(new LinkError(i18n.t('deviceLink.uploadFailed', { target: this.label }), 'network'));
      // A stopped upload leaves nothing on the printer: Moonraker drops an incomplete file.
      xhr.onabort = () => reject(new LinkError(i18n.t('deviceLink.uploadCancelled'), 'network'));
      if (signal?.aborted) return xhr.onabort(new ProgressEvent('abort'));
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(form);
    });
  }

  private async fetchUpload(form: FormData, path: string, signal?: AbortSignal): Promise<string> {
    let r: Response;
    try {
      r = await fetch(this.resolve('/server/files/upload'), { method: 'POST', headers: this.headers(), body: form, signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new LinkError(i18n.t('deviceLink.uploadCancelled'), 'network');
      throw new LinkError(i18n.t('deviceLink.uploadFailed', { target: this.label }), 'network');
    }
    const text = await r.text();
    if (!r.ok) throw new LinkError(uploadRefused(r.status, text), 'http');
    try {
      const body = JSON.parse(text) as { result?: { item?: { path?: string } }; item?: { path?: string } };
      return body.result?.item?.path ?? body.item?.path ?? path;
    } catch {
      return path;
    }
  }

  /** A piece of a file on the printer, asked with a Range header. */
  async readRange(path: string, start: number, end: number, options: ReadOptions = {}): Promise<RangeAnswer> {
    const blocked = directBlockedReason(this.baseUrl);
    if (blocked) throw new LinkError(blocked, 'blocked');
    let r: Response;
    try {
      r = await fetch(this.resolve(path), { headers: { ...this.headers(), Range: `bytes=${start}-${end}` }, signal: options.signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new LinkError(i18n.t('deviceLink.cannotReach', { target: this.label }), 'network');
    }
    const body = r.status === 200 || r.status === 206 ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array(0);
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    return rangeAnswer(r.status, body, rangeTotal({ status: r.status, headers, body: body.buffer }), start, end, 'direct');
  }

  mediaUrl(url: string): string | null {
    return directBlockedReason(this.baseUrl) ? null : this.resolve(url);
  }

  async snapshot(url: string): Promise<Blob> {
    const sep = url.includes('?') ? '&' : '?';
    const r = await this.fetch(`${url}${sep}_t=${Date.now()}`, { cache: 'no-store' }, 5000);
    const blob = await r.blob();
    if (!blob.size) throw new LinkError(i18n.t('deviceLink.emptyFrame'), 'http');
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
  return reason ? i18n.t('deviceLink.refusedFileWhy', { reason: reason.replace(/\.$/, ''), status }) : i18n.t('deviceLink.refusedFile', { status });
}
