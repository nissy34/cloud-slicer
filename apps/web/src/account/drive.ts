// Projects live in the person's own Google Drive (functions/_lib/drive.ts):
// the page uploads each save straight there and downloads a project straight
// from there, so a project never passes through Cloud Slicer and isn't held to
// Cloudflare's 100 MB request limit. With the drive.file permission the app
// only sees files it made: the "Cloud Slicer" folder and the projects in it.
import { i18n } from '../i18n';
import { api, ApiError, driveLost } from './api';
import { Cancelled, fetchWithin, TimedOut, unlessCancelled } from '../lib/time-limit';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'Cloud Slicer';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
/** Upload pieces: Google wants multiples of 256 KB. 4 MB shows progress often enough on a phone. */
export const CHUNK = 16 * 256 * 1024;
/** Tries after a dropped connection, waiting 1, 2, 4, 8 and 16 s. */
const RETRIES = 5;
/** Time limits: a stalled connection fails (or, for an upload piece, is tried again) instead of waiting for good (#276). */
const CALL_MS = 30_000;
/** One 4 MB piece: about 270 kbit/s at the slowest. */
const PIECE_MS = 120_000;
/** Where the person fixes it: the account menu (their name, top right) has Connect Google Drive then. */
const reconnect = () => i18n.t('accountErrors.driveReconnect');
const noAnswer = () => new ApiError(504, i18n.t('accountErrors.driveNoAnswer'), { code: 'timeout' });

let token: { accessToken: string; expiresAt: number } | null = null;
const folders = new Map<string, string>();
type KeySource = () => Promise<{ accessToken: string; expiresAt: number }>;
let keySource: KeySource = () => api.driveToken();

/** Where the Drive key comes from: the page asks the site with its sign-in; the AI app add-on (apps/mcp) with its own. */
export function setDriveKeySource(source: KeySource) {
  keySource = source;
  token = null;
}

async function key(signal?: AbortSignal): Promise<string> {
  if (!token || token.expiresAt - Date.now() < 60_000) token = await unlessCancelled(keySource(), signal);
  return token.accessToken;
}

/** Google's answer as an ApiError the save code understands. */
async function driveError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  const reason = body.error?.errors?.[0]?.reason;
  if (reason === 'storageQuotaExceeded') return new ApiError(res.status, i18n.t('accountErrors.driveFull'), { code: 'drive-full' });
  if (res.status === 401) {
    token = null;
    driveLost();
    return new ApiError(403, reconnect(), { code: 'drive-connect' });
  }
  return new ApiError(res.status, `Google Drive: ${body.error?.message ?? res.statusText}`, {});
}

/** A Drive call; its answer (and body, read straight after) within `ms`. `signal`: Cancel. */
async function drive(url: string, init: RequestInit = {}, signal?: AbortSignal, ms = CALL_MS): Promise<Response> {
  const headers = { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await key(signal)}` };
  let res: Response;
  try {
    res = await fetchWithin(ms, url, { ...init, headers }, signal);
  } catch (e) {
    throw e instanceof TimedOut ? noAnswer() : e;
  }
  if (!res.ok) throw await driveError(res);
  return res;
}

/** A folder of the app's, made the first time (`parent`: inside that folder, else at the top of their Drive). */
async function folder(name: string, parent?: string, signal?: AbortSignal): Promise<string> {
  const cacheKey = `${parent ?? ''}/${name}`;
  const known = folders.get(cacheKey);
  if (known) return known;
  const q = `name = '${name}' and mimeType = '${FOLDER_TYPE}' and trashed = false${parent ? ` and '${parent}' in parents` : ''}`;
  const found = (await (await drive(`${FILES}?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`, {}, signal)).json()) as {
    files: { id: string }[];
  };
  let id = found.files[0]?.id;
  if (!id) {
    const made = (await (
      await drive(`${FILES}?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_TYPE, ...(parent && { parents: [parent] }) }),
      }, signal)
    ).json()) as { id: string };
    id = made.id;
  }
  folders.set(cacheKey, id);
  return id;
}
export interface UploadOptions {
  /** Bytes sent so far, of `total`. */
  onProgress?: (sent: number, total: number) => void;
  /** Cancel: the upload stops, and Google drops what it had (no file is made). */
  signal?: AbortSignal;
}

/**
 * Uploads the 3MF as a new file in the Cloud Slicer folder and returns its id. A resumable upload: one request names the file,
 * then it goes in 4 MB pieces, and a dropped connection carries on from the
 * last piece Google has.
 */
