// One live connection to one printer: Moonraker JSON-RPC over a link, the
// Klipper objects it subscribes to, and the commands the screen sends.
// Reconnects by itself; the UI only reads what the callbacks report.
import { detectAddons, type PrinterAddon, type PrinterFacts } from './addons';
import type { BridgeStatus, PrinterLink, RpcMessage } from './link/types';
import { parseWebcams, type Webcam } from './camera';
import { genericObjects, mergeStatus, type KlipperObjects } from './status';

export type ConnState = 'connecting' | 'online' | 'offline';

export interface ConsoleLine {
  at: number;
  kind: 'command' | 'response' | 'error';
  text: string;
}

export interface GcodeFile {
  path: string;
  modified: number;
  size: number;
}

export type { Webcam };

/**
 * Whether a notify_filelist_changed touches the gcodes root. Moonraker sends
 * one for every root it watches, and the Snapmaker U1's camera rewrites
 * camera/monitor.jpg several times a second while it is watched: refreshing
 * the G-code list on each of those kept Moonraker busy rescanning gcodes
 * until it dropped its connection to Klipper.
 */
export function touchesGcodes(params: unknown): boolean {
  const items = Array.isArray(params) ? params : [params];
  return items.some((p) => {
    const e = p as { item?: { root?: string }; source_item?: { root?: string } } | null;
    const roots = [e?.item?.root, e?.source_item?.root].filter((r) => r != null);
    // No root at all: an older Moonraker; assume it may be G-code.
    return roots.length === 0 || roots.includes('gcodes');
  });
}

export interface SessionEvents {
  onState(state: ConnState, message: string): void;
  onObjects(objects: KlipperObjects): void;
  onFacts(facts: PrinterFacts, addons: PrinterAddon[]): void;
  onConsole(line: ConsoleLine): void;
  onFilesChanged(): void;
  onBridge?(status: BridgeStatus): void;
}

const OBJECT_FLUSH_MS = 150;

export class RpcError extends Error {}

export class PrinterSession {
  private seq = 0;
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private objects: KlipperObjects = {};
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private stopped = false;
  private subscribed: string[] = [];
  facts: PrinterFacts | null = null;
  addons: PrinterAddon[] = [];

