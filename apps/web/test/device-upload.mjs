#!/usr/bin/env node
// Sending G-code through the bridge, end to end against a pretend printer only:
// browser -> (direct WebRTC link | relay via wrangler dev) -> bridge -> mock printer.
// The file is zipped on the way and must reach the printer byte for byte, both
// over the direct link and, when the network blocks direct links, over the relay.
// Upload only: it never starts a print.
//
//   npm run build && node test/device-upload.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bridgeConfig, bridgeProgram, browserKey, startBridge } from './device/go-bridge.mjs';
import { startMockPrinter } from './device/mock-printer.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const relayDir = join(web, '../device-relay');
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

// About 3 MB of G-code, varied enough that zipping is realistic (not one repeated line).
function gcode(seed) {
  const lines = [`; upload test ${seed}`, 'G28'];
  let x = 0;
  for (let size = 0, i = 0; size < 3_000_000; i++) {
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
    const text = gcode(label);
    const started = Date.now();
    await page.getByTestId('device-gcode-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await page.getByTestId('upload-only').click();
    await until(`${name} on the printer`, () => printer.files.has(name), 60_000);
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30_000 });
    const got = printer.files.get(name).text;
    if (got !== text) throw new Error(`${label}: the printer got ${got.length} bytes that differ from the ${text.length} sent`);
    if (printer.state.print_stats.state !== 'standby') throw new Error('Upload only started a print');
    const route = routes.find((r) => r.name === name);
    const want = label === 'direct' ? /over the direct link/ : /over the relay/;
    if (!route || !want.test(route.how)) throw new Error(`${label}: the bridge says ${route ? route.how : 'nothing'} for ${name}`);
    console.log(`${label}: ${(text.length / 1e6).toFixed(1)} MB reached the printer intact in ${((Date.now() - started) / 1000).toFixed(1)} s (${route.how})`);
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
