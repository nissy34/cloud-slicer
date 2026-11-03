// Client for the owner's Admin API (functions/_lib/admin.ts).
import { ApiError } from './api';

export interface Meter {
  key: string;
  label: string;
  used: number;
  /** 0 when there is no limit to show. */
  limit: number;
  unit: 'bytes' | 'count';
  note?: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  createdAt: number | null;
  lastSeen: number | null;
  owner: boolean;
  blocked: boolean;
  /** On the invite-only list. */
  allowed: boolean;
  /** Saved projects (drafts aren't counted). */
  projects: number;
  presets: number;
  printers: number;
  bridges: number;
  /** False when the owner turned online projects off for this person. */
  projectsAllowed: boolean;
  /** False when the owner turned bridges off for this person. */
  bridgesAllowed: boolean;
  /** Bridges this person may use: null = the site's number, 0 = none, NO_LIMIT = any number. */
  bridgesLimit: number | null;
}

export interface AdminBridge {
  id: string;
  lastUsed: number | null;
  /** Names of the accounts that use it. */
  people: string;
  /** Turned off by the owner. */
  off: boolean;
  /** The name(s) it is saved under in people's printers ("Bridge on <computer>"); empty when nobody has it saved any more. */
  name: string;
  /** Names of the printers added to it. */
  printers: string;
}

export interface AdminOverview {
  settings: { inviteOnly: boolean; bridgesPerPerson: number };
  users: AdminUser[];
  invites: { email: string; addedAt: number }[];
  bridges: AdminBridge[];
  usage: { meters: Meter[]; analytics: 'ok' | 'not-set-up' | 'failed'; analyticsError?: string };
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? res.statusText), data);
  return data as T;
}

/** "No limit" for bridges per person (functions/_lib/access.ts NO_LIMIT). */
export const NO_LIMIT = -1;
/** How a bridge number reads on the Admin page. */
export const bridgeCount = (n: number) => (n === NO_LIMIT ? 'no limit' : n === 1 ? '1 bridge' : `${n} bridges`);

export const adminApi = {
  overview: () => call<AdminOverview>(''),
  /** The same without the free-tier numbers (usage is null): fast, for refreshing after a change. */
  quickOverview: () => call<Omit<AdminOverview, 'usage'> & { usage: null }>('?quick'),
  saveSettings: (s: Partial<AdminOverview['settings']>) => call('/settings', 'PUT', s),
  userAction: (id: string, action: 'block' | 'unblock' | 'allow' | 'disallow' | 'delete') => call(`/users/${encodeURIComponent(id)}/${action}`, 'POST', {}),
  setProjects: (id: string, allowed: boolean) => call(`/users/${encodeURIComponent(id)}/projects`, 'PUT', { allowed }),
  /** null = the site's number, 0 = none, NO_LIMIT = any number. */
  setBridges: (id: string, bridges: number | null) => call(`/users/${encodeURIComponent(id)}/bridges`, 'PUT', { bridges }),
  bridge: (id: string, action: 'off' | 'on') => call(`/bridges/${encodeURIComponent(id)}/${action}`, 'POST', {}),
  /** Takes an old bridge off the list (frees its place). */
  removeBridge: (id: string) => call(`/bridges/${encodeURIComponent(id)}`, 'DELETE'),
  invite: (email: string) => call('/invites', 'POST', { email }),
  uninvite: (email: string) => call(`/invites/${encodeURIComponent(email)}`, 'DELETE'),
};
