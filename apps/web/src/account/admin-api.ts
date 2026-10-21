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
  projects: number;
  bytes: number;
  presets: number;
  printers: number;
  bridges: number;
  /** null = the site's default. */
  storageMb: number | null;
  /** False when the owner turned bridges off for this person. */
  bridgesAllowed: boolean;
}

export interface AdminBridge {
  id: string;
  lastUsed: number | null;
  /** Names of the accounts that use it. */
  people: string;
  /** Turned off by the owner. */
  off: boolean;
  /** Last use by a signed-out browser. */
  guestUsed: number | null;
}

export interface AdminOverview {
  settings: { inviteOnly: boolean; storageMb: number; guestRelay: boolean };
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

export const adminApi = {
  overview: () => call<AdminOverview>(''),
  /** The same without the free-tier numbers (usage is null): fast, for refreshing after a change. */
  quickOverview: () => call<Omit<AdminOverview, 'usage'> & { usage: null }>('?quick'),
  saveSettings: (s: Partial<AdminOverview['settings']>) => call('/settings', 'PUT', s),
  userAction: (id: string, action: 'block' | 'unblock' | 'allow' | 'disallow' | 'delete') => call(`/users/${encodeURIComponent(id)}/${action}`, 'POST', {}),
  setStorage: (id: string, storageMb: number | null) => call(`/users/${encodeURIComponent(id)}/storage`, 'PUT', { storageMb }),
  setBridges: (id: string, allowed: boolean) => call(`/users/${encodeURIComponent(id)}/bridges`, 'PUT', { allowed }),
  bridge: (id: string, action: 'off' | 'on') => call(`/bridges/${encodeURIComponent(id)}/${action}`, 'POST', {}),
  invite: (email: string) => call('/invites', 'POST', { email }),
  uninvite: (email: string) => call(`/invites/${encodeURIComponent(email)}`, 'DELETE'),
};
