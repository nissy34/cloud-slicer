// Google sign-in (OAuth authorization code flow with PKCE). ProviderId leaves
// room for more providers; GitHub was dropped to keep setup simple.
import { HttpError } from './http';
import type { Env } from './types';

export type ProviderId = 'google';
export const PROVIDERS: ProviderId[] = ['google'];

export interface Profile {
  subject: string;
  name: string;
  email: string | null;
  login: string | null;
}

interface Endpoints {
  authorize: string;
  token: string;
  user: string;
}

function endpoints(env: Env, id: ProviderId): Endpoints {
  const mock = env.OAUTH_TEST_BASE;
  if (mock) return { authorize: `${mock}/${id}/authorize`, token: `${mock}/${id}/token`, user: `${mock}/${id}/user` };
  return {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    user: 'https://openidconnect.googleapis.com/v1/userinfo',
  };
}

function credentials(env: Env, _id: ProviderId) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const secret = env.GOOGLE_CLIENT_SECRET;
  return clientId && secret ? { clientId, secret } : null;
}

export const isConfigured = (env: Env, id: ProviderId) => credentials(env, id) !== null;

export function authorizeUrl(env: Env, id: ProviderId, p: { redirectUri: string; state: string; challenge: string }): string {
  const creds = credentials(env, id);
  if (!creds) throw new HttpError(503, `${id} sign-in is not set up`);
  const url = new URL(endpoints(env, id).authorize);
  const q = url.searchParams;
  q.set('client_id', creds.clientId);
  q.set('redirect_uri', p.redirectUri);
  q.set('state', p.state);
  q.set('code_challenge', p.challenge);
  q.set('code_challenge_method', 'S256');
  q.set('response_type', 'code');
  q.set('scope', 'openid email profile');
  q.set('prompt', 'select_account');
  return url.toString();
}

/** Trades the callback's code for the user's profile. */
export async function fetchProfile(
  env: Env,
  id: ProviderId,
  p: { code: string; redirectUri: string; verifier: string },
): Promise<Profile> {
  const creds = credentials(env, id);
  if (!creds) throw new HttpError(503, `${id} sign-in is not set up`);
  const ep = endpoints(env, id);
  const tokenRes = await fetch(ep.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: creds.clientId,
      client_secret: creds.secret,
      code_verifier: p.verifier,
    }),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !token.access_token) throw new HttpError(502, `${id} refused the sign-in (${token.error ?? tokenRes.status})`);

  const userRes = await fetch(ep.user, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', 'User-Agent': 'cloud-slicer' },
  });
  if (!userRes.ok) throw new HttpError(502, `${id} profile request failed (${userRes.status})`);
  const u = (await userRes.json()) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

  if (!str(u.sub)) throw new HttpError(502, 'Google returned no account id');
  return {
    subject: String(u.sub),
    name: str(u.name) ?? str(u.email) ?? 'Google user',
    email: u.email_verified === false ? null : str(u.email),
    login: null,
  };
}
