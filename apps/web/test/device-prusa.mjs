#!/usr/bin/env node
// A Prusa printer in the Device tab, end to end through the real bridge:
// browser -> relay (wrangler dev) -> bridge, which stands in for Moonraker ->
// a pretend PrusaLink (test/device/mock-prusa.mjs). It adds the printer with its
// PrusaLink password, checks the screen leaves out what PrusaLink can't do,
// uploads, prints, pauses and cancels on the MOCK. It never talks to real hardware.
//
//   npm run build && node test/device-prusa.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bridgeConfig, bridgeProgram, pairingCode, startBridge } from './device/go-bridge.mjs';
import { startMockPrusa } from './device/mock-prusa.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PAGE_PORT = 4176;
const RELAY_PORT = 8793;
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

const prusa = await startMockPrusa();
let bridge;
const program = bridgeProgram();
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  const persist = mkdtempSync(join(tmpdir(), 'relay-'));
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', persist], join(web, '../device-relay'), /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const cfg = { relay: `http://127.0.0.1:${RELAY_PORT}`, bridgeId: 'prusa-test-bridge', key: 'prusa-test-key-0123456789', printers: [] };
  const config = bridgeConfig(cfg);
  // What the bridge's search finds: the real one knows PrusaLink by its login challenge on port 80.
  const found = join(config.dir, 'found.json');
  writeFileSync(found, JSON.stringify([{ url: prusa.url, name: '127.0.0.1', needsKey: true, kind: 'prusalink' }]));
  bridge = startBridge(program, config, { find: found, log: (m) => console.log(`bridge: ${m}`) });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PAGE_PORT}/#pair=${pairingCode(cfg)}`);
  const printers = page.getByTestId('bridge-printers');
  await page.getByTestId('bridge-state').filter({ hasText: 'Connected to the bridge' }).waitFor({ timeout: 30_000 });

  // Which printers work, in plain sight at the top of Add printer.
  await page.getByRole('dialog').getByTestId('works-with').getByRole('rowheader', { name: /Prusa with PrusaLink/ }).waitFor();

  await printers.getByTestId('bridge-search').click();
  const row = printers.locator(`[data-testid="add-row"][data-url="${prusa.url}"]`);
  await row.waitFor({ timeout: 20_000 });
  await row.locator('.dv-kind').filter({ hasText: 'Prusa' }).waitFor();
  await row.getByTestId('add-row-add').click();
  await row.getByTestId('add-row-name').fill('My MK4');
  await row.getByText('PrusaLink password').first().waitFor();
  await row.getByText('Settings, Network, PrusaLink').waitFor();
  await row.getByTestId('add-row-done').click();
  await row.getByRole('alert').filter({ hasText: 'Type its PrusaLink password first' }).waitFor();
  await row.getByTestId('add-row-key').fill('wrong');
  await row.getByTestId('add-row-done').click();
  await row.getByRole('alert').filter({ hasText: 'did not accept that password' }).waitFor();
  await row.getByTestId('add-row-key').fill(prusa.password);
  await row.getByTestId('add-row-done').click();
  await until('the bridge kept it as a Prusa printer', () => config.printers().some((p) => p.name === 'My MK4' && p.kind === 'prusalink' && p.apiKey === prusa.password));
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'prusa-add.png') });
  await page.getByTestId('save-printer').click();
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });
  await page.locator('.dv-model').filter({ hasText: 'Prusa' }).waitFor();
  console.log('prusa: added with its PrusaLink password, connected through the bridge');

  // What PrusaLink reports, and none of the controls that would need G-code.
  await page.getByTestId('toolheads-card').locator('.dv-head-temp').filter({ hasText: '25°' }).waitFor();
  await page.getByTestId('climate-card').getByText('24°').waitFor();
  // Temperatures are set on the printer: their targets show as plain numbers.
  if (await page.getByLabel('Bed target').count()) throw new Error('the bed target should be read-only on a Prusa');
  await page.getByTestId('climate-card').getByTestId('temp-target').filter({ hasText: /^0$/ }).waitFor();
  for (const gone of ['motion-card', 'console-card']) if (await page.getByTestId(gone).count()) throw new Error(`${gone} shown for a printer that takes no G-code`);
  if (await page.getByRole('button', { name: 'Emergency stop' }).count()) throw new Error('no emergency stop through PrusaLink');
  // Prusa's camera only shows in Prusa Connect: no camera card at all.
  if (await page.getByTestId('camera-tile').count()) throw new Error('a camera card for a Prusa printer');
  if (await page.getByText('no camera set up', { exact: false }).count()) throw new Error('a camera card for a Prusa printer');
  await page.getByTestId('files-card').getByText('benchy.bgcode').waitFor();
  await until('file picture through the bridge', () => page.getByTestId('files-card').locator('.dv-file-thumb img').first().evaluate((img) => img.naturalWidth > 0).catch(() => false));
  await page.getByTestId('files-card').getByTestId('file-meta').first().filter({ hasText: '1 h' }).waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'prusa-device.png') });
  console.log('prusa: status, files and file picture; no Move, Console, camera, G-code or emergency stop');

  // Upload only, then print it from the file list, pause and cancel.
  const gcode = Buffer.from(['; generated by mock', 'G28', 'G1 X10 Y10', '; filament_type = PLA', ''].join('\n'));
  await page.getByTestId('device-gcode-input').setInputFiles({ name: 'cube.gcode', mimeType: 'text/plain', buffer: gcode });
  await page.getByRole('dialog').getByRole('heading', { name: 'Send to My MK4' }).waitFor();
  await page.getByTestId('upload-only').click();
  await until('file on the printer', () => prusa.files.get('cube.gcode')?.data.length === gcode.length, 20_000);
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20_000 });
  if (prusa.state.job) throw new Error('Upload only started a print');
  await page.getByTestId('files-card').locator('li', { hasText: 'cube.gcode' }).getByRole('button', { name: 'Print…' }).click();
  await page.getByTestId('upload-and-print').click();
  await page.getByTestId('print-state').filter({ hasText: 'Printing' }).waitFor({ timeout: 20_000 });
  if (prusa.state.job?.file !== 'cube.gcode') throw new Error(`printing ${prusa.state.job?.file}`);
  await page.getByTestId('job-card').getByText('cube.gcode').waitFor();
  await page.getByTestId('job-card').getByText('25%').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'prusa-printing.png') });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Paused' }).waitFor();
  await page.getByRole('button', { name: 'Cancel print' }).click();
  await page.getByRole('dialog', { name: 'Cancel print' }).getByRole('button', { name: 'Cancel print' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Cancelled' }).waitFor();
  console.log('prusa: upload, print, pause and cancel on the mock');

  // The phone layout shows it too, with nothing wider than the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  const tooWide = await page.evaluate(() => [...document.querySelectorAll('.device *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)?.className ?? null);
  if (tooWide !== null) throw new Error(`wider than a phone: ${tooWide}`);
  if (shots) await page.screenshot({ path: join(shots, 'prusa-phone.png') });

  // A printer that stops answering says so, and comes back by itself.
  await prusa.close();
  await page.getByTestId('job-card').getByText('The printer stopped answering').waitFor({ timeout: 20_000 });
  console.log('prusa: a printer that stops answering says so');
  console.log('DEVICE PRUSA OK');
} catch (e) {
  console.error(`DEVICE PRUSA FAIL: ${e.stack ?? e.message}`);
  process.exitCode = 1;
} finally {
  bridge?.stop();
  await browser.close();
  await prusa.close().catch(() => undefined);
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {
      // already gone
    }
  }
}
