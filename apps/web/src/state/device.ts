// The Device tab's state: the printers this browser knows, the live
// connection to the one on screen, and the send-to-printer hand-off from the
// slicer. Separate from the slicer store so the two can change independently.
//
// Sending sliced G-code from elsewhere in the app:
//   useDevice.getState().requestSend(blob, 'benchy.gcode', 'Snapmaker U1 (0.4 nozzle)');  // then show the Device tab
// The Device screen opens its print dialog for it, on the printer last sent
// to (or one set up with the profile the plate was sliced with); the dialog
// lets the user pick another.
//
// Saved printers are the account's printers (src/state/account.ts): kept in
// this browser when signed out, in the account when signed in. The secret (a
// direct printer's API key, a bridge's pairing key) is saved as the printer's
// API key and only fetched when connecting or editing.
import { create } from 'zustand';
import { api, ApiError, type Device } from '../account/api';
import { accountReady, deleteDevice, getDeviceApiKey, saveDevice, useAccount } from './account';
import type { PrinterAddon, PrinterError, PrinterFacts } from '../device/addons';
import { coalesce } from '../device/coalesce';
import { BridgeLink, onBridgeRemoved, setBridgeTickets } from '../device/link/bridge';
import { DirectLink } from '../device/link/direct';
import { LinkError, type BridgeStatus, type PrinterLink } from '../device/link/types';
import { currentRelay } from '../device/config';
import { decodePairing, type Pairing } from '../device/pairing';
import { PrinterSession, type ConnState, type ConsoleLine, type GcodeFile } from '../device/session';
import type { KlipperObjects } from '../device/status';

/** Shared by both kinds: `hiddenCameras` names the webcams the user chose not to show. */
type PrinterCommon = { id: string; name: string; preset?: string; hiddenCameras?: string[] };

export type SavedPrinter =
  | (PrinterCommon & { kind: 'direct'; url: string; apiKey: string })
  | (PrinterCommon & { kind: 'bridge'; relay: string; bridgeId: string; key: string; printer: string });

/**
 * A bridge (the small app on a computer near the printers), saved on its own:
 * it can have no printers, and removing a printer leaves it. Its printers
 * still carry the relay, id and key so they connect on their own.
 */
export interface SavedBridge {
  id: string;
  name: string;
  relay: string;
  bridgeId: string;
  key: string;
}

/** Shown when a bridge needs an account; the Device tab offers Sign in next to it. */
export const BRIDGE_SIGN_IN = 'Sign in to reach printers through the bridge. Printers you reach directly need no account.';

// The relay lets a browser in only with the site's ticket for a signed-in, allowed account.
setBridgeTickets(async (relay, bridgeId) => {
  await accountReady();
  const status = useAccount.getState().status;
  // A site without accounts (local dev) uses a relay without tickets.
  if (status === 'unavailable') return null;
  // Signed out, the site may still give a ticket (when the owner lets signed-out people use bridges).
  try {
    return await api.relayTicket(relay, bridgeId);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 503 || e.status === 404)) return null;
    if (e instanceof ApiError && e.status === 401) throw new LinkError(BRIDGE_SIGN_IN, 'auth');
    if (e instanceof ApiError) throw new LinkError(e.message, 'auth');
    throw new LinkError('Could not reach Cloud Slicer to open the bridge. Check your internet connection.', 'network');
  }
});

export type SendSource = { kind: 'upload'; blob: Blob; name: string } | { kind: 'file'; path: string };

interface DeviceState {
  printers: SavedPrinter[];
  bridges: SavedBridge[];
  /** The Printers & bridges window. */
  manageOpen: boolean;
  activeId: string | null;
  conn: { state: ConnState | 'idle'; message: string };
  objects: KlipperObjects;
  facts: PrinterFacts | null;
  addons: PrinterAddon[];
  /** The printer's own errors in words, from add-ons that know its codes. */
  errors: PrinterError[];
  bridge: BridgeStatus | null;
  console: ConsoleLine[];
  files: GcodeFile[] | null;
  /** The print dialog, when open. */
  send: SendSource | null;
  upload: { name: string; fraction: number } | null;
  /** A short message about the last action, e.g. an error from the printer. */
  toast: { text: string; error: boolean } | null;
  /** A pairing link opened this page; the add-printer dialog picks it up. */
  pairing: Pairing | null;
  /** In edit mode, the printer with its secret filled in. */
  /** `newBridge`: setting up a new bridge with a setup code, not adding a printer. */
  editor: { mode: 'add'; newBridge?: boolean } | { mode: 'edit'; id: string; printer: SavedPrinter } | null;

