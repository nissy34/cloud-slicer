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
import { metaFromMoonraker, readGcode3mf, readGcodeMeta } from '../../web/src/device/gcode-meta';
import { excludeObjectGcode, extrudeGcode, fanGcode, homeGcode, jogGcode, lightGcode, motorsOffGcode, setHeaterGcode, speedFactorGcode, flowFactorGcode } from '../../web/src/device/commands';
import { dialect, takesCommands } from '../../web/src/device/addons';
import { feedGcode, filamentConfigGcode, parkHeadGcode, pickHeadGcode, U1_LIGHT, u1Heads, u1LightGcode } from '../../web/src/device/addons/u1';
import { printObjects } from '../../web/src/device/objects';
import { BridgeLink } from '../../web/src/device/link/bridge';
import { DirectLink } from '../../web/src/device/link/direct';
import type { UploadStage } from '../../web/src/device/link/types';
import { printPlan } from '../../web/src/device/print-plan';
import { printerFromDevice, runCalls, type SavedPrinter } from '../../web/src/device/saved';
import { PrinterSession, type ConnState } from '../../web/src/device/session';
import { fans, heaters, job, klippyMessage, klippyState, lights, motion, type KlipperObjects } from '../../web/src/device/status';
import type { PrinterError } from '../../web/src/device/addons';
import { ApiError, type Account } from './account';

/** How long to wait for a printer to come online before saying it can't be reached. */
const CONNECT_MS = 30_000;
/** A printer's connection stays open this long after the last use (status, then send, costs one connection). */
const KEEP_MS = 60_000;

class Declined extends Error {}

/** How long a control waits for the printer before answering that it is still running. */
const WAIT_MS = Number(process.env.CLOUD_SLICER_WAIT_MS) || 20_000;

