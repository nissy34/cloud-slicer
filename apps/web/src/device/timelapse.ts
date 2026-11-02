// Timelapse videos on the printer, for the Files card's Timelapses tab.
// Klipper printers with the moonraker-timelapse add-on keep them in Moonraker's
// "timelapse" folder, the Snapmaker U1 in its "camera" folder, and the bridge
// offers OctoPrint's as a "timelapse" folder too. A video is fetched whole in
// fixed pieces (PIECE), a few at once, and kept for the page's life, so
// watching or downloading again costs nothing. Through a bridge the pieces come over a direct
// link when one connects, else over the relay, which only takes videos up to
// RELAY_VIDEO_LIMIT. Row pictures come either way (one small message each).
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
/** One piece of a video, the same over a direct link and the relay (one relay message: the bridge answers up to 700 KiB there). */
export const PIECE = 512 * 1024;
/** Pieces fetched at once for a download. */
const PARALLEL = 3;
/** How long a direct link gets to connect before a video goes over the relay. */
export const DIRECT_WAIT_MS = 12_000;
/** After a direct link drops, how long reads use the relay before trying a direct link again. */
const REOPEN_AFTER_MS = 20_000;
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

/** Where a piece came: over a direct link, or through the relay. */
export type FileRoute = 'direct' | 'relay';

export interface ReadOptions {
  /** Never through the relay (videos over RELAY_VIDEO_LIMIT). */
  directOnly?: boolean;
  signal?: AbortSignal;
}

/** Bytes `start`..`end` (inclusive) of a file, as far as the file goes; `total` its whole size when the printer said. */
export interface RangeAnswer {
  bytes: Uint8Array;
  total: number | null;
  route: FileRoute;
}

/** The whole size a Range answer names ("bytes 0-3/10" → 10). */
export function rangeTotal(a: PageAnswer): number | null {
  const v = Object.entries(a.headers).find(([k]) => k.toLowerCase() === 'content-range')?.[1];
  const m = v && /\/(\d+)\s*$/.exec(v);
  return m ? Number(m[1]) : null;
}

/** A printer's answer to a Range request, as a RangeAnswer (a printer that ignores Range sends it all). */
export function rangeAnswer(status: number, body: Uint8Array, total: number | null, start: number, end: number, route: FileRoute): RangeAnswer {
  if (status === 200) return { bytes: body.subarray(start, end + 1), total: body.length, route };
  if (status === 206) return { bytes: body, total, route };
  if (status === 416) return { bytes: new Uint8Array(0), total, route };
  throw new LinkError(status === 404 ? 'The video is no longer on the printer.' : `The printer answered HTTP ${status}.`, 'http');
}

const TOO_BIG = 'This video is too big to fetch through the relay. Open the app on the printer’s network to watch it.';

/** A stuck direct piece goes to the relay after this long. */
const DIRECT_PIECE_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, fail) => (t = setTimeout(() => fail(new Error('The direct link stalled.')), ms)))]).finally(() => clearTimeout(t));
}

/** Thrown when the bridge is too old to pass on timelapse files. */
const OLD_BRIDGE = 'Update the bridge to watch timelapses: Printers and bridges, then Update now.';

/**
 * Reads files through a bridge, a Range at a time: over one direct link shared
 * by every read (opened when first needed, closed when idle), else the relay.
 */
export class BridgeFiles {
  private direct: Promise<DirectPageLink | null> | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private busy = 0;
  private closed = false;

  constructor(private readonly bridge: PageBridge) {}

  /** When the last direct link dropped: until it is back, reads go over the relay without waiting for it. */
  private droppedAt = 0;

  private link(wait: boolean): Promise<DirectPageLink | null> {
    const shared = this.bridge.shared;
    if (this.closed || !shared || typeof RTCPeerConnection === 'undefined') return Promise.resolve(null);
    if (!this.direct) {
      // Right after a drop, don't try again on every piece.
      if (Date.now() - this.droppedAt < REOPEN_AFTER_MS && !wait) return Promise.resolve(null);
      const opening = openDirect(shared, () => {
        if (this.direct === opening) this.direct = null;
        this.droppedAt = Date.now();
      }).catch(() => {
        // Blocked this time; the next read tries again.
        if (this.direct === opening) this.direct = null;
        return null;
      });
      this.direct = opening;
    }
    if (this.droppedAt && !wait) {
      // A link coming back after a drop: use the relay until it is open.
      const d = this.direct;
      return Promise.race([d, Promise.resolve(null)]);
    }
    return this.direct;
  }