  /** Connects to the selected printer; the Device tab calls it when it opens. */
  start(): void;
  select(id: string | null): void;
  savePrinter(p: SavedPrinter): Promise<void>;
  /** Which of the active printer's cameras to hide, by name; saved with the printer. */
  setHiddenCameras(names: string[]): Promise<void>;
  removePrinter(id: string): Promise<void>;
  saveBridge(b: SavedBridge): Promise<void>;
  /** Removes a bridge and every printer saved through it. */
  removeBridge(id: string): Promise<void>;
  /** A saved bridge's pairing (relay, id and key), to reach it again. */
  bridgePairing(id: string): Promise<Pairing | null>;
  openManage(open: boolean): void;
  /** `bridge`: add printers from that saved bridge, with no pairing again. `newBridge`: set up a new bridge first. */
  openEditor(editor: { mode: 'add'; bridge?: string; newBridge?: boolean } | { mode: 'edit'; id: string } | null): Promise<void>;
  /** A bridge just joined the account with a setup code: reloads the account's bridges and returns the saved one's pairing. */
  adoptBridge(bridgeId: string): Promise<Pairing | null>;
  run(script: string): Promise<boolean>;
  call(label: string, fn: (s: PrinterSession) => Promise<unknown>): Promise<boolean>;
  refreshFiles(): Promise<void>;
  /** `slicedFor` is the printer profile the G-code was sliced with, if known. */
  requestSend(blob: Blob, name: string, slicedFor?: string): void;
  openPrintDialog(source: SendSource | null): void;
  uploadAndMaybePrint(source: SendSource, opts: { start: boolean; prep: string[] }): Promise<boolean>;
  setToast(text: string, error?: boolean): void;
  retry(): void;
  /** A print alert was tapped: show its printer ("<bridgeId>.<printer>" or "direct.<saved id>"). */
  openAlert(key: string): void;
}

/** Where printers lived before they moved into the account store. */
const LEGACY_PRINTERS_KEY = 'cloud-slicer:printers:v1';
const ACTIVE_KEY = 'cloud-slicer:printer-active:v1';
/** The printer sliced G-code was last sent to. */
const SEND_KEY = 'cloud-slicer:printer-send:v1';
const CONSOLE_MAX = 200;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: printers are kept for this visit only
  }
}

/** A saved account printer as the Device tab sees it (secret not filled in). */
export function printerFromDevice(d: Device): SavedPrinter | null {
  const x = d.extra ?? {};
  const hidden = Array.isArray(x.hiddenCameras) ? x.hiddenCameras.filter((n): n is string => typeof n === 'string') : [];
  const common = { ...(d.preset && { preset: d.preset }), ...(hidden.length && { hiddenCameras: hidden }) };
  if (x.kind === 'bridge' && typeof x.relay === 'string' && typeof x.bridgeId === 'string') {
    return { id: d.id, name: d.name, kind: 'bridge', relay: currentRelay(x.relay), bridgeId: x.bridgeId, key: '', printer: typeof x.printer === 'string' ? x.printer : '', ...common };
  }
  return d.url ? { id: d.id, name: d.name, kind: 'direct', url: d.url, apiKey: '', ...common } : null;
}

/** A saved bridge (extra.kind 'bridge-agent'); printers through it are kind 'bridge'. */
export function bridgeFromDevice(d: Device): SavedBridge | null {
  const x = d.extra ?? {};
  return x.kind === 'bridge-agent' && typeof x.relay === 'string' && typeof x.bridgeId === 'string' ? { id: d.id, name: d.name, relay: currentRelay(x.relay), bridgeId: x.bridgeId, key: '' } : null;
}

export const bridgeInput = (b: SavedBridge) => ({ id: b.id, name: b.name, url: '', apiKey: b.key, extra: { kind: 'bridge-agent', relay: b.relay, bridgeId: b.bridgeId } });

