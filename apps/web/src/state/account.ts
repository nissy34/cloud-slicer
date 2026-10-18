// Account state: who is signed in, and everything saved per user.
//
// Signed in, it lives in the account and follows the user to every device.
// Signed out, it is kept in this browser and merged into the account at the
// next sign-in. The same calls work either way:
//
// Presets (Orca user presets: a diff over the `inherits` system preset)
//   listUserPresets(type?) / useUserPresets(type)
//   saveUserPreset(type, name, inherits, diff) / deleteUserPreset(type, name)
// Setup choices (e.g. the setup wizard's installed printers and filaments)
//   getUserSetting(key) / useUserSetting(key)
//   saveUserSetting(key, value) / deleteUserSetting(key)
// Printers with their connection details
//   listDevices() / useDevices()
//   saveDevice({ id, name, preset, url, apiKey, extra }) / deleteDevice(id)
//   getDeviceApiKey(id)
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  api,
  ApiError,
  mergeSetting,
  type AccountUser,
  type Device,
  type DeviceInput,
  type PresetType,
  type ProviderId,
  type UserPreset,
  type UserSetting,
} from '../account/api';

export type AccountStatus = 'loading' | 'unavailable' | 'signedOut' | 'signedIn';

interface AccountState {
  status: AccountStatus;
  user: AccountUser | null;
  providers: Record<ProviderId, boolean>;
  presets: UserPreset[];
  settings: Record<string, UserSetting>;
  devices: Device[];
  /** Last sign-in or sync problem, for the account menu. */
  error: string;

  init(): void;
  refresh(): Promise<void>;
  signIn(provider: ProviderId): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  clearError(): void;
}

const CHANNEL = 'cloud-slicer-auth';

// ---- this browser's copy (signed out) ----------------------------------------

/** A printer saved in this browser keeps its API key next to it. */
type LocalDevice = Device & { apiKey?: string | null };

function localStore<T>(key: string, empty: T) {
  return {
    load(): T {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : empty;
      } catch {
        return empty;
      }
    },
    save(value: T, isEmpty: boolean) {
      try {
        if (isEmpty) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage unavailable: kept until the tab closes
      }
    },
  };
}
const localPresets = localStore<UserPreset[]>('cloud-slicer:user-presets:v1', []);
const localSettings = localStore<Record<string, UserSetting>>('cloud-slicer:user-settings:v1', {});
const localDevices = localStore<LocalDevice[]>('cloud-slicer:devices:v1', []);

const savePresetsLocal = (p: UserPreset[]) => localPresets.save(p, !p.length);
const saveSettingsLocal = (s: Record<string, UserSetting>) => localSettings.save(s, !Object.keys(s).length);
const saveDevicesLocal = (d: LocalDevice[]) => localDevices.save(d, !d.length);

const publicDevice = ({ apiKey, ...d }: LocalDevice): Device => ({ ...d, hasApiKey: Boolean(apiKey) });
const localState = () => ({
  presets: localPresets.load(),
  settings: localSettings.load(),
  devices: localDevices.load().map(publicDevice),
});

const byTypeAndName = (a: UserPreset, b: UserPreset) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
const byName = (a: Device, b: Device) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const same = (p: UserPreset, type: PresetType, name: string) => p.type === type && p.name === name;
const keyed = (list: UserSetting[]) => Object.fromEntries(list.map((s) => [s.key, s]));

// ---- moving this browser's copy into the account at sign-in --------------------

/** Presets: a name already on the account keeps both ("My PLA (2)"). */
async function mergePresets(server: UserPreset[]): Promise<UserPreset[]> {
  const out = [...server];
  const left: UserPreset[] = [];
  for (const p of localPresets.load()) {
    let name = p.name;
    for (let n = 2; out.some((s) => same(s, p.type, name)); n++) name = `${p.name} (${n})`;
    try {
      out.push(await api.savePreset({ ...p, name, baseVersion: 0 }));
    } catch {
      left.push(p);
    }
  }
  savePresetsLocal(left);
  return out.sort(byTypeAndName);
}

