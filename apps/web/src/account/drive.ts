// Projects live in the person's own Google Drive (functions/_lib/drive.ts):
// the page uploads each save straight there and downloads a project straight
// from there, so a project never passes through Cloud Slicer and isn't held to
// Cloudflare's 100 MB request limit. With the drive.file permission the app
// only sees files it made: the "Cloud Slicer" folder, its "Drafts" folder and
// the projects in them.
import { api, ApiError } from './api';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'Cloud Slicer';
/** AutoSave's drafts, inside the Cloud Slicer folder, so unnamed projects don't crowd it. */
const DRAFTS = 'Drafts';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
/** Upload pieces: Google wants multiples of 256 KB. 4 MB shows progress often enough on a phone. */
export const CHUNK = 16 * 256 * 1024;
/** Tries after a dropped connection, waiting 1, 2, 4, 8 and 16 s. */
const RETRIES = 5;

let token: { accessToken: string; expiresAt: number } | null = null;
const folders = new Map<string, string>();

async function key(): Promise<string> {
  if (!token || token.expiresAt - Date.now() < 60_000) token = await api.driveToken();
  return token.accessToken;
}

/** Google's answer as an ApiError the save code understands. */
async function driveError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  const reason = body.error?.errors?.[0]?.reason;
  if (reason === 'storageQuotaExceeded') return new ApiError(res.status, 'Your Google Drive is full. Free some space in Drive, then save again.', { code: 'drive-full' });
  if (res.status === 401) {
    token = null;
    return new ApiError(403, 'Google Drive needs connecting again, in the account menu', { code: 'drive-connect' });
  }
  return new ApiError(res.status, `Google Drive: ${body.error?.message ?? res.statusText}`, {});
}

async function drive(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await key()}` } });
  if (!res.ok) throw await driveError(res);
  return res;
}

/** A folder of the app's, made the first time (`parent`: inside that folder, else at the top of their Drive). */
async function folder(name: string, parent?: string): Promise<string> {
  const cacheKey = `${parent ?? ''}/${name}`;
  const known = folders.get(cacheKey);
  if (known) return known;
  const q = `name = '${name}' and mimeType = '${FOLDER_TYPE}' and trashed = false${parent ? ` and '${parent}' in parents` : ''}`;
  const found = (await (await drive(`${FILES}?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`)).json()) as { files: { id: string }[] };
  let id = found.files[0]?.id;
  if (!id) {
    const made = (await (
      await drive(`${FILES}?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_TYPE, ...(parent && { parents: [parent] }) }),
      })
    ).json()) as { id: string };
    id = made.id;
  }
  folders.set(cacheKey, id);
  return id;
}
const projectsFolder = async (draft: boolean) => {
  const top = await folder(FOLDER);
  return draft ? folder(DRAFTS, top) : top;
};

export interface UploadOptions {
  /** AutoSave's draft: it goes in Cloud Slicer/Drafts. */
  draft?: boolean;
  /** Bytes sent so far, of `total`. */
  onProgress?: (sent: number, total: number) => void;
}

/**
 * Uploads the 3MF as a new file in the Cloud Slicer folder (or its Drafts
 * folder) and returns its id. A resumable upload: one request names the file,
 * then it goes in 4 MB pieces, and a dropped connection carries on from the
 * last piece Google has.
 */
export async function uploadToDrive(file: Blob, name: string, opts: UploadOptions = {}): Promise<string> {
  try {
    return await upload(file, name, await projectsFolder(Boolean(opts.draft)), opts);
  } catch (e) {
    // A folder was deleted in Drive since: make it again.
    if (!(e instanceof ApiError && e.status === 404 && folders.size)) throw e;
    folders.clear();
    return upload(file, name, await projectsFolder(Boolean(opts.draft)), opts);
  }
}

async function upload(file: Blob, name: string, parent: string, opts: UploadOptions): Promise<string> {
  const start = await drive(`${UPLOAD}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'model/3mf', 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ name: `${name}.3mf`, parents: [parent], mimeType: 'model/3mf' }),
  });
  const session = start.headers.get('Location');
  if (!session) throw new ApiError(502, "Google Drive didn't start the upload", {});
  const total = file.size;
  let sent = 0;
  let tries = 0;
  opts.onProgress?.(0, total);
  for (;;) {
    const end = Math.min(sent + CHUNK, total);
    let res: Response;
    try {
      res = await fetch(session, {
        method: 'PUT',
        headers: { 'Content-Type': 'model/3mf', 'Content-Range': total ? `bytes ${sent}-${end - 1}/${total}` : 'bytes */0' },
        body: file.slice(sent, end),
      });
    } catch (e) {
      // The connection dropped: wait, ask Google how much it has, and go on from there.
      if (++tries > RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (tries - 1)));
      const at = await received(session, total).catch(() => null);
      if (typeof at === 'string') return at;
      if (at !== null) sent = at;
      continue;
    }
    if (res.ok) {
      opts.onProgress?.(total, total);
      return ((await res.json()) as { id: string }).id;
    }
    // 308: Google has the bytes its Range header names; the next piece starts after them.
    if (res.status !== 308) throw await driveError(res);
    sent = rangeEnd(res.headers.get('Range'));
    tries = 0;
    opts.onProgress?.(sent, total);
  }
}

/** How much of an interrupted upload Google has (bytes), or the file id when it already has all of it. */
async function received(session: string, total: number): Promise<number | string> {
  const res = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } });
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
  const gone = () => new ApiError(404, 'This project is no longer in your Google Drive', { code: 'drive-gone' });
  if (!fileId) throw gone();
  let res: Response;
  try {
    res = await drive(`${FILES}/${encodeURIComponent(fileId)}?alt=media`);
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