/** What to call a bridge before the user names it: by its computer's name or system when the bridge says. */
export function bridgeLabel(status?: { host?: string; system?: string } | null): string {
  if (status?.host) return `Bridge on ${status.host}`;
  return status?.system === 'win32' ? 'Bridge on a Windows PC' : status?.system === 'darwin' ? 'Bridge on a Mac' : status?.system === 'linux' ? 'Bridge on Linux' : 'Bridge';
}

const secretOf = (p: SavedPrinter) => (p.kind === 'direct' ? p.apiKey : p.key);
const withSecret = (p: SavedPrinter, secret: string): SavedPrinter => (p.kind === 'direct' ? { ...p, apiKey: secret } : { ...p, key: secret });

export function deviceInput(p: SavedPrinter) {
  const cams = p.hiddenCameras?.length ? { hiddenCameras: p.hiddenCameras } : {};
  return p.kind === 'direct'
    ? { id: p.id, name: p.name, url: p.url, apiKey: p.apiKey || null, preset: p.preset, extra: { kind: 'direct', ...cams } }
    : { id: p.id, name: p.name, url: '', apiKey: p.key, preset: p.preset, extra: { kind: 'bridge', relay: p.relay, bridgeId: p.bridgeId, printer: p.printer, ...cams } };
}

/** Secrets fetched or saved this visit, by printer id. */
const secrets = new Map<string, string>();

/** Waits for the account to know whether someone is signed in (which decides where secrets live). */
function accountSettled(): Promise<void> {
  if (useAccount.getState().status !== 'loading') return Promise.resolve();
  return new Promise((done) => {
    const off = useAccount.subscribe((a) => {
      if (a.status === 'loading') return;
      off();
      done();
    });
  });
}

async function loadSecret(p: SavedPrinter): Promise<SavedPrinter> {
  if (!secrets.has(p.id)) {
    await accountSettled();
    secrets.set(p.id, (await getDeviceApiKey(p.id).catch(() => null)) ?? '');
  }
  return withSecret(p, secrets.get(p.id)!);
}

const accountPrinters = () => useAccount.getState().devices.map(printerFromDevice).filter((p): p is SavedPrinter => p !== null);
/** Saved bridges, one per bridge id. */
const accountBridges = () => {
  const all = useAccount.getState().devices.map(bridgeFromDevice).filter((b): b is SavedBridge => b !== null);
  return all.filter((b, i) => all.findIndex((x) => x.bridgeId === b.bridgeId) === i);
};

const newId = () => Math.random().toString(36).slice(2, 10);
const making = new Set<string>();

/**
 * Printers saved before bridges were saved on their own: give each of their
 * bridges a record, with the pairing key from one of its printers.
 */
function ensureBridges() {
  void accountSettled().then(async () => {
    const bridges = accountBridges();
    for (const p of accountPrinters()) {
      if (p.kind !== 'bridge' || bridges.some((b) => b.bridgeId === p.bridgeId) || making.has(p.bridgeId)) continue;
      making.add(p.bridgeId);
      try {
        const { key } = (await loadSecret(p)) as Extract<SavedPrinter, { kind: 'bridge' }>;
        if (accountBridges().some((b) => b.bridgeId === p.bridgeId)) continue;
        const b = { id: newId(), name: 'Bridge', relay: p.relay, bridgeId: p.bridgeId, key };
        secrets.set(b.id, key);
        await saveDevice(bridgeInput(b));
      } catch {
        // tried again with the next change
      } finally {
        making.delete(p.bridgeId);
      }
    }
  });
}

/** Moves printers saved by earlier builds into the account store, once. */
function migrateLegacyPrinters() {
  const legacy = load<SavedPrinter[]>(LEGACY_PRINTERS_KEY, []);
  if (!legacy.length) return;
  void accountSettled().then(async () => {
    for (const p of legacy) {
      if (useAccount.getState().devices.some((d) => d.id === p.id)) continue;
      secrets.set(p.id, secretOf(p));
      await saveDevice(deviceInput(p)).catch(() => undefined);
    }
    try {
      localStorage.removeItem(LEGACY_PRINTERS_KEY);
    } catch {
      // nothing to clean up
    }
  });
}

