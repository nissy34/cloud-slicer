#!/usr/bin/env node
// Cloud Slicer bridge: lets the Device tab reach printers on your home network.
//
// Runs on any always-on computer near the printer (a PC, Raspberry Pi, NAS)
// with Node.js 22 or newer, and has no dependencies. It connects OUT to the
// relay over a websocket, so nothing on your router needs opening. The relay
// hands it the browser's Moonraker messages; it passes them to the printer
// and sends the answers back. It only talks to printers you added here.
//
//   node cloud-slicer-bridge.mjs                     # finds your printers, pairs, keeps running
//   node cloud-slicer-bridge.mjs add 192.168.1.50 [--name "My U1"] [--api-key KEY]
//   node cloud-slicer-bridge.mjs list | remove <name> | pair [--open]
//   node cloud-slicer-bridge.mjs install            # start with this computer
//   node cloud-slicer-bridge.mjs uninstall          # stop it and remove it from this computer
//
// The same file is also built into a one-file app per system (bun build
// --compile), which you open with a double click and which needs no Node.js.
//
// Options: --config <file> (default ~/.cloud-slicer-bridge.json),
//          --relay <url>, --site <url> (where pairing links point).
//
// Part of Cloud Slicer (AGPL-3.0): https://github.com/nissy34/cloud-slicer
import { createHmac, randomBytes } from 'node:crypto';
// fs as a namespace: a named import of openAsBlob would fail before main() can say Node is too old.
import * as fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, appendFile, mkdir, copyFile, chmod, rename } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, networkInterfaces, tmpdir, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const VERSION = '4';
/** True in the one-file app (bun build --compile), false under node or bun. */
const APP = Boolean(process.versions.bun) && !/^bun(\.exe)?$/i.test(basename(process.execPath));
/** The Mac app opened from Finder: it has no terminal window, but was opened by hand all the same. */
const MAC_BUNDLE = APP && process.platform === 'darwin' && /\.app\/Contents\/MacOS\//.test(process.execPath);
/** How to run this bridge again, for messages: the app's own path, or node and this script. */
let installedAt = null;
/**
 * A program path as a command to paste. On Windows "cmd /c call" makes the same
 * line work in PowerShell (where a quoted path followed by arguments is a
 * syntax error) and in Command Prompt.
 */
const asCommand = (path) => (process.platform === 'win32' ? `cmd /c call "${path}"` : `"${path}"`);
const self = () => (installedAt ? asCommand(installedAt) : APP ? asCommand(process.execPath) : `node ${basename(process.argv[1] ?? 'cloud-slicer-bridge.mjs')}`);
// The relay that served this file replaces this default when you download it.
const DEFAULT_RELAY = '__RELAY_URL__'.startsWith('__') ? 'https://cloud-slicer-relay.nissy34.workers.dev' : '__RELAY_URL__';
// Pairing links open the site the bridge was downloaded from (the relay fills it in).
const DEFAULT_SITE = '__SITE_URL__'.startsWith('__') ? 'https://slicer.awesomestuff.qzz.io' : '__SITE_URL__';
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
    } else if (!a.startsWith('-psn_')) rest.push(a); // older macOS adds -psn_… to apps opened from Finder
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
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error(apiKey ? 'Moonraker did not accept that API key' : 'Moonraker wants an API key (add --api-key KEY)'), { needsKey: true });
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

/** Every Moonraker answering on port 7125 on this computer's local networks (each /24). */
export async function discover({ timeoutMs = 1500, log = () => {} } = {}) {
  const hosts = new Set(['127.0.0.1']);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const prefix = a.address.split('.').slice(0, 3).join('.');
      for (let i = 1; i < 255; i++) hosts.add(`${prefix}.${i}`);
    }
  }
  log(`Looking for printers on your network (${hosts.size} addresses)...`);
  const found = [];
  const queue = [...hosts];
  const worker = async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      const url = `http://${h}:7125`;
      try {
        const r = await fetch(`${url}/printer/info`, { signal: AbortSignal.timeout(timeoutMs) });
        if (r.status === 401 || r.status === 403) found.push({ url, name: h, needsKey: true });
        else if (r.ok) found.push({ url, name: String((await r.json()).result?.hostname ?? h) });
      } catch {
        // nothing there
      }
    }
  };
  await Promise.all(Array.from({ length: 64 }, worker));
  return found;
}

