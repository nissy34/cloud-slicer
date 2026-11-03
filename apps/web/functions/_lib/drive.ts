// Projects kept in the person's own Google Drive (a trial, PR "Save projects to
// Google Drive"). Only the drive.file permission is asked for: the app sees
// the files it made and nothing else in their Drive, and Google needs no
// security review for it.
//
// The browser uploads the 3MF straight to Drive (so a project isn't held to
// Cloudflare's 100 MB request limit and never passes through us); the projects
// row then points at it with file_key "drive:<file id>". Opening streams the
// file from Drive through /api/projects/<id>/file, so the page opens a Drive
// project the same way as one in R2. Thumbnails stay in R2 (tens of KB).
import { createAuth, db, requireUser } from './auth';
import { HttpError, json, requireSameOrigin } from './http';
import type { Env } from './types';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const PREFIX = 'drive:';

export const isDriveKey = (key: string) => key.startsWith(PREFIX);
export const driveKey = (fileId: string) => PREFIX + fileId;
const fileIdOf = (key: string) => key.slice(PREFIX.length);
/** Drive file ids are letters, digits, - and _. */
export const validDriveId = (v: string | null) => (v && /^[A-Za-z0-9_-]{8,200}$/.test(v) ? v : null);

/** Scopes as Better Auth stores them: comma separated (Google's own are space separated). */
export const hasDriveScope = (scope: string | null | undefined) => (scope ?? '').split(/[\s,]+/).includes(DRIVE_SCOPE);

/** Not connected, or Google no longer accepts the app's key: the page offers "Connect Google Drive". */
const notConnected = (message = 'Connect Google Drive first, in Online projects') => new HttpError(403, message, { code: 'drive-connect' });

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
    throw notConnected('Google Drive needs connecting again, in Online projects');
  }
}

/** Calls Drive as the person; a refused key means they took the app's access away. */
async function drive(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${FILES}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw notConnected('Google Drive needs connecting again, in Online projects');
  return res;
}

/** The uploaded file: its size, and that it starts like a 3MF (a zip). */
export async function checkDriveFile(token: string, fileId: string): Promise<number> {
  const meta = await drive(token, `/${encodeURIComponent(fileId)}?fields=size,trashed`);
  if (meta.status === 404) throw new HttpError(400, "That file isn't in your Google Drive");
  if (!meta.ok) throw new HttpError(502, `Google Drive answered ${meta.status}`);
  const info = (await meta.json()) as { size?: string; trashed?: boolean };
  const size = Number(info.size);
  if (info.trashed || !Number.isInteger(size) || size <= 0) throw new HttpError(400, "That file isn't in your Google Drive");
  const head = await drive(token, `/${encodeURIComponent(fileId)}?alt=media`, { headers: { Range: 'bytes=0-1' } });
  const magic = new Uint8Array(await head.arrayBuffer());
  if (magic[0] !== 0x50 || magic[1] !== 0x4b) throw new HttpError(400, "That isn't a 3MF file");
  return size;
}

/** The 3MF, streamed from Drive. */
export async function driveDownload(token: string, key: string): Promise<Response> {
  const res = await drive(token, `/${encodeURIComponent(fileIdOf(key))}?alt=media`);
  if (res.status === 404) throw new HttpError(404, "The project's file is no longer in your Google Drive");
  if (!res.ok || !res.body) throw new HttpError(502, `Google Drive answered ${res.status}`);
  return res;
}

export async function driveRename(token: string, key: string, name: string): Promise<void> {
  await drive(token, `/${encodeURIComponent(fileIdOf(key))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${name}.3mf` }),
  });
}

/** Deletes for good (not to the bin); a file already gone is fine. */
export async function driveDelete(token: string, key: string): Promise<void> {
  const res = await drive(token, `/${encodeURIComponent(fileIdOf(key))}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new HttpError(502, `Google Drive answered ${res.status}`);
}

/** POST /api/drive/token -> { accessToken, expiresAt }: lets the page upload a project straight to Drive. */
export async function token(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  return json(await driveToken(env, request, user.id));
}
