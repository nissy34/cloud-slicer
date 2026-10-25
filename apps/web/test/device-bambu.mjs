#!/usr/bin/env node
// A Bambu Lab printer in the Device tab, end to end through the real bridge:
// browser -> relay (wrangler dev) -> bridge, which stands in for Moonraker -> a
// pretend Bambu printer speaking MQTT, FTPS and the P1/A1 camera protocol
// (apps/device-bridge/tools/mock-bambu). It adds the printer with its access
// code, shows its status, camera, Move and Console, uploads, prints, pauses,
// resumes and cancels on the MOCK, prints a .gcode.3mf from the AMS slots
// picked in the print dialog and reads the AMS for "From printer". It never
// talks to real hardware.
//
//   npm run build && node test/device-bambu.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { chromium } from 'playwright';
import { bridgeConfig, bridgeProgram, pairingCode, startBridge } from './device/go-bridge.mjs';

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

// The pretend printer: one JSON line says where it is.
const mock = spawn('go', ['run', './tools/mock-bambu'], { cwd: join(web, '../device-bridge'), stdio: ['ignore', 'pipe', 'inherit'], detached: true });
children.push(mock);
const bambu = await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('mock-bambu did not start')), 120_000);
  createInterface({ input: mock.stdout }).once('line', (line) => {
    clearTimeout(timer);
    ok(JSON.parse(line));
  });
  mock.on('exit', (code) => fail(new Error(`mock-bambu exited (${code})`)));
});
const state = async () => (await fetch(`${bambu.control}/state`)).json();
// The bridge reaches the pretend printer on its spare ports, and trusts its certificate.
process.env.CLOUD_SLICER_BAMBU_PORTS = bambu.ports;
process.env.CLOUD_SLICER_BAMBU_CA = bambu.ca;
let bridge;
const program = bridgeProgram();
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  const persist = mkdtempSync(join(tmpdir(), 'relay-'));
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', persist], join(web, '../device-relay'), /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const cfg = { relay: `http://127.0.0.1:${RELAY_PORT}`, bridgeId: 'bambu-test-bridge', key: 'bambu-test-key-0123456789', printers: [] };
  const config = bridgeConfig(cfg);
  // What the bridge's search finds: the real one hears the printer announce itself (SSDP, port 2021).
  const found = join(config.dir, 'found.json');
  writeFileSync(found, JSON.stringify([{ url: bambu.url, name: 'Workshop P1S', needsKey: true, kind: 'bambu' }]));
  bridge = startBridge(program, config, { find: found, log: (m) => console.log(`bridge: ${m}`) });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PAGE_PORT}/#pair=${pairingCode(cfg)}`);
  const printers = page.getByTestId('bridge-printers');
  await page.getByTestId('bridge-state').filter({ hasText: 'Connected to the bridge' }).waitFor({ timeout: 30_000 });

  await page.getByRole('dialog').getByTestId('works-with').getByRole('rowheader', { name: /Bambu Lab/ }).waitFor();
  if (shots) await page.getByRole('dialog').getByTestId('works-with').screenshot({ path: join(shots, 'bambu-works-with.png') });

  await printers.getByTestId('bridge-search').click();
  const row = printers.locator(`[data-testid="add-row"][data-url="${bambu.url}"]`);
  await row.waitFor({ timeout: 20_000 });
  await row.locator('.dv-kind').filter({ hasText: 'Bambu Lab' }).waitFor();
  await row.getByTestId('add-row-add').click();
  await row.getByTestId('add-row-name').fill('My P1S');
  await row.getByText('LAN access code').first().waitFor();
  await row.getByText('Developer Mode', { exact: false }).waitFor();
  await row.getByTestId('add-row-done').click();
  await row.getByRole('alert').filter({ hasText: 'Type its LAN access code first' }).waitFor();
  await row.getByTestId('add-row-key').fill('00000000');
  await row.getByTestId('add-row-done').click();
  await row.getByRole('alert').filter({ hasText: 'did not accept that access code' }).waitFor();
  if (shots) {
    await page.getByRole('dialog').screenshot({ path: join(shots, 'bambu-add-wrong-code.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, 'bambu-add-phone.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await row.getByTestId('add-row-key').fill(bambu.code);
  await row.getByTestId('add-row-done').click();
  await until('the bridge kept it as a Bambu printer', () => config.printers().some((p) => p.name === 'My P1S' && p.kind === 'bambu' && p.apiKey === bambu.code), 20_000);
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'bambu-add.png') });
  await page.getByTestId('save-printer').click();
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });
  await page.locator('.dv-model').filter({ hasText: 'Bambu Lab' }).waitFor();
  console.log('bambu: added with its access code, connected through the bridge');

  // What the printer reports; it takes G-code (Developer Mode), so Move and the Console stay.
  await page.getByTestId('toolheads-card').locator('.dv-head-temp').filter({ hasText: '25°' }).waitFor();
  await page.getByTestId('climate-card').getByText('26°').waitFor();
  await page.getByTestId('climate-card').getByText('24°').waitFor();
  for (const kept of ['motion-card', 'console-card']) await page.getByTestId(kept).waitFor();
  await page.getByTestId('files-card').getByText('benchy.gcode').waitFor();
  // Move: homing first (the printer doesn't say what is homed; the bridge remembers).
  const motion = page.getByTestId('motion-card');
  await motion.getByRole('button', { name: 'Home all' }).click();
  await until('homed', () => motion.getByRole('button', { name: 'Head right' }).isEnabled(), 20_000);
  if (!(await state()).commands.includes('print.gcode_line: G28')) throw new Error('Home all sent no G28');
  console.log('bambu: status, chamber, files, Move (homed) and Console');

  // Its camera (P1/A1), through the bridge.
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
  console.log('bambu: camera');

  // Upload only, then print it from the file list.
  const gcode = Buffer.from('; generated by mock\nG28\nG1 X10 Y10\nM84\n');
  await page.getByTestId('device-gcode-input').setInputFiles({ name: 'cube.gcode', mimeType: 'text/plain', buffer: gcode });
  await page.getByRole('dialog').getByRole('heading', { name: 'Send to My P1S' }).waitFor();
  await page.getByTestId('upload-only').click();
  await until('file on the printer', async () => (await state()).files['cube.gcode'] === gcode.length, 30_000);
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20_000 });
  if ((await state()).report.gcode_state !== 'IDLE') throw new Error('Upload only started a print');
  await page.getByTestId('files-card').locator('li', { hasText: 'cube.gcode' }).getByRole('button', { name: 'Print…' }).click();
  await page.getByTestId('upload-and-print').click();
  await page.getByTestId('print-state').filter({ hasText: 'Printing' }).waitFor({ timeout: 20_000 });
  await page.getByTestId('job-card').getByText('cube.gcode').waitFor();
  await page.getByTestId('job-card').getByText('12%').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'bambu-printing.png') });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Paused' }).waitFor();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Printing' }).waitFor();
  await page.getByRole('button', { name: 'Cancel print' }).click();
  await page.getByRole('dialog', { name: 'Cancel print' }).getByRole('button', { name: 'Cancel print' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Cancelled' }).waitFor();
  const commands = (await state()).commands;
  const want = ['print.gcode_file: /sdcard/cube.gcode', 'print.pause', 'print.resume', 'print.stop'];
  if (JSON.stringify(commands.filter((c) => !c.startsWith('print.gcode_line'))) !== JSON.stringify(want)) throw new Error(`commands ${JSON.stringify(commands)}`);
  console.log('bambu: upload, print, pause, resume and cancel on the mock');

  // A .gcode.3mf: each filament picks its AMS slot, and the print starts with them.
  const plate = Buffer.from(
    ['; filament used [g] = 3.10, 1.20', '; filament_colour = #D02020;#111111', '; filament_type = PLA;PETG', '; estimated printing time (normal mode) = 12m 0s', 'G28', 'M84', ''].join('\n'),
  );
  const project = Buffer.from(zipSync({ 'Metadata/plate_2.gcode': new Uint8Array(plate), 'Metadata/slice_info.config': strToU8('<config/>') }));
  await page.getByTestId('device-gcode-input').setInputFiles({ name: 'duo.gcode.3mf', mimeType: 'model/3mf', buffer: project });
  const map = page.getByRole('dialog').getByTestId('tool-map');
  await map.getByText('AMS', { exact: true }).waitFor({ timeout: 20_000 });
  const first = map.getByLabel('AMS slot for filament 1');
  const second = map.getByLabel('AMS slot for filament 2');
  // Picked by type, then colour: the red PLA on the red PLA in A3, PETG on A4.
  if ((await first.inputValue()) !== '2' || (await second.inputValue()) !== '3') throw new Error(`suggested ${await first.inputValue()} ${await second.inputValue()}`);
  if (!(await first.locator('option', { hasText: 'A4 · PETG' }).isDisabled())) throw new Error('PETG offered for a PLA filament');
  await first.selectOption({ label: 'A1 · PLA Basic' });
  await page.getByRole('dialog').getByLabel('Record a time-lapse').check();
  if (shots) await page.screenshot({ path: join(shots, 'bambu-ams-map.png') });
  await page.getByTestId('upload-and-print').click();
  await page
    .getByTestId('print-state')
    .filter({ hasText: 'Printing' })
    .waitFor({ timeout: 20_000 })
    .catch(async (e) => {
      throw new Error(`${e.message}\n${await page.getByTestId('send-error').innerText().catch(() => 'no send error')}\n${JSON.stringify(await state())}`);
    });
  const after = await state();
  const sent = after.project;
  if (!sent) throw new Error(`no project_file: ${JSON.stringify(after.commands)}`);
  const wantSent = { param: 'Metadata/plate_2.gcode', url: 'file:///sdcard/duo.gcode.3mf', use_ams: true, ams_mapping: [0, 3], timelapse: true, bed_leveling: true };
  for (const [k, v] of Object.entries(wantSent))
    if (JSON.stringify(sent?.[k]) !== JSON.stringify(v)) throw new Error(`project_file ${k}: ${JSON.stringify(sent?.[k])}, want ${JSON.stringify(v)}`);
  await page.getByRole('button', { name: 'Cancel print' }).click();
  await page.getByRole('dialog', { name: 'Cancel print' }).getByRole('button', { name: 'Cancel print' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Cancelled' }).waitFor();
  console.log('bambu: a .gcode.3mf prints from the AMS slots picked in the print dialog');

  // "From printer" reading the AMS runs in test/sync-filaments.mjs: it needs the engine, which this job doesn't build.

  // The printer's own errors, in Bambu's words with the code its apps show.
  const set = (fields) => fetch(`${bambu.control}/set`, { method: 'POST', body: JSON.stringify(fields) });
  await set({ hms: [{ attr: 0x03000100, code: 0x00010007 }], print_error: 0x03008008 });
  const errors = page.getByTestId('printer-errors');
  await errors.getByText('The heatbed temperature is abnormal; the sensor may have an open circuit.').waitFor({ timeout: 20_000 });
  const shown = await errors.innerText();
  for (const want of ['Motion system problem', 'Error code 0300_0100_0001_0007', 'Nozzle temperature malfunction', 'Error code 0300_8008'])
    if (!shown.includes(want)) throw new Error(`printer errors: ${shown}`);
  if (shots) await page.screenshot({ path: join(shots, 'bambu-errors.png') });
  await set({ hms: [], print_error: 0 });
  await errors.waitFor({ state: 'detached', timeout: 20_000 });
  console.log("bambu: its errors show in Bambu's words, and go when it clears them");

  await page.setViewportSize({ width: 390, height: 844 });
  const tooWide = await page.evaluate(() => [...document.querySelectorAll('.device *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)?.className ?? null);
  if (tooWide !== null) throw new Error(`wider than a phone: ${tooWide}`);
  if (shots) await page.screenshot({ path: join(shots, 'bambu-phone.png') });

  // A printer that is turned off says so.
  await fetch(`${bambu.control}/off`, { method: 'POST' });
  await page.getByTestId('job-card').getByText('The printer stopped answering').waitFor({ timeout: 30_000 });
  console.log('bambu: a printer that stops answering says so');
  console.log('DEVICE BAMBU OK');
} catch (e) {
  console.error(`DEVICE BAMBU FAIL: ${e.stack ?? e.message}`);
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