/** Opens a link in this computer's browser, if it has one (not on a headless Pi). */
function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no browser here; the link is printed anyway
  }
}

export const pairingCode = (cfg) =>
  Buffer.from(JSON.stringify({ r: cfg.relay, i: cfg.bridgeId, k: browserKey(cfg.key) })).toString('base64url');

function printPairing(cfg, site, { open = false } = {}) {
  const code = pairingCode(cfg);
  const link = `${String(site ?? cfg.site ?? DEFAULT_SITE).replace(/\/+$/, '')}/#pair=${code}`;
  console.log('\nTo use your printer from Cloud Slicer, open this link in your browser:');
  console.log(`  ${link}`);
  if (open) openInBrowser(link);
  console.log(`or paste this code:\n  ${code}\n`);
  console.log('Anyone with this code can control your printers; keep it private.\n');
}

// ---- start with this computer -------------------------------------------------------

const SERVICE = 'cloud-slicer-bridge';
const LABEL = 'io.qzz.awesomestuff.cloud-slicer-bridge';

/**
 * What starting with the computer takes on each system, without doing it:
 * where this program is copied to, the files to write and the commands to
 * run. Windows: a Run entry for the user (no admin; at sign-in the bridge
 * starts itself again with no window, --background, so nothing sits in the
 * taskbar). macOS: a launch agent. Linux: a systemd user service,
 * plus lingering so it starts at boot without a sign-in (a headless Pi).
 */
