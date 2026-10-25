#!/usr/bin/env node
// Sending G-code through the bridge, end to end against a pretend printer only:
// browser -> (direct WebRTC link | relay via wrangler dev) -> bridge -> mock printer.
// The file is zipped on the way and must reach the printer byte for byte, both
// over the direct link and, when the network blocks direct links, over the relay.
// A refused file says why inside the Send window, and Cancel stops an upload
// halfway with nothing left on the printer. The bar says "Connecting…" until the
// first byte leaves, then moves as the bytes go. Upload only: it never starts a print.
//
//   npm run build && node test/device-upload.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bridgeConfig, bridgeProgram, browserKey, startBridge } from './device/go-bridge.mjs';
import { startMockPrinter } from './device/mock-printer.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const relayDir = join(web, '../device-relay');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PAGE_PORT = 4178;
const RELAY_PORT = 8796;
const children = [];

function serve(cmd, args, cwd, ready) {
  const child = spawn(cmd, args, { cwd, stdio: 'pipe', detached: true, env: { ...process.env, NO_COLOR: '1' } });
  children.push(child);
  let log = '';
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`${cmd} ${args.join(' ')} did not start:\n${log}`)), 90_000);
    const watch = (d) => {
      log += d;
      if (ready.test(log)) {
        clearTimeout(timer);
        ok();
      }
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => fail(new Error(`${cmd} exited (${code}):\n${log}`)));
  });
}

