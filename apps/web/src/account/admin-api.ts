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
}

export interface AdminOverview {
  settings: { inviteOnly: boolean; storageMb: number; guestRelay: boolean };
  users: AdminUser[];
  invites: { email: string; addedAt: number }[];
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
  saveSettings: (s: Partial<AdminOverview['settings']>) => call('/settings', 'PUT', s),
  userAction: (id: string, action: 'block' | 'unblock' | 'allow' | 'disallow' | 'delete') => call(`/users/${encodeURIComponent(id)}/${action}`, 'POST', {}),
  setStorage: (id: string, storageMb: number | null) => call(`/users/${encodeURIComponent(id)}/storage`, 'PUT', { storageMb }),
  invite: (email: string) => call('/invites', 'POST', { email }),
  uninvite: (email: string) => call(`/invites/${encodeURIComponent(email)}`, 'DELETE'),
};
