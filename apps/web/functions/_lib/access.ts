// Who may use the site: the owner (OWNER_EMAILS), the "Invite only" switch
// and its allow list, and how much each user may store. Blocking is Better
// Auth's admin plugin (auth.ts); this file holds the site's own settings.
import type { Env } from './types';

export interface AccessSettings {
  /** Only owners and allowed emails may sign in. */
  inviteOnly: boolean;
  /** Online project storage per user, in MB, unless set per user. 0 = presets only. */
  storageMb: number;
}

export const DEFAULT_ACCESS: AccessSettings = { inviteOnly: false, storageMb: 200 };
/** Most anyone can be given (the site as a whole stays under R2's free 10 GB). */
export const MAX_STORAGE_MB = 2048;

export const normalEmail = (email: string) => email.trim().toLowerCase();

export function ownerEmails(env: Env): string[] {
  return (env.OWNER_EMAILS ?? '').split(/[,\s]+/).map(normalEmail).filter(Boolean);
}

export const isOwner = (env: Env, email: string | null | undefined) => !!email && ownerEmails(env).includes(normalEmail(email));

export async function accessSettings(env: Env): Promise<AccessSettings> {
  const row = await env.DB!.prepare("SELECT value FROM site_settings WHERE key = 'access'").first<{ value: string }>().catch(() => null);
  if (!row) return { ...DEFAULT_ACCESS };
  try {
    return { ...DEFAULT_ACCESS, ...(JSON.parse(row.value) as Partial<AccessSettings>) };
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

/** The user's online project storage in bytes (0 = presets only). */
export async function storageBytes(env: Env, userId: string): Promise<number> {
  const own = await env.DB!.prepare('SELECT storage_mb FROM user_limits WHERE user_id = ?')
    .bind(userId)
    .first<{ storage_mb: number | null }>()
    .catch(() => null);
  const mb = own?.storage_mb ?? (await accessSettings(env)).storageMb;
  return Math.max(0, mb) * 1024 * 1024;
}
