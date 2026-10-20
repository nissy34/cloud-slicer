// The owner's Admin page (OWNER_EMAILS only):
//
//   GET    /api/admin                       settings, users, invites, free-tier usage
//   PUT    /api/admin/settings              { inviteOnly, storageMb, guestRelay }
//   POST   /api/admin/users/<id>/<action>   block | unblock | allow | disallow | delete
//   PUT    /api/admin/users/<id>/storage    { storageMb: number | null }  (null = the site default)
//   POST   /api/admin/invites               { email }
//   DELETE /api/admin/invites/<email>
//
// Blocking is Better Auth's admin plugin (ban: signs the user out everywhere
// and refuses their sign-ins); the relay drops their bridge connections too.
import { accessSettings, isOwner, MAX_STORAGE_MB, normalEmail, saveAccessSettings } from './access';
import { createAuth, requireUser, type SessionUser } from './auth';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import { revoke } from './relay';
import type { Env } from './types';
import { usage } from './usage';

async function requireOwner(env: Env, request: Request): Promise<SessionUser> {
  const user = await requireUser(env, request);
  if (!user.owner) throw new HttpError(403, 'Only the site owner can open this page');
  return user;
}

/** Better Auth stores dates as ISO text or epoch numbers depending on the path; both become ms. */
const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};

interface UserRow {
  id: string;
  name: string;
  email: string;
  createdAt: unknown;
  banned: number | null;
  lastSeen: unknown;
  relaySeen: number | null;
  projects: number;
  bytes: number;
  presets: number;
  printers: number;
  bridges: number;
  storage_mb: number | null;
  allowed: number;
}

function storageMb(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_STORAGE_MB) throw new HttpError(400, `Storage is a whole number of MB, 0-${MAX_STORAGE_MB}`);
  return n;
}

function validEmail(v: unknown): string {
  const e = normalEmail(String(v ?? ''));
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, "That doesn't look like an email address");
  return e;
}

/** GET /api/admin */
export async function overview(env: Env, request: Request): Promise<Response> {
  await requireOwner(env, request);
  const d = env.DB!;
  const [settings, users, invites, use] = await Promise.all([
    accessSettings(env),
    d
      .prepare(
        `SELECT u.id, u.name, u.email, u."createdAt", u.banned,
           (SELECT MAX(s."updatedAt") FROM "session" s WHERE s."userId" = u.id) AS "lastSeen",
           (SELECT MAX(r.last_used_at) FROM relay_bridges r WHERE r.user_id = u.id) AS "relaySeen",
           (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
           (SELECT COALESCE(SUM(p.size), 0) FROM projects p WHERE p.user_id = u.id) AS bytes,
           (SELECT COUNT(*) FROM presets p WHERE p.user_id = u.id) AS presets,
           (SELECT COUNT(*) FROM devices v WHERE v.user_id = u.id) AS printers,
           (SELECT COUNT(*) FROM relay_bridges r WHERE r.user_id = u.id) AS bridges,
           l.storage_mb,
           (a.email IS NOT NULL) AS allowed
         FROM "user" u
         LEFT JOIN user_limits l ON l.user_id = u.id
         LEFT JOIN allowed_emails a ON a.email = lower(u.email)
         ORDER BY u."createdAt" DESC
         LIMIT 1000`,
      )
      .all<UserRow>(),
    d.prepare('SELECT a.email, a.added_at FROM allowed_emails a WHERE NOT EXISTS (SELECT 1 FROM "user" u WHERE lower(u.email) = a.email) ORDER BY a.added_at DESC').all<{
      email: string;
      added_at: number;
    }>(),
    usage(env),
  ]);
  return json({
    settings,
    users: users.results.map((u) => {
      const seen = [ms(u.lastSeen), u.relaySeen].filter((x): x is number => x !== null);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: ms(u.createdAt),
        lastSeen: seen.length ? Math.max(...seen) : null,
        owner: isOwner(env, u.email),
        blocked: !!u.banned,
        allowed: !!u.allowed,
        projects: u.projects,
        bytes: u.bytes,
        presets: u.presets,
        printers: u.printers,
        bridges: u.bridges,
        storageMb: u.storage_mb,
      };
    }),
    invites: invites.results.map((i) => ({ email: i.email, addedAt: i.added_at })),
    usage: use,
  });
}