/**
 * Which printer a freshly sliced plate goes to by default: the one last sent
 * to, unless another printer is set up with the profile the plate was sliced
 * for; then the one on screen, if it matches; then any that matches.
 */
export function pickSendTarget(printers: SavedPrinter[], activeId: string | null, lastId: string | null, slicedFor?: string): string | null {
  const byId = (id: string | null) => printers.find((p) => p.id === id);
  const order = [byId(lastId), byId(activeId), ...printers].filter((p): p is SavedPrinter => p !== undefined);
  const matches = slicedFor ? order.find((p) => p.preset === slicedFor) : undefined;
  return (matches ?? order[0])?.id ?? null;
}

export function linkFor(p: SavedPrinter): PrinterLink {
  return p.kind === 'direct'
    ? new DirectLink(p.url, p.apiKey)
    : new BridgeLink({ relay: p.relay, bridgeId: p.bridgeId, key: p.key, printer: p.printer });
}

let session: PrinterSession | null = null;
let connectSeq = 0;
/** The printer this browser is saving right now: its secret is already cached. */
let savingId: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Moonraker rescans the whole gcodes folder for every list: never ask more than every 2 s. */
const FILE_LIST_GAP_MS = 2000;

/** The live session, for components that call the printer directly (camera). */
export const currentSession = () => session;

function pairingFromLocation(): Pairing | null {
  if (typeof location === 'undefined') return null;
  const p = decodePairing(location.hash);
  // Cleared once every module has seen it (the slicer store opens the Device tab for it).
  if (p) setTimeout(() => history.replaceState(null, '', location.pathname + location.search));
  return p;
}

/** The printer a tapped print alert names (#alert=…, see public/sw.js). */
export function printerForAlert(printers: SavedPrinter[], key: string): SavedPrinter | undefined {
  const dot = key.indexOf('.');
  const [a, b] = [key.slice(0, dot), key.slice(dot + 1)];
  if (dot < 0) return undefined;
  return a === 'direct' ? printers.find((p) => p.id === b) : printers.find((p) => p.kind === 'bridge' && p.bridgeId === a && p.printer === b);
}

