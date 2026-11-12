// The signed-in person's printers (the Device tab's, from their account): how one
// is doing, and sending a file to it, with the site's own printer code
// (device/session.ts, link/bridge.ts, the printer add-ons, device/print-plan.ts).
// A printer behind a bridge is reached through the relay with the site's ticket,
// like the Device tab; Node has no WebRTC, so uploads go through the relay.
//
// Nothing here starts a print on its own: server.ts asks the person first, every time.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Device } from '../../web/src/account/api';
import { uploadName } from '../../web/src/device/commands';
import { readGcode3mf, readGcodeMeta } from '../../web/src/device/gcode-meta';
import { BridgeLink } from '../../web/src/device/link/bridge';
import { DirectLink } from '../../web/src/device/link/direct';
import type { UploadStage } from '../../web/src/device/link/types';
import { printPlan } from '../../web/src/device/print-plan';
import { printerFromDevice, runCalls, type SavedPrinter } from '../../web/src/device/saved';
import { PrinterSession, type ConnState } from '../../web/src/device/session';
import { heaters, job, klippyMessage, klippyState, type KlipperObjects } from '../../web/src/device/status';
import type { PrinterError } from '../../web/src/device/addons';
import { ApiError, type Account } from './account';

/** How long to wait for a printer to come online before saying it can't be reached. */
const CONNECT_MS = 30_000;
/** A printer's connection stays open this long after the last use (status, then send, costs one connection). */
const KEEP_MS = 60_000;

interface Live {
  printer: SavedPrinter;
  session: PrinterSession;
  state: ConnState;
  message: string;
  objects: KlipperObjects;
  errors: PrinterError[];
  ready: Promise<void>;
  timer?: NodeJS.Timeout;
}

export class Printers {
  private live = new Map<string, Live>();

  constructor(private account: Account) {}

  /** The account's printers (bridges themselves are left out). */
  async list(): Promise<SavedPrinter[]> {
    const { devices } = await this.account.api<{ devices: Device[] }>('/devices');
    return devices.map(printerFromDevice).filter((p): p is SavedPrinter => p !== null);
  }

  /** The printer named `which` (its name, or id); with one printer, that one. */
  async find(which?: string): Promise<SavedPrinter> {
    const all = await this.list();
    if (!all.length) throw new Error('This account has no printers yet. Add one in the Device tab on the site.');
    if (!which) {
      if (all.length === 1) return all[0];
      throw new Error(`Say which printer: ${all.map((p) => p.name).join(', ')}.`);
    }
    const w = which.trim().toLowerCase();
    const found = all.find((p) => p.id === which || p.name.toLowerCase() === w) ?? all.find((p) => p.name.toLowerCase().includes(w));
    if (!found) throw new Error(`No printer called "${which}". The account has: ${all.map((p) => p.name).join(', ')}.`);
    return found;
  }

  /** Connects (or reuses the open connection) and waits until the printer answers. */
  private async connect(p: SavedPrinter): Promise<Live> {
    const open = this.live.get(p.id);
    if (open && open.state !== 'offline') {
      this.keep(open);
      await open.ready;
      return open;
    }
    open?.session.stop();
    const { apiKey } = await this.account.api<{ apiKey: string | null }>(`/devices/${encodeURIComponent(p.id)}/secret`);
    const secret = apiKey ?? '';
    const link =
      p.kind === 'direct'
        ? new DirectLink(p.url, secret)
        : new BridgeLink({
            relay: p.relay,
            bridgeId: p.bridgeId,
            key: secret,
            printer: p.printer,
            ticket: () => this.ticket(p.relay, p.bridgeId),
          });
    let settle!: (e?: Error) => void;
    const live: Live = {
      printer: p,
      state: 'connecting',
      message: '',
      objects: {},
      errors: [],
      ready: new Promise<void>((ok, fail) => (settle = (e) => (e ? fail(e) : ok()))),
      session: null as unknown as PrinterSession,
    };
    const timer = setTimeout(() => settle(new Error(`${p.name} didn't answer: ${live.message || 'no answer'}.`)), CONNECT_MS);
    live.session = new PrinterSession(link, {
      onState: (state, message) => {
        live.state = state;
        live.message = message;
        if (state === 'online') {
          clearTimeout(timer);
          settle();
        }
      },
      onObjects: (o) => (live.objects = o),
      onFacts: () => {},
      onConsole: () => {},
      onFilesChanged: () => {},
      onErrors: (e) => (live.errors = e),
    });
    this.live.set(p.id, live);
    live.session.start();
    try {
      await live.ready;
    } catch (e) {
      this.drop(p.id);
      throw e;
    }
    // The first status arrives just after the handshake.
    for (let i = 0; i < 20 && !Object.keys(live.objects).length; i++) await new Promise((r) => setTimeout(r, 100));
    this.keep(live);
    return live;
  }

