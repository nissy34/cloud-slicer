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
const keyed = await startMockPrinter({ generic: true, hostname: 'Keyed-mock', apiKey: 'mock-api-key' });
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
  const cfg = { relay: `http://127.0.0.1:${RELAY_PORT}`, bridgeId: 'smoke-test-bridge', key: 'smoke-test-key-0123456789', printers: [
      { id: 'u1', name: 'U1-mock', url: u1.url, apiKey: '' },
    ],
  };

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const site = `http://localhost:${PAGE_PORT}/`;

  // ---- U1 through the bridge ---------------------------------------------------------
  // The pairing link alone opens the Device tab with the add-printer dialog: no clicks first.
  // The bridge app opens this link as it starts, so the page usually asks before the
  // bridge has connected: the dialog must keep listening until it comes online.
  await page.goto(`${site}#pair=${pairingCode(cfg)}`);
  await page.getByTestId('bridge-state').filter({ hasText: /Connecting to the bridge|The bridge is offline/ }).waitFor();
  // What the bridge's network search finds (the real one scans port 7125 on the bridge's networks).
  // The first search finds nothing, like a Mac before its "find devices on your local network" prompt is allowed.
  let searches = 0;
  const onTheNetwork = async () => (searches++ === 0 ? [] : [
    { url: u1.url, name: 'U1-mock' },
    { url: keyed.url, name: '127.0.0.1', needsKey: true },
  ]);
  bridge = runBridge(cfg, { log: (m) => console.log(`bridge: ${m}`), find: onTheNetwork });
  // One list: every printer the bridge serves or found, each with its own name, profile and API key, and one button for all.
  const printers = page.getByTestId('bridge-printers');
  const row = (url) => printers.locator(`[data-testid="add-row"][data-url="${url}"]`);
  await printers.locator('[data-testid="add-row"][data-bridge-id="u1"]').waitFor();
  await printers.getByTestId('bridge-search').click();
  // Searching is shown plainly, and an empty search goes again by itself.
  await printers.getByTestId('bridge-searching').waitFor();
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'bridge-searching.png') });
  await row(keyed.url).waitFor({ timeout: 20_000 });
  if (searches < 2) throw new Error('an empty search should go again by itself');
  if ((await printers.getByTestId('add-row').count()) !== 2) throw new Error('U1-mock is both on the bridge and found: it should be one row');
  // Or by its address (any port), when the search doesn't find it.
  const addToBridge = page.getByTestId('bridge-add-printer');
  await addToBridge.locator('summary').click();
  await addToBridge.getByTestId('bridge-new-address').fill(voron.url.replace('http://', ''));
  await addToBridge.getByTestId('bridge-add-submit').click();
  await until('voron-mock added to the bridge', () => cfg.printers.some((p) => p.name === 'voron-mock'));
  const voronRow = printers.locator(`[data-testid="add-row"][data-bridge-id="${cfg.printers.find((p) => p.name === 'voron-mock').id}"]`);
  await voronRow.getByTestId('add-row-name').waitFor();
  console.log('bridge: printer added from the Device tab by its address');
  // Each printer is added on its own row (name, profile, key checked there), then one button saves the ready ones.
  if (await page.getByTestId('save-printer').isEnabled()) throw new Error('nothing is ready yet, so nothing can be added');
  const u1Row = row(u1.url);
  await u1Row.getByTestId('add-row-add').click();
  await u1Row.getByTestId('add-row-done').click();
  await printers.locator(`[data-testid="add-row"][data-url="${u1.url}"][data-step="ready"]`).waitFor();
  const keyedRow = row(keyed.url);
  await keyedRow.getByTestId('add-row-add').click();
  await keyedRow.getByTestId('add-row-name').fill('Keyed printer');
  await keyedRow.getByTestId('add-row-done').click();
  await keyedRow.getByRole('alert').filter({ hasText: 'Type its API key first' }).waitFor();
  await keyedRow.getByTestId('add-row-key').fill('wrong-key');
  await keyedRow.getByTestId('add-row-done').click();
  await keyedRow.getByRole('alert').filter({ hasText: 'did not accept that API key' }).waitFor();
  await keyedRow.getByTestId('add-row-key').fill('mock-api-key');
  await keyedRow.getByTestId('add-row-done').click();
  await until('the bridge kept the key and the name', () => cfg.printers.some((p) => p.name === 'Keyed printer' && p.apiKey === 'mock-api-key'));
  await printers.locator('[data-testid="add-row"][data-step="ready"]').filter({ hasText: 'Keyed printer' }).waitFor();
  // The printer added by address opened for its details; leave it out.
  await voronRow.getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('save-printer').filter({ hasText: 'Add 2 printers' }).waitFor();
  await page.getByTestId('add-summary').filter({ hasText: 'U1-mock, Keyed printer' }).waitFor();
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'bridge-search.png') });
  // The list fits a phone too.
  await page.setViewportSize({ width: 390, height: 844 });
  const tooWide = await page.evaluate(() => [...document.querySelectorAll('.dv-dialog *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)?.className ?? null);
  if (tooWide !== null) throw new Error(`the add list is wider than a phone: ${tooWide}`);
  if (shots) await page.screenshot({ path: join(shots, 'bridge-list-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId('save-printer').click();
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
  await page.getByTestId('printer-select').locator('option', { hasText: 'Keyed printer' }).waitFor({ state: 'attached' });
  if (await page.getByTestId('printer-select').locator('option', { hasText: 'voron-mock' }).count()) throw new Error('only the ready printers should be saved');
  if ((await page.getByTestId('printer-select').locator('option:checked').textContent()) !== 'U1-mock') throw new Error('the first printer in the list should be chosen');
  console.log('bridge: the ready printers saved in one go, with their names and API key');
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
  // The offline help fits the bridge's computer: this one runs under Node.js on Linux (or wherever the test runs).
  await page.getByTestId('bridge-offline-help').waitFor();
  const offlineCmd = await page.getByTestId('bridge-offline-command').textContent();
  if (offlineCmd !== 'node cloud-slicer-bridge.mjs') throw new Error(`offline help for a Node.js bridge shows: ${offlineCmd}`);
  bridge = runBridge(cfg, { log: () => {} });
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 40_000 });
  console.log('bridge restart: reconnected by itself');

  // A second copy of the bridge (another window) takes over, and the older one stops rather than taking it back.
  let replaced = false;
  bridge.stop();
  // Wait for the older copy itself to be on the relay: the page may still show the stopped one as connected for a moment.
  let olderUp = false;
  const older = runBridge(cfg, { log: (m) => /Connected to the relay/.test(m) && (olderUp = true), onReplaced: () => (replaced = true) });
  await until('the older copy connected', () => olderUp, 40_000);
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 40_000 });
  bridge = runBridge(cfg, { log: () => {} });
  await until('the older copy stopped', () => replaced, 20_000);
  await new Promise((r) => setTimeout(r, 5000));
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 40_000 });
  older.stop();
  console.log('a second bridge takes over and the first one stops');

  // ---- generic Klipper printer, direct ------------------------------------------------
  // A printer that has collected files over months: the card pages them like Fluidd.
  for (let i = 0; i < 24; i++) voron.files.set(`part_${String(i).padStart(2, '0')}.gcode`, { size: 50_000, modified: Date.now() / 1000 - 7200 - i * 600, text: '' });
  await page.getByTestId('printer-select').selectOption('__add');
  await page.getByRole('tab', { name: 'Over the internet (advanced)' }).click();
  // The exact moonraker.conf lines that let this site reach the printer, ready to copy.
  await page.getByTestId('cors-snippet').filter({ hasText: `[authorization] cors_domains: ${site.replace(/\/$/, '')}` }).waitFor();
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
  // One computer at a time, three numbered steps, starting from this browser's system (Linux here).
  // Nothing to fill in before the bridge pairs: no name, profile or Add printer button yet.
  await setup.getByTestId('bridge-steps-linux').getByTestId('bridge-install-command').filter({ hasText: `curl -fsSL ${liveRelay}/install.sh | sh` }).waitFor();
  if ((await setup.getByTestId('bridge-steps-linux').locator('.dv-setup-step').count()) !== 3) throw new Error('the Linux setup should be three steps');
  if (await setup.getByTestId('save-printer').count()) throw new Error('Add printer should wait for the bridge to pair');
  if (await setup.getByRole('dialog').getByLabel('Printer profile').count()) throw new Error('the printer profile should wait for the bridge to pair');
  await setup.getByRole('tab', { name: 'Windows PC' }).click();
  const win = setup.getByTestId('bridge-download-windows');
  await win.waitFor();
  if ((await win.getAttribute('href')) !== `${liveRelay}/download/windows-x64`) throw new Error(`Windows download points at ${await win.getAttribute('href')}`);
  if (shots) await setup.screenshot({ path: join(shots, 'bridge-setup.png') });
  await setup.getByRole('tab', { name: 'Mac' }).click();
  await setup.getByTestId('bridge-steps-mac').getByTestId('bridge-install-command').filter({ hasText: `curl -fsSL ${liveRelay}/install.sh | sh` }).waitFor();
  await setup.getByText('Rather download the Mac app?').click();
  await setup.getByTestId('bridge-download-mac').waitFor();
  // A pairing link pasted by hand works too, for when the page opened on another computer.
  await setup.getByTestId('bridge-paste-link').locator('summary').click();
  await setup.getByTestId('pairing-code').fill('not a link');
  await setup.getByRole('alert').filter({ hasText: "That isn't a pairing link" }).waitFor();
  await setup.getByTestId('pairing-code').fill('');
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
  // Another saved printer still uses this bridge: keep it.
  await page.getByText('Keep the bridge on its computer: Keyed printer still uses it.').waitFor();
  await page.getByTestId('confirm-remove-printer').click();
  await until('U1-mock removed', async () => (await page.getByTestId('printer-select').locator('option', { hasText: 'U1-mock' }).count()) === 0);
  await until('the bridge forgot U1-mock too', () => !cfg.printers.some((p) => p.id === 'u1'));
  // The bridge's last printer: say how to remove the bridge too.
  await page.getByTestId('printer-select').selectOption({ label: 'Keyed printer' });
  await page.locator('.dv-header-actions').getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('remove-printer').click();
  await page.getByTestId('bridge-uninstall').getByTestId('bridge-uninstall-command').filter({ hasText: / uninstall$/ }).waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'remove-bridge-printer.png') });
  await page.getByTestId('confirm-remove-printer').click();
  await until('Keyed printer removed', async () => (await page.getByTestId('printer-select').locator('option', { hasText: 'Keyed printer' }).count()) === 0);
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
  await keyed.close();
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {
      // already gone
    }
  }
}
