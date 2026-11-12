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
import { APIError } from 'better-auth/api';
import { admin, bearer, deviceAuthorization, oAuthProxy } from 'better-auth/plugins';
import { isOwner, ownerEmails, projectsAllowed, signInRefusal } from './access';
import { HttpError, json } from './http';
import { DRIVE_SCOPE, hasDriveScope, pickerConfig } from './drive';
import type { Env } from './types';

export type ProviderId = 'google';

const DAY = 24 * 3600;

/** Programs that may ask to sign in (device-authorization client ids). */
export const PROGRAM_CLIENTS = new Set(['cloud-slicer-mcp']);

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

/** The owners' user ids (OWNER_EMAILS), for the admin plugin. One indexed lookup (Better Auth keeps emails lower case), only for Admin page actions. */
async function ownerIds(env: Env): Promise<string[]> {
  const emails = ownerEmails(env);
  if (!emails.length) return [];
  const rows = await db(env)
    .prepare(`SELECT id FROM "user" WHERE email IN (${emails.map(() => '?').join(',')})`)
    .bind(...emails)
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/**
 * Hidden guard on program sign-ins (no visible quota): expired codes are cleared,
 * and while too many are waiting site-wide a new one is refused, so nothing that
 * keeps asking for codes can fill D1. Each code lasts 10 minutes.
 */
const MAX_PENDING_PROGRAM_SIGN_INS = 200;
async function programSignInGuard(env: Env, _request: Request) {
  const d = db(env);
  await d.prepare('DELETE FROM "deviceCode" WHERE "expiresAt" < ?').bind(new Date().toISOString()).run();
  const row = await d.prepare('SELECT COUNT(*) AS n FROM "deviceCode"').first<{ n: number }>();
  if ((row?.n ?? 0) >= MAX_PENDING_PROGRAM_SIGN_INS)
    throw APIError.from('TOO_MANY_REQUESTS', { code: 'SLOW_DOWN', message: 'Too many sign-ins are waiting right now. Try again in a few minutes.' });
}

/** Refuses a sign-in the way Better Auth reports errors: the sign-in page shows `message`. */
function refuse(message: string): never {
  throw APIError.from('FORBIDDEN', { code: 'INVITE_ONLY', message });
}

/**
 * Better Auth for this request. `admin: true` (the Admin page's actions in admin.ts) looks
 * up the owners so the admin plugin lets them block and remove people; every other
 * request skips that D1 query, and the plugin's own admin endpoints refuse everyone.
 */
export async function createAuth(env: Env, request: Request, { admin: forAdmin = false } = {}) {
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
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              prompt: 'select_account',
              // Projects are kept in the person's own Google Drive (drive.ts): sign-in asks
              // for it (only files the app makes), with a refresh key so saving keeps working.
              scope: [DRIVE_SCOPE],
              accessType: 'offline',
            },
          }
        : {},
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    account: { encryptOAuthTokens: true },
    user: { deleteUser: { enabled: true } },
    // Invite only: no new account, and no new session, for an email that isn't allowed.
    // (Blocked users are the admin plugin's: it refuses their sessions itself.)
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const why = await signInRefusal(env, user.email);
            if (why) refuse(why);
          },
        },
        // Deleting an account (the user's own Delete account, or Delete on the Admin page):
        // D1 rows go with the user row (ON DELETE CASCADE). Project files are in the
        // person's own Google Drive and stay there.
      },
      session: {
        create: {
          before: async (session) => {
            const u = await db(env).prepare('SELECT email FROM "user" WHERE id = ?').bind(session.userId).first<{ email: string }>();
            const why = u ? await signInRefusal(env, u.email) : null;
            if (why) refuse(why);
          },
        },
      },
    },
    plugins: [
      oAuthProxy({ productionURL: env.AUTH_ORIGIN, currentURL: origin }),
      // Signing in a program on the person's computer (the MCP add-on, apps/mcp): it
      // shows a short code, the person approves it on the site (#link=CODE, signed in
      // there already), and the program gets a session of its own, sent as a bearer
      // token. No password or Google sign-in goes through the program.
      deviceAuthorization({
        expiresIn: '10m',
        interval: '5s',
        verificationUri: `${env.AUTH_ORIGIN ?? origin}/#link`,
        validateClient: (id) => PROGRAM_CLIENTS.has(id),
        onDeviceAuthRequest: () => programSignInGuard(env, request),
      }),
      // A program's session token, sent as "Authorization: Bearer", counts as its session.
      bearer({ requireSignature: false }),
      // Block / unblock and the user list for the Admin page; only the owners may use it.
      admin({
        adminUserIds: forAdmin ? await ownerIds(env) : [],
        bannedUserMessage: "This account has been blocked on Cloud Slicer. Ask the site's owner if you think that's a mistake.",
      }),
    ],
    telemetry: { enabled: false },
    // Better Auth would otherwise read every table's columns (one pragma_table_info query
    // per table) to check its schema. It remembers the answer per instance, but we build
    // a new instance per request, so it ran on every request: half of all D1 time.
    // migrations/0001_better_auth.sql sets up the schema, so the check adds nothing.
    advanced: { database: { validateSchema: false } },
  });
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  /** One of OWNER_EMAILS: may open the Admin page. */
  owner: boolean;
}

