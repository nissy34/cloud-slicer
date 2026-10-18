// The Device tab's state: the printers this browser knows, the live
// connection to the one on screen, and the send-to-printer hand-off from the
// slicer. Separate from the slicer store so the two can change independently.
//
// Sending sliced G-code from elsewhere in the app:
//   useDevice.getState().requestSend(blob, 'benchy.gcode');  // then show the Device tab
// The Device screen opens its print dialog for it.
//
// Saved printers (name and connection details, including any API key) live in
// localStorage. To keep them in a signed-in account instead, sync the list:
//   useDevice.subscribe((s, prev) => s.printers !== prev.printers && push(s.printers))
//   useDevice.getState().setPrinters(fromAccount)  // load the account's copy
import { create } from 'zustand';
import type { PrinterAddon, PrinterFacts } from '../device/addons';
import { BridgeLink } from '../device/link/bridge';
import { DirectLink } from '../device/link/direct';
import type { BridgeStatus, PrinterLink } from '../device/link/types';
import { decodePairing, type Pairing } from '../device/pairing';
import { PrinterSession, type ConnState, type ConsoleLine, type GcodeFile } from '../device/session';
import type { KlipperObjects } from '../device/status';

export type SavedPrinter =
  | { id: string; name: string; kind: 'direct'; url: string; apiKey: string }
  | { id: string; name: string; kind: 'bridge'; relay: string; bridgeId: string; key: string; printer: string };

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
  editor: { mode: 'add' } | { mode: 'edit'; id: string } | null;

  select(id: string | null): void;
  savePrinter(p: SavedPrinter): void;
  removePrinter(id: string): void;
  openEditor(editor: DeviceState['editor']): void;
  run(script: string): Promise<boolean>;
  call(label: string, fn: (s: PrinterSession) => Promise<unknown>): Promise<boolean>;
  refreshFiles(): Promise<void>;
  requestSend(blob: Blob, name: string): void;
  openPrintDialog(source: SendSource | null): void;
  uploadAndMaybePrint(source: SendSource, opts: { start: boolean; prep: string[] }): Promise<boolean>;
  setToast(text: string, error?: boolean): void;
  retry(): void;
  /** Replaces the saved printers, e.g. with the signed-in account's copy. */
  setPrinters(printers: SavedPrinter[]): void;
}

const PRINTERS_KEY = 'cloud-slicer:printers:v1';
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

export function linkFor(p: SavedPrinter): PrinterLink {
  return p.kind === 'direct'
    ? new DirectLink(p.url, p.apiKey)
    : new BridgeLink({ relay: p.relay, bridgeId: p.bridgeId, key: p.key, printer: p.printer });
}

let session: PrinterSession | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** The live session, for components that call the printer directly (camera). */
export const currentSession = () => session;

function pairingFromLocation(): Pairing | null {
  if (typeof location === 'undefined') return null;
  const p = decodePairing(location.hash);
  if (p) history.replaceState(null, '', location.pathname + location.search);
  return p;
}

export const useDevice = create<DeviceState>((set, get) => {
  const initialPrinters = load<SavedPrinter[]>(PRINTERS_KEY, []);
  const savedActive = load<string | null>(ACTIVE_KEY, null);
  const initialPairing = pairingFromLocation();

  const connect = (p: SavedPrinter | undefined) => {
    session?.stop();
    session = null;
    set({ objects: {}, facts: null, addons: [], bridge: null, console: [], files: null, conn: { state: 'idle', message: '' } });
    if (!p) return;
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

  // Connect lazily: the store is created on first use, i.e. when the Device tab opens.
  queueMicrotask(() => {
    const p = get().printers.find((x) => x.id === get().activeId);
    if (p) connect(p);
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

    select(id) {
      set({ activeId: id });
      store(ACTIVE_KEY, id);
      connect(get().printers.find((p) => p.id === id));
    },

    savePrinter(p) {
      const exists = get().printers.some((x) => x.id === p.id);
      const printers = exists ? get().printers.map((x) => (x.id === p.id ? p : x)) : [...get().printers, p];
      set({ printers, editor: null, pairing: null });
      store(PRINTERS_KEY, printers);
      get().select(p.id);
    },

    removePrinter(id) {
      const printers = get().printers.filter((p) => p.id !== id);
      set({ printers, editor: null });
      store(PRINTERS_KEY, printers);
      if (get().activeId === id) get().select(printers[0]?.id ?? null);
    },

    openEditor(editor) {
      set({ editor, ...(editor ? {} : { pairing: null }) });
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

    async refreshFiles() {
      if (!session) return;
      try {
        const files = await session.listFiles();
        set({ files });
      } catch {
        // keep the last list; the connection state already says what is wrong
      }
    },

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

    setPrinters(printers) {
      const current = get().printers.find((p) => p.id === get().activeId);
      set({ printers });
      store(PRINTERS_KEY, printers);
      const keep = printers.find((p) => p.id === get().activeId);
      if (!keep || JSON.stringify(keep) !== JSON.stringify(current)) get().select(keep?.id ?? printers[0]?.id ?? null);
    },
  };
});
