// Account state: who is signed in, and the user's own presets.
//
// Presets API for the preset pickers:
//   listUserPresets(type?)                        current list (sync)
//   useUserPresets(type)                          same, as a React hook
//   saveUserPreset(type, name, inherits, diff)    create or update
//   deleteUserPreset(type, name)
// Signed in, presets live on the server and follow the user to every device.
// Signed out, they are kept in this browser and uploaded at the next sign-in.
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { api, ApiError, signInUrl, type AccountUser, type PresetType, type ProviderId, type UserPreset } from '../account/api';

export type AccountStatus = 'loading' | 'unavailable' | 'signedOut' | 'signedIn';

interface AccountState {
  status: AccountStatus;
  user: AccountUser | null;
  providers: Record<ProviderId, boolean>;
  presets: UserPreset[];
  /** Last sign-in or sync problem, for the account menu. */
  error: string;

  init(): void;
  refresh(): Promise<void>;
  signIn(provider: ProviderId, opts?: { link?: boolean }): void;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  clearError(): void;
}

const LOCAL_KEY = 'cloud-slicer:user-presets:v1';
const CHANNEL = 'cloud-slicer-auth';

function loadLocal(): UserPreset[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as UserPreset[]) : [];
  } catch {
    return [];
  }
}
function saveLocal(presets: UserPreset[]) {
  try {
    if (presets.length) localStorage.setItem(LOCAL_KEY, JSON.stringify(presets));
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    // storage unavailable: presets last until the tab closes
  }
}

const byTypeAndName = (a: UserPreset, b: UserPreset) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
const same = (p: UserPreset, type: PresetType, name: string) => p.type === type && p.name === name;

let started = false;

export const useAccount = create<AccountState>((set, get) => {
  /** Uploads presets saved while signed out; a name already on the account keeps both. */
  async function uploadLocal(server: UserPreset[]): Promise<UserPreset[]> {
    const local = loadLocal();
    if (!local.length) return server;
    const out = [...server];
    const left: UserPreset[] = [];
    for (const p of local) {
      let name = p.name;
      for (let n = 2; out.some((s) => same(s, p.type, name)); n++) name = `${p.name} (${n})`;
      try {
        out.push(await api.savePreset({ ...p, name, baseVersion: 0 }));
      } catch {
        left.push(p);
      }
    }
    saveLocal(left);
    return out.sort(byTypeAndName);
  }

  return {
    status: 'loading',
    user: null,
    providers: { google: false, github: false },
    presets: loadLocal(),
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
      // The sign-in popup reports back over a same-origin channel (COOP cuts
      // the popup off from window.opener once it visits the provider).
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
        if (!me.user) return set({ status: 'signedOut', user: null, providers: me.providers, presets: loadLocal() });
        const wasSignedIn = get().status === 'signedIn' && get().user?.id === me.user.id;
        set({ status: 'signedIn', user: me.user, providers: me.providers });
        const presets = await api.presets();
        set({ presets: wasSignedIn ? presets : await uploadLocal(presets) });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) set({ status: 'unavailable', user: null });
        else set({ error: (e as Error).message });
      }
    },

    signIn(provider, opts = {}) {
      set({ error: '' });
      const returnTo = location.pathname + location.search;
      // A popup keeps the open model; fall back to a full redirect if it's blocked.
      const popup = window.open(signInUrl(provider, { returnTo, popup: true, link: opts.link }), 'cloud-slicer-signin', 'popup,width=520,height=680');
      if (!popup) location.assign(signInUrl(provider, { returnTo, link: opts.link }));
    },

    async signOut() {
      try {
        await api.logout();
      } catch (e) {
        set({ error: (e as Error).message });
      }
      set({ status: 'signedOut', user: null, presets: loadLocal() });
    },

    async deleteAccount() {
      try {
        await api.deleteAccount();
        set({ status: 'signedOut', user: null, presets: loadLocal() });
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },

    clearError: () => set({ error: '' }),
  };
});

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
  const { status, presets } = useAccount.getState();
  const existing = presets.find((p) => same(p, type, name));
  let saved: UserPreset;
  if (status === 'signedIn') {
    saved = await api.savePreset({ type, name, inherits, config: diff, baseVersion: opts.overwrite ? undefined : (existing?.version ?? 0) });
  } else {
    saved = { type, name, inherits, config: diff, version: 0, updatedAt: Date.now() };
  }
  const next = [...useAccount.getState().presets.filter((p) => !same(p, type, name)), saved].sort(byTypeAndName);
  useAccount.setState({ presets: next });
  if (status !== 'signedIn') saveLocal(next);
  return saved;
}

export async function deleteUserPreset(type: PresetType, name: string): Promise<void> {
  const { status } = useAccount.getState();
  if (status === 'signedIn') await api.deletePreset(type, name);
  const next = useAccount.getState().presets.filter((p) => !same(p, type, name));
  useAccount.setState({ presets: next });
  if (status !== 'signedIn') saveLocal(next);
}