/** PUT /api/admin/settings */
export async function putSettings(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  const body = await readJson<{ inviteOnly?: unknown; storageMb?: unknown; guestRelay?: unknown }>(request, 4096);
  const before = await accessSettings(env);
  const next = {
    inviteOnly: body.inviteOnly === undefined ? before.inviteOnly : body.inviteOnly === true,
    storageMb: body.storageMb === undefined ? before.storageMb : storageMb(body.storageMb),
    guestRelay: body.guestRelay === undefined ? before.guestRelay : body.guestRelay === true,
  };
  // Turning invite only on keeps everyone who already has an account: they go on the list.
  if (next.inviteOnly && !before.inviteOnly)
    await env.DB!.prepare('INSERT OR IGNORE INTO allowed_emails (email, added_at) SELECT lower(email), ? FROM "user"').bind(Date.now()).run();
  await saveAccessSettings(env, next);
  return json({ settings: next });
}

async function targetUser(env: Env, id: string) {
  const u = await env.DB!.prepare('SELECT id, email FROM "user" WHERE id = ?').bind(id).first<{ id: string; email: string }>();
  if (!u) throw new HttpError(404, 'No such user');
  return u;
}

/** POST /api/admin/users/<id>/<action> */
export async function userAction(env: Env, request: Request, id: string, action: string): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  const target = await targetUser(env, id);
  const owner = isOwner(env, target.email);
  const auth = await createAuth(env, request);
  const headers = request.headers;
  switch (action) {
    case 'block':
      if (owner) throw new HttpError(400, "The owner's own account can't be blocked");
      await auth.api.banUser({ body: { userId: id, banReason: 'Blocked on the Admin page' }, headers });
      await revoke(env, id, true);
      break;
    case 'unblock':
      await auth.api.unbanUser({ body: { userId: id }, headers });
      await revoke(env, id, false);
      break;
    case 'allow':
      await env.DB!.prepare('INSERT OR IGNORE INTO allowed_emails (email, added_at) VALUES (?, ?)').bind(normalEmail(target.email), Date.now()).run();
      break;
    case 'disallow': {
      if (owner) throw new HttpError(400, 'The owner is always allowed');
      await env.DB!.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(normalEmail(target.email)).run();
      // While invite only, taking someone off the list signs them out too.
      if ((await accessSettings(env)).inviteOnly) {
        await auth.api.revokeUserSessions({ body: { userId: id }, headers });
        await revoke(env, id, true);
      }
      break;
    }
    case 'delete':
      // Everything goes: sessions, presets, printers, projects (and their files, auth.ts's
      // delete hook), bridges; their relay connections close and they leave the invite list.
      if (owner) throw new HttpError(400, "The owner's own account can't be deleted here");
      await revoke(env, id, true);
      await auth.api.removeUser({ body: { userId: id }, headers });
      await env.DB!.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(normalEmail(target.email)).run();
      break;
    default:
      throw new HttpError(404, 'Not found');
  }
  return json({ ok: true });
}

/** PUT /api/admin/users/<id>/storage */
export async function putUserStorage(env: Env, request: Request, id: string): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  await targetUser(env, id);
  const body = await readJson<{ storageMb?: unknown }>(request, 4096);
  if (body.storageMb === null) await env.DB!.prepare('DELETE FROM user_limits WHERE user_id = ?').bind(id).run();
  else
    await env.DB!.prepare(
      `INSERT INTO user_limits (user_id, storage_mb, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET storage_mb = excluded.storage_mb, updated_at = excluded.updated_at`,
    )
      .bind(id, storageMb(body.storageMb), Date.now())
      .run();
  return json({ ok: true });
}

/** POST /api/admin/invites */
export async function addInvite(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  const body = await readJson<{ email?: unknown }>(request, 4096);
  const email = validEmail(body.email);
  await env.DB!.prepare('INSERT OR IGNORE INTO allowed_emails (email, added_at) VALUES (?, ?)').bind(email, Date.now()).run();
  return json({ email });
}

/** DELETE /api/admin/invites/<email> */
export async function removeInvite(env: Env, request: Request, email: string): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  await env.DB!.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(normalEmail(email)).run();
  return json({ ok: true });
}
