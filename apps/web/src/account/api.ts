// Client for the account API in functions/api (Cloudflare Pages Functions).
import type { EngineFlavor } from '../lib/engines';
import type { PresetEngines } from '../lib/preset-engines';

export type ProviderId = 'google';
export type PresetType = 'printer' | 'filament' | 'process';

export interface AccountUser {
  id: string;
  name: string;
  email: string | null;
  createdAt: number;
  identities: { provider: ProviderId; login: string | null; email: string | null }[];
  /** The site's owner (OWNER_EMAILS): sees the Admin page. */
  owner?: boolean;
}

export interface Me {
  /** False when the site has no account database (e.g. `npm run dev`, or not set up yet). */
  enabled: boolean;
  providers: Record<ProviderId, boolean>;
  user: AccountUser | null;
}

/**
 * An Orca user preset: `config` holds only what differs from the `inherits`
 * system preset; that is what Snapmaker Orca loads. `engines` holds
 * OrcaSlicer's part (src/lib/preset-engines.ts).
 */
export interface UserPreset {
  type: PresetType;
  name: string;
  inherits: string;
  config: Record<string, string>;
  engines?: PresetEngines;
  /** Server version, 0 for a preset only saved in this browser. */
  version: number;
  updatedAt: number;
}

/** A setup choice saved by key (e.g. the setup wizard's installed printers and filaments). */
export interface UserSetting<T = unknown> {
  key: string;
  value: T;
  version: number;
  updatedAt: number;
}

/** One of the user's physical printers and how to reach it. */
export interface Device {
  id: string;
  name: string;
  /** Printer preset (system or user) this machine prints with. */
  preset: string;
  /** Moonraker address, e.g. http://192.168.1.50 */
  url: string;
  /** The API key is fetched separately (getDeviceApiKey), never listed. */
  hasApiKey: boolean;
  /** Anything else the Device tab wants to keep per printer. */
  extra: Record<string, unknown>;
  version: number;
  updatedAt: number;
}

export interface DeviceInput {
  id: string;
  name: string;
  preset?: string;
  url?: string;
  /** A string sets it, null removes it, undefined keeps the saved one. */
  apiKey?: string | null;
  extra?: Record<string, unknown>;
  baseVersion?: number;
}

/** A project saved online (its 3MF and thumbnail are fetched separately). */
export interface OnlineProject {
  id: string;
  name: string;
  /** Bytes of the 3MF. */
  size: number;
  hasThumbnail: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** The engine it slices with. */
  engine: EngineFlavor;
}

