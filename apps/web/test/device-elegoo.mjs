#!/usr/bin/env node
// An Elegoo Centauri Carbon in the Device tab, end to end through the real
// bridge: browser -> relay (wrangler dev) -> bridge, which stands in for
// Moonraker -> a pretend Elegoo speaking SDCP (test/device/mock-elegoo.mjs).
// It adds the printer (no password), checks the screen leaves out what the
// printer can't do, shows its camera, uploads, prints, pauses, resumes and
// cancels on the MOCK. It never talks to real hardware.
//
//   npm run build && node test/device-elegoo.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bridgeConfig, bridgeProgram, pairingCode, startBridge } from './device/go-bridge.mjs';
import { startMockElegoo } from './device/mock-elegoo.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PAGE_PORT = 4178;
const RELAY_PORT = 8795;
const children = [];

function serve(cmd, args, cwd, ready) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, NO_COLOR: '1' },
  });
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

const elegoo = await startMockElegoo();
// The bridge finds the pretend printer on its spare ports.
process.env.CLOUD_SLICER_ELEGOO_PORTS = elegoo.ports;
let bridge;
const program = bridgeProgram();
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  const persist = mkdtempSync(join(tmpdir(), 'relay-'));
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', persist], join(web, '../device-relay'), /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const cfg = {
    relay: `http://127.0.0.1:${RELAY_PORT}`,
    bridgeId: 'elegoo-test-bridge',
    key: 'elegoo-test-key-0123456789',
    printers: [],
  };
  const config = bridgeConfig(cfg);
  // What the bridge's search finds: the real one asks the whole network "M99999".
  const found = join(config.dir, 'found.json');
  writeFileSync(found, JSON.stringify([{ url: elegoo.url, name: 'Carbon mock', kind: 'elegoo' }]));
  bridge = startBridge(program, config, {
    find: found,
    log: (m) => console.log(`bridge: ${m}`),
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PAGE_PORT}/#pair=${pairingCode(cfg)}`);
  const printers = page.getByTestId('bridge-printers');
  await page.getByTestId('bridge-state').filter({ hasText: 'Connected to the bridge' }).waitFor({ timeout: 30_000 });

  // The table starts folded in the window.
  await page.getByRole('dialog').getByTestId('works-with').getByText('See what each can do').click();
  await page.getByRole('dialog').getByTestId('works-with').getByRole('rowheader', { name: /Elegoo Centauri Carbon/ }).waitFor();

  await printers.getByTestId('bridge-search').click();
  const row = printers.locator(`[data-testid="add-row"][data-url="${elegoo.url}"]`);
  await row.waitFor({ timeout: 20_000 });
  await row.locator('.dv-kind').filter({ hasText: 'Elegoo' }).waitFor();
  await row.getByTestId('add-row-add').click();
  await row.getByTestId('add-row-name').fill('My Carbon');
  await row.getByTestId('add-row-done').click();
  await until('the bridge kept it as an Elegoo printer', () => config.printers().some((p) => p.name === 'My Carbon' && p.kind === 'elegoo'), 20_000);
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'elegoo-add.png') });
  await page.getByTestId('save-printer').click();
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });
  await page.locator('.dv-model').filter({ hasText: 'Elegoo Centauri Carbon' }).waitFor();
  console.log('elegoo: added without a password, connected through the bridge');

  // What the printer reports, and none of the controls that would need G-code.
  await page.getByTestId('toolheads-card').locator('.dv-head-temp').filter({ hasText: '25°' }).waitFor();
  await page.getByTestId('climate-card').getByText('24°').waitFor();
  await page.getByTestId('climate-card').getByText('26°').waitFor();
  if (await page.getByLabel('Bed target').count()) throw new Error('the bed target should be read-only on an Elegoo');
  for (const gone of ['motion-card', 'console-card']) if (await page.getByTestId(gone).count()) throw new Error(`${gone} shown for a printer that takes no G-code`);
  if (await page.getByRole('button', { name: 'Emergency stop' }).count()) throw new Error('no emergency stop on an Elegoo');
  await page.getByTestId('files-card').getByText('benchy.gcode').waitFor();
  console.log('elegoo: status, chamber and files; no Move, Console, G-code or emergency stop');

  // Its camera, through the bridge, from one shared stream.
  await page.getByTestId('camera-frame').waitFor({ timeout: 30_000 });
  await until(
    'camera picture',
    () =>
      page
        .getByTestId('camera-frame')
        .first()
        .evaluate((img) => img.naturalWidth > 0)
        .catch(() => false),
    30_000,
  );
  if (elegoo.cameraClients() > 1) throw new Error(`${elegoo.cameraClients()} camera connections: the printer has few`);
  if (shots) await page.screenshot({ path: join(shots, 'elegoo-device.png') });
  console.log('elegoo: camera');

  // Upload only (over 1 MB, so it goes in parts), then print it from the file list.
  const lines = ['; generated by mock', 'G28'];
  while (lines.join('\n').length < 1_300_000) lines.push(`G1 X${lines.length % 200} Y${lines.length % 150} E0.0123`);
  const gcode = Buffer.from(lines.join('\n') + '\n');
  await page.getByTestId('device-gcode-input').setInputFiles({
    name: 'cube.gcode',
    mimeType: 'text/plain',
    buffer: gcode,
  });
  await page.getByRole('dialog').getByRole('heading', { name: 'Send to My Carbon' }).waitFor();
  await page.getByTestId('upload-only').click();
  await until('file on the printer', () => elegoo.files.get('/local/cube.gcode')?.equals(gcode), 30_000);
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20_000 });
  if (elegoo.state.status !== 0) throw new Error('Upload only started a print');
  await page.getByTestId('files-card').locator('li', { hasText: 'cube.gcode' }).getByRole('button', { name: 'Print…' }).click();
  // Orca's send window for Elegoo: Level the bed and Record a time-lapse, no flow calibration.
  if (await page.getByRole('dialog').getByLabel('Calibrate flow').count()) throw new Error('Elegoo offers flow calibration');
  await page.getByRole('dialog').getByLabel('Level the bed').check();
  await page.getByTestId('upload-and-print').click();
  await page.getByTestId('print-state').filter({ hasText: 'Printing' }).waitFor({ timeout: 20_000 });
  if (elegoo.state.file !== '/local/cube.gcode') throw new Error(`printing ${elegoo.state.file}`);
  {
    const { Calibration_switch, Tlp_Switch, PrintPlatformType } = elegoo.state.started ?? {};
    if (Calibration_switch !== 1 || Tlp_Switch !== 0 || PrintPlatformType !== 0) throw new Error(`print start sent ${JSON.stringify(elegoo.state.started)}`);
  }
  await page.getByTestId('job-card').getByText('cube.gcode').waitFor();
  await page.getByTestId('job-card').getByText('25%').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'elegoo-printing.png') });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Paused' }).waitFor();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Printing' }).waitFor();
  await page.getByRole('button', { name: 'Cancel print' }).click();
  await page.getByRole('dialog', { name: 'Cancel print' }).getByRole('button', { name: 'Cancel print' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Cancelled' }).waitFor();
  const unknown = elegoo.commands.filter((c) => ![0, 128, 129, 130, 131, 258, 259, 512].includes(c));
  if (unknown.length) throw new Error(`commands the printer doesn't know: ${unknown}`);
  console.log('elegoo: upload in parts, print, pause, resume and cancel on the mock');

  await page.setViewportSize({ width: 390, height: 844 });
  const tooWide = await page.evaluate(() => [...document.querySelectorAll('.device *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)?.className ?? null);
  if (tooWide !== null) throw new Error(`wider than a phone: ${tooWide}`);
  if (shots) await page.screenshot({ path: join(shots, 'elegoo-phone.png') });

  // A printer that is turned off says so.
  await elegoo.close();
  await page.getByTestId('job-card').getByText('The printer stopped answering').waitFor({ timeout: 30_000 });
  console.log('elegoo: a printer that stops answering says so');
  console.log('DEVICE ELEGOO OK');
} catch (e) {
  console.error(`DEVICE ELEGOO FAIL: ${e.stack ?? e.message}`);
  process.exitCode = 1;
} finally {
  bridge?.stop();
  await browser.close();
  await elegoo.close().catch(() => undefined);
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {
      // already gone
    }
  }
}