export function autostartPlan({ platform = process.platform, home = homedir(), env = process.env, app = APP, exe = process.execPath, script = process.argv[1], user = safeUser() } = {}) {
  const win = platform === 'win32';
  const dir =
    win ? join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Cloud Slicer Bridge')
    : platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Cloud Slicer Bridge')
    : join(home, '.local', 'share', SERVICE);
  // The app copies itself; under node the script is copied and node runs it.
  const copy = app ? { from: exe, to: join(dir, win ? `${SERVICE}.exe` : SERVICE) } : { from: script, to: join(dir, `${SERVICE}.mjs`) };
  const argv = [...(app ? [copy.to] : [exe, copy.to]), 'run', '--no-browser'];
  const quoted = argv.map((a) => `"${a}"`).join(' ');
  if (win) {
    const value = `${quoted} "--background"`;
    return {
      dir,
      copy,
      files: [],
      enable: [['reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'CloudSlicerBridge', '/t', 'REG_SZ', '/d', value, '/f']]],
      start: [argv[0], [...argv.slice(1), '--background']],
      restart: null,
      disable: [['reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'CloudSlicerBridge', '/f']]],
      marker: null,
    };
  }
  if (platform === 'darwin') {
    const plist = join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const log = join(home, 'Library', 'Logs', `${SERVICE}.log`);
    const xml = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${argv.map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
    return {
      dir,
      copy,
      files: [{ path: plist, content }],
      enable: [['launchctl', ['bootout', `gui/${uid}/${LABEL}`], { optional: true }], ['launchctl', ['bootstrap', `gui/${uid}`, plist]]],
      start: null,
      restart: [['launchctl', ['kickstart', '-k', `gui/${uid}/${LABEL}`]]],
      disable: [['launchctl', ['bootout', `gui/${uid}/${LABEL}`], { optional: true }]],
      marker: plist,
    };
  }
  const unit = join(home, '.config', 'systemd', 'user', `${SERVICE}.service`);
  const content = `[Unit]
Description=Cloud Slicer bridge (lets the Device tab reach printers on this network)
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=${argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
  // The app also gets a menu entry, with its icon, that opens the pairing link.
  const icon = join(dir, 'icon.png');
  const menu = {
    path: join(home, '.local', 'share', 'applications', `${SERVICE}.desktop`),
    content: `[Desktop Entry]
Type=Application
Name=Cloud Slicer Bridge
Comment=Open the link that pairs this bridge with Cloud Slicer
Exec=${[copy.to, 'pair', '--open'].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}
Icon=${icon}
Terminal=false
Categories=Utility;
`,
  };
  return {
    dir,
    copy,
    files: app ? [{ path: unit, content }, menu] : [{ path: unit, content }],
    icon: app ? icon : null,
    enable: [
      ['systemctl', ['--user', 'daemon-reload']],
      ['systemctl', ['--user', 'enable', SERVICE]],
      ['systemctl', ['--user', 'restart', SERVICE]],
      // Without lingering a user service only runs while that user is signed in.
      ['loginctl', ['enable-linger', user], { optional: true }],
    ],
    start: null,
    restart: [['systemctl', ['--user', 'restart', SERVICE]]],
    disable: [['systemctl', ['--user', 'disable', '--now', SERVICE], { optional: true }]],
    marker: unit,
  };
}

function safeUser() {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? '';
  }
}

function runStep([cmd, args, { optional = false } = {}]) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  if ((r.error || r.status !== 0) && !optional) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.error?.message || `exit ${r.status}`).trim()}`);
  }
  return r.status === 0;
}

/** Whether this computer already starts the bridge by itself. */
export function autostartInstalled(plan = autostartPlan()) {
  if (plan.marker) return fs.existsSync(plan.marker);
  const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'CloudSlicerBridge'], { stdio: 'ignore' });
  return r.status === 0;
}

/** Copies this program somewhere stable, registers it to start with the computer, and starts it now. */
async function installAutostart() {
  const plan = autostartPlan();
  await mkdir(plan.dir, { recursive: true });
  if (plan.copy.from !== plan.copy.to) {
    // An older copy may be running (Windows locks running programs): stop it first.
    for (const step of plan.disable) runStep([step[0], step[1], { optional: true }]);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/IM', basename(plan.copy.to), '/FI', `PID ne ${process.pid}`], { stdio: 'ignore' });
    }
    // Copy then rename: replacing a program that is running fails on Linux, renaming over it doesn't.
    await copyFile(plan.copy.from, `${plan.copy.to}.new`);
    if (process.platform !== 'win32') await chmod(`${plan.copy.to}.new`, 0o755);
    await rm(plan.copy.to, { force: true }).catch(() => {});
    await rename(`${plan.copy.to}.new`, plan.copy.to);
  }
  for (const f of plan.files) {
    await mkdir(dirname(f.path), { recursive: true });
    await writeFile(f.path, f.content);
  }
  if (plan.icon) {
    // build-apps.sh builds the icon into the Linux app.
    const png = globalThis.Bun?.embeddedFiles?.find((f) => /\.png$/.test(f.name));
    if (png) await writeFile(plan.icon, Buffer.from(await png.arrayBuffer()));
  }
  try {
    for (const step of plan.enable) runStep(step);
  } catch (e) {
    if (process.platform !== 'linux') throw e;
    throw new Error(`${e.message}\nThis computer can't start the bridge by itself (no systemd user services). Run it yourself instead: ${asCommand(plan.copy.to)} run`);
  }
  if (plan.start) {
    const child = spawn(plan.start[0], plan.start[1], { stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: true });
    child.unref();
  }
  return plan;
}

