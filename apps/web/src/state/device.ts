// The Device tab's state: the printers this browser knows, the live
// connection to the one on screen, and the send-to-printer hand-off from the
// slicer. Separate from the slicer store so the two can change independently.
//
// Sending sliced G-code from elsewhere in the app:
//   useDevice.getState().requestSend(blob, 'benchy.gcode');  // then show the Device tab
// The Device screen opens its print dialog for it.
//
// Saved printers are the account's printers (src/state/account.ts): kept in
// this browser when signed out, in the account when signed in. The secret (a
// direct printer's API key, a bridge's pairing key) is saved as the printer's
// API key and only fetched when connecting or editing.
import { create } from 'zustand';
import type { Device } from '../account/api';
import { deleteDevice, getDeviceApiKey, saveDevice, useAccount } from './account';
import type { PrinterAddon, PrinterFacts } from '../device/addons';
import { coalesce } from '../device/coalesce';
import { BridgeLink } from '../device/link/bridge';
import { DirectLink } from '../device/link/direct';
import type { BridgeStatus, PrinterLink } from '../device/link/types';
import { decodePairing, type Pairing } from '../device/pairing';
import { PrinterSession, type ConnState, type ConsoleLine, type GcodeFile } from '../device/session';
import type { KlipperObjects } from '../device/status';

export type SavedPrinter =
  | { id: string; name: string; kind: 'direct'; url: string; apiKey: string; preset?: string }
  | { id: string; name: string; kind: 'bridge'; relay: string; bridgeId: string; key: string; printer: string; preset?: string };

export type SendSource = { kind: 'upload'; blob: Blob; name: string } | { kind: 'file'; path: string };

interface DeviceState {
  printers: SavedPrinter[];
  activeId: string | null;
  conn: { state: ConnState | 'idle'; message: string };
  objects: KlipperObjects;
  facts: PrinterFacts | null;
  addons: PrinterAddon[];
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
  editor: { mode: 'add' } | { mode: 'edit'; id: string; printer: SavedPrinter } | null;

  /** Connects to the selected printer; the Device tab calls it when it opens. */
  start(): void;
  select(id: string | null): void;
  savePrinter(p: SavedPrinter): Promise<void>;
  removePrinter(id: string): Promise<void>;
  openEditor(editor: { mode: 'add' } | { mode: 'edit'; id: string } | null): Promise<void>;
  run(script: string): Promise<boolean>;
  call(label: string, fn: (s: PrinterSession) => Promise<unknown>): Promise<boolean>;
  refreshFiles(): Promise<void>;
  requestSend(blob: Blob, name: string): void;
  openPrintDialog(source: SendSource | null): void;
  uploadAndMaybePrint(source: SendSource, opts: { start: boolean; prep: string[] }): Promise<boolean>;
  setToast(text: string, error?: boolean): void;
  retry(): void;
}

/** Where printers lived before they moved into the account store. */
const LEGACY_PRINTERS_KEY = 'cloud-slicer:printers:v1';
const ACTIVE_KEY = 'cloud-slicer:printer-active:v1';
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
  if (x.kind === 'bridge' && typeof x.relay === 'string' && typeof x.bridgeId === 'string') {
    return { id: d.id, name: d.name, kind: 'bridge', relay: x.relay, bridgeId: x.bridgeId, key: '', printer: typeof x.printer === 'string' ? x.printer : '', ...(d.preset && { preset: d.preset }) };
  }
  return d.url ? { id: d.id, name: d.name, kind: 'direct', url: d.url, apiKey: '', ...(d.preset && { preset: d.preset }) } : null;
}

const secretOf = (p: SavedPrinter) => (p.kind === 'direct' ? p.apiKey : p.key);
const withSecret = (p: SavedPrinter, secret: string): SavedPrinter => (p.kind === 'direct' ? { ...p, apiKey: secret } : { ...p, key: secret });

export function deviceInput(p: SavedPrinter) {
  return p.kind === 'direct'
    ? { id: p.id, name: p.name, url: p.url, apiKey: p.apiKey || null, preset: p.preset, extra: { kind: 'direct' } }
    : { id: p.id, name: p.name, url: '', apiKey: p.key, preset: p.preset, extra: { kind: 'bridge', relay: p.relay, bridgeId: p.bridgeId, printer: p.printer } };
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
  if (p) history.replaceState(null, '', location.pathname + location.search);
  return p;
}

export const useDevice = create<DeviceState>((set, get) => {
  migrateLegacyPrinters();
  const initialPrinters = accountPrinters();
  const savedActive = load<string | null>(ACTIVE_KEY, null);
  const initialPairing = pairingFromLocation();

  const connect = async (saved: SavedPrinter | undefined) => {
    session?.stop();
    session = null;
    const seq = ++connectSeq;
    set({ objects: {}, facts: null, addons: [], bridge: null, console: [], files: null, conn: { state: saved ? 'connecting' : 'idle', message: '' } });
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
    });
    session = s;
    s.start();
  };

  // Nothing connects until the Device tab first opens (start()).
  let started = false;

  // Follow the account's printers: sign-in, sign-out and edits on other devices.
  useAccount.subscribe((a, prev) => {
    if (a.devices === prev.devices) return;
    const before = get().printers.find((x) => x.id === get().activeId);
    const printers = accountPrinters();
    set({ printers });
    const now = printers.find((x) => x.id === get().activeId);
    if (!now) get().select(printers[0]?.id ?? null);
    else if (started && now.id !== savingId && (!before || JSON.stringify(now) !== JSON.stringify(before))) {
      // Changed elsewhere (another device or tab): its secret may have changed too.
      secrets.delete(now.id);
      void connect(now);
    }
  });

  return {
    printers: initialPrinters,
    activeId: initialPrinters.some((p) => p.id === savedActive) ? savedActive : (initialPrinters[0]?.id ?? null),
    conn: { state: 'idle', message: '' },
    objects: {},
    facts: null,
    addons: [],
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

    async openEditor(editor) {
      if (editor?.mode !== 'edit') {
        set({ editor, ...(editor ? {} : { pairing: null }) });
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

    requestSend(blob, name) {
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
      try {
        let path: string;
        if (source.kind === 'upload') {
          set({ upload: { name: source.name, fraction: 0 } });
          path = await s.upload(source.blob, source.name, (fraction) => set({ upload: { name: source.name, fraction } }));
          set({ upload: null });
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
  };
});
