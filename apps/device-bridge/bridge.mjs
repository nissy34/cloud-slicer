#!/usr/bin/env node
// Cloud Slicer bridge: lets the Device tab reach printers on your home network.
//
// Runs on any always-on computer near the printer (a PC, Raspberry Pi, NAS)
// with Node.js 22 or newer, and has no dependencies. It connects OUT to the
// relay over a websocket, so nothing on your router needs opening. The relay
// hands it the browser's Moonraker messages; it passes them to the printer
// and sends the answers back. It only talks to printers you added here.
//
//   node cloud-slicer-bridge.mjs add 192.168.1.50 [--name "My U1"] [--api-key KEY]
//   node cloud-slicer-bridge.mjs list | remove <name> | pair
//   node cloud-slicer-bridge.mjs                     # run (keep it running)
//
// Options: --config <file> (default ~/.cloud-slicer-bridge.json),
//          --relay <url>, --site <url> (where pairing links point).
//
// Part of Cloud Slicer (AGPL-3.0): https://github.com/nissy34/cloud-slicer
import { createHmac, randomBytes } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const VERSION = '2';
// The relay that served this file replaces this default when you download it.
const DEFAULT_RELAY = '__RELAY_URL__'.startsWith('__') ? 'https://cloud-slicer-relay.nissy34.workers.dev' : '__RELAY_URL__';
const DEFAULT_SITE = 'https://cloud-slicer.pages.dev';
/** notify_status_update is merged and sent at most this often per browser, to keep the relay within its free tier. */
export const STATUS_EVERY_MS = 1000;
/** Base64 of a frame must stay under the relay's 1 MiB message limit. */
const MAX_FRAME = 700 * 1024;
/** Moonraker notifications the Device tab doesn't use; dropping them saves relay traffic. */
const DROPPED = new Set(['notify_proc_stat_update', 'notify_cpu_throttled']);

/**
 * Moonraker calls the bridge refuses to pass on. access.* would let anyone
 * holding the pairing code read or replace the printer's API key, or add
 * Moonraker users; the Device tab never needs them.
 */
export const refused = (method) => typeof method === 'string' && method.startsWith('access.');

// ---- config ------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      opts[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else rest.push(a);
  }
  return { opts, rest };
}

async function loadConfig(path, relay) {
  let cfg = {};
  try {
    cfg = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // first run
  }
  const fresh = !cfg.bridgeId;
  cfg.bridgeId ??= randomBytes(12).toString('base64url');
  cfg.key ??= randomBytes(24).toString('base64url');
  cfg.relay = String(relay ?? cfg.relay ?? DEFAULT_RELAY).replace(/\/+$/, '');
  cfg.printers ??= [];
  if (fresh) await saveConfig(path, cfg);
  return cfg;
}

