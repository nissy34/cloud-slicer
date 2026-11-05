// Who may use the site: the owner (OWNER_EMAILS), the "Invite only" switch
// and its allow list, and who may save projects online. Blocking is Better
// Auth's admin plugin (auth.ts); this file holds the site's own settings.
import type { Env } from './types';

export interface AccessSettings {
  /** Only owners and allowed emails may sign in. */
  inviteOnly: boolean;
  /** Bridges each person may use (NO_LIMIT = any number), unless the owner set another number for them (user_limits.bridges). */
  bridgesPerPerson: number;
}

/** "No limit" for bridges per person, in site_settings and in user_limits.bridges. */
export const NO_LIMIT = -1;



export const DEFAULT_ACCESS: AccessSettings = { inviteOnly: false, bridgesPerPerson: 1 };

/** A bridge number: any whole number from `min` up, or NO_LIMIT; null when it isn't one. One bridge reaches every printer on its network. */
export const bridgeNumber = (v: unknown, min = 1): number | null =>
  v === NO_LIMIT || (Number.isSafeInteger(v) && (v as number) >= min) ? (v as number) : null;

export const normalEmail = (email: string) => email.trim().toLowerCase();

export function ownerEmails(env: Env): string[] {
  return (env.OWNER_EMAILS ?? '').split(/[,\s]+/).map(normalEmail).filter(Boolean);
}

export const isOwner = (env: Env, email: string | null | undefined) => !!email && ownerEmails(env).includes(normalEmail(email));

export async function accessSettings(env: Env): Promise<AccessSettings> {
  const row = await env.DB!.prepare("SELECT value FROM site_settings WHERE key = 'access'").first<{ value: string }>().catch(() => null);
  if (!row) return { ...DEFAULT_ACCESS };
  try {
    const saved = JSON.parse(row.value) as Partial<AccessSettings>;
    return { inviteOnly: saved.inviteOnly === true, bridgesPerPerson: bridgeNumber(saved.bridgesPerPerson) ?? DEFAULT_ACCESS.bridgesPerPerson };
  } catch {
    return { ...DEFAULT_ACCESS };
  }
}

export async function saveAccessSettings(env: Env, s: AccessSettings) {
  await env.DB!.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('access', ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(s), Date.now())
    .run();
}

export async function isAllowedEmail(env: Env, email: string): Promise<boolean> {
  const row = await env.DB!.prepare('SELECT 1 AS ok FROM allowed_emails WHERE email = ?').bind(normalEmail(email)).first();
  return !!row;
}

/** Null when this email may sign in; otherwise the message the sign-in page shows. */
export async function signInRefusal(env: Env, email: string): Promise<string | null> {
  if (isOwner(env, email)) return null;
  const s = await accessSettings(env);
  if (!s.inviteOnly || (await isAllowedEmail(env, email))) return null;
  return "Cloud Slicer is invite only for now, and this Google account isn't on the list. Ask the site's owner to add your email.";
}

/**
 * Whether the person may save projects online (into their Google Drive). On
 * unless the owner turned it off for them on the Admin page.
 */
export async function projectsAllowed(env: Env, userId: string): Promise<boolean> {
  const own = await env.DB!.prepare('SELECT projects FROM user_limits WHERE user_id = ?')
    .bind(userId)
    .first<{ projects: number | null }>()
    .catch(() => null);
  return own?.projects !== 0;
}