  /** The site's relay ticket for the bridge; null when the site uses none (as the Device tab: state/device.ts). */
  private async ticket(relay: string, bridgeId: string) {
    try {
      return await this.account.api<{ ticket: string; expiresAt: number }>('/relay/ticket', { method: 'POST', body: JSON.stringify({ relay, bridgeId }) });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 503 || e.status === 404)) return null;
      throw e;
    }
  }

  private keep(l: Live) {
    if (l.timer) clearTimeout(l.timer);
    l.timer = setTimeout(() => this.drop(l.printer.id), KEEP_MS);
    l.timer.unref?.();
  }

  private drop(id: string) {
    const l = this.live.get(id);
    if (!l) return;
    if (l.timer) clearTimeout(l.timer);
    l.session.stop();
    this.live.delete(id);
  }

  close() {
    for (const id of [...this.live.keys()]) this.drop(id);
  }

  /** How the printer is doing: what it prints, temperatures, its filaments, its errors. */
  async status(which?: string) {
    const p = await this.find(which);
    const l = await this.connect(p);
    return describe(l);
  }

  /**
   * Uploads `file` to the printer. With `start`, then starts it, after `confirm`
   * (the person's yes) answers true; refused when the printer is busy or a
   * filament has nothing it can print from.
   */
  async send(
    which: string | undefined,
    file: string,
    opts: { start: boolean; confirm?: (plan: { printer: string; file: string; slots: string[] }) => Promise<boolean>; progress?: (fraction: number, stage?: UploadStage) => void },
  ) {
    const p = await this.find(which);
    const l = await this.connect(p);
    const name = uploadName(basename(file));
    const bytes = readFileSync(file);
    const blob = new Blob([bytes]);
    let check: ReturnType<typeof printPlan> | null = null;
    if (opts.start) {
      const j = job(l.objects);
      if (j.state === 'printing' || j.state === 'paused') throw new Error(`${p.name} is already printing ${j.filename}. Nothing was sent.`);
      if (klippyState(l.objects) && klippyState(l.objects) !== 'ready') throw new Error(`${p.name} isn't ready: ${klippyMessage(l.objects) || klippyState(l.objects)}. Nothing was sent.`);
      const bundle = /\.3mf$/i.test(name) ? await readGcode3mf(blob) : null;
      const meta = await readGcodeMeta(bundle?.gcode ?? blob);
      check = printPlan({ addons: l.session.addons, objects: l.objects, path: name, meta, plate: bundle?.plate ?? null });
      const blocked = [...check.checks.values()].map((c) => c.blocked).filter(Boolean);
      if (blocked.length) throw new Error(`${blocked.join(' ')} Nothing was sent.`);
      const slots = meta.filaments.map((f) => {
        const slot = check!.toolMap ? check!.slots[check!.toolMap[f.index]] : undefined;
        return `filament ${f.index + 1}${f.material ? ` (${f.material})` : ''}${slot ? ` from ${slot.label}${slot.material ? ` (${slot.material})` : ''}` : ''}`;
      });
      if (!opts.confirm || !(await opts.confirm({ printer: p.name, file: name, slots }))) return { printer: p.name, sent: false, started: false, note: 'Not started: the person did not say yes. Nothing was sent.' };
      // The person may have taken a while: still free?
      const now = job(l.objects);
      if (now.state === 'printing' || now.state === 'paused') throw new Error(`${p.name} started printing ${now.filename} meanwhile. Nothing was sent.`);
    }
    const path = await l.session.upload(blob, name, (f) => opts.progress?.(f), undefined, (s) => opts.progress?.(0, s));
    this.keep(l);
    if (!opts.start || !check) return { printer: p.name, sent: true, started: false, path };
    await runCalls(l.session, check.calls(path));
    return { printer: p.name, sent: true, started: true, path };
  }
}

function describe(l: Live) {
  const j = job(l.objects);
  const fil = l.session.addons.find((a) => a.filaments)?.filaments;
  const slots = fil?.read(l.objects) ?? [];
  const round = (n: number) => Math.round(n);
  return {
    printer: l.printer.name,
    connection: l.state,
    state: j.state,
    ...(j.filename && { file: j.filename }),
    ...((j.state === 'printing' || j.state === 'paused') && {
      progressPercent: Math.round(j.progress * 100),
      ...(j.layer != null && { layer: `${j.layer}${j.totalLayers ? ` of ${j.totalLayers}` : ''}` }),
      printedMinutes: round(j.printSeconds / 60),
    }),
    ...(j.message && { message: j.message }),
    ...(klippyState(l.objects) && klippyState(l.objects) !== 'ready' && { problem: klippyMessage(l.objects) || klippyState(l.objects) }),
    temperatures: heaters(l.objects).map((h) => ({ name: h.label, now: round(h.temp), target: round(h.target) })),
    ...(slots.length && {
      filaments: slots.map((s) => ({ slot: s.label, material: s.material || 'not set', colour: s.colour, ...(s.vendor && { brand: s.vendor }), loaded: s.ready })),
    }),
    ...(l.errors.length && { errors: l.errors.map((e) => `${e.title}: ${e.text}`) }),
  };
}