/** Restarts the background bridge, if there is one, so it picks up changed printers. Returns whether it did. */
function restartAutostart() {
  const plan = autostartPlan();
  if (!autostartInstalled(plan)) return false;
  try {
    if (plan.restart) for (const step of plan.restart) runStep(step);
    else {
      spawnSync('taskkill', ['/F', '/IM', basename(plan.copy.to), '/FI', `PID ne ${process.pid}`], { stdio: 'ignore' });
      spawn(plan.start[0], plan.start[1], { stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: true }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the bridge from this computer: stops it, stops it starting with the
 * computer, and deletes its installed copy and its settings (printers and the
 * pairing secret, so old pairing links stop working).
 */
async function uninstallBridge(configPath) {
  const plan = autostartPlan();
  for (const step of plan.disable) runStep([step[0], step[1], { optional: true }]);
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/IM', basename(plan.copy.to), '/FI', `PID ne ${process.pid}`], { stdio: 'ignore' });
  }
  for (const f of plan.files) await rm(f.path, { force: true });
  if (process.platform === 'linux') runStep(['systemctl', ['--user', 'daemon-reload'], { optional: true }]);
  await rm(configPath, { force: true });
  // install.sh's link to the command, on Linux.
  const link = join(homedir(), '.local', 'bin', SERVICE);
  try {
    if (fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link).startsWith(plan.dir)) fs.unlinkSync(link);
  } catch {}
  try {
    await rm(plan.dir, { recursive: true, force: true });
  } catch {
    // Windows can't delete the program that is running this: delete it just after this exits.
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${plan.dir}"`], { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
    }
  }
  return plan;
}

/** Asks for a line of text in the terminal. */
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim());
    }),
  );
}

/** Asks a yes/no question in the terminal; Enter means yes. */
async function ask(question) {
  return !/^n/i.test(await prompt(question));
}

/** Finds Moonraker at an address the user typed (with or without a port or http://). */
async function probeAddress(address, apiKey) {
  let lastError = null;
  for (const url of candidateUrls(address)) {
    try {
      return { url, info: await probe(url, apiKey) };
    } catch (e) {
      lastError = e;
      if (e.needsKey) break;
    }
  }
  throw Object.assign(new Error(`No Moonraker answered at ${address}: ${lastError?.message}`), { needsKey: !!lastError?.needsKey });
}