export interface ProjectList {
  /** False when the site has no project storage (R2) yet. */
  enabled: boolean;
  projects: OnlineProject[];
  usage: { count: number; bytes: number };
  limits: { projectBytes: number; userBytes: number; userProjects: number };
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

async function call<T>(path: string, init: RequestInit = {}, contentType = 'application/json'): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': contentType } : undefined,
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
  /**
   * Starts a sign-in (Better Auth); returns the provider's page to open. The
   * way back is absolute: on a preview the provider returns via AUTH_ORIGIN,
   * which must send the user (or an error) back to this host.
   */
  startSignIn: (provider: ProviderId, opts: { returnTo: string; popup?: boolean }) => {
    const done = location.origin + signInDoneUrl(opts);
    return call<{ url: string }>('/api/auth/sign-in/social', {
      method: 'POST',
      body: JSON.stringify({ provider, callbackURL: done, errorCallbackURL: done, disableRedirect: true }),
    }).then((r) => r.url);
  },
  logout: () => call<{ success: boolean }>('/api/auth/sign-out', { method: 'POST', body: '{}' }),
  deleteAccount: () => call<{ success: boolean }>('/api/auth/delete-user', { method: 'POST', body: '{}' }),
  presets: () => call<{ presets: UserPreset[] }>('/api/presets').then((r) => r.presets),
  savePreset: (p: { type: PresetType; name: string; inherits: string; config: Record<string, string>; engines?: PresetEngines; baseVersion?: number }) =>
    call<{ preset: UserPreset }>(presetPath(p.type, p.name), {
      method: 'PUT',
      body: JSON.stringify({ inherits: p.inherits, config: p.config, engines: p.engines, baseVersion: p.baseVersion }),
    }).then((r) => r.preset),
  deletePreset: (type: PresetType, name: string) => call<{ ok: true }>(presetPath(type, name), { method: 'DELETE' }),
  settings: () => call<{ settings: UserSetting[] }>('/api/settings').then((r) => r.settings),
  saveSetting: (key: string, value: unknown, baseVersion?: number) =>
    call<{ setting: UserSetting }>(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value, baseVersion }),
    }).then((r) => r.setting),
  deleteSetting: (key: string) => call<{ ok: true }>(`/api/settings/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  devices: () => call<{ devices: Device[] }>('/api/devices').then((r) => r.devices),
  deviceApiKey: (id: string) => call<{ apiKey: string | null }>(`/api/devices/${encodeURIComponent(id)}/secret`).then((r) => r.apiKey),
  saveDevice: ({ id, ...rest }: DeviceInput) =>
    call<{ device: Device }>(`/api/devices/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(rest) }).then((r) => r.device),
  deleteDevice: (id: string) => call<{ ok: true }>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  projects: () => call<ProjectList>('/api/projects'),
  /** baseVersion: the version this save started from (0 = must be new); undefined overwrites. */
  saveProject: (id: string, name: string, file: Blob, baseVersion: number | undefined, engine: EngineFlavor) => {
    const q = new URLSearchParams({ name, engine });
    if (baseVersion !== undefined) q.set('baseVersion', String(baseVersion));
    return call<{ project: OnlineProject }>(`${projectPath(id)}?${q}`, { method: 'PUT', body: file }, 'model/3mf').then((r) => r.project);
  },
  saveProjectThumbnail: (id: string, png: Blob) =>
    call<{ ok: true }>(`${projectPath(id)}/thumbnail`, { method: 'PUT', body: png }, 'image/png'),
  renameProject: (id: string, name: string, baseVersion?: number) =>
    call<{ project: OnlineProject }>(projectPath(id), { method: 'PATCH', body: JSON.stringify({ name, baseVersion }) }).then((r) => r.project),
  deleteProject: (id: string) => call<{ ok: true }>(projectPath(id), { method: 'DELETE' }),
  /** A ticket that lets this account through the bridge relay for one bridge (about an hour). */
  relayTicket: (relay: string, bridgeId: string) =>
    call<{ ticket: string; expiresAt: number }>('/api/relay/ticket', { method: 'POST', body: JSON.stringify({ relay, bridgeId }) }),
  /** The bridge was removed: it no longer counts against the account's bridges. */
  forgetBridge: (bridgeId: string) => call<{ ok: true }>(`/api/relay/bridges/${encodeURIComponent(bridgeId)}`, { method: 'DELETE' }),
  /** The project's 3MF and the version it is at. */
  /** `onProgress`: bytes downloaded so far, of `total` (0 when the size is unknown). */
  async projectFile(id: string, onProgress?: (loaded: number, total: number) => void): Promise<{ bytes: ArrayBuffer; version: number }> {
    const res = await fetch(`${projectPath(id)}/file`, { credentials: 'same-origin' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError(res.status, String(body.error ?? res.statusText), body);
    }
    const version = Number(res.headers.get('X-Project-Version') ?? 0);
    if (!onProgress || !res.body) return { bytes: await res.arrayBuffer(), version };
    // A compressed response's length isn't the size of what it reads.
    const total = res.headers.get('Content-Encoding') ? 0 : Number(res.headers.get('Content-Length') ?? 0);
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const reader = res.body.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      chunks.push(r.value);
      loaded += r.value.byteLength;
      onProgress(loaded, total);
    }
    const bytes = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { bytes: bytes.buffer, version };
  },
};

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
export const projectThumbnailUrl = (p: Pick<OnlineProject, 'id' | 'version'>) => `${projectPath(p.id)}/thumbnail?v=${p.version}`;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Combines a setting saved in this browser with the account's copy at sign-in.
 * Lists of names (installed printers, chosen filaments) are unioned, also one
 * level down inside an object ({ printers: [...], filaments: [...] }); for
 * anything else the account's copy wins. Returns undefined when nothing changes.
 */
export function mergeSetting(account: unknown, local: unknown): unknown {
  const union = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.includes(x))];
  if (isStringArray(account) && isStringArray(local)) {
    const merged = union(account, local);
    return merged.length === account.length ? undefined : merged;
  }
  if (isPlainObject(account) && isPlainObject(local)) {
    let changed = false;
    const merged: Record<string, unknown> = { ...account };
    for (const [k, v] of Object.entries(local)) {
      if (!(k in account)) {
        merged[k] = v;
        changed = true;
      } else if (isStringArray(account[k]) && isStringArray(v)) {
        const u = union(account[k] as string[], v);
        if (u.length !== (account[k] as string[]).length) {
          merged[k] = u;
          changed = true;
        }
      }
    }
    return changed ? merged : undefined;
  }
  return undefined;
}

/** A new printer id. */
export const newDeviceId = () => crypto.randomUUID();

/** Where a sign-in ends: back to `returnTo`, or (popup) a page that tells the app and closes. */
export function signInDoneUrl(opts: { returnTo: string; popup?: boolean }): string {
  const q = new URLSearchParams({ return: opts.returnTo });
  if (opts.popup) q.set('popup', '1');
  return `/api/signin-done?${q.toString()}`;
}

/** Orca user preset file content (what goes in <dataDir>/user/default/<machine|filament|process>/<name>.json). */
export function toOrcaPresetJson(p: Pick<UserPreset, 'type' | 'name' | 'inherits' | 'config'>): Record<string, string> {
  // Orca skips a user preset file without a version.
  return { ...p.config, name: p.name, inherits: p.inherits, from: 'User', is_custom_defined: '0', version: '1.0.0' };
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
