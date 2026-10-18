// Sign-in with Google or GitHub, and the browser sessions it creates.
//
// Every deploy (production, cloud-slicer.pages.dev and each branch preview)
// shares one D1 database, but an OAuth app only knows a fixed callback URL. So
// a sign-in starts on whatever host the user is on, every provider calls back
// to AUTH_ORIGIN, and a one-time handoff code carries the result back to the
// starting host, which sets its own session cookie:
//
//   host/api/auth/<p>/start  -> provider -> AUTH_ORIGIN/api/auth/<p>/callback
//     -> host/api/auth/finish?code=… (sets the session) -> host/<return path>
//
// The start sets a nonce cookie on the starting host and the finish checks it,
// so a sign-in can only be finished by the browser that began it.
import { pkceChallenge, randomToken, sha256 } from './crypto';
import { cookie, getCookie, HttpError, json, redirect, requireSameOrigin } from './http';
import { authorizeUrl, fetchProfile, isConfigured, PROVIDERS, type ProviderId } from './providers';
import type { D1Database, Env } from './types';

export const SESSION_COOKIE = '__Host-cs_session';
const NONCE_COOKIE = '__Host-cs_oauth';
const DAY = 24 * 3600 * 1000;
const SESSION_TTL = 30 * DAY;
const STATE_TTL = 10 * 60 * 1000;
const HANDOFF_TTL = 2 * 60 * 1000;

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  createdAt: number;
  expiresAt: number;
  sessionHash: string;
}

export function db(env: Env): D1Database {
  if (!env.DB) throw new HttpError(503, 'Accounts are not set up on this site yet');
  return env.DB;
}

/** Relative path inside the site, or "/" (never another site: no open redirects). */
export function safeReturnPath(value: string | null): string {
  if (!value || value.length > 1024 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}

/** Is `host` one of the configured hosts ("*.example.com" matches any subdomain)? */
export function hostAllowed(host: string, allowed: string | undefined, authOrigin: string): boolean {
  if (host === new URL(authOrigin).host) return true;
  const hostname = host.replace(/:\d+$/, '');
  return (allowed ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) =>
      pattern.startsWith('*.') ? hostname.endsWith(pattern.slice(1)) : pattern === hostname || pattern === host,
    );
}

const authOrigin = (env: Env, request: Request) => (env.AUTH_ORIGIN || new URL(request.url).origin).replace(/\/$/, '');
const callbackUrl = (env: Env, request: Request, provider: ProviderId) => `${authOrigin(env, request)}/api/auth/${provider}/callback`;

export async function currentUser(env: Env, request: Request): Promise<SessionUser | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !env.DB) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.created_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(hash, Date.now())
    .first<{ id: string; name: string; email: string | null; created_at: number; expires_at: number }>();
  return row
    ? { id: row.id, name: row.name, email: row.email, createdAt: row.created_at, expiresAt: row.expires_at, sessionHash: hash }
    : null;
}

export async function requireUser(env: Env, request: Request): Promise<SessionUser> {
  db(env);
  const user = await currentUser(env, request);
  if (!user) throw new HttpError(401, 'Sign in first');
  return user;
}

function providerOf(value: string): ProviderId {
  if (!PROVIDERS.includes(value as ProviderId)) throw new HttpError(404, 'Unknown sign-in provider');
  return value as ProviderId;
}

/** GET /api/me: who is signed in, and which providers this site offers. */
export async function me(env: Env, request: Request): Promise<Response> {
  const providers = { google: isConfigured(env, 'google'), github: isConfigured(env, 'github') };
  const enabled = Boolean(env.DB);
  const user = await currentUser(env, request);
  if (!user) return json({ enabled, providers, user: null });

  const ids = await env
    .DB!.prepare('SELECT provider, login, email FROM identities WHERE user_id = ? ORDER BY created_at')
    .bind(user.id)
    .all<{ provider: ProviderId; login: string | null; email: string | null }>();
  const now = Date.now();
  const cookies: Record<string, string> = {};
  // Sliding expiry, renewed at most once a day.
  if (user.expiresAt - now < SESSION_TTL - DAY) {
    await env.DB!.batch([
      env.DB!.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').bind(now + SESSION_TTL, user.sessionHash),
      env.DB!.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, user.id),
    ]);
    cookies['Set-Cookie'] = cookie(SESSION_COOKIE, getCookie(request, SESSION_COOKIE)!, SESSION_TTL / 1000);
  }
  return json(
    {
      enabled,
      providers,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        identities: ids.results.map((i) => ({ provider: i.provider, login: i.login, email: i.email })),
      },
    },
    200,
    cookies,
  );
}

