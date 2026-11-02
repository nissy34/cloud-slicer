// Timelapse videos on the printer, for the Files card's Timelapses tab.
// Klipper printers with the moonraker-timelapse add-on keep them in Moonraker's
// "timelapse" folder, the Snapmaker U1 in its "camera" folder, and the bridge
// offers OctoPrint's as a "timelapse" folder too. A video is fetched whole, in
// Range pieces, and kept for the page's life so watching it again costs nothing.
// Through a bridge the pieces come over a direct link when one connects, else
// over the relay, which only takes videos up to RELAY_VIDEO_LIMIT; row pictures
// never go over the relay.
import type { PageAnswer, PageRequest } from './link/types';
import { LinkError } from './link/types';
import { openDirect, PageRefused, type DirectPageLink, type PageBridge } from './printer-page';

/** Moonraker folders that may hold timelapse videos, the add-on's first. */
export const TIMELAPSE_ROOTS = ['timelapse', 'camera'] as const;
export type TimelapseRoot = (typeof TIMELAPSE_ROOTS)[number];

export interface Timelapse {
  root: TimelapseRoot;
  /** Inside the root ("benchy_20261102.mp4"). */
  path: string;
  modified: number;
  size: number;
  /** The add-on's still picture beside the video ("benchy_20261102.jpg"), when there is one. */
  picture?: string;
}

/** Videos above this never go through the relay: only over a direct link. */
export const RELAY_VIDEO_LIMIT = 200 * 1024 * 1024;
/** A piece over a direct link (the bridge answers up to 8 MiB). */
export const DIRECT_PIECE = 4 * 1024 * 1024;
/** A piece over the relay: one relay message (the bridge answers up to 700 KiB there). */
export const RELAY_PIECE = 512 * 1024;
/** How long a direct link gets to connect before a video goes over the relay. */
export const DIRECT_WAIT_MS = 12_000;
/** A direct link with nothing to fetch closes after this long. */
const DIRECT_IDLE_MS = 60_000;

const VIDEO = /\.(mp4|webm|mkv|mov|avi)$/i;
const PICTURE = /\.(jpe?g|png)$/i;

/** Whether a phone's browser can play it (mp4 and webm; mkv, mov and avi only save). */
export function playable(path: string): boolean {
  return /\.(mp4|webm|m4v)$/i.test(path);
}

const base = (p: string) => p.replace(/\.[^./]+$/, '');

/** One folder's videos, newest first, each with its picture when the folder holds one of the same name. */
export function pickTimelapses(root: TimelapseRoot, files: { path: string; modified: number; size: number }[]): Timelapse[] {
  const pictures = new Map<string, string>();
  for (const f of files) if (PICTURE.test(f.path)) pictures.set(base(f.path), f.path);
  return files
    .filter((f) => VIDEO.test(f.path))
    .map((f) => {
      const picture = pictures.get(base(f.path));
      return { root, path: f.path, modified: f.modified, size: f.size, ...(picture ? { picture } : {}) };
    })
    .sort((a, b) => b.modified - a.modified);
}