async function saveConfig(path, cfg) {
  await writeFile(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** "192.168.1.50" -> candidate Moonraker base URLs, most likely first. */
export function candidateUrls(address) {
  const a = String(address).trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(a)) return [a];
  if (/:\d+$/.test(a)) return [`http://${a}`];
  return [`http://${a}:7125`, `http://${a}`];
}

async function probe(url, apiKey) {
  const r = await fetch(`${url}/printer/info`, { headers: apiKey ? { 'X-Api-Key': apiKey } : {}, signal: AbortSignal.timeout(5000) });
  if (r.status === 401 || r.status === 403) throw new Error('Moonraker wants an API key (add --api-key KEY)');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  return body.result ?? {};
}

/**
 * The key browsers get, derived from this bridge's secret key (the relay
 * derives the same). It lets a browser reach the printers but not connect as
 * this bridge, and the secret key itself never leaves this computer.
 */
export const browserKey = (key) => createHmac('sha256', key).update('cloud-slicer browser key').digest('base64url');

export const pairingCode = (cfg) =>
  Buffer.from(JSON.stringify({ r: cfg.relay, i: cfg.bridgeId, k: browserKey(cfg.key) })).toString('base64url');

function printPairing(cfg, site) {
  const code = pairingCode(cfg);
  console.log('\nPair this bridge in Cloud Slicer: Device tab > Add a printer > On my home network.');
  console.log(`Open this link in your browser:\n  ${String(site ?? cfg.site ?? DEFAULT_SITE).replace(/\/+$/, '')}/#pair=${code}`);
  console.log(`or paste this code:\n  ${code}\n`);
  console.log('Anyone with this code can control your printers; keep it private.\n');
}

// ---- one browser's session with one printer ------------------------------------------

/** Merges a notify_status_update diff into a pending one (same rules as Moonraker's own diffs). */
export function mergeDiff(into, diff) {
  for (const [k, v] of Object.entries(diff ?? {})) {
    into[k] = v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object' ? { ...into[k], ...v } : v;
  }
  return into;
}

class Session {
  constructor(id, printer, send, drop) {
    Object.assign(this, { id, printer, send, drop });
    this.queue = [];
    this.ws = null;
    this.pendingStatus = null;
    this.statusTimer = null;
    this.uploads = new Map();
    this.closed = false;
  }

  async open() {
    let url = this.printer.url.replace(/^http/i, 'ws') + '/websocket';
    if (this.printer.apiKey) {
      const r = await fetch(`${this.printer.url}/access/oneshot_token`, { headers: { 'X-Api-Key': this.printer.apiKey }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`The printer refused the API key (HTTP ${r.status}).`);
      url += `?token=${encodeURIComponent((await r.json()).result)}`;
    }
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`${this.printer.name} did not answer.`));
      }, 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        for (const m of this.queue) ws.send(m);
        this.queue = [];
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Could not reach ${this.printer.name} at ${this.printer.url}.`));
      };
      ws.onmessage = (ev) => this.fromPrinter(String(ev.data));
      ws.onclose = () => {
        if (this.ws === ws && !this.closed) this.drop(`Lost the connection to ${this.printer.name}.`);
        this.ws = null;
      };
    });
  }

  fromPrinter(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (DROPPED.has(msg.method)) return;
    if (msg.method === 'notify_status_update') {
      this.pendingStatus = mergeDiff(this.pendingStatus ?? {}, msg.params?.[0]);
      this.statusTimer ??= setTimeout(() => this.flushStatus(), STATUS_EVERY_MS);
      return;
    }
    // Anything else goes straight through, after the status it may depend on.
    this.flushStatus();
    this.send(text);
  }

  flushStatus() {
    clearTimeout(this.statusTimer);
    this.statusTimer = null;
    if (!this.pendingStatus) return;
    const diff = this.pendingStatus;
    this.pendingStatus = null;
    this.send(JSON.stringify({ jsonrpc: '2.0', method: 'notify_status_update', params: [diff, Date.now() / 1000] }));
  }

  fromBrowser(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg.method === 'string' && msg.method.startsWith('bridge.')) {
      this.local(msg).then(
        (result) => this.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })),
        (e) => this.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } })),
      );
      return;
    }
    if (refused(msg.method)) {
      if (msg.id != null) this.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `The bridge does not pass on ${msg.method}.` } }));
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    else this.queue.push(text);
  }

  /** Same-host check: the browser may only make the bridge fetch from its own printer. */
  resolve(url) {
    const base = new URL(this.printer.url);
    const u = new URL(url, base);
    if (u.hostname !== base.hostname || !/^https?:$/.test(u.protocol)) throw new Error('Only the printer itself can be reached through the bridge.');
    // Relative paths keep the printer's port; Moonraker's webcam paths are relative to the web server.
    return u.href;
  }

  async local(msg) {
    const p = msg.params ?? {};
    switch (msg.method) {
      case 'bridge.snapshot': {
        const url = this.resolve(p.url);
        const tries = /^https?:\/\//i.test(p.url) ? [url] : [url, this.resolve(new URL(p.url, `http://${new URL(this.printer.url).hostname}`).href)];
        let last;
        for (const u of [...new Set(tries)]) {
          try {
            const r = await fetch(u, { headers: this.keyFor(u), signal: AbortSignal.timeout(5000) });
            if (!r.ok) throw new Error(`Camera answered HTTP ${r.status}`);
            const buf = Buffer.from(await r.arrayBuffer());
            if (!buf.length) throw new Error('Empty frame');
            if (buf.length > MAX_FRAME) throw new Error('Camera frame too large to relay');
            return { contentType: r.headers.get('content-type') ?? 'image/jpeg', data: buf.toString('base64') };
          } catch (e) {
            last = e;
          }
        }
        throw last;
      }
      case 'bridge.upload_begin': {
        const dir = await mkdtemp(join(tmpdir(), 'cloud-slicer-'));
        const uploadId = randomBytes(8).toString('hex');
        this.uploads.set(uploadId, { dir, file: join(dir, 'upload'), path: String(p.path || 'print.gcode'), size: Number(p.size) || 0, received: 0 });
        await writeFile(join(dir, 'upload'), '');
        return { uploadId };
      }
      case 'bridge.upload_chunk': {
        const up = this.uploads.get(p.uploadId);
        if (!up) throw new Error('Unknown upload');
        if (p.offset !== up.received) throw new Error('Upload chunk out of order');
        const buf = Buffer.from(p.data, 'base64');
        await appendFile(up.file, buf);
        up.received += buf.length;
        return { received: up.received };
      }
      case 'bridge.upload_end': {
        const up = this.uploads.get(p.uploadId);
        if (!up) throw new Error('Unknown upload');
        this.uploads.delete(p.uploadId);
        try {
          const form = new FormData();
          form.append('root', 'gcodes');
          form.append('file', await openAsBlob(up.file), up.path);
          const r = await fetch(`${this.printer.url}/server/files/upload`, { method: 'POST', body: form, headers: this.keyFor(this.printer.url) });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body?.error?.message ?? `Upload failed: HTTP ${r.status}`);
          return { path: body.result?.item?.path ?? body.item?.path ?? up.path };
        } finally {
          await rm(up.dir, { recursive: true, force: true });
        }
      }
      default:
        throw new Error(`Unknown bridge call ${msg.method}`);
    }
  }

  keyFor(url) {
    return this.printer.apiKey && new URL(url).host === new URL(this.printer.url).host ? { 'X-Api-Key': this.printer.apiKey } : {};
  }

  close() {
    this.closed = true;
    clearTimeout(this.statusTimer);
    this.ws?.close();
    for (const up of this.uploads.values()) void rm(up.dir, { recursive: true, force: true });
    this.uploads.clear();
  }
}

