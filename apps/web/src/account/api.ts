// Client for the account API in functions/api (Cloudflare Pages Functions).

export type ProviderId = 'google' | 'github';
export type PresetType = 'printer' | 'filament' | 'process';

export interface AccountUser {
  id: string;
  name: string;
  email: string | null;
  createdAt: number;
  identities: { provider: ProviderId; login: string | null; email: string | null }[];
}

export interface Me {
  /** False when the site has no account database (e.g. `npm run dev`, or not set up yet). */
  enabled: boolean;
  providers: Record<ProviderId, boolean>;
  user: AccountUser | null;
}

/** An Orca user preset: `config` holds only what differs from the `inherits` system preset. */
export interface UserPreset {
  type: PresetType;
  name: string;
  inherits: string;
  config: Record<string, string>;
  /** Server version, 0 for a preset only saved in this browser. */
  version: number;
  updatedAt: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const type = res.headers.get('Content-Type') ?? '';
  // Without Functions (vite dev/preview) /api/* falls through to index.html.
  if (!type.includes('application/json')) throw new ApiError(404, 'Accounts are not available on this server');
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? res.statusText), body);
  return body as T;
}

const presetPath = (type: PresetType, name: string) => `/api/presets/${type}/${encodeURIComponent(name)}`;

export const api = {
  me: () => call<Me>('/api/me'),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  deleteAccount: () => call<{ ok: true }>('/api/me', { method: 'DELETE' }),
  presets: () => call<{ presets: UserPreset[] }>('/api/presets').then((r) => r.presets),
  savePreset: (p: { type: PresetType; name: string; inherits: string; config: Record<string, string>; baseVersion?: number }) =>
    call<{ preset: UserPreset }>(presetPath(p.type, p.name), {
      method: 'PUT',
      body: JSON.stringify({ inherits: p.inherits, config: p.config, baseVersion: p.baseVersion }),
    }).then((r) => r.preset),
  deletePreset: (type: PresetType, name: string) => call<{ ok: true }>(presetPath(type, name), { method: 'DELETE' }),
};

/** URL that starts a sign-in and comes back to `returnTo`. */
export function signInUrl(provider: ProviderId, opts: { returnTo: string; popup?: boolean; link?: boolean }): string {
  const q = new URLSearchParams({ return: opts.returnTo });
  if (opts.popup) q.set('popup', '1');
  if (opts.link) q.set('link', '1');
  return `/api/auth/${provider}/start?${q.toString()}`;
}

/** Orca user preset file content (what goes in <dataDir>/user/default/<machine|filament|process>/<name>.json). */
export function toOrcaPresetJson(p: Pick<UserPreset, 'type' | 'name' | 'inherits' | 'config'>): Record<string, string> {
  return { ...p.config, name: p.name, inherits: p.inherits, from: 'User', is_custom_defined: '0' };
}

/** Orca's folder name for a preset type. */
export const orcaFolder = (type: PresetType) => (type === 'printer' ? 'machine' : type);

/** Same rule as the server: names become file names in the engine. */
export function presetNameError(name: string): string | null {
  const n = name.trim();
  // eslint-disable-next-line no-control-regex
  if (!n || n.length > 128 || /[/\\:*?"<>|\u0000-\u001f]/.test(n))
    return 'Use 1-128 characters, without / \\ : * ? " < > |';
  return null;
}