/** Moonraker's address for a file in a folder. */
export function fileAddress(root: string, path: string): string {
  return `/server/files/${root}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Where a download is going: over a direct link, or through the relay. */
export type FileRoute = 'direct' | 'relay';

export interface DownloadOptions {
  onProgress?(fraction: number): void;
  onRoute?(route: FileRoute): void;
  signal?: AbortSignal;
  /** Never through the relay (row pictures). */
  directOnly?: boolean;
  /** The file's type, for the Blob. */
  type?: string;
}

/** The whole size a Range answer names ("bytes 0-3/10" → 10). */
export function rangeTotal(a: PageAnswer): number | null {
  const v = Object.entries(a.headers).find(([k]) => k.toLowerCase() === 'content-range')?.[1];
  const m = v && /\/(\d+)\s*$/.exec(v);
  return m ? Number(m[1]) : null;
}

/** Thrown when the bridge is too old to pass on timelapse files. */
const OLD_BRIDGE = 'Update the bridge to watch timelapses: Printers and bridges, then Update now.';

/**
 * Fetches files through a bridge, piece by piece: over one direct link shared
 * by every download (opened when first needed, closed when idle), else the relay.
 */
export class BridgeFiles {
  private direct: Promise<DirectPageLink | null> | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private busy = 0;
  private closed = false;

  constructor(private readonly bridge: PageBridge) {}

  private link(): Promise<DirectPageLink | null> {
    if (this.closed || !this.bridge.pageOpen || !this.bridge.pageClose || typeof RTCPeerConnection === 'undefined') return Promise.resolve(null);
    if (!this.direct) {
      this.direct = openDirect(this.bridge as Required<PageBridge>, () => (this.direct = null)).catch(() => {
        // Blocked this time; the next download tries again.
        setTimeout(() => (this.direct = null), 0);
        return null;
      });
    }
    return this.direct;
  }

  async download(path: string, size: number, o: DownloadOptions = {}): Promise<Blob> {
    this.busy++;
    clearTimeout(this.idle);
    try {
      return await this.fetchAll(path, size, o);
    } finally {
      if (--this.busy === 0) this.idle = setTimeout(() => this.dropDirect(), DIRECT_IDLE_MS);
    }
  }

  private async fetchAll(path: string, size: number, o: DownloadOptions): Promise<Blob> {
    const parts: Uint8Array[] = [];
    let got = 0;
    let total = size > 0 ? size : null;
    let direct = await this.link();
    let route: FileRoute | null = null;
    const say = (r: FileRoute) => r !== route && o.onRoute?.((route = r));
    const get = async (piece: number): Promise<PageAnswer> => {
      const req: PageRequest = { method: 'GET', path, headers: { Range: `bytes=${got}-${got + piece - 1}` } };
      return direct ? direct.fetch(req) : this.bridge.pageFetch(req);
    };
    while (total == null || got < total) {
      if (o.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (!direct) {
        if (o.directOnly) throw new LinkError('No direct link to the bridge.', 'blocked');
        if ((total ?? size) > RELAY_VIDEO_LIMIT) throw new LinkError('This video is too big to fetch away from home: open it on the same network as the printer.', 'blocked');
      }
      say(direct ? 'direct' : 'relay');
      let a: PageAnswer;
      try {
        a = await get(direct ? DIRECT_PIECE : RELAY_PIECE);
      } catch (e) {
        if (e instanceof PageRefused) throw new LinkError(/not part of a page/.test(e.message) ? OLD_BRIDGE : e.message, 'bridge');
        // The direct link dropped: carry on over the relay from here.
        if (direct) {
          direct = null;
          continue;
        }
        throw e;
      }
      if (a.status === 200 && got === 0) {
        // No Range support: the whole file in one answer.
        parts.push(new Uint8Array(a.body));
        got = a.body.byteLength;
        total = got;
        break;
      }
      if (a.status !== 206) throw new LinkError(a.status === 404 ? 'The video is no longer on the printer.' : `The printer answered HTTP ${a.status}.`, 'http');
      total ??= rangeTotal(a) ?? size;
      if (!a.body.byteLength) break;
      parts.push(new Uint8Array(a.body));
      got += a.body.byteLength;
      if (total) o.onProgress?.(Math.min(1, got / total));
    }
    return new Blob(parts as BlobPart[], { type: o.type ?? '' });
  }

  private dropDirect() {
    const d = this.direct;
    this.direct = null;
    void d?.then((l) => l?.close());
  }

  close() {
    this.closed = true;
    clearTimeout(this.idle);
    this.dropDirect();
  }
}

/** A video's type for the Blob, so the player knows it. */
export function videoType(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', avi: 'video/x-msvideo', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' } as Record<string, string>)[ext ?? ''] ?? '';
}

// Videos and pictures fetched this page's life, by printer, file and date: watching again costs nothing.
const kept = new Map<string, Promise<Blob>>();

export function keptDownload(key: string, fetch: () => Promise<Blob>): Promise<Blob> {
  let p = kept.get(key);
  if (!p) {
    p = fetch();
    kept.set(key, p);
    p.catch(() => kept.delete(key));
  }
  return p;
}

export function forgetDownload(key: string) {
  kept.delete(key);
}