// ---- the relay connection ---------------------------------------------------------

export function runBridge(cfg, { log = console.log } = {}) {
  const sessions = new Map();
  let relay = null;
  let retries = 0;
  let stopped = false;

  const toRelay = (obj) => relay?.readyState === WebSocket.OPEN && relay.send(JSON.stringify(obj));

  const connect = () => {
    if (stopped) return;
    const url = `${cfg.relay.replace(/^http/i, 'ws')}/v1/bridges/${encodeURIComponent(cfg.bridgeId)}/agent?key=${encodeURIComponent(cfg.key)}`;
    const ws = new WebSocket(url);
    relay = ws;
    ws.onopen = () => {
      retries = 0;
      log(`Connected to the relay (${cfg.relay}). Serving: ${cfg.printers.map((p) => p.name).join(', ') || 'no printers yet'}`);
      toRelay({ ctl: 'hello', version: VERSION, printers: cfg.printers.map(({ id, name }) => ({ id, name })) });
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.ctl === 'open') {
        const printer = cfg.printers.find((p) => p.id === msg.printer);
        if (!printer) return toRelay({ ctl: 'drop', c: msg.c, reason: 'This bridge no longer has that printer.' });
        sessions.get(msg.c)?.close();
        const s = new Session(
          msg.c,
          printer,
          (text) => toRelay({ c: msg.c, m: text }),
          (reason) => {
            sessions.delete(msg.c);
            s.close();
            toRelay({ ctl: 'drop', c: msg.c, reason });
          },
        );
        sessions.set(msg.c, s);
        s.open().catch((e) => {
          sessions.delete(msg.c);
          s.close();
          toRelay({ ctl: 'drop', c: msg.c, reason: e.message });
        });
      } else if (msg.ctl === 'close') {
        sessions.get(msg.c)?.close();
        sessions.delete(msg.c);
      } else if (msg.c && typeof msg.m === 'string') {
        sessions.get(msg.c)?.fromBrowser(msg.m);
      }
    };
    ws.onclose = (ev) => {
      if (relay !== ws) return;
      relay = null;
      for (const s of sessions.values()) s.close();
      sessions.clear();
      if (stopped) return;
      if (ev.code === 4003) {
        log(`The relay refused this bridge: ${ev.reason}`);
      }
      const delay = Math.min(60_000, 2000 * 2 ** Math.min(retries++, 5));
      log(`Relay connection closed${ev.reason ? ` (${ev.reason})` : ''}; retrying in ${Math.round(delay / 1000)} s.`);
      setTimeout(connect, delay);
    };
    ws.onerror = () => {};
  };
  connect();
  return {
    stop() {
      stopped = true;
      relay?.close();
      for (const s of sessions.values()) s.close();
    },
    get sessions() {
      return sessions.size;
    },
  };
}

