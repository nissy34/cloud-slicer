// Sign-in with Google, via Better Auth (https://better-auth.com): OAuth,
// sessions and cookies are the library's; this file configures it and adds
// the few endpoints the app needs around it.
//
// Every deploy (production, cloud-slicer.pages.dev, each branch preview)
// shares one D1 database, but the Google client has one redirect URI. Better
// Auth's oAuthProxy plugin handles that: a sign-in started on a preview goes
// through AUTH_ORIGIN's callback, which hands the result back (encrypted with
// BETTER_AUTH_SECRET, shared by all deploys) to the preview, which sets its
// own session cookie.
import { betterAuth } from 'better-auth';
import { oAuthProxy } from 'better-auth/plugins';
import { HttpError, json } from './http';
import { deleteAllFiles } from './projects';
import type { Env } from './types';

export type ProviderId = 'google';

const DAY = 24 * 3600;

export function db(env: Env) {
  if (!env.DB) throw new HttpError(503, 'Accounts are not set up on this site yet');
  return env.DB;
}

/** Origins allowed to sign in and to be redirected back to ("*" wildcards allowed). */
export function trustedOrigins(env: Env, request: Request): string[] {
  const list = (env.TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([new URL(request.url).origin, ...(env.AUTH_ORIGIN ? [env.AUTH_ORIGIN] : []), ...list])];
}

const configured = (env: Env) => Boolean(env.DB && env.BETTER_AUTH_SECRET);

export function createAuth(env: Env, request: Request) {
  const origin = new URL(request.url).origin;
  return betterAuth({
    appName: 'Cloud Slicer',
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: db(env),
    trustedOrigins: trustedOrigins(env, request),
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' } }
        : {},
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    account: { encryptOAuthTokens: true },
    user: {
      deleteUser: {
        enabled: true,
        // D1 rows go with the user row (ON DELETE CASCADE); saved project files are in R2.
        beforeDelete: (user) => deleteAllFiles(env, user.id),
      },
    },
    plugins: [oAuthProxy({ productionURL: env.AUTH_ORIGIN, currentURL: origin })],
    telemetry: { enabled: false },
  });
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export async function currentUser(env: Env, request: Request): Promise<SessionUser | null> {
  if (!configured(env)) return null;
  const session = await createAuth(env, request).api.getSession({ headers: request.headers });
  if (!session) return null;
  const u = session.user;
  return { id: u.id, name: u.name, email: u.email, createdAt: new Date(u.createdAt).getTime() };
}

export async function requireUser(env: Env, request: Request): Promise<SessionUser> {
  db(env);
  const user = await currentUser(env, request);
  if (!user) throw new HttpError(401, 'Sign in first');
  return user;
}

/** GET /api/me: who is signed in, and which sign-in providers this site offers. */
export async function me(env: Env, request: Request): Promise<Response> {
  const providers = { google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) };
  const enabled = configured(env);
  const user = await currentUser(env, request);
  if (!user) return json({ enabled, providers, user: null });
  const accounts = await db(env)
    .prepare('SELECT "providerId" AS provider FROM "account" WHERE "userId" = ? ORDER BY "createdAt"')
    .bind(user.id)
    .all<{ provider: ProviderId }>();
  return json({
    enabled,
    providers,
    user: { ...user, identities: accounts.results.map((a) => ({ provider: a.provider, login: null, email: user.email })) },
  });
}

/** Everything under /api/auth/* is Better Auth's (sign-in/social, callback/google, sign-out, delete-user, ...). */
export function handle(env: Env, request: Request): Promise<Response> {
  if (!configured(env)) throw new HttpError(503, 'Accounts are not set up on this site yet');
  return createAuth(env, request).handler(request);
}

/**
 * GET /api/signin-done?popup=1[&return=/path][&error=code]: where a sign-in
 * ends. In the sign-in popup it tells the app's window (over a same-origin
 * channel: COOP cuts a popup off from window.opener once it has visited
 * Google) and closes; otherwise it goes back to the page the user was on.
 */
export function signInDone(request: Request): Response {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const message = error ? describeError(error) : '';
  if (url.searchParams.get('popup') !== '1') {
    const back = new URL(safeReturnPath(url.searchParams.get('return')), url.origin);
    if (error) back.hash = `auth-error=${encodeURIComponent(message)}`;
    return Response.redirect(back.toString(), 302);
  }
  const payload = JSON.stringify(error ? { type: 'error', message } : { type: 'signed-in' }).replace(/</g, '\\u003c');
  const text = error ? `Sign-in failed: ${message}` : 'Signed in. You can close this window.';
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cloud Slicer</title>
<body style="font:15px system-ui;padding:24px"><p>${escape(text)}</p>
<script>try{new BroadcastChannel('cloud-slicer-auth').postMessage(${payload})}catch(e){}${error ? '' : 'window.close()'}</script>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

function describeError(code: string): string {
  if (code === 'access_denied') return 'Sign-in was cancelled';
  return code.replace(/_/g, ' ').slice(0, 200);
}

/** Relative path inside the site, or "/" (never another site). */
export function safeReturnPath(value: string | null): string {
  if (!value || value.length > 1024 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}
