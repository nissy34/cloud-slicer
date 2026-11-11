// Projects are kept in the person's own Google Drive, and nowhere else: the
// site has no project storage of its own. Only the drive.file permission is
// asked for: the app sees the files it made and nothing else in their Drive,
// and Google needs no security review for it.
//
// The page uploads the 3MF straight to Drive and downloads it from there
// (src/account/drive.ts), so a project never passes through us and isn't held
// to Cloudflare's 100 MB request limit. The projects row points at the file
// with file_key "drive:<file id>" and keeps its MD5, so a save notices when the
// file was changed in Drive since (another app, Drive for desktop). The server
// uses the permission to check a save arrived, and to rename and delete files.
import { createAuth, db, requireUser } from './auth';
import { HttpError, json, requireSameOrigin } from './http';
import type { Env } from './types';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const PREFIX = 'drive:';

export const isDriveKey = (key: string) => key.startsWith(PREFIX);
export const driveKey = (fileId: string) => PREFIX + fileId;
/** The Drive file id of a project's file_key, or null when it isn't in Drive. */
export const fileIdOf = (key: string) => (isDriveKey(key) ? key.slice(PREFIX.length) : null);
/** Drive file ids are letters, digits, - and _. */
export const validDriveId = (v: string | null) => (v && /^[A-Za-z0-9_-]{8,200}$/.test(v) ? v : null);

/** Scopes as Better Auth stores them: comma separated (Google's own are space separated). */
export const hasDriveScope = (scope: string | null | undefined) => (scope ?? '').split(/[\s,]+/).includes(DRIVE_SCOPE);

/** Not connected, or Google no longer accepts the app's key: the page offers "Connect Google Drive". */
const notConnected = (message = 'Connect Google Drive first, in the account menu') => new HttpError(403, message, { code: 'drive-connect' });
/** The page then shows Connect Google Drive in the account menu again (src/state/account.ts driveLost). */
const RECONNECT = 'Google Drive needs connecting again. Open the account menu (top right) and press Connect Google Drive.';

async function googleAccount(env: Env, userId: string) {
  return db(env)
    .prepare(`SELECT id, scope FROM "account" WHERE "userId" = ? AND "providerId" = 'google' ORDER BY "createdAt" LIMIT 1`)
    .bind(userId)
    .first<{ id: string; scope: string | null }>();
}

export async function driveConnected(env: Env, userId: string): Promise<boolean> {
  return hasDriveScope((await googleAccount(env, userId))?.scope);
}

/** A key for the person's Drive, refreshed by Better Auth when it has run out (about an hour each). */
export async function driveToken(env: Env, request: Request, userId: string): Promise<{ accessToken: string; expiresAt: number }> {
  const account = await googleAccount(env, userId);
  if (!account || !hasDriveScope(account.scope)) throw notConnected();
  try {
    const auth = await createAuth(env, request);
    const t = await auth.api.getAccessToken({ body: { accountId: account.id, userId } });
    const expiresAt = t.accessTokenExpiresAt ? new Date(t.accessTokenExpiresAt).getTime() : Date.now() + 3000 * 1000;
    if (!t.accessToken || expiresAt < Date.now()) throw new Error('expired');
    return { accessToken: t.accessToken, expiresAt };
  } catch {
    throw notConnected(RECONNECT);
  }
}

/** Calls Drive as the person; a refused key means they took the app's access away. */
async function drive(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${FILES}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw notConnected(RECONNECT);
  return res;
}

/** The uploaded file: its size, its MD5, and that it starts like a 3MF (a zip). */
export async function checkDriveFile(token: string, fileId: string): Promise<{ size: number; md5: string | null }> {
  const meta = await drive(token, `/${encodeURIComponent(fileId)}?fields=size,md5Checksum,trashed`);
  if (meta.status === 404) throw new HttpError(400, "That file isn't in your Google Drive");
  if (!meta.ok) throw new HttpError(502, `Google Drive answered ${meta.status}`);
  const info = (await meta.json()) as { size?: string; md5Checksum?: string; trashed?: boolean };
  const size = Number(info.size);
  if (info.trashed || !Number.isInteger(size) || size <= 0) throw new HttpError(400, "That file isn't in your Google Drive");
  const head = await drive(token, `/${encodeURIComponent(fileId)}?alt=media`, { headers: { Range: 'bytes=0-1' } });
  const magic = new Uint8Array(await head.arrayBuffer());
  if (magic[0] !== 0x50 || magic[1] !== 0x4b) throw new HttpError(400, "That isn't a 3MF file");
  return { size, md5: info.md5Checksum ?? null };
}

/** The file's MD5 in Drive now; null when it is gone (deleted or in the bin) or not in Drive. */
export async function driveMd5(token: string, key: string): Promise<string | null> {
  const id = fileIdOf(key);
  if (!id) return null;
  const res = await drive(token, `/${encodeURIComponent(id)}?fields=md5Checksum,trashed`);
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `Google Drive answered ${res.status}`);
  const info = (await res.json()) as { md5Checksum?: string; trashed?: boolean };
  return info.trashed ? null : (info.md5Checksum ?? null);
}

export async function driveRename(token: string, key: string, name: string): Promise<void> {
  const id = fileIdOf(key);
  if (!id) return;
  await drive(token, `/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${name}.3mf` }),
  });
}

/** Deletes for good (not to the bin); a file already gone is fine. */
export async function driveDelete(token: string, key: string): Promise<void> {
  const id = fileIdOf(key);
  if (!id) return;
  const res = await drive(token, `/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new HttpError(502, `Google Drive answered ${res.status}`);
}

/**
 * POST /api/drive/token -> { accessToken, expiresAt, picker? }: lets the page upload and download projects straight from Drive.
 * `picker`: what Google's file window (Open from Google Drive, public/drive-picker.html) needs, when the site has a Picker key.
 */
export async function token(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  return json({ ...(await driveToken(env, request, user.id)), ...(pickerConfig(env) && { picker: pickerConfig(env) }) });
}

/**
 * Google's file window wants a browser key (GOOGLE_PICKER_KEY, limited to the site in Google Cloud console) and the app's
 * Cloud project number, which starts the OAuth client id ("123456789012-abc.apps.googleusercontent.com"). With both,
 * a file picked in the window is opened up to the app's drive.file permission: no wider Drive access.
 */
export function pickerConfig(env: Env): { key: string; appId: string } | null {
  const appId = /^(\d+)-/.exec(env.GOOGLE_CLIENT_ID ?? '')?.[1];
  return env.GOOGLE_PICKER_KEY && appId ? { key: env.GOOGLE_PICKER_KEY, appId } : null;
}
