// Tickets for the bridge relay (apps/device-relay). The relay only lets a
// browser in with a ticket: a short-lived JWT (jose, ES256) this site signs
// for a signed-in, allowed user and one bridge. The relay holds only the
// public key, so it can check tickets but never make them.
//
//   POST /api/relay/ticket  { relay, bridgeId } -> { ticket, expiresAt }
//   POST /api/relay/setup   { relay } -> { code, expiresAt }   a setup code for adding a bridge
//   GET  /api/relay/setup/<code>      -> { state, bridgeId?, name? }   has a bridge used it yet?
//   POST /api/relay/claim   (from the relay, for a bridge spending a setup code) -> { claim, name }
//   POST /api/relay/release (from the relay, for a bridge removed on its own computer) -> { removed }
//
// Each bridge a user connects to is recorded (relay_bridges), which is how
// the per-user bridge cap and the Admin page's bridge counts work. Blocking a
// user also tells each relay they used to drop them at once (revoke()).
import { SignJWT, importJWK, type JWK } from 'jose';
import { isOwner } from './access';
import { currentUser, requireUser } from './auth';
import { decrypt, encrypt } from './crypto';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env } from './types';
import { keyContext } from './userdata';

/** Bridges one account may use. */
export const MAX_BRIDGES = 3;
/** Cameras one account may watch at once through one bridge (the relay enforces it; sent in the ticket). */
export const MAX_CAMERAS = 2;
/** Tickets last an hour; the page renews them over the open connection. */
const TICKET_SECONDS = 3600;
/** A setup code works once, within the hour. */
const SETUP_MS = 3600_000;

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
  if (!env.DB || !env.RELAY_TICKET_KEY) throw new HttpError(503, "The printer bridge doesn't need tickets on this site");
  const body = await readJson<{ relay?: unknown; bridgeId?: unknown }>(request, 4096);
  const bridgeId = String(body.bridgeId ?? '');
  if (!BRIDGE_ID.test(bridgeId)) throw new HttpError(400, 'Bad bridge id');
  const relay = relayOrigin(body.relay);
  const now = Date.now();
  const d = env.DB!;
  const info = await d.prepare('SELECT revoked FROM relay_bridge_info WHERE bridge_id = ?').bind(bridgeId).first<{ revoked: number }>().catch(() => null);
  if (info?.revoked) throw new HttpError(403, "The site's owner turned this bridge off.", { code: 'bridge-off' });
  const user = await currentUser(env, request);
  if (!user) throw new HttpError(401, 'Sign in first');
  await mayAddBridge(env, user.id, user.owner, bridgeId);
  await recordBridge(env, user.id, bridgeId, relay, now);
  const t = await sign(env, { b: bridgeId, cams: user.owner ? 8 : MAX_CAMERAS }, user.id, TICKET_SECONDS);
  return json({ ticket: t, expiresAt: now + TICKET_SECONDS * 1000 });
}

/** Refuses when this account may not use bridges, or already uses as many as it may (bridgeId: one it uses already is fine). */
async function mayAddBridge(env: Env, userId: string, owner: boolean, bridgeId?: string) {
  if (owner) return;
  const d = env.DB!;
  const limits = await d.prepare('SELECT bridges FROM user_limits WHERE user_id = ?').bind(userId).first<{ bridges: number | null }>().catch(() => null);
  if (limits?.bridges === 0) throw new HttpError(403, "Bridges aren't available for your account. Printers you reach directly still work.", { code: 'no-bridges' });
  if (bridgeId && (await d.prepare('SELECT 1 AS ok FROM relay_bridges WHERE user_id = ? AND bridge_id = ?').bind(userId, bridgeId).first())) return;
  const n = await d.prepare('SELECT COUNT(*) AS n FROM relay_bridges WHERE user_id = ?').bind(userId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_BRIDGES)
    throw new HttpError(403, `An account can use up to ${MAX_BRIDGES} bridges. Remove a bridge you no longer use (Printers & bridges), then try again.`, {
      code: 'bridge-limit',
    });
}