const until = async (what, fn, ms = 30_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

// G-code (3 MB unless said), varied enough that zipping is realistic (not one repeated line).
function gcode(seed, bytes = 3_000_000) {
  const lines = [`; upload test ${seed}`, 'G28'];
  let x = 0;
  for (let size = 0, i = 0; size < bytes; i++) {
    x = (x * 1103515245 + 12345 + i) % 2147483648;
    const line = `G1 X${(x % 27000) / 100} Y${((x >> 8) % 27000) / 100} E${((x >> 4) % 1000) / 1000}`;
    lines.push(line);
    size += line.length + 1;
  }
  lines.push('M84', '');
  return lines.join('\n');
}

const printer = await startMockPrinter({ generic: true, hostname: 'Upload-mock' });
const routes = [];
let bridge;
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', mkdtempSync(join(tmpdir(), 'relay-upload-'))], relayDir, /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const site = `http://localhost:${PAGE_PORT}/`;
  const relay = `http://127.0.0.1:${RELAY_PORT}`;
  const cfg = { relay, bridgeId: 'upload-test-bridge', key: 'upload-test-key-0123456789', printers: [{ id: 'mock', name: 'Upload-mock', url: printer.url, apiKey: '' }] };
  bridge = startBridge(bridgeProgram(), bridgeConfig(cfg), {
    log: (m) => {
      console.log(`bridge: ${m}`);
      const r = /^Upload (\S+): (.*)$/.exec(m);
      if (r) routes.push({ name: r[1], how: r[2] });
    },
  });

  for (const label of ['direct', 'relay']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // A network that blocks direct links: the file goes over the relay.
    if (label === 'relay') await context.addInitScript(() => delete window.RTCPeerConnection);
    const page = await context.newPage();
    await page.addLocatorHandler(page.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Not now' }).click());
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    await page.goto(site);
    await page.evaluate(
      ([cfg, key]) =>
        localStorage.setItem('cloud-slicer:printers:v1', JSON.stringify([{ id: 'through-bridge', name: 'Upload-mock', kind: 'bridge', relay: cfg.relay, bridgeId: cfg.bridgeId, key, printer: 'mock' }])),
      [cfg, browserKey(cfg.key)],
    );
    await page.goto(`${site}#device`);
    await page.reload();
    await page.getByRole('tab', { name: 'Device' }).click();
    await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });

    const name = `upload_${label}.gcode`;
    // Over the relay, big enough to zip to several 1 MiB pieces.
    const text = gcode(label, label === 'relay' ? 12_000_000 : 3_000_000);
    // The bar's words as the file goes up: "Connecting…" first, then over the relay it moves piece by piece.
    await page.evaluate(() => {
      window.__bar = [];
      new MutationObserver(() => {
        const t = document.querySelector('.dv-upload')?.textContent?.trim();
        if (t && window.__bar.at(-1) !== t) window.__bar.push(t);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const started = Date.now();
    await page.getByTestId('device-gcode-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await page.getByTestId('upload-only').click();
    await until(`${name} on the printer`, () => printer.files.has(name), 60_000);
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30_000 });
    const bar = await page.evaluate(() => window.__bar);
    console.log(`${label}: the bar said ${bar.join(' | ')}`);
    if (bar[0] !== 'Connecting…') throw new Error(`${label}: the bar started with ${bar[0]}, not Connecting…`);
    const between = bar.map((t) => Number(/Uploading (\d+)%/.exec(t)?.[1])).filter((n) => n > 0 && n < 90);
    if (label === 'relay' && between.length < 2) throw new Error(`${label}: the bar didn't move during the upload: ${bar.join(' | ')}`);
    const got = printer.files.get(name).text;
    if (got !== text) throw new Error(`${label}: the printer got ${got.length} bytes that differ from the ${text.length} sent`);
    if (printer.state.print_stats.state !== 'standby') throw new Error('Upload only started a print');
    const route = routes.find((r) => r.name === name);
    const want = label === 'direct' ? /over the direct link/ : /over the relay/;
    if (!route || !want.test(route.how)) throw new Error(`${label}: the bridge says ${route ? route.how : 'nothing'} for ${name}`);
    console.log(`${label}: ${(text.length / 1e6).toFixed(1)} MB reached the printer intact in ${((Date.now() - started) / 1000).toFixed(1)} s (${route.how})`);

    // The printer refuses the file (a file of that name is printing): the reason shows in the window, which stays open.
    printer.uploads.refuse = 'Forbidden';
    const refused = `refused_${label}.gcode`;
    await page.getByTestId('device-gcode-input').setInputFiles({ name: refused, mimeType: 'text/plain', buffer: Buffer.from('G28\n') });
    await page.getByTestId('upload-only').click();
    const error = page.getByRole('dialog').getByTestId('send-error');
    await error.waitFor({ timeout: 30_000 });
    if ((await error.textContent()) !== 'The printer refused the file: Forbidden (HTTP 403).') throw new Error(`${label}: the window says ${await error.textContent()}`);
    if (printer.files.has(refused)) throw new Error(`${label}: the refused file is on the printer`);
    if (shots && label === 'direct') {
      await page.getByRole('dialog').screenshot({ path: join(shots, 'send-error-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(shots, 'send-error-phone.png') });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    printer.uploads.refuse = '';
    await page.getByTestId('send-cancel').click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    console.log(`${label}: a refused file says why inside the Send window`);

    // Cancel works while the file goes up, and the printer keeps nothing.
    printer.uploads.slowMs = 50;
    const stopped = `cancelled_${label}.gcode`;
    await page.getByTestId('device-gcode-input').setInputFiles({ name: stopped, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await page.getByTestId('upload-only').click();
    // The bridge is passing the file on (the printer reads it slowly).
    await until(`${label}: the cancelled file on its way`, () => routes.some((r) => r.name === stopped), 30_000);
    const cancel = page.getByTestId('send-cancel');
    if (await cancel.isDisabled()) throw new Error(`${label}: Cancel is greyed out during the upload`);
    await cancel.click();
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 });
    await until(`${label}: the bridge drops the cancelled upload`, () => routes.some((r) => r.name === stopped && r.how === 'cancelled'), 15_000);
    await new Promise((r) => setTimeout(r, 1500));
    printer.uploads.slowMs = 0;
    if (printer.files.has(stopped)) throw new Error(`${label}: the cancelled file is on the printer`);
    console.log(`${label}: Cancel stopped the upload and the printer kept nothing`);
    await context.close();
  }
  console.log('DEVICE UPLOAD OK');
} catch (e) {
  console.error(`DEVICE UPLOAD FAIL: ${e.stack ?? e.message}`);
  process.exitCode = 1;
} finally {
  bridge?.stop();
  await browser.close();
  await printer.close();
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {
      // already gone
    }
  }
}