export async function uploadToDrive(file: Blob, name: string, opts: UploadOptions = {}): Promise<string> {
  let id: string;
  try {
    id = await upload(file, name, await folder(FOLDER, undefined, opts.signal), opts);
  } catch (e) {
    // A folder was deleted in Drive since: make it again.
    if (!(e instanceof ApiError && e.status === 404 && folders.size)) throw e;
    folders.clear();
    id = await upload(file, name, await folder(FOLDER, undefined, opts.signal), opts);
  }
  // Cancelled as the last piece went in: the file isn't kept.
  if (opts.signal?.aborted) {
    void drive(`${FILES}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    throw new Cancelled();
  }
  return id;
}

async function upload(file: Blob, name: string, parent: string, opts: UploadOptions): Promise<string> {
  const { signal } = opts;
  const start = await drive(
    `${UPLOAD}?uploadType=resumable&fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'model/3mf', 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify({ name: `${name}.3mf`, parents: [parent], mimeType: 'model/3mf' }),
    },
    signal,
  );
  const session = start.headers.get('Location');
  if (!session) throw new ApiError(502, i18n.t('accountErrors.driveNoUpload'), {});
  const total = file.size;
  let sent = 0;
  let tries = 0;
  opts.onProgress?.(0, total);
  for (;;) {
    const end = Math.min(sent + CHUNK, total);
    let res: Response;
    let id: string | undefined;
    try {
      res = await fetchWithin(
        PIECE_MS,
        session,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'model/3mf', 'Content-Range': total ? `bytes ${sent}-${end - 1}/${total}` : 'bytes */0' },
          body: file.slice(sent, end),
        },
        signal,
      );
      if (res.ok) id = ((await res.json()) as { id: string }).id;
    } catch (e) {
      if (e instanceof Cancelled) {
        // Google drops an upload whose session is deleted.
        void fetch(session, { method: 'DELETE' }).catch(() => {});
        throw e;
      }
      // The connection dropped or stalled: wait, ask Google how much it has, and go on from there.
      if (++tries > RETRIES) throw e instanceof TimedOut ? noAnswer() : e;
      await unlessCancelled(new Promise((r) => setTimeout(r, 1000 * 2 ** (tries - 1))), signal);
      const at = await received(session, total, signal).catch((err) => {
        if (err instanceof Cancelled) throw err;
        return null;
      });
      if (typeof at === 'string') return at;
      if (at !== null) sent = at;
      continue;
    }
    if (id !== undefined) {
      opts.onProgress?.(total, total);
      return id;
    }
    // 308: Google has the bytes its Range header names; the next piece starts after them.
    if (res.status !== 308) throw await driveError(res);
    sent = rangeEnd(res.headers.get('Range'));
    tries = 0;
    opts.onProgress?.(sent, total);
  }
}

/** How much of an interrupted upload Google has (bytes), or the file id when it already has all of it. */
async function received(session: string, total: number, signal?: AbortSignal): Promise<number | string> {
  const res = await fetchWithin(CALL_MS, session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } }, signal);
  if (res.ok) return ((await res.json()) as { id: string }).id;
  if (res.status !== 308) throw await driveError(res);
  return rangeEnd(res.headers.get('Range'));
}

/** "bytes=0-4194303" -> 4194304 (no header: nothing received yet). */
export function rangeEnd(range: string | null): number {
  const m = /bytes=0-(\d+)/.exec(range ?? '');
  return m ? Number(m[1]) + 1 : 0;
}

/** How big a download will be: Drive's own length when it is the file's (not compressed), else the size we keep. */
export function downloadTotal(headers: Headers, size: number): number {
  const length = headers.get('Content-Encoding') ? 0 : Number(headers.get('Content-Length') ?? 0);
  return length > 0 ? length : Math.max(0, size || 0);
}

/** The project is no longer in their Drive (deleted, or in the bin and emptied). */
export const driveGone = (e: unknown) => e instanceof ApiError && e.body.code === 'drive-gone';

/**
 * A project's 3MF, straight from their Drive. `onProgress`: bytes so far, of `total` (0 when unknown).
 * `size`: the size the list keeps for it, used when Drive doesn't say (it often sends the file compressed).
 */
export async function downloadFromDrive(
  fileId: string | null,
  onProgress?: (loaded: number, total: number) => void,
  size = 0,
): Promise<ArrayBuffer> {
  const gone = () => new ApiError(404, i18n.t('accountErrors.driveGone'), { code: 'drive-gone' });
  if (!fileId) throw gone();
  let res: Response;
  try {
    // No time limit: a big project takes as long as it takes to come down.
    res = await drive(`${FILES}/${encodeURIComponent(fileId)}?alt=media`, {}, undefined, Infinity);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw gone();
    throw e;
  }
  if (!onProgress || !res.body) return res.arrayBuffer();
  const total = downloadTotal(res.headers, size);
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    chunks.push(r.value);
    loaded += r.value.byteLength;
    // A file a little bigger than the list said: the bar stays full rather than going past.
    onProgress(loaded, total && Math.max(total, loaded));
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes.buffer;
}

/**
 * The ids of the app's project files still in their Drive (not in the bin).
 * One call for the whole list: a project whose file isn't among them was deleted in Drive.
 */
export async function filesInDrive(): Promise<Set<string>> {
  const ids = new Set<string>();
  let page: string | undefined;
  do {
    const q = new URLSearchParams({ q: `trashed = false and mimeType != '${FOLDER_TYPE}'`, fields: 'nextPageToken,files(id)', pageSize: '1000', spaces: 'drive' });
    if (page) q.set('pageToken', page);
    const res = (await (await drive(`${FILES}?${q}`)).json()) as { files: { id: string }[]; nextPageToken?: string };
    for (const f of res.files) ids.add(f.id);
    page = res.nextPageToken;
  } while (page);
  return ids;
}