/** Keeps a double-clicked app's window open until Enter, so its message can be read. */
async function holdWindow() {
  if (APP && process.stdin.isTTY) await ask('\nPress Enter to close this window.');
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
          form.append('file', await fs.openAsBlob(up.file), up.path);
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

export function runBridge(cfg, { log = console.log, save = async () => {}, onReplaced = () => {}, find = discover } = {}) {
  const sessions = new Map();
  let relay = null;
  let retries = 0;
  let stopped = false;

  const toRelay = (obj) => relay?.readyState === WebSocket.OPEN && relay.send(JSON.stringify(obj));
  const hello = () => toRelay({ ctl: 'hello', version: VERSION, system: process.platform, app: APP, printers: cfg.printers.map(({ id, name }) => ({ id, name })) });

  /** Calls from a window with no printer chosen: finding, adding and removing this bridge's printers from the Device tab. */
  const manage = async (method, p = {}) => {
    if (method === 'bridge.discover') {
      log('Looking for printers on the network for the Device tab...');
      const found = await find();
      return { printers: found.map((f) => ({ url: f.url, name: f.name, needsKey: !!f.needsKey, added: cfg.printers.find((x) => x.url === f.url)?.id ?? null })) };
    }
    if (method === 'bridge.add_printer') {
      const address = String(p.address ?? '').trim().slice(0, 200);
      const apiKey = String(p.apiKey ?? '').trim().slice(0, 200);
      if (!address) throw new Error("Type the printer's address.");
      let found;
      try {
        found = await probeAddress(address, apiKey);
      } catch (e) {
        if (e.needsKey) throw new Error(apiKey ? 'The printer did not accept that API key.' : 'This printer needs its Moonraker API key.');
        throw new Error(`No printer answered at ${address}. Check the address, and that the printer is on.`);
      }
      const name = String(p.name || found.info.hostname || address).slice(0, 80);
      let printer = cfg.printers.find((x) => x.url === found.url);
      if (printer) Object.assign(printer, { name, apiKey });
      else cfg.printers.push((printer = { id: randomBytes(4).toString('hex'), name, url: found.url, apiKey }));
      await save();
      log(`Added ${name} (${found.url}) from the Device tab.`);
      hello();
      return { id: printer.id, name };
    }
    if (method === 'bridge.remove_printer') {
      const id = String(p.id ?? '');
      const printer = cfg.printers.find((x) => x.id === id);
      if (!printer) return { removed: false };
      cfg.printers = cfg.printers.filter((x) => x !== printer);
      await save();
      for (const [c, s] of sessions) {
        if (s.printer === printer) {
          s.close();
          sessions.delete(c);
          toRelay({ ctl: 'drop', c, reason: 'This printer was removed from the bridge.' });
        }
      }
      log(`Removed ${printer.name} from the Device tab.`);
      hello();
      return { removed: true };
    }
    throw new Error(`Unknown bridge call ${method}`);
  };

  const connect = () => {
    if (stopped) return;
    const url = `${cfg.relay.replace(/^http/i, 'ws')}/v1/bridges/${encodeURIComponent(cfg.bridgeId)}/agent?key=${encodeURIComponent(cfg.key)}`;
    const ws = new WebSocket(url);
    relay = ws;
    ws.onopen = () => {
      retries = 0;
      log(`Connected to the relay (${cfg.relay}). Serving: ${cfg.printers.map((p) => p.name).join(', ') || 'no printers yet'}`);
      hello();
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
        const session = sessions.get(msg.c);
        if (session) return session.fromBrowser(msg.m);
        let call;
        try {
          call = JSON.parse(msg.m);
        } catch {
          return;
        }
        if (call.id == null) return;
        const answer = (body) => toRelay({ c: msg.c, m: JSON.stringify({ jsonrpc: '2.0', id: call.id, ...body }) });
        manage(call.method, call.params).then(
          (result) => answer({ result }),
          (e) => answer({ error: { code: -32000, message: e.message } }),
        );
      }
    };
    ws.onclose = (ev) => {
      if (relay !== ws) return;
      relay = null;
      for (const s of sessions.values()) s.close();
      sessions.clear();
      if (stopped) return;
      // Another copy of this bridge (a second window, or the one running in the background) took
      // over: retrying would only take it back, and the two would swap forever.
      if (ev.code === 4000) {
        stopped = true;
        log('Another copy of this bridge is running on this computer and took over, so this one stops. Close this window.');
        onReplaced();
        return;
      }
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

export async function main() {
  if (!process.versions.bun && Number(process.versions.node.split('.')[0]) < 22) {
    throw new Error(`The bridge needs Node.js 22 or newer; this is ${process.version}. Install it from https://nodejs.org (or with nvm: nvm install 22).`);
  }
  const { opts, rest } = parseArgs(process.argv.slice(2));
  if (opts.background && process.platform === 'win32' && !process.env.CLOUD_SLICER_BRIDGE_BACKGROUND) {
    // Windows gives a console program a window (and a taskbar button). --background starts this
    // again detached with no window at all, and this copy exits; that is how it runs at sign-in.
    const args = process.argv.slice(2).filter((a) => a !== '--background');
    spawn(process.execPath, APP ? args : [process.argv[1], ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, CLOUD_SLICER_BRIDGE_BACKGROUND: '1' },
    }).unref();
    return;
  }
  const path = String(opts.config ?? process.env.CLOUD_SLICER_BRIDGE_CONFIG ?? join(homedir(), '.cloud-slicer-bridge.json'));
  const cfg = await loadConfig(path, opts.relay);
  if (opts.site) cfg.site = String(opts.site);
  const [cmd = 'run', ...args] = rest;
  // Opened with a double click (or plain "run" in a terminal): offer to start with the computer.
  const interactive = !rest.length && !opts['no-browser'] && (process.stdin.isTTY || MAC_BUNDLE);

  /** Sets the bridge up to start with this computer (and starts it there), or says why it can't. */
  const startWithComputer = async () => {
    try {
      const plan = await installAutostart();
      console.log(`\nThe bridge now runs in the background and starts by itself with this computer (from ${plan.copy.to}).`);
      console.log(`To remove it from this computer: ${asCommand(plan.copy.to)} uninstall`);
      return true;
    } catch (e) {
      console.log(`\nThe bridge can't start by itself on this computer (${e.message}). It runs while this window stays open.`);
      return false;
    }
  };

  if (cmd === 'add') {
    if (!args[0]) throw new Error('Usage: add <address> [--name NAME] [--api-key KEY]');
    const apiKey = opts['api-key'] ? String(opts['api-key']) : '';
    const found = await probeAddress(args[0], apiKey);
    const name = String(opts.name ?? found.info.hostname ?? args[0]);
    const existing = cfg.printers.find((p) => p.url === found.url);
    if (existing) Object.assign(existing, { name, apiKey });
    else cfg.printers.push({ id: randomBytes(4).toString('hex'), name, url: found.url, apiKey });
    await saveConfig(path, cfg);
    console.log(`Added ${name} (${found.url}).${restartAutostart() ? ' The bridge restarted to use it.' : ' Restart the bridge if it is running.'}`);
    printPairing(cfg, opts.site);
  } else if (cmd === 'remove') {
    const before = cfg.printers.length;
    cfg.printers = cfg.printers.filter((p) => p.name !== args[0] && p.id !== args[0]);
    await saveConfig(path, cfg);
    if (before === cfg.printers.length) console.log(`No printer called ${args[0]}.`);
    else console.log(`Removed ${args[0]}.${restartAutostart() ? ' The bridge restarted without it.' : ''}`);
  } else if (cmd === 'list') {
    for (const p of cfg.printers) console.log(`${p.id}  ${p.name}  ${p.url}${p.apiKey ? '  (API key)' : ''}`);
    if (!cfg.printers.length) console.log(`No printers yet. Add one: ${self()} add <address>`);
  } else if (cmd === 'pair') {
    printPairing(cfg, opts.site, { open: !!opts.open });
  } else if (cmd === 'install') {
    if (APP) installedAt = autostartPlan().copy.to;
    const plan = await installAutostart();
    console.log(`The bridge now starts by itself with this computer (from ${plan.copy.to}), and is running.`);
    console.log(`To remove it from this computer: ${asCommand(plan.copy.to)} uninstall`);
    printPairing(cfg, opts.site, { open: !opts['no-browser'] });
  } else if (cmd === 'uninstall') {
    await uninstallBridge(path);
    console.log('Removed the bridge from this computer: it has stopped, no longer starts with the computer, and its printers and pairing are deleted.');
    console.log('Remove its printers from the Device tab too (Edit, then Remove printer).');
  } else if (cmd === 'version') {
    console.log(VERSION);
  } else if (cmd === 'run') {
    if (interactive && autostartInstalled()) {
      // A second bridge would only take over from the background one. A newly
      // downloaded app replaces it instead (that's how the app updates).
      const plan = autostartPlan();
      if (APP && process.execPath !== plan.copy.to) {
        await installAutostart();
        console.log('Updated the bridge that runs in the background to this version.');
      } else console.log('The bridge already runs in the background and starts with this computer.');
      console.log(`To remove it from this computer: ${asCommand(plan.copy.to)} uninstall`);
      printPairing(cfg, opts.site, { open: true });
      await holdWindow();
      return;
    }
    // Opened by hand: set it up to start with the computer, no questions. Finding and adding printers (and their API keys) happens in the Device tab.
    if (interactive && (await startWithComputer())) {
      printPairing(cfg, opts.site, { open: true });
      console.log('You can close this window.');
      await holdWindow();
      process.exit(0);
    }
    printPairing(cfg, opts.site, { open: !opts['no-browser'] });
    runBridge(cfg, {
      save: () => saveConfig(path, cfg),
      onReplaced: async () => {
        await holdWindow();
        process.exit(0);
      },
    });
  } else {
    throw new Error(`Unknown command ${cmd}. Commands: add, remove, list, pair, run, install, uninstall`);
  }
}

// Run main() when started directly (not when imported by the tests). pathToFileURL
// handles Windows paths; the one-file app is always started directly.
if (APP || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().catch(async (e) => {
    console.error(e.message);
    await holdWindow();
    process.exit(1);
  });
}