/** One Device tab control (server.ts printer_control). */
export interface Control {
  action:
    | 'print_file' | 'pause' | 'resume' | 'stop' | 'skip_object'
    | 'home' | 'move' | 'extrude' | 'motors_off' | 'heat' | 'fan' | 'light' | 'speed' | 'flow'
    | 'load_filament' | 'unload_filament' | 'set_head_filament' | 'pick_head' | 'park_head';
  file?: string;
  object?: string;
  axes?: ('x' | 'y' | 'z')[];
  axis?: 'x' | 'y' | 'z';
  mm?: number;
  heater?: string;
  target?: number;
  fan?: string;
  light?: string;
  on?: boolean;
  percent?: number;
  head?: number;
  material?: string;
  subType?: string;
  brand?: string;
  colour?: string;
}

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
  private tickets = new Map<string, { ticket: string; expiresAt: number }>();

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
    // A ticket lasts an hour: kept and used again (the site counts them per day).
    const kept = this.tickets.get(bridgeId);
    if (kept && kept.expiresAt - Date.now() > 5 * 60_000) return kept;
    try {
      const t = await this.account.api<{ ticket: string; expiresAt: number }>('/relay/ticket', { method: 'POST', body: JSON.stringify({ relay, bridgeId }) });
      this.tickets.set(bridgeId, t);
      return t;
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

  /** The files on the printer, newest first. */
  async files(which?: string) {
    const p = await this.find(which);
    const l = await this.connect(p);
    const list = await l.session.listFiles();
    return { printer: p.name, files: list.sort((a, b) => b.modified - a.modified).slice(0, 50).map((f) => ({ file: f.path, sizeKb: Math.round(f.size / 1024), at: new Date(f.modified * 1000).toISOString() })) };
  }

  /**
   * One of the Device tab's controls. `confirm` asks the person; every control that
   * heats, moves, starts, resumes or stops a print is asked first, every time.
   */
  async control(which: string | undefined, c: Control, confirm: (what: string) => Promise<boolean>) {
    const p = await this.find(which);
    const l = await this.connect(p);
    const s = l.session;
    const o = l.objects;
    const addons = s.addons;
    const isU1 = addons.some((a) => a.id === 'u1');
    const j = job(o);
    const printing = j.state === 'printing' || j.state === 'paused';
    const ask = async (what: string) => {
      if (!(await confirm(`${what} on ${p.name}?`))) throw new Declined();
    };
    const gcodeOk = () => {
      if (!takesCommands(addons)) throw new Error(`${p.name} doesn't take commands from Cloud Slicer (only status, files and prints).`);
    };
    const notPrinting = () => {
      if (printing) throw new Error(`${p.name} is printing ${j.filename}. Pause or stop it first.`);
    };
    // Homing a U1 or loading filament can take minutes, longer than an AI app waits for a
    // tool: after WAIT_MS the answer says it's still running, and printer_status tells when done.
    let still = false;
    const run = async (script: string) => {
      this.keep(l);
      const done = s.gcode(script, 600_000).finally(() => this.keep(l));
      const waited = await Promise.race([done.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), WAIT_MS))]);
      if (waited) {
        still = true;
        done.catch(() => {});
      }
    };
    const answer = (r: Record<string, unknown>) =>
      still ? { ...r, done: `${String(r.done)}: sent, still running on the printer`, note: 'It takes a while; printer_status shows when it is done (homed axes, temperatures, filaments).' } : r;
    const head = (n: number | undefined) => {
      if (!isU1) throw new Error('Tool heads can only be handled on a Snapmaker U1.');
      const h = u1Heads(o)[(n ?? 1) - 1];
      if (!h) throw new Error('Head numbers are 1 to 4.');
      return h;
    };
    try {
      return answer(await (async (): Promise<Record<string, unknown>> => { switch (c.action) {
        case 'print_file': {
          if (!c.file) throw new Error('Say which file (from printer_files).');
          notPrinting();
          const meta = metaFromMoonraker(await s.metadata(c.file));
          const plan = printPlan({ addons, objects: o, path: c.file, meta, plate: null });
          const blocked = [...plan.checks.values()].map((x) => x.blocked).filter(Boolean);
          if (blocked.length) throw new Error(blocked.join(' '));
          await ask(`Start printing ${c.file}`);
          await runCalls(s, plan.calls(c.file));
          return { done: `Printing ${c.file}` };
        }
        case 'pause':
          if (j.state !== 'printing') throw new Error(`${p.name} isn't printing.`);
          await ask(`Pause the print of ${j.filename}`);
          await s.pause();
          return { done: 'Paused' };
        case 'resume':
          if (j.state !== 'paused') throw new Error(`${p.name} isn't paused.`);
          await ask(`Resume printing ${j.filename}`);
          await s.resume();
          return { done: 'Resumed' };
        case 'stop':
          if (!printing) throw new Error(`${p.name} isn't printing.`);
          await ask(`Stop the print of ${j.filename} (it can't be continued)`);
          await s.cancel();
          return { done: 'Stopped' };
        case 'skip_object': {
          const objs = printObjects(o);
          if (!objs.supported) throw new Error(`${p.name} can't skip objects.`);
          const want = (c.object ?? '').toLowerCase();
          const ob = objs.objects.find((x) => x.label.toLowerCase() === want || x.name.toLowerCase() === want);
          if (!ob) throw new Error(`No object "${c.object}". Objects: ${objs.objects.map((x) => x.label).join(', ') || 'none'}.`);
          await ask(`Skip ${ob.label} for the rest of this print (it can't be undone)`);
          await run(excludeObjectGcode(ob.name));
          return { done: `Skipping ${ob.label}` };
        }
        case 'home':
          gcodeOk();
          notPrinting();
          await ask(`Home ${c.axes?.length ? c.axes.join(', ').toUpperCase() : 'all axes'} (the head and bed move)`);
          await run(homeGcode(c.axes ?? []));
          return { done: 'Homed' };
        case 'move': {
          gcodeOk();
          notPrinting();
          if (!c.axis || !c.mm) throw new Error('Say the axis (x, y or z) and the millimetres.');
          await ask(`Move ${c.axis.toUpperCase()} by ${c.mm} mm`);
          await run(jogGcode(c.axis, c.mm, c.axis === 'z' ? 600 : 6000, dialect(addons)));
          return { done: `Moved ${c.axis.toUpperCase()} ${c.mm} mm` };
        }
        case 'extrude': {
          gcodeOk();
          notPrinting();
          if (!c.mm) throw new Error('Say the millimetres (negative to pull back).');
          await ask(`${c.mm > 0 ? 'Push out' : 'Pull back'} ${Math.abs(c.mm)} mm of filament (the nozzle must be hot)`);
          await run(extrudeGcode(c.mm, undefined, dialect(addons)));
          return { done: `${c.mm > 0 ? 'Extruded' : 'Retracted'} ${Math.abs(c.mm)} mm` };
        }
        case 'motors_off':
          gcodeOk();
          notPrinting();
          await run(motorsOffGcode());
          return { done: 'Motors off' };
        case 'heat': {
          gcodeOk();
          const all = heaters(o);
          const want = (c.heater ?? '').toLowerCase();
          const h = all.find((x) => x.name.toLowerCase() === want || x.label.toLowerCase() === want) ?? (want === 'bed' ? all.find((x) => x.kind === 'bed') : want === 'nozzle' ? all.find((x) => x.kind === 'nozzle') : undefined);
          if (!h) throw new Error(`No heater "${c.heater}". Heaters: ${all.map((x) => x.label).join(', ')}.`);
          const target = Math.max(0, Math.min(h.max, Math.round(c.target ?? 0)));
          if (target > 0) await ask(`Heat ${h.label} to ${target} °C`);
          await run(setHeaterGcode(h.name, target, h.max, dialect(addons)));
          return { done: target > 0 ? `${h.label} heating to ${target} °C` : `${h.label} off` };
        }
        case 'fan': {
          gcodeOk();
          const all = fans(o).filter((f) => f.settable);
          const want = (c.fan ?? '').toLowerCase();
          const f = all.find((x) => x.name.toLowerCase() === want || x.label.toLowerCase() === want) ?? (all.length === 1 || !want ? all[0] : undefined);
          if (!f) throw new Error(`No fan "${c.fan}". Fans that can be set: ${all.map((x) => x.label).join(', ') || 'none'}.`);
          const pct = Math.max(0, Math.min(100, c.percent ?? 0));
          await run(fanGcode(f.name, pct / 100));
          return { done: `${f.label} at ${pct}%` };
        }
        case 'light': {
          gcodeOk();
          const all = lights(o);
          if (!all.length) throw new Error(`${p.name} has no light it lets us switch.`);
          const want = (c.light ?? '').toLowerCase();
          const li = all.find((x) => x.name.toLowerCase() === want || x.label.toLowerCase() === want) ?? all.find((x) => x.name === U1_LIGHT) ?? all[0];
          await run(isU1 && li.name === U1_LIGHT ? u1LightGcode(Boolean(c.on)) : lightGcode(li.name, Boolean(c.on)));
          return { done: `Light ${c.on ? 'on' : 'off'}` };
        }
        case 'speed':
        case 'flow': {
          gcodeOk();
          if (!c.percent) throw new Error('Say the percent (100 is normal).');
          await run(c.action === 'speed' ? speedFactorGcode(c.percent) : flowFactorGcode(c.percent));
          return { done: `${c.action === 'speed' ? 'Speed' : 'Flow'} ${c.percent}%` };
        }
        case 'load_filament':
        case 'unload_filament': {
          const h = head(c.head);
          notPrinting();
          if (!h.feed) throw new Error(`${h.label} has no automatic feed.`);
          const load = c.action === 'load_filament';
          await ask(`${load ? 'Load' : 'Unload'} filament ${load ? 'into' : 'from'} ${h.label} (the head heats and moves)`);
          await run(feedGcode(h.feed, load ? 'load' : 'unload'));
          return { done: `${load ? 'Loading' : 'Unloading'} ${h.label}` };
        }
        case 'set_head_filament': {
          const h = head(c.head);
          if (!c.material) throw new Error('Say the material, e.g. PLA or PETG.');
          if (h.official) throw new Error(`${h.label} has a tagged spool; the printer reads its filament from the tag.`);
          await run(filamentConfigGcode(h.index, { material: c.material, subType: c.subType ?? '', vendor: c.brand ?? '', colour: c.colour ?? h.colour }));
          return { done: `${h.label}: ${c.material}${c.colour ? ` ${c.colour}` : ''}` };
        }
        case 'pick_head':
        case 'park_head': {
          const h = head(c.head);
          notPrinting();
          const pick = c.action === 'pick_head';
          await ask(`${pick ? 'Pick up' : 'Park'} ${h.label} (the carriage moves)`);
          await run(pick ? pickHeadGcode(h.index) : parkHeadGcode(h.index));
          return { done: `${pick ? 'Picked up' : 'Parked'} ${h.label}` };
        }
      }
      throw new Error(`Unknown action ${String(c.action)}.`);
      })());
    } catch (e) {
      if (e instanceof Declined) return { done: false, note: 'The person said no; nothing was done.' };
      throw e;
    }
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
    ...(motion(l.objects).homed !== undefined && { homedAxes: motion(l.objects).homed || 'none' }),
    temperatures: heaters(l.objects).map((h) => ({ name: h.label, now: round(h.temp), target: round(h.target) })),
    ...(slots.length && {
      filaments: slots.map((s) => ({ slot: s.label, material: s.material || 'not set', colour: s.colour, ...(s.vendor && { brand: s.vendor }), loaded: s.ready })),
    }),
    ...(l.errors.length && { errors: l.errors.map((e) => `${e.title}: ${e.text}`) }),
  };
}
