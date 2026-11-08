// The owner's Admin page (OWNER_EMAILS only):
//
//   GET    /api/admin[?quick]               settings, users, invites, free-tier usage (not with ?quick)
//   PUT    /api/admin/settings              { inviteOnly?, bridgesPerPerson? (-1 = no limit) }
//   POST   /api/admin/users/<id>/<action>   block | unblock | allow | disallow | delete
//   PUT    /api/admin/users/<id>/projects   { allowed: boolean }  (online projects, in their Google Drive)
//   PUT    /api/admin/users/<id>/bridges    { bridges: null (the site's number) | a whole number, 0 = none | -1 (no limit) }
//   POST   /api/admin/bridges/<id>/<off|on> turn a bridge off for everyone, or back on
//   DELETE /api/admin/bridges/<id>          take an old bridge off the list (frees its place)
//   POST   /api/admin/invites               { email }
//   DELETE /api/admin/invites/<email>
//
// Blocking is Better Auth's admin plugin (ban: signs the user out everywhere
// and refuses their sign-ins); the relay drops their bridge connections too.
import { accessSettings, bridgeNumber, isOwner, normalEmail, saveAccessSettings } from './access';
import { createAuth, requireUser, type SessionUser } from './auth';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import { revoke, setBridgeOff } from './relay';
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
  presets: number;
  printers: number;
  bridges: number;
  projects_allowed: number | null;
  bridges_allowed: number | null;
  allowed: number;
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
  // ?quick: the page refreshing after a change; skips the slow free-tier numbers (Cloudflare's analytics).
  const quick = new URL(request.url).searchParams.has('quick');
  const [settings, users, invites, use, bridges] = await Promise.all([
    accessSettings(env),
    d
      .prepare(
        `SELECT u.id, u.name, u.email, u."createdAt", u.banned,
           (SELECT MAX(s."updatedAt") FROM "session" s WHERE s."userId" = u.id) AS "lastSeen",
           (SELECT MAX(r.last_used_at) FROM relay_bridges r WHERE r.user_id = u.id) AS "relaySeen",
           (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
           (SELECT COUNT(*) FROM presets p WHERE p.user_id = u.id) AS presets,
           (SELECT COUNT(*) FROM devices v WHERE v.user_id = u.id) AS printers,
           (SELECT COUNT(*) FROM relay_bridges r WHERE r.user_id = u.id) AS bridges,
           l.projects AS projects_allowed, l.bridges AS bridges_allowed,
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
    quick ? null : usage(env),
    d
      .prepare(
        `SELECT b.bridge_id AS id, MAX(b.last_used_at) AS used, group_concat(COALESCE(NULLIF(u.name, ''), u.email), ', ') AS people,
           i.revoked,
           (SELECT group_concat(v.name, ', ') FROM devices v
              WHERE json_extract(v.extra, '$.kind') = 'bridge-agent' AND json_extract(v.extra, '$.bridgeId') = b.bridge_id) AS names,
           (SELECT group_concat(v.name, ', ') FROM devices v
              WHERE json_extract(v.extra, '$.kind') = 'bridge' AND json_extract(v.extra, '$.bridgeId') = b.bridge_id) AS printers
         FROM relay_bridges b
         LEFT JOIN "user" u ON u.id = b.user_id
         LEFT JOIN relay_bridge_info i ON i.bridge_id = b.bridge_id
         GROUP BY b.bridge_id ORDER BY used DESC LIMIT 500`,
      )
      .all<{ id: string; used: number; people: string | null; revoked: number | null; names: string | null; printers: string | null }>()
      .catch(() => ({ results: [] })),
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
        presets: u.presets,
        printers: u.printers,
        bridges: u.bridges,
        projectsAllowed: u.projects_allowed !== 0,
        bridgesAllowed: u.bridges_allowed !== 0,
        /** This person's own bridge number: null = the site's, 0 = none. */
        bridgesLimit: u.bridges_allowed,
      };
    }),
    invites: invites.results.map((i) => ({ email: i.email, addedAt: i.added_at })),
    bridges: bridges.results.map((b) => ({
      id: b.id,
      lastUsed: b.used,
      people: b.people ?? '',
      off: !!b.revoked,
      name: b.names ?? '',
      printers: b.printers ?? '',
    })),
    usage: use,
  });
}

/** PUT /api/admin/settings */
export async function putSettings(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  const body = await readJson<{ inviteOnly?: unknown; bridgesPerPerson?: unknown }>(request, 4096);
  const before = await accessSettings(env);
  const bridges = body.bridgesPerPerson === undefined ? before.bridgesPerPerson : bridgeNumber(body.bridgesPerPerson);
  if (bridges === null) throw new HttpError(400, 'Bridges per person must be a whole number from 1 up, or no limit (-1)');
  const next = { inviteOnly: body.inviteOnly === undefined ? before.inviteOnly : body.inviteOnly === true, bridgesPerPerson: bridges };
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
  const auth = await createAuth(env, request, { admin: true });
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
      // Everything goes: sessions, presets, printers, the project list, bridges; their relay
      // connections close and they leave the invite list. Project files stay in their Google Drive.
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

/** PUT /api/admin/users/<id>/projects  { allowed }: may this person save projects online (in their Google Drive). */
export async function putUserProjects(env: Env, request: Request, id: string): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  await targetUser(env, id);
  const body = await readJson<{ allowed?: unknown }>(request, 4096);
  await env.DB!.prepare(
    `INSERT INTO user_limits (user_id, projects, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET projects = excluded.projects, updated_at = excluded.updated_at`,
  )
    .bind(id, body.allowed === false ? 0 : null, Date.now())
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

/**
 * PUT /api/admin/users/<id>/bridges  { bridges }: how many bridges this person may use.
 * null = the site's number, 0 = none (their bridges close at once). Lowering the
 * number keeps bridges they already use; it stops new ones.
 */
export async function putUserBridges(env: Env, request: Request, id: string): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  const target = await targetUser(env, id);
  if (isOwner(env, target.email)) throw new HttpError(400, 'The owner can always use bridges');
  const body = await readJson<{ bridges?: unknown }>(request, 4096);
  const n = body.bridges === null ? null : bridgeNumber(body.bridges, 0);
  if (n === null && body.bridges !== null) throw new HttpError(400, "Bridges must be the site's number (null), a whole number from 0 up, or no limit (-1)");
  await env.DB!.prepare(
    `INSERT INTO user_limits (user_id, bridges, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET bridges = excluded.bridges, updated_at = excluded.updated_at`,
  )
    .bind(id, n, Date.now())
    .run();
  await revoke(env, id, n === 0);
  return json({ ok: true });
}

/** POST /api/admin/bridges/<id>/<off|on> */
export async function bridgeAction(env: Env, request: Request, bridgeId: string, action: string): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  if (action !== 'off' && action !== 'on') throw new HttpError(404, 'Not found');
  await setBridgeOff(env, bridgeId, action === 'off');
  return json({ ok: true });
}

/**
 * DELETE /api/admin/bridges/<id>: takes a bridge off the list for everyone, so it
 * stops counting toward anyone's bridges. A bridge that is still running comes
 * back the next time someone opens it (if they have a place for it).
 */
export async function removeBridge(env: Env, request: Request, bridgeId: string): Promise<Response> {
  requireSameOrigin(request);
  await requireOwner(env, request);
  const d = env.DB!;
  const { meta } = await d.prepare('DELETE FROM relay_bridges WHERE bridge_id = ?').bind(bridgeId).run();
  await d.prepare('DELETE FROM relay_bridge_info WHERE bridge_id = ? AND revoked = 0').bind(bridgeId).run();
  if (!meta.changes) throw new HttpError(404, 'No such bridge');
  return json({ ok: true });
}