/** Notes that this account uses this bridge (the cap and the Admin page count these). */
async function recordBridge(env: Env, userId: string, bridgeId: string, relay: string, now: number) {
  await env
    .DB!.prepare(
      `INSERT INTO relay_bridges (user_id, bridge_id, relay, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, bridge_id) DO UPDATE SET last_used_at = excluded.last_used_at, relay = excluded.relay`,
    )
    .bind(userId, bridgeId, relay, now, now)
    .run();
}

// ---- setup codes ---------------------------------------------------------------
// Adding a bridge: the Device tab asks for a setup code, the install command
// carries it, and the bridge spends it through the relay (which forwards to
// POST /api/relay/claim). The code is the only secret, works once and for an
// hour, and the bridge joins the account that made it: saved in its devices,
// with the browser key the relay derived from the bridge's own secret.

/** No 0/O or 1/I: people read these aloud and type them. 8 of them = 40 bits. */
const CODE_LETTERS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE = /^[2-9A-HJ-NP-Z]{4}-?[2-9A-HJ-NP-Z]{4}$/;

/** Upper case, with the dash in the middle: how codes are shown, hashed and compared. */
export function normalCode(raw: unknown): string | null {
  const c = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!CODE.test(c)) return null;
  const bare = c.replace('-', '');
  return `${bare.slice(0, 4)}-${bare.slice(4)}`;
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = [...bytes].map((b) => CODE_LETTERS[b % 32]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** POST /api/relay/setup { relay } -> { code, expiresAt } */
export async function setup(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  if (!env.DB || !env.RELAY_TICKET_KEY) throw new HttpError(503, "The printer bridge isn't set up on this site yet");
  const user = await requireUser(env, request);
  const relay = relayOrigin((await readJson<{ relay?: unknown }>(request, 4096)).relay);
  await mayAddBridge(env, user.id, user.owner);
  const now = Date.now();
  // Spent and run-out codes are no longer needed.
  await env.DB.prepare('DELETE FROM bridge_setup_codes WHERE user_id = ? AND (expires_at < ? OR used_at IS NOT NULL)').bind(user.id, now - SETUP_MS).run();
  const code = newCode();
  await env.DB.prepare('INSERT INTO bridge_setup_codes (code_hash, user_id, relay, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(code), user.id, relay, now, now + SETUP_MS)
    .run();
  return json({ code, expiresAt: now + SETUP_MS });
}

interface SetupRow {
  user_id: string;
  relay: string;
  expires_at: number;
  used_at: number | null;
  bridge_id: string | null;
  bridge_name: string | null;
}

/** GET /api/relay/setup/<code> -> { state: 'waiting' | 'used' | 'expired', bridgeId?, name? } */
export async function setupState(env: Env, request: Request, raw: string): Promise<Response> {
  const user = await requireUser(env, request);
  const code = normalCode(decodeURIComponent(raw));
  const row = code ? await env.DB!.prepare('SELECT * FROM bridge_setup_codes WHERE code_hash = ?').bind(await sha256(code)).first<SetupRow>() : null;
  if (!row || row.user_id !== user.id) throw new HttpError(404, 'No such setup code');
  if (row.used_at) return json({ state: 'used', bridgeId: row.bridge_id, name: row.bridge_name });
  return json({ state: row.expires_at < Date.now() ? 'expired' : 'waiting' });
}

const label = (host: string, system: string) =>
  host ? `Bridge on ${host}` : system === 'win32' ? 'Bridge on a Windows PC' : system === 'darwin' ? 'Bridge on a Mac' : system === 'linux' ? 'Bridge on Linux' : 'Bridge';

/**
 * POST /api/relay/claim { code, relay, bridgeId, browserKey, host?, system?, place? }
 * The relay calls this for a bridge that was given a setup code. Knowing the
 * code is the proof; the answer is a short claim the relay checks with the
 * site's public key before it lets the bridge in, owned by the code's account.
 */
export async function claim(env: Env, request: Request): Promise<Response> {
  if (!env.DB || !env.RELAY_TICKET_KEY) throw new HttpError(503, "The printer bridge isn't set up on this site yet");
  const body = await readJson<Record<string, unknown>>(request, 4096);
  const code = normalCode(body.code);
  const bridgeId = String(body.bridgeId ?? '');
  const browserKey = String(body.browserKey ?? '');
  if (!BRIDGE_ID.test(bridgeId) || !/^[\w-]{16,128}$/.test(browserKey)) throw new HttpError(400, 'Bad bridge');
  const relay = relayOrigin(body.relay);
  const expired = () => new HttpError(410, 'This setup code expired or was already used.', { code: 'expired' });
  if (!code) throw new HttpError(404, "That isn't a setup code. Copy it again from Cloud Slicer.", { code: 'wrong' });
  const d = env.DB;
  const hash = await sha256(code);
  const row = await d.prepare('SELECT * FROM bridge_setup_codes WHERE code_hash = ?').bind(hash).first<SetupRow>();
  if (!row) throw new HttpError(404, "That setup code isn't right. Copy it again from Cloud Slicer.", { code: 'wrong' });
  if (row.relay !== relay) throw new HttpError(400, 'This setup code is for another relay.');
  const now = Date.now();
  if (row.used_at || row.expires_at < now) throw expired();
  const who = await d.prepare('SELECT email, banned FROM "user" WHERE id = ?').bind(row.user_id).first<{ email: string; banned: number | null }>();
  if (!who || who.banned) throw new HttpError(403, "This setup code's Cloud Slicer account is blocked.");
  await mayAddBridge(env, row.user_id, isOwner(env, who.email), bridgeId);
  const name = label(String(body.host ?? '').replace(/[^\w .'-]/g, '').slice(0, 64), String(body.system ?? ''));
  // Spend it: only one bridge ever gets in with a code, even two at once.
  const spent = await d.prepare('UPDATE bridge_setup_codes SET used_at = ?, bridge_id = ?, bridge_name = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?')
    .bind(now, bridgeId, name, hash, now)
    .run();
  if (!spent.meta.changes) throw expired();
  await recordBridge(env, row.user_id, bridgeId, relay, now);
  // Saved to the account like a bridge paired by hand, so the Device tab lists it at once.
  const devices = await d.prepare('SELECT id, extra FROM devices WHERE user_id = ?').bind(row.user_id).all<{ id: string; extra: string }>();
  const old = devices.results.filter((r) => {
    const x = JSON.parse(r.extra) as { kind?: unknown; bridgeId?: unknown };
    return x.kind === 'bridge-agent' && x.bridgeId === bridgeId;
  });
  for (const r of old) await d.prepare('DELETE FROM devices WHERE user_id = ? AND id = ?').bind(row.user_id, r.id).run();
  const id = crypto.randomUUID().slice(0, 8);
  if (!env.ACCOUNT_ENC_KEY) throw new HttpError(503, "Saving bridges isn't set up on this site yet");
  await d
    .prepare('INSERT INTO devices (user_id, id, name, preset, url, api_key_enc, extra, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
    .bind(row.user_id, id, name, '', '', await encrypt(env.ACCOUNT_ENC_KEY, browserKey, keyContext(row.user_id, id)), JSON.stringify({ kind: 'bridge-agent', relay, bridgeId }), now)
    .run();
  const token = await sign(env, { b: bridgeId, claim: true }, row.user_id, 300);
  return json({ claim: token, name });
}

/**
 * POST /api/relay/release { relay, bridgeId, browserKey, owner }
 * The relay calls this when a bridge was removed on its own computer (its
 * status window, or Windows' Installed apps). Knowing the bridge's browser key,
 * which only the bridge and its account have, is the proof; the bridge and its
 * printers then leave the account, as with Remove bridge in the Device tab.
 */
export async function release(env: Env, request: Request): Promise<Response> {
  if (!env.DB || !env.ACCOUNT_ENC_KEY) throw new HttpError(503, "The printer bridge isn't set up on this site yet");
  const body = await readJson<Record<string, unknown>>(request, 4096);
  const bridgeId = String(body.bridgeId ?? '');
  const browserKey = String(body.browserKey ?? '');
  const owner = String(body.owner ?? '');
  if (!BRIDGE_ID.test(bridgeId) || !/^[\w-]{16,128}$/.test(browserKey) || !owner) throw new HttpError(400, 'Bad bridge');
  const relay = relayOrigin(body.relay);
  const d = env.DB;
  const rows = (await d.prepare('SELECT id, extra, api_key_enc FROM devices WHERE user_id = ?').bind(owner).all<{ id: string; extra: string; api_key_enc: string | null }>()).results;
  const ofBridge = rows.filter((r) => {
    const x = JSON.parse(r.extra) as { bridgeId?: unknown; relay?: unknown };
    return x.bridgeId === bridgeId && x.relay === relay;
  });
  let proven = false;
  for (const r of ofBridge) {
    if ((JSON.parse(r.extra) as { kind?: unknown }).kind !== 'bridge-agent' || !r.api_key_enc) continue;
    const known = await decrypt(env.ACCOUNT_ENC_KEY, r.api_key_enc, keyContext(owner, r.id)).catch(() => '');
    if (known && known === browserKey) proven = true;
  }
  if (!proven) throw new HttpError(404, 'No such bridge in that account');
  for (const r of ofBridge) await d.prepare('DELETE FROM devices WHERE user_id = ? AND id = ?').bind(owner, r.id).run();
  await d.prepare('DELETE FROM relay_bridges WHERE user_id = ? AND bridge_id = ?').bind(owner, bridgeId).run();
  return json({ removed: ofBridge.length });
}

/**
 * GET /api/relay/key -> the public half of the key this site signs tickets and
 * setup-code claims with, so a relay can be given exactly the key that checks them
 * (CI gives it to the test relay from the branch's preview).
 */
export async function publicKey(env: Env): Promise<Response> {
  if (!env.RELAY_TICKET_KEY) throw new HttpError(404, "This site doesn't sign relay tickets");
  const { kty, crv, x, y } = JSON.parse(env.RELAY_TICKET_KEY) as JWK;
  return json({ kty, crv, x, y });
}

/** DELETE /api/relay/bridges/<id>: the user removed a bridge, so it no longer counts against their cap. */
export async function forget(env: Env, request: Request, bridgeId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  await env.DB!.prepare('DELETE FROM relay_bridges WHERE user_id = ? AND bridge_id = ?').bind(user.id, bridgeId).run();
  return json({ ok: true });
}

/** Sends a signed order to relays: { revoke: bridge ids, ... } (see the relay's POST /v1/revoke). */
async function order(env: Env, targets: { relay: string; bridge_id: string }[], subject: string, claims: Record<string, unknown>) {
  if (!env.RELAY_TICKET_KEY) return;
  const byRelay = new Map<string, string[]>();
  for (const r of targets) byRelay.set(r.relay, [...(byRelay.get(r.relay) ?? []), r.bridge_id]);
  await Promise.all(
    [...byRelay].map(async ([relay, bridges]) => {
      try {
        const token = await sign(env, { ...claims, revoke: bridges }, subject, 300);
        await fetch(`${relay}/v1/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        console.error('relay order failed', relay, e);
      }
    }),
  );
}

/**
 * Tells every relay the user has used to drop their connections now
 * (blocked: true), or to let them back (false). Best effort: their tickets
 * run out within the hour anyway, and new ones need a session.
 */
export async function revoke(env: Env, userId: string, blocked: boolean): Promise<void> {
  if (!env.RELAY_TICKET_KEY) return;
  const rows = await env.DB!.prepare('SELECT bridge_id, relay FROM relay_bridges WHERE user_id = ?').bind(userId).all<{ bridge_id: string; relay: string }>();
  await order(env, rows.results, userId, { blocked });
}

/** Turns a bridge off (or back on) for everyone: its relay closes it and the site stops giving tickets for it. */
export async function setBridgeOff(env: Env, bridgeId: string, off: boolean): Promise<void> {
  const d = env.DB!;
  const known = await d
    .prepare('SELECT relay FROM relay_bridge_info WHERE bridge_id = ? UNION SELECT relay FROM relay_bridges WHERE bridge_id = ? LIMIT 1')
    .bind(bridgeId, bridgeId)
    .first<{ relay: string }>();
  if (!known) throw new HttpError(404, 'No such bridge');
  await d
    .prepare(
      `INSERT INTO relay_bridge_info (bridge_id, relay, revoked, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (bridge_id) DO UPDATE SET revoked = excluded.revoked, updated_at = excluded.updated_at`,
    )
    .bind(bridgeId, known.relay, off ? 1 : 0, Date.now())
    .run();
  await order(env, [{ relay: known.relay, bridge_id: bridgeId }], 'site', { bridgeOff: off });
}
