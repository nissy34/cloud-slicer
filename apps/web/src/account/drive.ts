// Uploads a project straight from the page to the person's Google Drive (a
// trial: see functions/_lib/drive.ts). The file never passes through Cloud
// Slicer, so Cloudflare's 100 MB request limit doesn't apply. With the
// drive.file permission the app only sees files it made: the "Cloud Slicer"
// folder and the projects in it.
import { api, ApiError } from './api';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'Cloud Slicer';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';

let token: { accessToken: string; expiresAt: number } | null = null;
let folderId: string | null = null;

async function key(): Promise<string> {
  if (!token || token.expiresAt - Date.now() < 60_000) token = await api.driveToken();
  return token.accessToken;
}

/** Google's answer as an ApiError the save code understands; a full Drive says so. */
async function driveError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  const reason = body.error?.errors?.[0]?.reason;
  if (reason === 'storageQuotaExceeded') return new ApiError(res.status, 'Your Google Drive is full. Free some space in Drive, or keep projects in Cloud Slicer.', { code: 'drive-full' });
  if (res.status === 401) {
    token = null;
    return new ApiError(403, 'Google Drive needs connecting again, in Online projects', { code: 'drive-connect' });
  }
  return new ApiError(res.status, `Google Drive: ${body.error?.message ?? res.statusText}`, {});
}

async function drive(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await key()}` } });
  if (!res.ok) throw await driveError(res);
  return res;
}

/** The app's "Cloud Slicer" folder in their Drive, made the first time. */
async function folder(): Promise<string> {
  if (folderId) return folderId;
  const q = `name = '${FOLDER}' and mimeType = '${FOLDER_TYPE}' and trashed = false`;
  const found = (await (await drive(`${FILES}?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`)).json()) as { files: { id: string }[] };
  if (found.files[0]) return (folderId = found.files[0].id);
  const made = (await (
    await drive(`${FILES}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_TYPE }) })
  ).json()) as { id: string };
  return (folderId = made.id);
}

/**
 * Uploads the 3MF as a new file in the Cloud Slicer folder and returns its id.
 * A resumable upload: one request names the file, a second carries it.
 */
export async function uploadToDrive(file: Blob, name: string): Promise<string> {
  try {
    return await upload(file, name, await folder());
  } catch (e) {
    // The folder was deleted in Drive since: make it again.
    if (!(e instanceof ApiError && e.status === 404 && folderId)) throw e;
    folderId = null;
    return upload(file, name, await folder());
  }
}

async function upload(file: Blob, name: string, parent: string): Promise<string> {
  const start = await drive(`${UPLOAD}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'model/3mf', 'X-Upload-Content-Length': String(file.size) },
    body: JSON.stringify({ name: `${name}.3mf`, parents: [parent], mimeType: 'model/3mf' }),
  });
  const session = start.headers.get('Location');
  if (!session) throw new ApiError(502, "Google Drive didn't start the upload", {});
  const done = await fetch(session, { method: 'PUT', headers: { 'Content-Type': 'model/3mf' }, body: file });
  if (!done.ok) throw await driveError(done);
  return ((await done.json()) as { id: string }).id;
}