function alertFromLocation(): string | null {
  if (typeof location === 'undefined') return null;
  const m = /[#&]alert=([^&]+)/.exec(location.hash);
  if (!m) return null;
  setTimeout(() => history.replaceState(null, '', location.pathname + location.search));
  return decodeURIComponent(m[1]);
}

export const useDevice = create<DeviceState>((set, get) => {
  migrateLegacyPrinters();
  const initialPrinters = accountPrinters();
  const alertKey = alertFromLocation();
  const savedActive = (alertKey && printerForAlert(initialPrinters, alertKey)?.id) || load<string | null>(ACTIVE_KEY, null);
  const initialPairing = pairingFromLocation();

  const connect = async (saved: SavedPrinter | undefined) => {
    session?.stop();
    session = null;
    const seq = ++connectSeq;
    set({ objects: {}, facts: null, addons: [], errors: [], bridge: null, console: [], files: null, conn: { state: saved ? 'connecting' : 'idle', message: '' } });
    if (!saved) return;
    const p = await loadSecret(saved);
    if (seq !== connectSeq) return;
    const s: PrinterSession = new PrinterSession(linkFor(p), {
      onState: (state, message) => {
        if (session !== s) return;
        set({ conn: { state, message } });
        if (state === 'online') void get().refreshFiles();
      },
      onObjects: (objects) => session === s && set({ objects }),
      onFacts: (facts, addons) => session === s && set({ facts, addons }),
      onConsole: (line) => session === s && set({ console: [...get().console, line].slice(-CONSOLE_MAX) }),
      onFilesChanged: () => session === s && void get().refreshFiles(),
      onBridge: (bridge) => session === s && set({ bridge }),
      onErrors: (errors) => session === s && set({ errors }),
    });
    session = s;
    s.start();
  };

  // Nothing connects until the Device tab first opens (start()).
  let started = false;

  // Follow the account's printers: sign-in, sign-out and edits on other devices.
  useAccount.subscribe((a, prev) => {
    // Just signed in: a bridge that was waiting for an account connects now.
    if (a.status === 'signedIn' && prev.status !== 'signedIn' && get().conn.state !== 'online') session?.retryNow();
    if (a.devices === prev.devices) return;
    const before = get().printers.find((x) => x.id === get().activeId);
    const printers = accountPrinters();
    set({ printers, bridges: accountBridges() });
    ensureBridges();
    const now = printers.find((x) => x.id === get().activeId);
    if (!now) get().select(printers[0]?.id ?? null);
    else if (started && now.id !== savingId && (!before || JSON.stringify(now) !== JSON.stringify(before))) {
      // Changed elsewhere (another device or tab): its secret may have changed too.
      secrets.delete(now.id);
      void connect(now);
    }
  });

  ensureBridges();

  return {
    printers: initialPrinters,
    bridges: accountBridges(),
    manageOpen: false,
    activeId: initialPrinters.some((p) => p.id === savedActive) ? savedActive : (initialPrinters[0]?.id ?? null),
    conn: { state: 'idle', message: '' },
    objects: {},
    facts: null,
    addons: [],
    errors: [],
    bridge: null,
    console: [],
    files: null,
    send: null,
    upload: null,
    toast: null,
    pairing: initialPairing,
    editor: initialPairing ? { mode: 'add' } : null,

    start() {
      if (started) return;
      started = true;
      const p = get().printers.find((x) => x.id === get().activeId);
      if (p) void connect(p);
    },

    select(id) {
      set({ activeId: id });
      store(ACTIVE_KEY, id);
      if (started) void connect(get().printers.find((p) => p.id === id));
    },

    async savePrinter(p) {
      secrets.set(p.id, secretOf(p));
      savingId = p.id;
      try {
        await saveDevice(deviceInput(p));
      } catch (e) {
        get().setToast(`Could not save the printer: ${(e as Error).message}`, true);
        return;
      } finally {
        savingId = null;
      }
      set({ editor: null, pairing: null });
      get().select(p.id);
    },

    async setHiddenCameras(names) {
      const p = get().printers.find((x) => x.id === get().activeId);
      if (!p) return;
      const next = { ...p, hiddenCameras: [...new Set(names)] };
      // Show the change at once; the account store follows.
      set({ printers: get().printers.map((x) => (x.id === p.id ? next : x)) });
      savingId = p.id;
      try {
        // apiKey undefined: keep the saved secret as it is.
        await saveDevice({ ...deviceInput(next), apiKey: undefined });
      } catch (e) {
        get().setToast(`Could not save the camera choice: ${(e as Error).message}`, true);
      } finally {
        savingId = null;
      }
    },

    async removePrinter(id) {
      try {
        await deleteDevice(id);
      } catch (e) {
        get().setToast(`Could not remove the printer: ${(e as Error).message}`, true);
        return;
      }
      secrets.delete(id);
      set({ editor: null });
    },

    async saveBridge(b) {
      secrets.set(b.id, b.key);
      try {
        await saveDevice(bridgeInput(b));
      } catch (e) {
        get().setToast(`Could not save the bridge: ${(e as Error).message}`, true);
      }
    },

    async removeBridge(id) {
      const b = get().bridges.find((x) => x.id === id);
      if (!b) return;
      try {
        for (const p of get().printers) if (p.kind === 'bridge' && p.bridgeId === b.bridgeId) await deleteDevice(p.id);
        // Older copies of the same bridge's record go too.
        for (const d of useAccount.getState().devices) if (bridgeFromDevice(d)?.bridgeId === b.bridgeId) await deleteDevice(d.id);
        // It no longer counts against the account's bridges.
        if (useAccount.getState().status === 'signedIn') await api.forgetBridge(b.bridgeId).catch(() => undefined);
      } catch (e) {
        get().setToast(`Could not remove the bridge: ${(e as Error).message}`, true);
        return;
      }
      secrets.delete(id);
    },

    async bridgePairing(id) {
      const b = get().bridges.find((x) => x.id === id);
      if (!b) return null;
      if (!secrets.has(id)) {
        await accountSettled();
        secrets.set(id, (await getDeviceApiKey(id).catch(() => null)) ?? '');
      }
      return { relay: b.relay, bridgeId: b.bridgeId, key: secrets.get(id)! };
    },

    async adoptBridge(bridgeId) {
      // The site saved it when the bridge used the code; this page hasn't seen it yet.
      useAccount.setState({ devices: await api.devices() });
      const b = get().bridges.find((x) => x.bridgeId === bridgeId);
      return b ? get().bridgePairing(b.id) : null;
    },

    openManage(open) {
      set({ manageOpen: open });
    },

    async openEditor(editor) {
      if (editor?.mode === 'add' && editor.bridge) {
        const pairing = await get().bridgePairing(editor.bridge);
        set({ editor: { mode: 'add' }, pairing });
        return;
      }
      if (editor?.mode !== 'edit') {
        set({ editor: editor && { mode: 'add', ...(editor.newBridge && { newBridge: true }) }, ...(editor ? {} : { pairing: null }) });
        return;
      }
      const p = get().printers.find((x) => x.id === editor.id);
      if (p) set({ editor: { ...editor, printer: await loadSecret(p) } });
    },

    run(script) {
      return get().call('', (s) => s.gcode(script));
    },

    async call(label, fn) {
      if (!session || get().conn.state !== 'online') {
        get().setToast('The printer is not connected.', true);
        return false;
      }
      try {
        await fn(session);
        if (label) get().setToast(label);
        return true;
      } catch (e) {
        get().setToast((e as Error).message, true);
        return false;
      }
    },

    refreshFiles: coalesce(async () => {
      const s = session;
      if (!s) return;
      try {
        const files = await s.listFiles();
        if (session === s) set({ files });
      } catch {
        // keep the last list; the connection state already says what is wrong
      }
    }, FILE_LIST_GAP_MS),

    requestSend(blob, name, slicedFor) {
      const target = pickSendTarget(get().printers, get().activeId, load<string | null>(SEND_KEY, null), slicedFor);
      if (target && target !== get().activeId) get().select(target);
      set({ send: { kind: 'upload', blob, name } });
    },

    openPrintDialog(source) {
      set({ send: source });
    },

    async uploadAndMaybePrint(source, { start, prep }) {
      const s = session;
      if (!s || get().conn.state !== 'online') {
        get().setToast('The printer is not connected.', true);
        return false;
      }
      const target = get().activeId;
      try {
        let path: string;
        if (source.kind === 'upload') {
          set({ upload: { name: source.name, fraction: 0 } });
          path = await s.upload(source.blob, source.name, (fraction) => set({ upload: { name: source.name, fraction } }));
          set({ upload: null });
          store(SEND_KEY, target);
        } else {
          path = source.path;
        }
        if (start) {
          for (const line of prep) await s.gcode(line, 30_000);
          await s.startPrint(path);
          get().setToast(`Printing ${path}`);
        } else {
          get().setToast(`Uploaded ${path}`);
        }
        set({ send: null });
        void get().refreshFiles();
        return true;
      } catch (e) {
        set({ upload: null });
        get().setToast((e as Error).message, true);
        return false;
      }
    },

    setToast(text, error = false) {
      if (toastTimer) clearTimeout(toastTimer);
      set({ toast: { text, error } });
      toastTimer = setTimeout(() => set({ toast: null }), error ? 8000 : 4000);
    },

    retry() {
      session?.retryNow();
    },

    openAlert(key) {
      const p = printerForAlert(get().printers, key);
      if (p && p.id !== get().activeId) get().select(p.id);
    },
  };
});

// A bridge removed on its own computer (its status window, or Windows' Installed
// apps) has already left the account on the site; the list catches up, and
// anything the site couldn't remove goes too.
let tidying = false;
onBridgeRemoved(async (_relay, bridgeId) => {
  if (tidying) return;
  tidying = true;
  try {
    const before = useDevice.getState().bridges.find((b) => b.bridgeId === bridgeId);
    if (useAccount.getState().status === 'signedIn') useAccount.setState({ devices: await api.devices() });
    const left = useDevice.getState().bridges.find((b) => b.bridgeId === bridgeId);
    if (left) await useDevice.getState().removeBridge(left.id);
    if (before) useDevice.getState().setToast(`${before.name} was removed from its computer, so it's gone from Printers & bridges.`);
  } catch {
    // tried again the next time the relay says so
  } finally {
    tidying = false;
  }
});
