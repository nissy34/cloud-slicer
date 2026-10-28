#!/usr/bin/env node
// A printer run by OctoPrint in the Device tab, end to end through the real bridge:
// browser -> relay (wrangler dev) -> bridge, which stands in for Moonraker ->
// the real OctoPrint with its built-in virtual printer (test/device/printers/octoprint).
// It adds the printer with its API key, then checks status, temperatures, Move,
// the console's replies, the camera, upload, print, pause and cancel, and
// connecting again after an emergency stop. It never talks to real hardware.
//
//   test/device/printers/octoprint/start.sh /tmp/octoprint 7140   (OctoPrint installed with pip)
//   npm run build && node test/device-octoprint.mjs [screenshot-dir]
//
// OCTOPRINT_URL says where it runs (default http://127.0.0.1:7140).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bridgeConfig, bridgeProgram, pairingCode, startBridge } from './device/go-bridge.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PAGE_PORT = 4177;
const RELAY_PORT = 8794;
const OCTO = process.env.OCTOPRINT_URL ?? 'http://127.0.0.1:7140';
const KEY = 'CLOUDSLICERTESTKEY0123456789ABCD';
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

const until = async (what, fn, ms = 15_000) => {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** OctoPrint's own answer, to check what the bridge did. */
async function octo(path, init = {}) {
  const res = await fetch(OCTO + path, { ...init, headers: { 'X-Api-Key': KEY, 'Content-Type': 'application/json', ...init.headers } });
  if (!res.ok) throw new Error(`OctoPrint ${path}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

await until('OctoPrint answers', () => octo('/api/printer').then(() => true, () => false), 90_000);
// Clean up after an earlier run.
for (const f of (await octo('/api/files/local')).files) if (f.type !== 'folder') await octo(`/api/files/local/${f.path}`, { method: 'DELETE' }).catch(() => undefined);

let bridge;
const program = bridgeProgram();
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  const persist = mkdtempSync(join(tmpdir(), 'relay-'));
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', persist], join(web, '../device-relay'), /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const cfg = { relay: `http://127.0.0.1:${RELAY_PORT}`, bridgeId: 'octo-test-bridge', key: 'octo-test-key-0123456789ab', printers: [] };
  const config = bridgeConfig(cfg);
  // What the bridge's search finds: the real one knows OctoPrint by its login page.
  const found = join(config.dir, 'found.json');
  writeFileSync(found, JSON.stringify([{ url: OCTO, name: '127.0.0.1', needsKey: true, kind: 'octoprint' }]));
  bridge = startBridge(program, config, { find: found, log: (m) => console.log(`bridge: ${m}`) });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PAGE_PORT}/#pair=${pairingCode(cfg)}`);
  const printers = page.getByTestId('bridge-printers');
  await page.getByTestId('bridge-state').filter({ hasText: 'Connected to the bridge' }).waitFor({ timeout: 30_000 });
  // The table starts folded in the window.
  await page.getByRole('dialog').getByTestId('works-with').getByText('See what each can do').click();
  await page.getByRole('dialog').getByTestId('works-with').getByRole('rowheader', { name: /OctoPrint/ }).waitFor();

  await printers.getByTestId('bridge-search').click();
  const row = printers.locator(`[data-testid="add-row"][data-url="${OCTO}"]`);
  await row.waitFor({ timeout: 20_000 });
  await row.locator('.dv-kind').filter({ hasText: 'OctoPrint' }).waitFor();
  await row.getByTestId('add-row-add').click();
  await row.getByTestId('add-row-name').fill('My Ender');
  await row.getByText('Application Keys', { exact: false }).waitFor();
  await row.getByTestId('add-row-done').click();
  await row.getByRole('alert').filter({ hasText: 'Type its OctoPrint API key first' }).waitFor();
  await row.getByTestId('add-row-key').fill('wrong');
  await row.getByTestId('add-row-done').click();
  await row.getByRole('alert').filter({ hasText: 'did not accept that API key' }).waitFor();
  await row.getByTestId('add-row-key').fill(KEY);
  await row.getByTestId('add-row-done').click();
  await until('the bridge kept it as an OctoPrint printer', () => config.printers().some((p) => p.name === 'My Ender' && p.kind === 'octoprint' && p.apiKey === KEY));
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'octoprint-add.png') });
  await page.getByTestId('save-printer').click();
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });
  await page.locator('.dv-model').filter({ hasText: 'OctoPrint' }).waitFor();
  console.log('octoprint: added with its API key, connected through the bridge');

  // Temperatures from OctoPrint, and set from here (in Marlin's words).
  await page.getByTestId('toolheads-card').locator('.dv-head-temp').first().waitFor();
  await page.getByLabel('Bed target').fill('55');
  await page.getByLabel('Bed target').press('Enter');
  await until('bed target 55 in OctoPrint', async () => (await octo('/api/printer')).temperature.bed.target === 55, 20_000);
  await page.getByLabel('Bed target').fill('0');
  await page.getByLabel('Bed target').press('Enter');
  console.log('octoprint: temperatures shown and set');

  // Move: homing first (OctoPrint doesn't say what is homed; the bridge remembers), then a jog.
  const motion = page.getByTestId('motion-card');
  if (!(await motion.getByRole('button', { name: 'Head right' }).isDisabled())) throw new Error('jogging before homing');
  await motion.getByRole('button', { name: 'Home all' }).click();
  await until('homed', () => motion.getByRole('button', { name: 'Head right' }).isEnabled(), 20_000);
  await motion.getByRole('button', { name: 'Head right' }).click();
  // The bridge asks the printer where the head is after a move.
  await motion.locator('.dv-pos').filter({ hasText: 'X 10.0' }).waitFor({ timeout: 20_000 });
  // The console shows what the printer says back.
  const consoleCard = page.getByTestId('console-card');
  await consoleCard.getByLabel('G-code command').fill('M114');
  await consoleCard.getByLabel('G-code command').press('Enter');
  await consoleCard.locator('li', { hasText: /X:10(\.0+)? / }).first().waitFor({ timeout: 20_000 });
  await consoleCard.getByLabel('G-code command').fill('SET_LED LED=x WHITE=1');
  await consoleCard.getByLabel('G-code command').press('Enter');
  await page.getByText('is a Klipper command', { exact: false }).first().waitFor();
  console.log('octoprint: home, jog, and the console shows the printer\'s replies');

  // The camera OctoPrint has (its logo stands in), through the bridge.
  await page.getByTestId('camera-frame').waitFor({ timeout: 30_000 });
  await until('camera picture', () => page.getByTestId('camera-frame').first().evaluate((img) => img.naturalWidth > 0).catch(() => false), 30_000);
  if (shots) await page.screenshot({ path: join(shots, 'octoprint-device.png') });
  console.log('octoprint: camera from its settings');

  // Upload only, then print it from the file list, pause and cancel.
  const lines = ['; generated by test', 'G28', 'M117 test'];
  for (let i = 0; i < 300; i++) lines.push(`G1 X${10 + (i % 100)} Y${10 + (i % 50)} F600`);
  const gcode = Buffer.from(lines.join('\n') + '\n');
  await page.getByTestId('device-gcode-input').setInputFiles({ name: 'cube.gcode', mimeType: 'text/plain', buffer: gcode });
  await page.getByRole('dialog').getByRole('heading', { name: 'Send to My Ender' }).waitFor();
  await page.getByTestId('upload-only').click();
  await until('file in OctoPrint', async () => (await octo('/api/files/local')).files.some((f) => f.path === 'cube.gcode' && f.size === gcode.length), 20_000);
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20_000 });
  if ((await octo('/api/job')).state !== 'Operational') throw new Error('Upload only started a print');
  await page.getByTestId('files-card').locator('li', { hasText: 'cube.gcode' }).getByRole('button', { name: 'Print…' }).click();
  await page.getByTestId('upload-and-print').click();
  await page.getByTestId('print-state').filter({ hasText: 'Printing' }).waitFor({ timeout: 20_000 });
  await page.getByTestId('job-card').getByText('cube.gcode').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'octoprint-printing.png') });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Paused' }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Cancel print' }).click();
  await page.getByRole('dialog', { name: 'Cancel print' }).getByRole('button', { name: 'Cancel print' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Cancelled' }).waitFor({ timeout: 30_000 });
  console.log('octoprint: upload, print, pause and cancel on the virtual printer');

  // The phone layout shows it too, with nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  const tooWide = await page.evaluate(() => [...document.querySelectorAll('.device *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)?.className ?? null);
  if (tooWide !== null) throw new Error(`wider than a phone: ${tooWide}`);
  if (shots) await page.screenshot({ path: join(shots, 'octoprint-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });

  // OctoPrint without its printer says so, and "Connect again" connects it.
  await octo('/api/connection', { method: 'POST', body: JSON.stringify({ command: 'disconnect' }) });
  await page.getByTestId('job-card').getByText("OctoPrint isn't connected to the printer", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByTestId('job-card').getByRole('button', { name: 'Connect again' }).click();
  await page.getByTestId('print-state').waitFor({ timeout: 30_000 });
  await until('connected again', async () => (await octo('/api/connection')).current.state !== 'Closed', 20_000);
  console.log('octoprint: not connected to its printer, then connected again');
  console.log('DEVICE OCTOPRINT OK');
} catch (e) {
  console.error(`DEVICE OCTOPRINT FAIL: ${e.stack ?? e.message}`);
  process.exitCode = 1;
} finally {
  bridge?.stop();
  await browser.close();
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {
      // already gone
    }
  }
}