// ---- command line ------------------------------------------------------------------

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  const path = String(opts.config ?? process.env.CLOUD_SLICER_BRIDGE_CONFIG ?? join(homedir(), '.cloud-slicer-bridge.json'));
  const cfg = await loadConfig(path, opts.relay);
  if (opts.site) cfg.site = String(opts.site);
  const [cmd = 'run', ...args] = rest;

  if (cmd === 'add') {
    if (!args[0]) throw new Error('Usage: add <address> [--name NAME] [--api-key KEY]');
    const apiKey = opts['api-key'] ? String(opts['api-key']) : '';
    let found = null;
    let lastError = null;
    for (const url of candidateUrls(args[0])) {
      try {
        found = { url, info: await probe(url, apiKey) };
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!found) throw new Error(`No Moonraker answered at ${args[0]}: ${lastError?.message}`);
    const name = String(opts.name ?? found.info.hostname ?? args[0]);
    const existing = cfg.printers.find((p) => p.url === found.url);
    if (existing) Object.assign(existing, { name, apiKey });
    else cfg.printers.push({ id: randomBytes(4).toString('hex'), name, url: found.url, apiKey });
    await saveConfig(path, cfg);
    console.log(`Added ${name} (${found.url}). Restart the bridge if it is running.`);
    printPairing(cfg, opts.site);
  } else if (cmd === 'remove') {
    const before = cfg.printers.length;
    cfg.printers = cfg.printers.filter((p) => p.name !== args[0] && p.id !== args[0]);
    await saveConfig(path, cfg);
    console.log(before === cfg.printers.length ? `No printer called ${args[0]}.` : `Removed ${args[0]}.`);
  } else if (cmd === 'list') {
    for (const p of cfg.printers) console.log(`${p.id}  ${p.name}  ${p.url}${p.apiKey ? '  (API key)' : ''}`);
    if (!cfg.printers.length) console.log('No printers yet. Add one: add <address>');
  } else if (cmd === 'pair') {
    printPairing(cfg, opts.site);
  } else if (cmd === 'run') {
    if (!cfg.printers.length) console.log('No printers yet. Add one first: node cloud-slicer-bridge.mjs add <printer address>');
    printPairing(cfg, opts.site);
    runBridge(cfg);
  } else {
    throw new Error(`Unknown command ${cmd}. Commands: add, remove, list, pair, run`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