  constructor(
    readonly link: PrinterLink,
    private readonly ev: SessionEvents,
  ) {}

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.failPending('Disconnected.');
    this.link.close();
  }

  private async connect() {
    if (this.stopped) return;
    this.ev.onState('connecting', this.retries ? 'Reconnecting…' : `Connecting ${this.link.label}…`);
    try {
      await this.link.open({
        onMessage: (m) => this.onMessage(m),
        onClose: (reason) => this.onClosed(reason),
        onBridge: (b) => this.ev.onBridge?.(b),
      });
      await this.handshake();
      this.retries = 0;
    } catch (e) {
      this.link.close();
      this.onClosed((e as Error).message);
    }
  }

  private onClosed(reason: string) {
    this.failPending(reason);
    if (this.stopped) return;
    this.ev.onState('offline', reason);
    const delay = Math.min(30_000, 2000 * 2 ** Math.min(this.retries++, 4));
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  /** Reconnect now instead of waiting for the back-off. */
  retryNow() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retries = 0;
    this.link.close();
    void this.connect();
  }

  private failPending(reason: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RpcError(reason));
    }
    this.pending.clear();
  }

  /** Learns what the printer is, then subscribes to everything the screen shows. */
  private async handshake() {
    const server = await this.rpc<{ klippy_state: string }>('server.info');
    if (server.klippy_state !== 'ready') {
      // Klipper is starting or in error: show what we can and wait for notify_klippy_ready.
      this.objects = { webhooks: { state: server.klippy_state, state_message: 'Klipper is not ready.' } };
      this.ev.onObjects(this.objects);
      this.ev.onState('online', '');
      if (this.facts) this.ev.onFacts(this.facts, this.addons);
      return;
    }
    const [list, info] = await Promise.all([
      this.rpc<{ objects: string[] }>('printer.objects.list'),
      this.rpc<{ hostname?: string; software_version?: string }>('printer.info').catch(() => ({}) as { hostname?: string; software_version?: string }),
    ]);
    const facts: PrinterFacts = { objects: list.objects ?? [], hostname: info.hostname ?? '', software: info.software_version ?? '' };
    this.facts = facts;
    this.addons = detectAddons(facts);
    this.subscribed = [...new Set([...genericObjects(facts.objects), ...this.addons.flatMap((a) => a.objects(facts))])];
    const res = await this.rpc<{ status: KlipperObjects }>('printer.objects.subscribe', {
      objects: Object.fromEntries(this.subscribed.map((o) => [o, null])),
    });
    this.objects = res.status ?? {};
    this.ev.onFacts(facts, this.addons);
    this.ev.onObjects(this.objects);
    this.ev.onState('online', '');
  }

  private onMessage(msg: RpcMessage) {
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new RpcError(msg.error.message ?? 'The printer refused the command.'));
      else p.resolve(msg.result);
      return;
    }
    switch (msg.method) {
      case 'notify_status_update': {
        const [diff] = (msg.params as [KlipperObjects]) ?? [{}];
        this.objects = mergeStatus(this.objects, diff ?? {});
        this.scheduleFlush();
        break;
      }
      case 'notify_gcode_response':
        for (const text of (msg.params as string[]) ?? []) {
          this.ev.onConsole({ at: Date.now(), kind: /^!!/.test(text) ? 'error' : 'response', text: text.replace(/^(\/\/|!!)\s?/, '') });
        }
        break;
      case 'notify_klippy_ready':
        void this.handshake().catch((e) => this.ev.onState('online', (e as Error).message));
        break;
      case 'notify_klippy_shutdown':
      case 'notify_klippy_disconnected':
        this.objects = mergeStatus(this.objects, { webhooks: { state: msg.method === 'notify_klippy_shutdown' ? 'shutdown' : 'startup', state_message: 'Klipper is not ready.' } });
        this.scheduleFlush();
        break;
      case 'notify_filelist_changed':
        if (touchesGcodes(msg.params)) this.ev.onFilesChanged();
        break;
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.ev.onObjects(this.objects);
    }, OBJECT_FLUSH_MS);
  }

  rpc<T = unknown>(method: string, params?: unknown, timeoutMs = 15_000): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError('The printer did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.link.send({ jsonrpc: '2.0', method, params, id });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  /** Runs a G-code script and echoes it to the console. Long commands (homing, loading) get a long timeout. */
  async gcode(script: string, timeoutMs = 120_000): Promise<void> {
    this.ev.onConsole({ at: Date.now(), kind: 'command', text: script });
    try {
      await this.rpc('printer.gcode.script', { script }, timeoutMs);
    } catch (e) {
      this.ev.onConsole({ at: Date.now(), kind: 'error', text: (e as Error).message });
      throw e;
    }
  }

  async listFiles(): Promise<GcodeFile[]> {
    const files = await this.rpc<GcodeFile[]>('server.files.list', { root: 'gcodes' });
    return (files ?? []).filter((f) => /\.(gcode|g|gco)$/i.test(f.path)).sort((a, b) => b.modified - a.modified);
  }

  metadata(filename: string) {
    return this.rpc<Record<string, unknown>>('server.files.metadata', { filename }).catch(() => null);
  }

  /** A file's slicer thumbnail, fetched through the link (direct or bridge). */
  thumbnail(url: string) {
    return this.link.snapshot(url);
  }

  deleteFile(path: string) {
    return this.rpc('server.files.delete_file', { path: `gcodes/${path}` });
  }

  upload(blob: Blob, name: string, onProgress?: (f: number) => void) {
    return this.link.upload(blob, name, onProgress);
  }

  /** Starts a print. Callers must only reach this from an explicit user action. */
  startPrint(filename: string) {
    return this.rpc('printer.print.start', { filename }, 60_000);
  }

  pause = () => this.rpc('printer.print.pause', undefined, 60_000);
  resume = () => this.rpc('printer.print.resume', undefined, 60_000);
  cancel = () => this.rpc('printer.print.cancel', undefined, 60_000);
  emergencyStop = () => this.rpc('printer.emergency_stop');
  firmwareRestart = () => this.rpc('printer.firmware_restart');

  /** Cameras configured in Moonraker; empty when it has none or can't say. */
  async webcams(): Promise<Webcam[]> {
    try {
      return parseWebcams(await this.rpc('server.webcams.list'));
    } catch {
      return [];
    }
  }
}