export async function currentUser(env: Env, request: Request): Promise<SessionUser | null> {
  if (!configured(env)) return null;
  const session = await (await createAuth(env, request)).api.getSession({ headers: request.headers });
  if (!session) return null;
  const u = session.user;
  return { id: u.id, name: u.name, email: u.email, createdAt: new Date(u.createdAt).getTime(), owner: isOwner(env, u.email) };
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
    .prepare(
      'SELECT "providerId" AS provider, scope, "refreshToken" IS NOT NULL AS refresh, "accessTokenExpiresAt" AS expires FROM "account" WHERE "userId" = ? ORDER BY "createdAt"',
    )
    .bind(user.id)
    .all<{ provider: ProviderId; scope: string | null; refresh: number; expires: string | number | null }>();
  const drive = accounts.results.find((a) => a.provider === 'google' && hasDriveScope(a.scope));
  return json({
    enabled,
    providers,
    user: {
      ...user,
      identities: accounts.results.map((a) => ({ provider: a.provider, login: null, email: user.email })),
      // Projects save online only into their Google Drive (drive.ts).
      drive: Boolean(drive),
      // Connected, but its key ran out and there is no refresh key to get another: the account menu offers Connect again.
      // (A refresh key Google stopped accepting only shows when a save tries it: the page then offers Connect too.)
      driveReconnect: Boolean(drive && !drive.refresh && drive.expires !== null && new Date(drive.expires).getTime() < Date.now()),
      // False when the site's owner turned online projects off for them (Admin page).
      projects: await projectsAllowed(env, user.id),
      // Open from Google Drive works: the site has the key Google's file window needs.
      drivePicker: Boolean(pickerConfig(env)),
    },
  });
}

/** Everything under /api/auth/* is Better Auth's (sign-in/social, callback/google, sign-out, delete-user, ...). */
export async function handle(env: Env, request: Request): Promise<Response> {
  if (!configured(env)) throw new HttpError(503, 'Accounts are not set up on this site yet');
  return (await createAuth(env, request)).handler(request);
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
  const message = error ? describeError(error, url.searchParams.get('error_description')) : '';
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

function describeError(code: string, description: string | null): string {
  if (code === 'access_denied') return 'Sign-in was cancelled';
  // Our own refusals (invite only, blocked) carry a sentence for the user.
  if ((code === 'INVITE_ONLY' || code === 'BANNED_USER') && description) return description.slice(0, 300);
  return code.replace(/_/g, ' ').slice(0, 200);
}

/** Relative path inside the site, or "/" (never another site). */
export function safeReturnPath(value: string | null): string {
  if (!value || value.length > 1024 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}
