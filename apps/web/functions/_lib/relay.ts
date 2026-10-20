// Tickets for the bridge relay (apps/device-relay). The relay only lets a
// browser in with a ticket: a short-lived JWT (jose, ES256) this site signs
// for a signed-in, allowed user and one bridge. The relay holds only the
// public key, so it can check tickets but never make them.
//
//   POST /api/relay/ticket  { relay, bridgeId } -> { ticket, expiresAt }
//
// Each bridge a user connects to is recorded (relay_bridges), which is how
// the per-user bridge cap and the Admin page's bridge counts work. Blocking a
// user also tells each relay they used to drop them at once (revoke()).
import { SignJWT, importJWK, type JWK } from 'jose';
import { requireUser } from './auth';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env } from './types';

/** Bridges one account may use. */
export const MAX_BRIDGES = 3;
/** Cameras one account may watch at once through one bridge (the relay enforces it; sent in the ticket). */
export const MAX_CAMERAS = 2;
/** Tickets last an hour; the page renews them over the open connection. */
const TICKET_SECONDS = 3600;

const BRIDGE_ID = /^[\w-]{8,64}$/;

let key: { jwk: string; key: CryptoKey } | null = null;
async function signingKey(env: Env): Promise<CryptoKey> {
  const jwk = env.RELAY_TICKET_KEY;
  if (!jwk) throw new HttpError(503, "The printer bridge isn't set up on this site yet");
  if (key?.jwk !== jwk) key = { jwk, key: (await importJWK(JSON.parse(jwk) as JWK, 'ES256')) as CryptoKey };
  return key.key;
}

const sign = async (env: Env, claims: Record<string, unknown>, subject: string, seconds: number) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(subject)
    .setAudience('cloud-slicer-relay')
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(await signingKey(env));

function relayOrigin(v: unknown): string {
  try {
    const u = new URL(String(v));
    if (u.protocol === 'https:' || ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:')) return u.origin;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Bad relay address');
}

/** POST /api/relay/ticket */
export async function ticket(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const body = await readJson<{ relay?: unknown; bridgeId?: unknown }>(request, 4096);
  const bridgeId = String(body.bridgeId ?? '');
  if (!BRIDGE_ID.test(bridgeId)) throw new HttpError(400, 'Bad bridge id');
  const relay = relayOrigin(body.relay);
  const now = Date.now();
  const d = env.DB!;
  const known = await d.prepare('SELECT 1 AS ok FROM relay_bridges WHERE user_id = ? AND bridge_id = ?').bind(user.id, bridgeId).first();
  if (known) {
    await d.prepare('UPDATE relay_bridges SET last_used_at = ?, relay = ? WHERE user_id = ? AND bridge_id = ?').bind(now, relay, user.id, bridgeId).run();
  } else {
    const n = await d.prepare('SELECT COUNT(*) AS n FROM relay_bridges WHERE user_id = ?').bind(user.id).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_BRIDGES && !user.owner)
      throw new HttpError(
        403,
        `An account can use up to ${MAX_BRIDGES} bridges. Remove a bridge you no longer use (Device tab, Manage bridges), then try again.`,
        { code: 'bridge-limit' },
      );
    await d
      .prepare('INSERT INTO relay_bridges (user_id, bridge_id, relay, created_at, last_used_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(user.id, bridgeId, relay, now, now)
      .run();
  }
  const t = await sign(env, { b: bridgeId, cams: user.owner ? 8 : MAX_CAMERAS }, user.id, TICKET_SECONDS);
  return json({ ticket: t, expiresAt: now + TICKET_SECONDS * 1000 });
}

/** DELETE /api/relay/bridges/<id>: the user removed a bridge, so it no longer counts against their cap. */
export async function forget(env: Env, request: Request, bridgeId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  await env.DB!.prepare('DELETE FROM relay_bridges WHERE user_id = ? AND bridge_id = ?').bind(user.id, bridgeId).run();
  return json({ ok: true });
}

/**
 * Tells every relay the user has used to drop their connections now
 * (blocked: true), or to let them back (false). Best effort: their tickets
 * run out within the hour anyway, and new ones need a session.
 */
export async function revoke(env: Env, userId: string, blocked: boolean): Promise<void> {
  if (!env.RELAY_TICKET_KEY) return;
  const rows = await env.DB!.prepare('SELECT bridge_id, relay FROM relay_bridges WHERE user_id = ?').bind(userId).all<{ bridge_id: string; relay: string }>();
  const byRelay = new Map<string, string[]>();
  for (const r of rows.results) byRelay.set(r.relay, [...(byRelay.get(r.relay) ?? []), r.bridge_id]);
  await Promise.all(
    [...byRelay].map(async ([relay, bridges]) => {
      try {
        const token = await sign(env, { revoke: bridges, blocked }, userId, 300);
        await fetch(`${relay}/v1/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        console.error('relay revoke failed', relay, e);
      }
    }),
  );
}
