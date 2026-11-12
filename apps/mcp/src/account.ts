// Signing the add-on in to the person's Cloud Slicer account, so it can use their
// own presets and printers. Better Auth's device authorization (RFC 8628, set up
// in apps/web/functions/_lib/auth.ts): the add-on asks for a code, the person
// opens the site's link (already signed in there) and taps Connect, and the add-on
// gets a session token of its own, sent as "Authorization: Bearer". No password
// or Google sign-in goes through the add-on or the AI app.
//
// The token is kept in a file only this computer's user can read
// (<config>/cloud-slicer/account.json), so the next start is still signed in.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The site; CLOUD_SLICER_SITE points the add-on at another one (tests, previews). */
export const SITE = (process.env.CLOUD_SLICER_SITE ?? 'https://slicer.awesomestuff.qzz.io').replace(/\/+$/, '');
/** The add-on's name to the site (PROGRAM_CLIENTS in auth.ts). */
const CLIENT_ID = 'cloud-slicer-mcp';

export function accountFile(): string {
  if (process.env.CLOUD_SLICER_ACCOUNT_FILE) return process.env.CLOUD_SLICER_ACCOUNT_FILE;
  const base =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
  return join(base, 'cloud-slicer', 'account.json');
}

interface Saved {
  site: string;
  token: string;
  name?: string;
  email?: string;
}

export interface Pending {
  code: string;
  link: string;
  expiresAt: number;
}

export class SignInError extends Error {}
/** The site refused a call; `status` is its HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class Account {
  private saved: Saved | null = null;
  private pending: (Pending & { deviceCode: string; interval: number; timer?: NodeJS.Timeout; failed?: string }) | null = null;

  private file: string;
  /** Called after signing in or out (or the site ending the sign-in). */
  onChange?: () => void;

  constructor(file = accountFile()) {
    this.file = file;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Saved;
      if (s.site === SITE && s.token) this.saved = s;
    } catch {
      // not signed in yet
    }
  }

  get signedIn() {
    return Boolean(this.saved);
  }

  /** Who is signed in, a sign-in waiting for the person, or neither. */
  async status() {
    if (this.saved) {
      const me = await this.me().catch((e: Error) => ({ error: e.message }));
      if ('error' in me) return { signedIn: this.signedIn, site: SITE, problem: me.error };
      return { signedIn: true, site: SITE, name: me.name, email: me.email };
    }
    if (this.pending?.failed) {
      const why = this.pending.failed;
      this.pending = null;
      return { signedIn: false, site: SITE, problem: why };
    }
    if (this.pending && this.pending.expiresAt > Date.now())
      return { signedIn: false, site: SITE, waiting: { code: this.pending.code, link: this.pending.link } };
    return { signedIn: false, site: SITE };
  }

  /**
   * Starts a sign-in: the code and link for the person. The add-on keeps checking in
   * the background (at the site's pace) and saves the session once they tap Connect.
   */
  async start(): Promise<Pending> {
    if (this.pending && this.pending.expiresAt > Date.now() + 60_000 && !this.pending.failed) return this.publicPending();
    this.stopWaiting();
    const r = await fetch(`${SITE}/api/auth/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new SignInError(String(body.message ?? body.error_description ?? `The site answered ${r.status}. Try again later.`));
    const link = String(body.verification_uri_complete ?? body.verification_uri);
    this.pending = {
      code: String(body.user_code),
      link,
      expiresAt: Date.now() + Number(body.expires_in ?? 600) * 1000,
      deviceCode: String(body.device_code),
      interval: Math.max(1, Number(body.interval ?? 5)),
    };
    this.schedule();
    return this.publicPending();
  }

  private publicPending(): Pending {
    const { code, link, expiresAt } = this.pending!;
    return { code, link, expiresAt };
  }

  private schedule() {
    const p = this.pending;
    if (!p) return;
    p.timer = setTimeout(() => void this.poll(), p.interval * 1000);
    p.timer.unref?.();
  }

  private stopWaiting() {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  /** One check of a waiting sign-in (RFC 8628 token request). */
  async poll(): Promise<boolean> {
    const p = this.pending;
    if (!p || p.failed) return false;
    if (p.expiresAt <= Date.now()) {
      p.failed = 'The sign-in code expired before it was approved. Sign in again for a new one.';
      return false;
    }
    const r = await fetch(`${SITE}/api/auth/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: p.deviceCode, client_id: CLIENT_ID }),
    }).catch(() => null);
    if (this.pending !== p) return false;
    const body = r ? ((await r.json().catch(() => ({}))) as Record<string, unknown>) : {};
    if (r?.ok && typeof body.access_token === 'string') {
      this.pending = null;
      await this.save({ site: SITE, token: body.access_token });
      return true;
    }
    const error = String(body.error ?? '');
    if (error === 'slow_down') p.interval += 5;
    else if (error === 'access_denied') {
      p.failed = 'The sign-in was turned down on the site.';
      return false;
    } else if (error === 'expired_token') {
      p.failed = 'The sign-in code expired before it was approved. Sign in again for a new one.';
      return false;
    }
    // authorization_pending, a network hiccup: keep waiting
    this.schedule();
    return false;
  }

  private async save(s: Saved) {
    this.saved = s;
    const me = await this.me().catch(() => null);
    if (me) Object.assign(s, { name: me.name, email: me.email });
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(s), { mode: 0o600 });
    this.onChange?.();
  }

  /** Signs out: ends the session on the site and forgets it here. */
  async signOut() {
    this.stopWaiting();
    const s = this.saved;
    this.saved = null;
    rmSync(this.file, { force: true });
    this.onChange?.();
    if (s) await fetch(`${SITE}/api/auth/sign-out`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  }

  /** A call to the site's /api as the signed-in person. */
  async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.saved) throw new SignInError('Not signed in. Use sign_in first.');
    const r = await fetch(`${SITE}/api${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.saved.token}`, 'content-type': 'application/json', ...init.headers },
    });
    if (r.status === 401) this.ended();
    const body = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new ApiError(body.error ?? `The site answered ${r.status}`, r.status);
    return body;
  }

  async me(): Promise<{ name: string; email: string }> {
    const r = await this.api<{ user: { name: string; email: string } | null }>('/me');
    if (!r.user) this.ended();
    return r.user;
  }

  /** The site no longer knows the session (signed out there, blocked, or expired). */
  private ended(): never {
    this.saved = null;
    rmSync(this.file, { force: true });
    this.onChange?.();
    throw new SignInError('The sign-in ended (signed out on the site, or it expired). Use sign_in again.');
  }
}