  async readRange(path: string, start: number, end: number, o: ReadOptions = {}): Promise<RangeAnswer> {
    this.busy++;
    clearTimeout(this.idle);
    try {
      const req: PageRequest = { method: 'GET', path, headers: { Range: `bytes=${start}-${end}` } };
      const direct = await this.link(!!o.directOnly);
      if (o.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      let a: PageAnswer | null = null;
      let route: FileRoute = 'direct';
      try {
        if (direct) a = await withTimeout(direct.fetch(req), DIRECT_PIECE_MS);
      } catch (e) {
        if (e instanceof PageRefused) throw new LinkError(/not part of a page/.test(e.message) ? OLD_BRIDGE : e.message, 'bridge');
        // The direct link dropped: the relay answers this one.
        this.direct = null;
        this.droppedAt = Date.now();
      }
      if (!a) {
        if (o.directOnly) throw new LinkError('No direct link to the bridge.', 'blocked');
        route = 'relay';
        try {
          a = await this.bridge.pageFetch(req);
        } catch (e) {
          if (e instanceof PageRefused || /not part of a page/.test((e as Error).message)) throw new LinkError(/not part of a page/.test((e as Error).message) ? OLD_BRIDGE : (e as Error).message, 'bridge');
          throw e;
        }
      }
      return rangeAnswer(a.status, new Uint8Array(a.body), rangeTotal(a), start, end, route);
    } finally {
      if (--this.busy === 0) this.idle = setTimeout(() => this.dropDirect(), DIRECT_IDLE_MS);
    }
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

/** A video's type, so the player knows it. */
export function videoType(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', avi: 'video/x-msvideo', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' } as Record<string, string>)[ext ?? ''] ?? '';
}

export type RangeReader = (start: number, end: number, o: ReadOptions) => Promise<RangeAnswer>;

/**
 * One file on the printer, read in PIECE-sized pieces kept for the page's
 * life: watching and Download share them.
 */
export class VideoSource {
  private pieces = new Map<number, Promise<Uint8Array>>();
  /** The way the last piece came. */
  route: FileRoute | null = null;
  onRoute?: (route: FileRoute) => void;

  constructor(
    private readonly read: RangeReader,
    public size: number,
    readonly type: string,
    private readonly directOnly = false,
  ) {}

  private piece(i: number): Promise<Uint8Array> {
    let p = this.pieces.get(i);
    if (!p) {
      const start = i * PIECE;
      // Big videos never go through the relay: only over a direct link.
      const directOnly = this.directOnly || this.size > RELAY_VIDEO_LIMIT;
      const big = !this.directOnly && this.size > RELAY_VIDEO_LIMIT;
      p = this.read(start, start + PIECE - 1, { directOnly }).then((a) => {
        if (a.total != null) this.size = a.total;
        if (a.route !== this.route) this.onRoute?.((this.route = a.route));
        return a.bytes;
      }, (e: Error) => {
        throw big && e instanceof LinkError && e.kind === 'blocked' ? new LinkError(TOO_BIG, 'blocked') : e;
      });
      this.pieces.set(i, p);
      p.catch(() => this.pieces.delete(i));
    }
    return p;
  }

  /** The whole file, a few pieces at a time. */
  async all(onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
    const first = await this.piece(0);
    const count = Math.max(1, Math.ceil(this.size / PIECE));
    const parts: Uint8Array[] = new Array(count);
    parts[0] = first;
    let done = 1;
    let next = 1;
    onProgress?.(done / count);
    const worker = async () => {
      while (next < count) {
        if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
        const i = next++;
        parts[i] = await this.piece(i);
        onProgress?.(++done / count);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return new Blob(parts as BlobPart[], { type: this.type });
  }
}

// Files read this page's life, by printer, file and date: watching again costs nothing.
const sources = new Map<string, VideoSource>();

export function videoSource(key: string, make: () => VideoSource): VideoSource {
  let s = sources.get(key);
  if (!s) {
    s = make();
    sources.set(key, s);
  }
  return s;
}

export function forgetSource(key: string) {
  sources.delete(key);
}
