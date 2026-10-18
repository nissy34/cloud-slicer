#!/usr/bin/env node
// Device tab end to end, against pretend printers only (test/device/mock-printer.mjs):
//   1. a U1 through the whole bridge: browser -> relay (wrangler dev) -> bridge agent -> mock
//   2. a generic Klipper printer reached directly from the browser
// It uploads, starts and cancels prints on the MOCK printer; it never talks to real hardware.
//
//   npm run build && node test/device-smoke.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runBridge, pairingCode } from '../../device-bridge/bridge.mjs';
import { startMockPrinter } from './device/mock-printer.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PAGE_PORT = 4174;
const RELAY_PORT = 8798;
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

const u1 = await startMockPrinter();
const voron = await startMockPrinter({ generic: true });
let bridge;
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  // Pretend bridge apps in the relay's local R2, as CI uploads the real ones on main.
  const persist = mkdtempSync(join(tmpdir(), 'relay-'));
  const fakeApp = join(persist, 'fake-app');
  writeFileSync(fakeApp, 'pretend bridge app');
  for (const name of ['windows-x64', 'mac-arm64', 'linux-arm64']) {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `cloud-slicer-bridge/bridge/${name}`, '--file', fakeApp, '--local', '--persist-to', persist], { cwd: join(web, '../device-relay'), stdio: 'ignore' });
  }
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', persist], join(web, '../device-relay'), /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const cfg = { relay: `http://127.0.0.1:${RELAY_PORT}`, bridgeId: 'smoke-test-bridge', key: 'smoke-test-key-0123456789', printers: [{ id: 'u1', name: 'U1-mock', url: u1.url, apiKey: '' }] };

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const site = `http://localhost:${PAGE_PORT}/`;

  // ---- U1 through the bridge ---------------------------------------------------------
  // The pairing link alone opens the Device tab with the add-printer dialog: no clicks first.
  // The bridge app opens this link as it starts, so the page usually asks before the
  // bridge has connected: the dialog must keep listening until it comes online.
  await page.goto(`${site}#pair=${pairingCode(cfg)}`);
  await page.getByText(/Bridge smoke-te · (checking…|offline)/).waitFor();
  bridge = runBridge(cfg, { log: (m) => console.log(`bridge: ${m}`) });
  await page.getByRole('combobox').filter({ hasText: 'U1-mock' }).waitFor();
  await page.getByTestId('save-printer').click();
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
  console.log('bridge: connected');

  await page.getByTestId('head-0').getByText('PLA').waitFor();
  await page.getByTestId('head-3').getByText('No filament').waitFor();
  await page.getByText('Snapmaker U1').first().waitFor();
  console.log('U1 tool heads shown');

  // Each file row shows what Moonraker already knows about it: thumbnail (fetched through the bridge), time, filament.
  await until('file thumbnail through the bridge', () => page.getByTestId('files-card').locator('.dv-file-thumb img').first().evaluate((img) => img.naturalWidth > 0).catch(() => false));
  await page.getByTestId('files-card').getByTestId('file-meta').first().filter({ hasText: '1 h' }).filter({ hasText: 'PLA 5.1 g' }).waitFor();
  console.log('file rows show thumbnail, print time and filament');

  await page.getByRole('switch', { name: 'Chamber light' }).click({ force: true });
  await until('chamber light on', () => u1.state['led cavity_led'].color_data[0][3] === 1);
  await page.getByLabel('Bed target').fill('60');
  await page.getByLabel('Bed target').press('Enter');
  await until('bed target 60', () => u1.state.heater_bed.target === 60);
  console.log('light and bed heater work');

  await page.getByTestId('camera-frame').waitFor({ timeout: 20_000 });
  // The U1 announces every camera frame as a file change; none of that may
  // turn into G-code list refreshes (that stalled Moonraker on a real U1).
  const before = { ...u1.stats };
  await new Promise((r) => setTimeout(r, 6000));
  const lists = u1.stats.fileLists - before.fileLists;
  const monitors = u1.stats.startMonitor - before.startMonitor;
  if (lists > 1) throw new Error(`camera frames caused ${lists} G-code list refreshes in 6 s`);
  if (monitors > 1) throw new Error(`camera.start_monitor sent ${monitors} times in 6 s`);
  console.log('camera frames arrive through the bridge, without file-list or start_monitor floods');

  await page.getByTestId('head-3').getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('dialog', { name: 'Load filament' }).getByRole('button', { name: 'Load filament' }).click();
  await until('FEED_AUTO load', () => u1.scripts.includes('FEED_AUTO MODULE=right CHANNEL=1 LOAD=1'));
  await until('head 4 loaded', () => u1.state.print_task_config.filament_exist[3] === true);
  await page.getByTestId('print-state').filter({ hasText: 'Ready' }).waitFor();
  console.log('filament load sent to the right feeder');

  await page.getByTestId('head-1').getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Type').fill('Silk');
  await page.getByRole('button', { name: 'Save to printer' }).click();
  await until('filament edited', () => u1.state.print_task_config.filament_sub_type[1] === 'Silk');
  console.log('filament edit saved on the printer');

  await page.getByTestId('head-0').getByText('On carriage').waitFor();
  await page.getByTestId('head-2').getByRole('button', { name: 'Pick up' }).click();
  await page.getByRole('dialog', { name: 'Pick up' }).getByRole('button', { name: 'Pick up' }).click();
  await until('PICK_EXTRUDER2 sent', () => u1.scripts.includes('PICK_EXTRUDER2'));
  await page.getByTestId('head-2').getByText('On carriage').waitFor();
  await page.getByTestId('head-0').getByText('Docked').waitFor();
  await page.getByTestId('head-2').getByRole('button', { name: 'Park' }).click();
  await page.getByRole('dialog', { name: 'Park' }).getByRole('button', { name: 'Park' }).click();
  await until('PARK_EXTRUDER2 sent', () => u1.scripts.includes('PARK_EXTRUDER2'));
  await page.getByTestId('head-2').getByText('Docked').waitFor();
  console.log('tool head pick up and park');

  await page.getByTestId('head-1').getByRole('button', { name: 'Nozzle' }).click();
  await page.getByTestId('head-switches').getByText('121').waitFor();
  await page.getByLabel('Size').selectOption('0.6');
  await page.getByLabel('Type').selectOption('high_flow');
  await page.getByRole('button', { name: 'Save to printer' }).click();
  await until('nozzle saved', () => u1.scripts.includes('SET_NOZZLE_PROPERTIES EXTRUDER=extruder1 DIAMETER=0.6 VOLUME_TYPE=high_flow'));
  await page.getByTestId('head-1').getByText('0.6 mm high flow nozzle').waitFor();
  console.log('nozzle size and type saved on the printer');

  if (shots) await page.screenshot({ path: join(shots, 'device-u1.png'), fullPage: true });

  const gcode = Buffer.from(
    ['; generated by mock', '; estimated printing time (normal mode) = 1h 2m 3s', 'T0', 'G1 X1', 'T1', 'G1 X2', '; filament used [g] = 3.20, 1.10', '; filament_colour = #E72F1D;#3E413F', '; filament_type = PETG;PLA', ''].join('\n'),
  );
  await page.getByTestId('device-gcode-input').setInputFiles({ name: 'two colour.gcode', mimeType: 'text/plain', buffer: gcode });
  await page.getByTestId('tool-map').waitFor();
  // Suggested map: red PETG -> T2 (red PETG), dark PLA -> T1.
  await until('suggested map', async () => (await page.getByLabel('Tool head for filament 1').inputValue()) === '1' && (await page.getByLabel('Tool head for filament 2').inputValue()) === '0');
  await page.getByTestId('upload-only').click();
  await until('file uploaded', () => u1.files.has('two_colour.gcode'), 20_000);
  if (u1.state.print_stats.state !== 'standby') throw new Error('Upload only started a print');
  if (u1.files.get('two_colour.gcode').size !== gcode.length) throw new Error(`uploaded ${u1.files.get('two_colour.gcode').size} bytes, sent ${gcode.length}`);
  console.log('upload only: file on the printer, no print started');

  await page.getByTestId('files-card').getByRole('button', { name: 'Print…' }).first().click();
  await page.getByTestId('tool-map').waitFor();
  await page.getByLabel('Level the bed').uncheck();
  await page.getByTestId('upload-and-print').click();
  await page.getByTestId('print-state').filter({ hasText: 'Printing' }).waitFor({ timeout: 20_000 });
  for (const want of ['SET_PRINT_PREFERENCES BED_LEVEL=0 FLOW_CALIBRATE=0 TIME_LAPSE_CAMERA=0', 'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=1', 'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=1 MAP_EXTRUDER=0']) {
    if (!u1.scripts.includes(want)) throw new Error(`missing ${want}; got ${u1.scripts.join(' | ')}`);
  }
  console.log('print on the mock: preferences and tool map sent before starting');

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Paused' }).waitFor();
  await page.getByRole('button', { name: 'Cancel print' }).click();
  await page.getByRole('dialog', { name: 'Cancel print' }).getByRole('button', { name: 'Cancel print' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Cancelled' }).waitFor();
  console.log('pause and cancel work');

  // The bridge going away is reported, and the page reconnects when it returns.
  bridge.stop();
  await page.getByText('Bridge offline').waitFor({ timeout: 20_000 });
  bridge = runBridge(cfg, { log: () => {} });
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 40_000 });
  console.log('bridge restart: reconnected by itself');

  // ---- generic Klipper printer, direct ------------------------------------------------
  // A printer that has collected files over months: the card pages them like Fluidd.
  for (let i = 0; i < 24; i++) voron.files.set(`part_${String(i).padStart(2, '0')}.gcode`, { size: 50_000, modified: Date.now() / 1000 - 7200 - i * 600, text: '' });
  await page.getByTestId('printer-select').selectOption('__add');
  await page.getByRole('tab', { name: 'Public https address' }).click();
  await page.getByTestId('printer-url').fill(voron.url);
  await page.getByTestId('save-printer').click();
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
  await page.getByText('Klipper printer').first().waitFor();
  if (await page.getByTestId('tool-map').count()) throw new Error('generic printer shows U1 controls');
  await page.getByRole('heading', { name: 'Nozzles' }).waitFor();
  await until('both cameras streaming', async () => (await page.getByTestId('camera-tile').count()) === 2, 20_000);
  await page.locator('[data-camera="case"] iframe[data-view="iframe"]').waitFor({ timeout: 20_000 });
  await page.frameLocator('[data-camera="case"] iframe').getByText('mock camera player').waitFor({ timeout: 20_000 });
  await page.locator('[data-camera="nozzle"] img[data-view="mjpeg"]').waitFor({ timeout: 20_000 });
  await until('mjpeg stream decodes', () => page.locator('[data-camera="nozzle"] img').evaluate((img) => img.naturalWidth > 0), 20_000);
  if (voron.stats.startMonitor) throw new Error('camera.start_monitor sent to a printer with configured webcams');
  await page.getByTestId('camera-card').getByRole('button', { name: 'Choose' }).click();
  await page.getByTestId('camera-pick').getByLabel('case').uncheck();
  await until('case camera hidden', async () => (await page.getByTestId('camera-tile').count()) === 1 && (await page.locator('[data-camera="nozzle"]').count()) === 1);
  await until('choice saved with the printer', () => page.evaluate(() => (localStorage.getItem('cloud-slicer:devices:v1') ?? '').includes('hiddenCameras')));
  await page.getByTestId('camera-pick').getByLabel('case').check();
  await until('case camera back', async () => (await page.getByTestId('camera-tile').count()) === 2);
  await page.getByTestId('camera-card').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Home all' }).click();
  await until('homed', () => voron.state.toolhead.homed_axes === 'xyz');
  await page.getByRole('button', { name: 'X plus' }).click();
  await until('jogged', () => voron.scripts.includes('G1 X10 F6000'));
  console.log('direct generic printer: connected, both cameras live (player page + MJPEG), camera choice saved, home and jog work');

  const filesCard = page.getByTestId('files-card');
  const fileRows = filesCard.locator('.dv-files li');
  await filesCard.getByTestId('files-pager').filter({ hasText: '1–10 of 25' }).waitFor();
  if ((await fileRows.count()) !== 10) throw new Error(`files card shows ${await fileRows.count()} rows, want 10`);
  if (!(await fileRows.first().textContent()).includes('calibration_cube.gcode')) throw new Error('files card is not newest first');
  await filesCard.getByRole('button', { name: 'Older ›' }).click();
  await filesCard.getByTestId('files-pager').filter({ hasText: '11–20 of 25' }).waitFor();
  if (!(await fileRows.first().textContent()).includes('part_09.gcode')) throw new Error(`page 2 starts with ${await fileRows.first().textContent()}`);
  await filesCard.getByLabel('Search files').fill('part_2');
  await until('search narrows the list', async () => (await fileRows.count()) === 4 && (await filesCard.getByTestId('files-pager').count()) === 0);
  await filesCard.getByLabel('Search files').fill('');
  console.log('files card: 10 newest per page, older pages and search reach the rest');

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(site);
  await phone.evaluate((p) => localStorage.setItem('cloud-slicer:devices:v1', p), await page.evaluate(() => localStorage.getItem('cloud-slicer:devices:v1')));
  await phone.reload();
  await phone.getByRole('tab', { name: 'Device' }).click();
  await phone.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
  // Every card and the top bar fit in a 390 and a narrow 360 px phone, with no sideways scroll.
  for (const width of [390, 360]) {
    await phone.setViewportSize({ width, height: 844 });
    const wide = await phone.evaluate(() => {
      if (document.documentElement.scrollWidth > window.innerWidth) return 'the page';
      const over = [...document.querySelectorAll('.topbar, .device *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5);
      return over ? `${over.tagName.toLowerCase()}.${over.className}` : null;
    });
    if (wide) throw new Error(`Device tab is wider than a ${width} px phone: ${wide}`);
  }
  if (shots) await phone.screenshot({ path: join(shots, 'device-phone.png'), fullPage: true });
  console.log('phone layout fits');

  // Printers saved by the first Device tab build move into the account store.
  const old = await browser.newPage();
  await old.goto(site);
  await old.evaluate((url) => localStorage.setItem('cloud-slicer:printers:v1', JSON.stringify([{ id: 'legacy', name: 'Old Voron', kind: 'direct', url, apiKey: '' }])), voron.url);
  await old.reload();
  await old.getByRole('tab', { name: 'Device' }).click();
  await old.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
  const moved = await old.evaluate(() => [localStorage.getItem('cloud-slicer:printers:v1'), localStorage.getItem('cloud-slicer:devices:v1')]);
  if (moved[0] !== null || !moved[1]?.includes('Old Voron')) throw new Error(`legacy printers not moved: ${JSON.stringify(moved)}`);
  console.log('printers from the earlier build moved into the account store');

  // ---- Bridge setup: the apps the relay has, else the Node.js steps ---------------------
  const relayUrl = `http://127.0.0.1:${RELAY_PORT}`;
  const liveRelay = 'https://cloud-slicer-relay.nissy34.workers.dev';
  const setup = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let noApps = false;
  // The dialog asks the default (live) relay before anything is paired; answer from the local one.
  await setup.route(`${liveRelay}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (noApps && u.pathname === '/downloads.json') return route.fulfill({ json: { apps: [] } });
    const r = await fetch(`${relayUrl}${u.pathname}${u.search}`);
    await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
  });
  await setup.goto(site);
  await setup.getByRole('tab', { name: 'Device' }).click();
  await setup.getByTestId('add-printer').click();
  const win = setup.getByTestId('bridge-download-windows');
  await win.waitFor();
  if ((await win.getAttribute('href')) !== `${liveRelay}/download/windows-x64`) throw new Error(`Windows download points at ${await win.getAttribute('href')}`);
  await setup.getByTestId('bridge-download-mac').waitFor();
  await setup.getByTestId('bridge-install-command').filter({ hasText: `curl -fsSL ${liveRelay}/install.sh | sh` }).waitFor();
  if (shots) await setup.screenshot({ path: join(shots, 'bridge-setup.png') });
  const download = await fetch(`${relayUrl}/download/windows-x64`);
  if ((await download.text()) !== 'pretend bridge app' || !/filename="cloud-slicer-bridge\.exe"/.test(download.headers.get('content-disposition') ?? '')) throw new Error('the relay does not serve the Windows app');
  const script = await (await fetch(`${relayUrl}/install.sh`)).text();
  if (!script.includes(`RELAY="${relayUrl}"`)) throw new Error('install.sh does not name the relay it came from');
  // What the bridge does once set up, how to add printers or remove it: explained in the dialog.
  await setup.getByTestId('bridge-about').locator('summary').click();
  const about = setup.getByTestId('bridge-about');
  // One command per line, each with its own Copy, and the printer address typed in rather than an example to edit.
  await about.getByTestId('bridge-add-command').filter({ hasText: '~/.local/bin/cloud-slicer-bridge add <printer address>' }).waitFor();
  await about.getByTestId('bridge-add-address').fill('10.0.0.42');
  await about.getByRole('tab', { name: 'Mac' }).click();
  await about.getByTestId('bridge-add-command').filter({ hasText: /^"\$HOME\/Library\/Application Support\/Cloud Slicer Bridge\/cloud-slicer-bridge" add 10\.0\.0\.42$/ }).waitFor();
  await about.getByRole('tab', { name: 'Windows' }).click();
  await about.getByTestId('bridge-uninstall-command').filter({ hasText: /^cmd \/c call "%LOCALAPPDATA%\\Cloud Slicer Bridge\\cloud-slicer-bridge\.exe" uninstall$/ }).waitFor();
  if ((await about.getByRole('button', { name: 'Copy' }).count()) !== 2) throw new Error('the add and uninstall commands should each have their own Copy button');
  if (shots) await about.screenshot({ path: join(shots, 'bridge-about.png') });
  for (const width of [390, 360]) {
    await setup.setViewportSize({ width, height: 844 });
    const wide = await setup.evaluate(() => [...document.querySelectorAll('.dv-dialog *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)?.className ?? null);
    if (wide !== null) throw new Error(`bridge setup is wider than a ${width} px phone: ${wide}`);
  }
  if (shots) await setup.screenshot({ path: join(shots, 'bridge-setup-phone.png'), fullPage: true });
  noApps = true;
  await setup.reload();
  await setup.getByRole('tab', { name: 'Device' }).click();
  await setup.getByTestId('add-printer').click();
  await setup.getByText('node cloud-slicer-bridge.mjs', { exact: true }).waitFor();
  console.log('bridge setup: app downloads and the Linux command from the relay, Node.js steps when it has none');
  // Removing a bridge printer explains how to remove the bridge from its computer too.
  await page.getByTestId('printer-select').selectOption({ label: 'U1-mock' });
  await page.locator('.dv-header-actions').getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('remove-printer').click();
  await page.getByTestId('bridge-uninstall').getByTestId('bridge-uninstall-command').filter({ hasText: / uninstall$/ }).waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'remove-bridge-printer.png') });
  await page.getByTestId('confirm-remove-printer').click();
  await until('U1-mock removed', async () => (await page.getByTestId('printer-select').locator('option', { hasText: 'U1-mock' }).count()) === 0);
  console.log('removing a bridge printer: shows how to uninstall the bridge, then removes it');
  console.log('DEVICE SMOKE OK');
} catch (e) {
  console.error(`DEVICE SMOKE FAIL: ${e.stack ?? e.message}`);
  process.exitCode = 1;
} finally {
  bridge?.stop();
  await browser.close();
  await u1.close();
  await voron.close();
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {
      // already gone
    }
  }
}