/** Settings: lists of names are unioned (see mergeSetting); otherwise the account's copy wins. */
async function mergeSettings(server: UserSetting[]): Promise<Record<string, UserSetting>> {
  const out = keyed(server);
  const left: Record<string, UserSetting> = {};
  for (const [key, local] of Object.entries(localSettings.load())) {
    const account = out[key];
    const value = account ? mergeSetting(account.value, local.value) : local.value;
    if (value === undefined) continue;
    try {
      out[key] = await api.saveSetting(key, value, account?.version ?? 0);
    } catch {
      left[key] = local;
    }
  }
  saveSettingsLocal(left);
  return out;
}

/** Printers: added unless the account already has that printer (same id or address). */
async function mergeDevices(server: Device[]): Promise<Device[]> {
  const out = [...server];
  const left: LocalDevice[] = [];
  for (const d of localDevices.load()) {
    if (out.some((s) => s.id === d.id || (d.url && s.url === d.url))) continue;
    try {
      out.push(await api.saveDevice({ ...d, apiKey: d.apiKey ?? undefined, baseVersion: 0 }));
    } catch {
      left.push(d);
    }
  }
  saveDevicesLocal(left);
  return out.sort(byName);
}

let started = false;

export const useAccount = create<AccountState>((set, get) => ({
  status: 'loading',
  user: null,
  providers: { google: false },
  ...localState(),
  error: '',

  init() {
    if (started) return;
    started = true;
    // A full-page sign-in that failed comes back as #auth-error=<message>.
    const m = /(?:^#|&)auth-error=([^&]*)/.exec(location.hash);
    if (m) {
      set({ error: decodeURIComponent(m[1]) });
      history.replaceState(null, '', location.pathname + location.search);
    }
    // The sign-in popup reports back over a same-origin channel (COOP cuts the
    // popup off from window.opener once it visits the provider).
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel(CHANNEL).onmessage = (e: MessageEvent<{ type: string; message?: string }>) => {
        if (e.data?.type === 'signed-in') void get().refresh();
        if (e.data?.type === 'error') set({ error: e.data.message ?? 'Sign-in failed' });
      };
    }
    void get().refresh();
  },

  async refresh() {
    try {
      const me = await api.me();
      if (!me.enabled) return set({ status: 'unavailable', user: null, providers: me.providers });
      if (!me.user) return set({ status: 'signedOut', user: null, providers: me.providers, ...localState() });
      const justSignedIn = !(get().status === 'signedIn' && get().user?.id === me.user.id);
      set({ status: 'signedIn', user: me.user, providers: me.providers });
      const [presets, settings, devices] = await Promise.all([api.presets(), api.settings(), api.devices()]);
      if (!justSignedIn) return set({ presets, settings: keyed(settings), devices });
      set({ presets: await mergePresets(presets), settings: await mergeSettings(settings), devices: await mergeDevices(devices) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) set({ status: 'unavailable', user: null });
      else set({ error: (e as Error).message });
    }
  },

  async signIn(provider) {
    set({ error: '' });
    const returnTo = location.pathname + location.search;
    // A popup keeps the open model; it is opened right away (before any await)
    // so the browser counts it as a click. Blocked: sign in in this tab.
    const popup = window.open('about:blank', 'cloud-slicer-signin', 'popup,width=520,height=680');
    try {
      const url = await api.startSignIn(provider, { returnTo, popup: Boolean(popup) });
      if (popup) popup.location.href = url;
      else location.assign(url);
    } catch (e) {
      popup?.close();
      set({ error: (e as Error).message });
    }
  },

  async signOut() {
    try {
      await api.logout();
    } catch (e) {
      set({ error: (e as Error).message });
    }
    set({ status: 'signedOut', user: null, ...localState() });
  },

  async deleteAccount() {
    try {
      await api.deleteAccount();
      set({ status: 'signedOut', user: null, ...localState() });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  clearError: () => set({ error: '' }),
}));

const signedIn = () => useAccount.getState().status === 'signedIn';

// ---- presets -------------------------------------------------------------------

/** The user's presets, optionally of one type. */
export function listUserPresets(type?: PresetType): UserPreset[] {
  const all = useAccount.getState().presets;
  return type ? all.filter((p) => p.type === type) : all;
}

/** Hook form of listUserPresets (shallow-compared, so it doesn't re-render needlessly). */
export function useUserPresets(type: PresetType): UserPreset[] {
  return useAccount(useShallow((s) => s.presets.filter((p) => p.type === type)));
}

/**
 * Creates or updates a user preset: `diff` is only the options that differ
 * from the `inherits` system preset. Throws ApiError 409 when the preset was
 * changed on another device since this one loaded it, unless `overwrite`.
 */
export async function saveUserPreset(
  type: PresetType,
  name: string,
  inherits: string,
  diff: Record<string, string>,
  opts: { overwrite?: boolean } = {},
): Promise<UserPreset> {
  const existing = useAccount.getState().presets.find((p) => same(p, type, name));
  const saved = signedIn()
    ? await api.savePreset({ type, name, inherits, config: diff, baseVersion: opts.overwrite ? undefined : (existing?.version ?? 0) })
    : { type, name, inherits, config: diff, version: 0, updatedAt: Date.now() };
  const next = [...useAccount.getState().presets.filter((p) => !same(p, type, name)), saved].sort(byTypeAndName);
  useAccount.setState({ presets: next });
  if (!signedIn()) savePresetsLocal(next);
  return saved;
}

export async function deleteUserPreset(type: PresetType, name: string): Promise<void> {
  if (signedIn()) await api.deletePreset(type, name);
  const next = useAccount.getState().presets.filter((p) => !same(p, type, name));
  useAccount.setState({ presets: next });
  if (!signedIn()) savePresetsLocal(next);
}

// ---- setup choices ---------------------------------------------------------------

/** A saved setup choice, e.g. getUserSetting<string[]>('installedPrinters'). */
export function getUserSetting<T>(key: string): T | undefined {
  return useAccount.getState().settings[key]?.value as T | undefined;
}

export function useUserSetting<T>(key: string): T | undefined {
  return useAccount((s) => s.settings[key]?.value as T | undefined);
}

/** Saves a setup choice (any JSON value up to 64 KB). The last save wins. */
export async function saveUserSetting<T>(key: string, value: T): Promise<void> {
  const setting: UserSetting = signedIn() ? await api.saveSetting(key, value) : { key, value, version: 0, updatedAt: Date.now() };
  const next = { ...useAccount.getState().settings, [key]: setting };
  useAccount.setState({ settings: next });
  if (!signedIn()) saveSettingsLocal(next);
}

export async function deleteUserSetting(key: string): Promise<void> {
  if (signedIn()) await api.deleteSetting(key);
  const next = { ...useAccount.getState().settings };
  delete next[key];
  useAccount.setState({ settings: next });
  if (!signedIn()) saveSettingsLocal(next);
}

// ---- printers --------------------------------------------------------------------

export const listDevices = () => useAccount.getState().devices;
export const useDevices = () => useAccount((s) => s.devices);

/**
 * Saves a printer and its connection details (use newDeviceId() for a new
 * one). apiKey: a string sets it, null removes it, undefined keeps it.
 */
export async function saveDevice(input: DeviceInput): Promise<Device> {
  let saved: Device;
  if (signedIn()) {
    saved = await api.saveDevice(input);
  } else {
    const all = localDevices.load();
    const old = all.find((d) => d.id === input.id);
    const local: LocalDevice = {
      id: input.id,
      name: input.name,
      preset: input.preset ?? '',
      url: input.url ?? '',
      extra: input.extra ?? {},
      hasApiKey: false,
      apiKey: input.apiKey === undefined ? (old?.apiKey ?? null) : input.apiKey,
      version: 0,
      updatedAt: Date.now(),
    };
    saveDevicesLocal([...all.filter((d) => d.id !== input.id), local]);
    saved = publicDevice(local);
  }
  useAccount.setState({ devices: [...useAccount.getState().devices.filter((d) => d.id !== input.id), saved].sort(byName) });
  return saved;
}

export async function deleteDevice(id: string): Promise<void> {
  if (signedIn()) await api.deleteDevice(id);
  else saveDevicesLocal(localDevices.load().filter((d) => d.id !== id));
  useAccount.setState({ devices: useAccount.getState().devices.filter((d) => d.id !== id) });
}

/** The printer's API key, or null when none is saved. */
export async function getDeviceApiKey(id: string): Promise<string | null> {
  if (signedIn()) return api.deviceApiKey(id);
  return localDevices.load().find((d) => d.id === id)?.apiKey ?? null;
}
