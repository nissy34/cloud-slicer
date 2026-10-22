#!/usr/bin/env node
// Printer pages (a camera's own page, opened with Open page), end to end against
// a pretend printer only: browser -> relay (wrangler dev) holder page -> this
// site -> bridge -> mock printer with a paxx12-like remote screen behind the web
// login. Checks the page shows, taps reach the printer, the page runs on the
// relay's address (not the site's), and it can't reach Moonraker's API.
//
//   npm run build && node test/device-pages.mjs [screenshot-dir]
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
const PAGE_PORT = 4176;
const RELAY_PORT = 8794;
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

const printer = await startMockPrinter({ generic: true, hostname: 'Screen-mock', apiKey: 'mock-api-key', screen: true });
let bridge;
let failShot = null;
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', mkdtempSync(join(tmpdir(), 'relay-pages-'))], relayDir, /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const site = `http://localhost:${PAGE_PORT}/`;
  const relay = `http://127.0.0.1:${RELAY_PORT}`;
  const cfg = { relay, bridgeId: 'pages-test-bridge', key: 'pages-test-key-0123456789', printers: [{ id: 'screen', name: 'Screen-mock', url: printer.url, apiKey: 'mock-api-key' }] };
  bridge = startBridge(bridgeProgram(), bridgeConfig(cfg), { log: (m) => console.log(`bridge: ${m}`) });

  for (const [label, viewport] of [
    ['desktop', { width: 1280, height: 900 }],
    ['phone', { width: 390, height: 844 }],
    // A network that blocks direct links: everything goes over the relay.
    ['relay only', { width: 1280, height: 900 }],
  ]) {
    const context = await browser.newContext({ viewport, ...(label === 'phone' ? { isMobile: true, hasTouch: true } : {}) });
    const viaRelay = label === 'relay only';
    if (viaRelay) await context.addInitScript(() => delete window.RTCPeerConnection);
    const page = await context.newPage();
    failShot = page;
    await page.addLocatorHandler(page.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Not now' }).click());
    page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
    await page.goto(site);
    await page.evaluate(
      ([cfg, key]) =>
        localStorage.setItem('cloud-slicer:printers:v1', JSON.stringify([{ id: 'through-bridge', name: 'Screen-mock', kind: 'bridge', relay: cfg.relay, bridgeId: cfg.bridgeId, key, printer: 'screen' }])),
      [cfg, browserKey(cfg.key)],
    );
    // Opening at #device keeps the first-run printer wizard away (it would sit under the page panel).
    await page.goto(`${site}#device`);
    await page.reload();
    await page.getByRole('tab', { name: 'Device' }).click();
    await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });

    // The screen is a camera tile like the others; its page opens from the tile.
    const tile = page.locator('[data-camera="gui"]');
    await tile.waitFor({ timeout: 30_000 });
    if (!(await tile.getAttribute('data-main'))) await tile.locator('.dv-camera-swap').click();
    await page.locator('[data-camera="gui"][data-main]').waitFor();
    if ((await page.getByTestId('open-page').count()) !== 1) throw new Error('only the big camera tile, and only a page camera, offers Open page');
    // The case camera is a page too, but its tile is still live pictures, not a page streaming through the relay.
    await tile.getByTestId('open-page').click();
    const panel = page.getByTestId('printer-page');
    await panel.waitFor();
    const screen = page.frameLocator('[data-testid="printer-page"] iframe').frameLocator('iframe');
    await screen.getByText('mock screen: 0 taps').waitFor({ timeout: 30_000 });
    await until('the screen picture shows', () => screen.locator('#s').evaluate((img) => img.naturalWidth === 480), 30_000);
    // Taps reach the printer, and the picture after them comes back.
    const before = printer.stats.touches.length;
    await screen.locator('#s').click({ position: { x: 40, y: 30 } });
    await screen.getByText('mock screen: 1 taps').waitFor({ timeout: 15_000 });
    await until('the tap reached the printer', () => printer.stats.touches.length === before + 1);
    if (!/^\?a=tap&x=\d+&y=\d+$/.test(printer.stats.touches.at(-1))) throw new Error(`tap arrived as ${printer.stats.touches.at(-1)}`);
    const route = viaRelay ? 'relay' : 'direct';
    await until(`the panel goes ${route}`, async () => (await panel.getAttribute('data-route')) === route, 30_000);
    if (viaRelay) {
      // The page asks for its picture ten times a second; over the relay about one a second reaches the printer.
      const start = printer.stats.pagePolls;
      await new Promise((r) => setTimeout(r, 3000));
      const polls = printer.stats.pagePolls - start;
      if (polls > 6) throw new Error(`over the relay the page asked the printer ${polls} times in 3 s`);
      console.log(`${label}: ${polls} picture checks reached the printer in 3 s`);
    }
    console.log(`${label}: the screen page shows, a tap reached the printer, requests go ${viaRelay ? 'over the relay' : 'over the direct link'}`);

    // The page runs on the relay's address: it can't read the site, and Moonraker's API is out of its reach.
    const inner = page.frames().find((f) => f.url().includes('/page/v/'));
    if (!inner || !inner.url().startsWith(relay)) throw new Error(`the printer page should run on the relay's address, not ${inner?.url()}`);
    const reach = await inner.evaluate(async () => {
      let site = 'blocked';
      try {
        site = String(top.document.title);
      } catch {
        // cross-origin: as it should be
      }
      let storage = 'blocked';
      try {
        storage = String(top.localStorage.length);
      } catch {
        // cross-origin: as it should be
      }
      const api = await fetch('/access/api_key').then((r) => r.status);
      const nested = await fetch('../access/api_key').then((r) => r.status);
      return { site, storage, api, nested };
    });
    if (reach.site !== 'blocked' || reach.storage !== 'blocked') throw new Error(`the printer page can reach the site: ${JSON.stringify(reach)}`);
    if (reach.nested === 200) throw new Error(`the printer page reached Moonraker's API: ${JSON.stringify(reach)}`);
    if (printer.stats.refused.length) throw new Error(`Moonraker's API was reached: ${printer.stats.refused}`);
    console.log(`${label}: the page runs apart from the site and can't reach Moonraker's API`);

    // The panel fits the screen.
    const box = await panel.boundingBox();
    if (box.x < 0 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1) throw new Error(`${label}: the page panel does not fit (${JSON.stringify(box)})`);
    if (shots) await page.screenshot({ path: join(shots, `printer-page-${label.replace(' ', '-')}.png`) });
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await panel.waitFor({ state: 'detached' });
    // Closed means closed: the page stops asking for pictures.
    await new Promise((r) => setTimeout(r, 1500));
    const after = printer.stats.pagePolls;
    await new Promise((r) => setTimeout(r, 1500));
    if (printer.stats.pagePolls !== after) throw new Error('the screen is still being asked for pictures after closing its page');
    if (shots && !viaRelay) await page.getByTestId('camera-card').screenshot({ path: join(shots, `printer-page-tile-${label}.png`) });
    await context.close();
  }
  console.log('DEVICE PAGES OK');
} catch (e) {
  console.error(`DEVICE PAGES FAIL: ${e.stack ?? e.message}`);
  if (shots && failShot) await failShot.screenshot({ path: join(shots, 'printer-page-failed.png') }).catch(() => undefined);
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
  process.exit();
}
