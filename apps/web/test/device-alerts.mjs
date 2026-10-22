#!/usr/bin/env node
// Print alerts in the Device tab, end to end against pretend printers only:
//   1. a printer through the bridge: the Alerts card turns alerts on, the relay
//      (wrangler dev) pushes to a pretend push service here, decrypted as a browser would
//   2. a printer reached directly: the page itself shows the alerts while open
//   3. an iPhone without the site on its Home Screen: the card says what to do
// The browser's push service is stood in for: pushManager.subscribe returns a
// subscription to the pretend one, and shown notifications are recorded.
// It starts prints on the MOCK printers only.
//
//   npm run build && node test/device-alerts.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { bridgeConfig, bridgeProgram, browserKey, startBridge } from './device/go-bridge.mjs';
import { startMockPrinter } from './device/mock-printer.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const relayDir = join(web, '../device-relay');
const ece = createRequire(join(relayDir, 'package.json'))('http_ece');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PAGE_PORT = 4175;
const RELAY_PORT = 8795;
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

const until = async (what, fn, ms = 60_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

// The pretend push service, and the keys of the pretend browser subscription.
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const auth = randomBytes(16);
const pushes = [];
const push = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      pushes.push(JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth.toString('base64url') }).toString('utf8')));
      res.writeHead(201).end();
    } catch {
      res.writeHead(400).end();
    }
  });
});
await new Promise((r) => push.listen(0, '127.0.0.1', r));
const subscription = { endpoint: `http://127.0.0.1:${push.address().port}/push/ui`, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') } };

/** Stands in for the browser's push service and records notifications the page shows itself. */
const fakePush = (sub) => {
  window.__shown = [];
  // Headless Chromium reports notifications as blocked even when the permission is granted.
  Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
  Notification.requestPermission = async () => 'granted';
  let current = null;
  const make = (key) => ({
    endpoint: sub.endpoint,
    options: { applicationServerKey: key },
    toJSON: () => ({ endpoint: sub.endpoint, keys: sub.keys }),
    unsubscribe: async () => ((current = null), true),
  });
  PushManager.prototype.getSubscription = async () => current;
  PushManager.prototype.subscribe = async (o) => (current = make(o.applicationServerKey.buffer ?? o.applicationServerKey));
  ServiceWorkerRegistration.prototype.showNotification = async (title, o) => void window.__shown.push({ title, ...o });
};

/** Turns the card's main switch on once it can be used (it waits for the printer and the saved alerts). */
const turnOn = async (card) => {
  const sw = card.getByTestId('alerts-on');
  const said = async (e) => {
    throw new Error(`${e.message}\ncard said: ${(await card.innerText()).replace(/\s+/g, ' ')}`);
  };
  await until('the alerts switch usable', async () => !(await sw.isDisabled()), 30_000).catch(said);
  await sw.click({ force: true });
  await card.getByTestId('alert-finished').waitFor({ timeout: 30_000 }).catch(said);
};

const voron = await startMockPrinter({ generic: true, hostname: 'Voron-mock' });
const direct = await startMockPrinter({ generic: true, hostname: 'Direct-mock' });
const persist = mkdtempSync(join(tmpdir(), 'relay-alerts-'));
const vapid = JSON.stringify((await import('node:crypto')).generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }));
let bridge;
let failShot = null;
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', persist, '--var', `VAPID_KEY:${vapid}`, '--var', 'PUSH_TEST_ENDPOINTS:1'], relayDir, /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const site = `http://localhost:${PAGE_PORT}/`;
  const cfg = { relay: `http://127.0.0.1:${RELAY_PORT}`, bridgeId: 'alerts-test-bridge', key: 'alerts-test-key-0123456789', printers: [{ id: 'voron', name: 'Voron-mock', url: voron.url, apiKey: '' }] };
  bridge = startBridge(bridgeProgram(), bridgeConfig(cfg), { log: (m) => console.log(`bridge: ${m}`) });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(['notifications'], { origin: site.replace(/\/$/, '') });
  await context.addInitScript(fakePush, subscription);
  const page = await context.newPage();
  failShot = page;
  // The first-run printer wizard (when the engine is there) is closed whenever it gets in the way.
  const noWizard = (p) => p.addLocatorHandler(p.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Not now' }).click());
  await noWizard(page);
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  // Two saved printers, as an earlier build kept them (they move into the account store on load).
  await page.goto(site);
  await page.evaluate(
    ([cfg, key, url]) =>
      localStorage.setItem(
        'cloud-slicer:printers:v1',
        JSON.stringify([
          { id: 'through-bridge', name: 'Voron-mock', kind: 'bridge', relay: cfg.relay, bridgeId: cfg.bridgeId, key, printer: 'voron' },
          { id: 'direct', name: 'Direct-mock', kind: 'direct', url, apiKey: '' },
        ]),
      ),
    [cfg, browserKey(cfg.key), direct.url],
  );
  await page.reload();
  await page.getByRole('tab', { name: 'Device' }).click();
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });

  // ---- through the bridge --------------------------------------------------------------
  const card = page.getByTestId('alerts-card');
  await card.getByText('Sent through the bridge, even when the browser is closed.').waitFor();
  if (shots) await card.screenshot({ path: join(shots, 'alerts-off-desktop.png') });
  await turnOn(card);
  // The agreed defaults: problems and Finished on, every other milestone off, pictures on, offline off.
  const checked = async (id) => card.getByTestId(id).isChecked();
  for (const id of ['alert-failed', 'alert-paused', 'alert-error', 'alert-finished', 'alert-pictures']) if (!(await checked(id))) throw new Error(`${id} should be on by default`);
  for (const id of ['alert-started', 'alert-layer1', 'alert-layer3', 'alert-progress', 'alert-almostDone', 'alert-stillPrinting', 'alert-resumed', 'alert-bedCooled', 'alert-offline'])
    if (await checked(id)) throw new Error(`${id} should be off by default`);
  console.log('alerts on through the bridge, with the agreed defaults');

  await card.getByTestId('alert-test').click();
  await until('the test alert pushed', () => pushes.find((p) => p.title === 'Test alert'));
  await card.getByText('Sent. It should show in a few seconds.').waitFor();
  console.log('test alert pushed through the relay');

  // Progress at 50% too.
  await card.getByTestId('alert-progress').click({ force: true });
  await card.getByRole('button', { name: '50%' }).waitFor();
  if ((await card.getByRole('button', { name: '50%' }).getAttribute('aria-pressed')) !== 'true') throw new Error('progress should start at 50%');
  if (shots) await card.screenshot({ path: join(shots, 'alerts-on-desktop.png') });

  // "Alert me after layer N" from the print dialog, then a whole print on the mock.
  await page.getByTestId('files-card').locator('li', { hasText: 'calibration_cube.gcode' }).getByRole('button', { name: 'Print…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('send-layer-alert').waitFor();
  // A layer past the print's last one is refused with a note, and nothing is saved.
  await dialog.getByText('of 50').waitFor();
  await dialog.getByTestId('alert-layer').fill('99999');
  await dialog.getByTestId('alert-layer').press('Enter');
  await dialog.getByTestId('alert-layer-hint').filter({ hasText: 'This print has 50 layers' }).waitFor();
  if ((await card.getByTestId('alert-layer').inputValue()) !== '') throw new Error('layer 99999 was saved');
  await dialog.getByTestId('alert-layer').fill('5');
  await dialog.getByTestId('alert-layer').press('Enter');
  await until('layer 5 saved', async () => (await card.getByTestId('alert-layer').inputValue()) === '5');
  if (shots) await dialog.screenshot({ path: join(shots, 'alerts-print-dialog-desktop.png') });
  await dialog.getByTestId('upload-and-print').click();
  for (const title of ['Layer 5 of 50 done', 'calibration_cube 50% done', 'calibration_cube finished']) await until(title, () => pushes.find((p) => p.title === title));
  const finished = pushes.find((p) => p.title === 'calibration_cube finished');
  if (!finished.image || finished.printer !== `${cfg.bridgeId}.voron`) throw new Error(`finished alert: ${JSON.stringify(finished)}`);
  if (pushes.some((p) => p.title.startsWith('Printing'))) throw new Error('"Print started" is off but was sent');
  await until('layer N cleared on the card', async () => (await card.getByTestId('alert-layer').inputValue()) === '');
  console.log('layer 5, 50% and finished (with a camera picture) pushed; layer N cleared after the print');

  // Phone width: the card fits, nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const wide = await page.evaluate(() => [...document.querySelectorAll('[data-testid="alerts-card"] *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)?.className ?? null);
  if (wide !== null) throw new Error(`the Alerts card is wider than a phone: ${wide}`);
  if (shots) await page.screenshot({ path: join(shots, 'alerts-on-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });

  // ---- reached directly: the open page alerts ----------------------------------------
  await page.getByTestId('printer-select').selectOption({ label: 'Direct-mock' });
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });
  await card.getByText('only come while Cloud Slicer is open in a tab').waitFor();
  if (await card.getByTestId('alert-pictures').count()) throw new Error('direct printers have no picture switch');
  await turnOn(card);
  if (shots) await card.screenshot({ path: join(shots, 'alerts-direct-desktop.png') });
  await page.getByTestId('files-card').locator('li', { hasText: 'calibration_cube.gcode' }).getByRole('button', { name: 'Print…' }).click();
  await page.getByRole('dialog').getByTestId('upload-and-print').click();
  await until('direct: finished shown by the page', () => page.evaluate(() => window.__shown.find((n) => n.title === 'calibration_cube finished')), 60_000);
  const shown = await page.evaluate(() => window.__shown.find((n) => n.title === 'calibration_cube finished'));
  if (shown.data?.printer !== 'direct.direct' || !String(shown.image ?? '').startsWith('data:image/')) throw new Error(`direct alert: ${JSON.stringify({ ...shown, image: String(shown.image).slice(0, 30) })}`);
  console.log('direct printer: the open page showed "finished", with a camera picture');

  // A tapped alert opens the Device tab on its printer.
  const tapped = await context.newPage();
  await noWizard(tapped);
  await tapped.goto(`${site}#alert=${encodeURIComponent(`${cfg.bridgeId}.voron`)}`);
  await tapped.getByTestId('printer-select').waitFor();
  if ((await tapped.getByTestId('printer-select').locator('option:checked').textContent()) !== 'Voron-mock') throw new Error('a tapped alert did not open its printer');
  console.log('a tapped alert opens the Device tab on its printer');

  // ---- iPhone in Safari, not on the Home Screen ----------------------------------------
  const iphone = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
  const ios = await iphone.newPage();
  await noWizard(ios);
  await ios.goto(site);
  await ios.evaluate((v) => localStorage.setItem('cloud-slicer:printers:v1', v), await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('cloud-slicer:devices:v1')).filter((d) => d.extra?.kind === 'direct').map((d) => ({ id: d.id, name: d.name, kind: 'direct', url: d.url, apiKey: '' })))));
  await ios.reload();
  await ios.getByRole('tab', { name: 'Device' }).click();
  await ios.getByTestId('alerts-ios').waitFor({ timeout: 30_000 });
  if (!(await ios.getByTestId('alerts-on').isDisabled())) throw new Error('alerts can be turned on in iPhone Safari outside the Home Screen');
  if (shots) {
    await ios.getByTestId('alerts-card').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await ios.screenshot({ path: join(shots, 'alerts-iphone.png') });
  }
  console.log('iPhone: Add to Home Screen first');
  console.log('DEVICE ALERTS OK');
} catch (e) {
  console.error(`DEVICE ALERTS FAIL: ${e.stack ?? e.message}`);
  if (shots && failShot) await failShot.screenshot({ path: join(shots, 'alerts-failed.png') }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  bridge?.stop();
  await browser.close();
  await voron.close();
  await direct.close();
  push.close();
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {
      // already gone
    }
  }
  process.exit();
}