/** GET /api/auth/<provider>/start?return=/path[&popup=1][&link=1] */
export async function start(env: Env, request: Request, providerName: string): Promise<Response> {
  const provider = providerOf(providerName);
  const d = db(env);
  const url = new URL(request.url);
  const auth = authOrigin(env, request);
  if (!hostAllowed(url.host, env.ALLOWED_HOSTS, auth)) throw new HttpError(403, `Sign-in is not allowed from ${url.host}`);

  const link = url.searchParams.get('link') === '1' ? await currentUser(env, request) : null;
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const now = Date.now();
  await d.batch([
    d.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
    d
      .prepare(
        `INSERT INTO oauth_states (id, provider, origin, return_to, nonce_hash, verifier, link_user_id, popup, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        await sha256(state),
        provider,
        url.origin,
        safeReturnPath(url.searchParams.get('return')),
        await sha256(nonce),
        verifier,
        link?.id ?? null,
        url.searchParams.get('popup') === '1' ? 1 : 0,
        now + STATE_TTL,
      ),
  ]);
  const location = authorizeUrl(env, provider, {
    redirectUri: callbackUrl(env, request, provider),
    state,
    challenge: await pkceChallenge(verifier),
  });
  return redirect(location, [cookie(NONCE_COOKIE, nonce, STATE_TTL / 1000)]);
}

interface StateRow {
  provider: ProviderId;
  origin: string;
  return_to: string;
  nonce_hash: string;
  verifier: string;
  link_user_id: string | null;
  popup: number;
  expires_at: number;
}

const finishUrl = (origin: string, params: Record<string, string>) =>
  `${origin}/api/auth/finish?${new URLSearchParams(params).toString()}`;

/** GET /api/auth/<provider>/callback?code&state — on AUTH_ORIGIN only. */
export async function callback(env: Env, request: Request, providerName: string): Promise<Response> {
  const provider = providerOf(providerName);
  const d = db(env);
  const url = new URL(request.url);
  const stateToken = url.searchParams.get('state') ?? '';
  const stateHash = await sha256(stateToken);
  const st = await d.prepare('SELECT * FROM oauth_states WHERE id = ?').bind(stateHash).first<StateRow>();
  if (!st || st.provider !== provider || st.expires_at < Date.now())
    throw new HttpError(400, 'This sign-in link has expired. Go back to the slicer and try again.');
  await d.prepare('DELETE FROM oauth_states WHERE id = ?').bind(stateHash).run();

  const back = { popup: String(st.popup), return: st.return_to };
  const providerError = url.searchParams.get('error');
  if (providerError)
    return redirect(finishUrl(st.origin, { ...back, error: providerError === 'access_denied' ? 'Sign-in was cancelled' : providerError }));

  let userId: string;
  try {
    const profile = await fetchProfile(env, provider, {
      code: url.searchParams.get('code') ?? '',
      redirectUri: callbackUrl(env, request, provider),
      verifier: st.verifier,
    });
    userId = await upsertUser(d, provider, profile, st.link_user_id);
  } catch (e) {
    return redirect(finishUrl(st.origin, { ...back, error: (e as Error).message }));
  }

  const code = randomToken();
  const now = Date.now();
  await d.batch([
    d.prepare('DELETE FROM handoffs WHERE expires_at < ?').bind(now),
    d
      .prepare(
        'INSERT INTO handoffs (code_hash, user_id, origin, return_to, nonce_hash, popup, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(await sha256(code), userId, st.origin, st.return_to, st.nonce_hash, st.popup, now + HANDOFF_TTL),
  ]);
  return redirect(finishUrl(st.origin, { code }));
}

async function upsertUser(
  d: D1Database,
  provider: ProviderId,
  p: { subject: string; name: string; email: string | null; login: string | null },
  linkUserId: string | null,
): Promise<string> {
  const now = Date.now();
  const existing = await d
    .prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
    .bind(provider, p.subject)
    .first<{ user_id: string }>();
  if (existing) {
    if (linkUserId && existing.user_id !== linkUserId)
      throw new HttpError(409, `That ${provider === 'google' ? 'Google' : 'GitHub'} account already belongs to another Cloud Slicer account`);
    await d.batch([
      d
        .prepare('UPDATE identities SET login = ?, email = ? WHERE provider = ? AND subject = ?')
        .bind(p.login, p.email, provider, p.subject),
      d.prepare('UPDATE users SET last_seen_at = ?, email = COALESCE(email, ?) WHERE id = ?').bind(now, p.email, existing.user_id),
    ]);
    return existing.user_id;
  }
  const userId = linkUserId ?? crypto.randomUUID();
  const statements = [
    linkUserId
      ? d.prepare('UPDATE users SET last_seen_at = ?, email = COALESCE(email, ?) WHERE id = ?').bind(now, p.email, userId)
      : d
          .prepare('INSERT INTO users (id, name, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
          .bind(userId, p.name.slice(0, 200), p.email, now, now),
  ];
  statements.push(
    d
      .prepare('INSERT INTO identities (provider, subject, user_id, login, email, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(provider, p.subject, userId, p.login, p.email, now),
  );
  await d.batch(statements);
  return userId;
}

/** Page shown in a sign-in popup: tells the app's window and closes itself. */
function popupPage(message: { type: 'signed-in' } | { type: 'error'; message: string }, cookies: string[]): Response {
  const text = message.type === 'signed-in' ? 'Signed in. You can close this window.' : `Sign-in failed: ${message.message}`;
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const payload = JSON.stringify(message).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cloud Slicer</title>
<body style="font:15px system-ui;padding:24px"><p>${escape(text)}</p>
<script>try{new BroadcastChannel('cloud-slicer-auth').postMessage(${payload})}catch(e){}${message.type === 'signed-in' ? 'window.close()' : ''}</script>`;
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(html, { headers });
}

/** GET /api/auth/finish?code=… (or ?error=…): on the host the sign-in started from. */
export async function finish(env: Env, request: Request): Promise<Response> {
  const d = db(env);
  const url = new URL(request.url);
  const clearNonce = cookie(NONCE_COOKIE, '', 0);
  const error = url.searchParams.get('error');
  if (error) {
    const msg = error.slice(0, 300);
    if (url.searchParams.get('popup') === '1') return popupPage({ type: 'error', message: msg }, [clearNonce]);
    const target = new URL(safeReturnPath(url.searchParams.get('return')), url.origin);
    target.hash = `auth-error=${encodeURIComponent(msg)}`;
    return redirect(target.toString(), [clearNonce]);
  }

  const codeHash = await sha256(url.searchParams.get('code') ?? '');
  const h = await d
    .prepare('SELECT * FROM handoffs WHERE code_hash = ?')
    .bind(codeHash)
    .first<{ user_id: string; origin: string; return_to: string; nonce_hash: string; popup: number; expires_at: number }>();
  if (h) await d.prepare('DELETE FROM handoffs WHERE code_hash = ?').bind(codeHash).run();
  const nonce = getCookie(request, NONCE_COOKIE);
  if (!h || h.expires_at < Date.now() || h.origin !== url.origin || !nonce || (await sha256(nonce)) !== h.nonce_hash)
    throw new HttpError(400, 'This sign-in could not be finished in this browser. Go back to the slicer and try again.');

  const token = randomToken();
  const now = Date.now();
  await d.batch([
    d.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    d
      .prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), h.user_id, now, now + SESSION_TTL),
  ]);
  const cookies = [cookie(SESSION_COOKIE, token, SESSION_TTL / 1000), clearNonce];
  if (h.popup) return popupPage({ type: 'signed-in' }, cookies);
  return redirect(new URL(h.return_to, url.origin).toString(), cookies);
}

/** POST /api/auth/logout */
export async function logout(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  const token = getCookie(request, SESSION_COOKIE);
  if (token && env.DB) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
}

/** DELETE /api/me: the account and everything saved with it. */
export async function deleteAccount(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const d = db(env);
  await d.batch(
    ['presets', 'sessions', 'handoffs', 'identities'].map((t) => d.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id)).concat(
      d.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
    ),
  );
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
}
