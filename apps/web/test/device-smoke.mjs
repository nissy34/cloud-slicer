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
import { bridgeConfig, bridgeProgram, pairingCode, startBridge } from './device/go-bridge.mjs';
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
const program = bridgeProgram();
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  // Pretend bridge apps in the relay's local R2, as CI uploads the real ones on main.
  const persist = mkdtempSync(join(tmpdir(), 'relay-'));
  const fakeApp = join(persist, 'fake-app');
  writeFileSync(fakeApp, 'pretend bridge app');
  for (const name of ['windows-x64', 'mac-arm64', 'linux-arm64']) {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `cloud-slicer-bridge/bridge/${name}`, '--file', fakeApp, '--local', '--persist-to', persist], { cwd: join(web, '../device-relay'), stdio: 'ignore' });
  }
  // A release newer than any real build, so Printers & bridges offers an update.
  const release = join(persist, 'release.json');
  writeFileSync(release, JSON.stringify({ build: 9_999_999_999, apps: {} }));
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', 'cloud-slicer-bridge/bridge/release.json', '--file', release, '--local', '--persist-to', persist], { cwd: join(web, '../device-relay'), stdio: 'ignore' });
  await serve('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', persist], join(web, '../device-relay'), /Ready on/);
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const cfg = { relay: `http://127.0.0.1:${RELAY_PORT}`, bridgeId: 'smoke-test-bridge', key: 'smoke-test-key-0123456789', printers: [
      { id: 'u1', name: 'U1-mock', url: u1.url, apiKey: '' },
    ],
  };
  const config = bridgeConfig(cfg);
  // What the bridge's network search finds (the real one scans port 7125 on the bridge's networks).
  const found = join(config.dir, 'found.json');
  writeFileSync(found, '[]');
  const uninstallMarker = join(config.dir, 'uninstalled');

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const site = `http://localhost:${PAGE_PORT}/`;

  // ---- U1 through the bridge ---------------------------------------------------------
  // The pairing link alone opens the Device tab with the add-printer dialog: no clicks first.
  // The bridge app opens this link as it starts, so the page usually asks before the
  // bridge has connected: the dialog must keep listening until it comes online.
  await page.goto(`${site}#pair=${pairingCode(cfg)}`);
  await page.getByTestId('bridge-state').filter({ hasText: /Connecting to the bridge|The bridge is offline/ }).waitFor();
  // Connecting is shown with a spinner, and a stray click outside the dialog doesn't lose the pairing.
  await page.getByTestId('bridge-state').locator('.dv-spinner').waitFor();
  await page.mouse.click(5, 895);
  await page.getByRole('dialog', { name: 'Add a printer' }).getByTestId('bridge-state').waitFor({ timeout: 2000 });
  bridge = startBridge(program, config, { find: found, log: (m) => console.log(`bridge: ${m}`) });
  // One list: every printer the bridge serves or found, each with its own name, profile and API key, and one button for all.
  const printers = page.getByTestId('bridge-printers');
  const row = (url) => printers.locator(`[data-testid="add-row"][data-url="${url}"]`);
  await printers.locator('[data-testid="add-row"][data-bridge-id="u1"]').waitFor();
  await printers.getByTestId('bridge-search').click();
  // Searching is shown plainly, and an empty search goes again by itself.
  await printers.getByTestId('bridge-searching').waitFor();
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'bridge-searching.png') });
  // The first search finds nothing, like a Mac before its "find devices on your local network" prompt
  // is allowed; the printers only show up if the dialog searches again by itself.
  await new Promise((r) => setTimeout(r, 1500));
  writeFileSync(found, JSON.stringify([
    { url: u1.url, name: 'U1-mock' },
    { url: keyed.url, name: '127.0.0.1', needsKey: true },
  ]));
  await row(keyed.url).waitFor({ timeout: 20_000 });
  if ((await printers.getByTestId('add-row').count()) !== 2) throw new Error('U1-mock is both on the bridge and found: it should be one row');
  // Or by its address (any port), when the search doesn't find it.
  const addToBridge = page.getByTestId('bridge-add-printer');
  await addToBridge.locator('summary').click();
  await addToBridge.getByTestId('bridge-new-address').fill(voron.url.replace('http://', ''));
  await addToBridge.getByTestId('bridge-add-submit').click();
  await until('voron-mock added to the bridge', () => config.printers().some((p) => p.name === 'voron-mock'));
  const voronRow = printers.locator(`[data-testid="add-row"][data-bridge-id="${config.printers().find((p) => p.name === 'voron-mock').id}"]`);
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
  await until('the bridge kept the key and the name', () => config.printers().some((p) => p.name === 'Keyed printer' && p.apiKey === 'mock-api-key'));
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
  // In the dark theme the printer list's choices are dark too (the open list used to be light).
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const optionColours = await page.getByTestId('printer-select').evaluate((select) => {
    // A see-through background leaves the browser's own (light) list showing: count it as light.
    const lum = (c) => {
      const [r, g, b, a = 1] = (c.match(/\d+(\.\d+)?/g) ?? []).map(Number);
      return a === 0 ? 1 : (r + g + b) / 765;
    };
    return [...select.options].map((o) => ({ bg: lum(getComputedStyle(o).backgroundColor), fg: lum(getComputedStyle(o).color) }));
  });
  if (optionColours.some((o) => o.bg > 0.4 || o.fg < 0.6)) throw new Error(`printer choices aren't dark in the dark theme: ${JSON.stringify(optionColours)}`);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
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
  {
    // One part fan, the hotend fan of the head on the carriage, and a parked head's while it still spins; no per-head part fans.
    const climate = page.getByTestId('climate-card');
    await climate.getByText('Hotend fan T1', { exact: true }).waitFor();
    await climate.getByText('Hotend fan T3', { exact: true }).waitFor();
    for (const gone of ['Hotend fan T2', 'E1 fan', 'E1 nozzle fan']) if (await climate.getByText(gone, { exact: true }).count()) throw new Error(`U1 fan list shows ${gone}`);
    console.log('U1 fans: part cooling plus the hotend fans that matter');
    // Fans are tiles with their speed; tapping one opens its slider. Fans the printer runs by itself can't be opened.
    if (!(await climate.getByRole('button', { name: /Hotend fan T1/ }).isDisabled())) throw new Error('hotend fan tile should not open a slider');
    await climate.getByRole('button', { name: /Part cooling/ }).click();
    const slider = climate.getByRole('slider', { name: 'Part cooling' });
    await slider.focus();
    await slider.press('End');
    await until('part cooling fan full', () => u1.state.fan.speed === 1);
    await climate.getByRole('button', { name: /Part cooling/ }).filter({ hasText: '100%' }).waitFor();
    console.log('fan tiles show speeds and open a slider');
    // Desktop: Bed and chamber beside Move, both cards ending on the same line.
    const [c, m] = await Promise.all([climate.boundingBox(), page.getByTestId('motion-card').boundingBox()]);
    if (Math.abs(c.y - m.y) > 1 || Math.abs(c.y + c.height - (m.y + m.height)) > 1) throw new Error(`Bed and chamber and Move are not side by side and even (${JSON.stringify({ c, m })})`);
    console.log('Bed and chamber and Move sit side by side, same height');
  }

  // Move arrows say what physically moves. On the U1 the bed moves up and down, so "Bed up" closes the gap (Z−).
  {
    const motion = page.getByTestId('motion-card');
    await motion.getByRole('button', { name: 'Home all' }).click();
    await until('U1 homed', () => u1.state.toolhead.homed_axes === 'xyz');
    if ((await motion.getByText('Bed', { exact: true }).count()) !== 1) throw new Error('U1 Move card does not label the height arrows "Bed"');
    await motion.getByRole('button', { name: 'Bed up' }).click();
    await until('bed up sends Z-', () => u1.scripts.includes('G1 Z-10 F600'));
    await motion.getByRole('button', { name: 'Bed down' }).click();
    await until('bed down sends Z+', () => u1.scripts.includes('G1 Z10 F600'));
    await motion.getByRole('button', { name: 'Head toward you' }).click();
    await until('head toward you sends Y-', () => u1.scripts.includes('G1 Y-10 F6000'));
    await motion.getByRole('button', { name: 'Head to the back' }).click();
    await until('head to the back sends Y+', () => u1.scripts.includes('G1 Y10 F6000'));
    console.log('U1 move arrows: bed up/down and head front/back send the right moves');
  }

  await page.getByTestId('camera-frame').waitFor({ timeout: 20_000 });
  // The camera comes straight from the bridge (pictures over a direct WebRTC link), not one frame a second over the relay.
  await page.locator('[data-testid="camera-frame"][data-view="direct-pictures"]').waitFor({ timeout: 20_000 });
  {
    const seen = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      seen.add(await page.locator('[data-view="direct-pictures"]').getAttribute('src'));
      await new Promise((r) => setTimeout(r, 50));
    }
    // The stock U1's picture file is read at its own gentle 2 a second (addons/u1.ts); the relay's 1 a second would give 2 at most.
    if (seen.size < 3) throw new Error(`only ${seen.size} camera pictures in 2 s over the direct link`);
    console.log(`camera comes straight from the bridge: ${seen.size} pictures in 2 s`);
  }
  // The U1 announces every camera frame as a file change; none of that may
  // turn into G-code list refreshes (that stalled Moonraker on a real U1).
  const before = { ...u1.stats };
  await new Promise((r) => setTimeout(r, 6000));
  const lists = u1.stats.fileLists - before.fileLists;
  const monitors = u1.stats.startMonitor - before.startMonitor;
  if (lists > 1) throw new Error(`camera frames caused ${lists} G-code list refreshes in 6 s`);
  if (monitors > 1) throw new Error(`camera.start_monitor sent ${monitors} times in 6 s`);
  console.log('camera frames arrive through the bridge, without file-list or start_monitor floods');

  // Tapping a tool head opens its buttons under the tiles.
  const sheet = page.getByTestId('head-sheet');
  const pickHead = async (i) => {
    await page.getByTestId(`head-${i}`).locator('.dv-head-tile').click();
    await page.locator(`[data-testid="head-${i}"].selected`).waitFor();
  };
  // Each head shows how it is as a face: the empty one asks for filament, the docked cold ones nap in bed;
  // the head on the carriage stands up.
  await page.locator('[data-testid="head-3"][data-mood="hungry"]').getByText('Feed me').waitFor();
  await page.locator('[data-testid="head-2"][data-mood="napping"] .dv-bed-pose-nap').waitFor();
  // In bed the empty head dreams of a spool instead of napping.
  await page.locator('[data-testid="head-3"] .dv-bed-pose-hungry').waitFor();
  await page.locator('[data-testid="head-0"][data-dock="attached"] .dv-face').waitFor();
  if (await page.locator('[data-testid="head-0"] .dv-bed').count()) throw new Error('the head on the carriage is drawn in bed');
  if (shots) await page.getByTestId('toolheads-card').screenshot({ path: join(shots, 'tool-heads.png') });
  await pickHead(3);
  await sheet.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('dialog', { name: 'Load filament' }).getByRole('button', { name: 'Load filament' }).click();
  await until('FEED_AUTO load', () => u1.scripts.includes('FEED_AUTO MODULE=right CHANNEL=1 LOAD=1'));
  await until('head 4 loaded', () => u1.state.print_task_config.filament_exist[3] === true);
  await page.getByTestId('print-state').filter({ hasText: 'Ready' }).waitFor();
  console.log('filament load sent to the right feeder');

  // Unloading empties the head while the filament waits at the side feeder: the head asks for
  // filament again, Load comes back and Unload greys out.
  await page.locator('[data-testid="head-3"]:not([data-mood="hungry"])').waitFor();
  await sheet.getByRole('button', { name: 'Unload', exact: true }).click();
  await page.getByRole('dialog', { name: 'Unload filament' }).getByRole('button', { name: 'Unload filament' }).click();
  await until('FEED_AUTO unload', () => u1.scripts.includes('FEED_AUTO MODULE=right CHANNEL=1 UNLOAD=1'));
  await page.locator('[data-testid="head-3"][data-mood="hungry"]').getByText('At the feeder').waitFor();
  if (!(await sheet.getByRole('button', { name: 'Unload', exact: true }).isDisabled())) throw new Error('Unload still on after unloading');
  if (await sheet.getByRole('button', { name: 'Load', exact: true }).isDisabled()) throw new Error('Load off after unloading');
  if (!u1.state.print_task_config.filament_exist[3]) throw new Error('mock: filament_exist should stay true after an unload');
  console.log('filament unload empties the head, filament waits at the feeder');

  await pickHead(1);
  await sheet.getByRole('button', { name: 'Filament' }).click();
  await page.getByLabel('Type').fill('Silk');
  await page.getByRole('button', { name: 'Save to printer' }).click();
  await until('filament edited', () => u1.state.print_task_config.filament_sub_type[1] === 'Silk');
  console.log('filament edit saved on the printer');

  await page.locator('[data-testid="head-0"][data-dock="attached"]').waitFor();
  await pickHead(2);
  await sheet.getByTestId('head-dock').filter({ hasText: 'In its dock' }).waitFor();
  await sheet.getByRole('button', { name: 'Pick up' }).click();
  await page.getByRole('dialog', { name: 'Pick up' }).getByRole('button', { name: 'Pick up' }).click();
  await until('PICK_EXTRUDER2 sent', () => u1.scripts.includes('PICK_EXTRUDER2'));
  // Picked up: it gets out of bed, and the head it replaces goes back to bed.
  await page.locator('[data-testid="head-2"][data-dock="attached"][data-scene="waking"]').getByText('Getting up').waitFor();
  await page.locator('[data-testid="head-0"][data-dock="parked"][data-scene="bedtime"]').getByText('Back to bed').waitFor();
  await page.locator('[data-testid="head-2"][data-dock="attached"] .dv-face').waitFor();
  await page.locator('[data-testid="head-0"][data-scene="asleep"] .dv-bed').waitFor();
  await sheet.getByTestId('head-dock').filter({ hasText: 'On the carriage' }).waitFor();
  await sheet.getByRole('button', { name: 'Park' }).click();
  await page.getByRole('dialog', { name: 'Park' }).getByRole('button', { name: 'Park' }).click();
  await until('PARK_EXTRUDER2 sent', () => u1.scripts.includes('PARK_EXTRUDER2'));
  await page.locator('[data-testid="head-2"][data-dock="parked"]').waitFor();
  console.log('tool head pick up and park');

  await pickHead(1);
  await sheet.getByRole('button', { name: 'Nozzle' }).click();
  await page.getByTestId('head-switches').getByText('121').waitFor();
  await page.getByLabel('Size').selectOption('0.6');
  await page.getByLabel('Type').selectOption('high_flow');
  await page.getByRole('button', { name: 'Save to printer' }).click();
  await until('nozzle saved', () => u1.scripts.includes('SET_NOZZLE_PROPERTIES EXTRUDER=extruder1 DIAMETER=0.6 VOLUME_TYPE=high_flow'));
  await sheet.getByText('0.6 mm high flow nozzle').waitFor();
  console.log('nozzle size and type saved on the printer');

  // The U1's error codes read in Snapmaker's own words, where the printer state is shown.
  const runout = { id: 523, index: 1, code: 0, level: 2, message: 'runout' };
  u1.setExceptions([runout]);
  const jobCard = page.getByTestId('job-card');
  await jobCard.getByTestId('printer-error').filter({ hasText: 'Filament Anomaly' }).filter({ hasText: 'Filament runout detected in Toolhead 2' }).filter({ hasText: 'Error code 0002 0523 0001 0000' }).waitFor();
  await jobCard.getByTestId('print-state').filter({ hasText: 'Needs attention' }).waitFor();
  if (await jobCard.getByTestId('printer-error').getByRole('button', { name: 'Dismiss' }).count()) throw new Error('an error the printer still reports cannot be dismissed');
  // A one-off announcement can be dismissed; an unknown code falls back to the printer's own message.
  u1.announceException({ id: 999, index: 0, code: 3, level: 3, message: 'Mock printer says no' });
  const oneOff = jobCard.getByTestId('printer-error').filter({ hasText: 'Mock printer says no' });
  await oneOff.filter({ hasText: 'Printer error' }).waitFor();
  if (shots) await jobCard.screenshot({ path: join(shots, 'printer-errors.png') });
  await oneOff.getByRole('button', { name: 'Dismiss' }).click();
  await oneOff.waitFor({ state: 'detached' });
  u1.setExceptions([]);
  await jobCard.getByTestId('printer-errors').waitFor({ state: 'detached' });
  await jobCard.getByTestId('print-state').filter({ hasText: 'Ready' }).waitFor();
  console.log('U1 errors shown in words with their code, one-off ones dismissable, cleared when the printer clears them');

  if (shots) await page.screenshot({ path: join(shots, 'device-u1.png'), fullPage: true });

  const gcode = Buffer.from(
    [
      '; generated by mock',
      '; estimated printing time (normal mode) = 1h 2m 3s',
      // Object labels for Klipper's exclude_object, as Orca writes them.
      'EXCLUDE_OBJECT_DEFINE NAME=Calibration_cube.stl_id_0_copy_0 CENTER=80,80 POLYGON=[[60,60],[100,60],[100,100],[60,100]]',
      'EXCLUDE_OBJECT_DEFINE NAME=Calibration_cube.stl_id_0_copy_1 CENTER=190,80 POLYGON=[[170,60],[210,60],[210,100],[170,100]]',
      'EXCLUDE_OBJECT_DEFINE NAME=Ring_id_1_copy_0 CENTER=135,190 POLYGON=[[115,175],[135,165],[155,175],[155,205],[135,215],[115,205]]',
      'T0',
      'G1 X1',
      'T1',
      'G1 X2',
      '; filament used [g] = 3.20, 1.10',
      '; filament_colour = #E72F1D;#3E413F',
      '; filament_type = PETG;PLA',
      '',
    ].join('\n'),
  );
  await page.getByTestId('device-gcode-input').setInputFiles({ name: 'two colour.gcode', mimeType: 'text/plain', buffer: gcode });
  await page.getByTestId('tool-map').waitFor();
  // The dialog names the printer the file goes to.
  await page.getByRole('dialog').getByRole('heading', { name: 'Send to U1-mock' }).waitFor();
  // Suggested map: red PETG -> T2 (red PETG), dark PLA -> T1.
  await until('suggested map', async () => (await page.getByLabel('Tool head for filament 1').inputValue()) === '1' && (await page.getByLabel('Tool head for filament 2').inputValue()) === '0');
  await page.getByTestId('upload-only').click();
  await until('file uploaded', () => u1.files.has('two_colour.gcode'), 20_000);
  // The printer has the whole file a moment before the page hears back; the
  // dialog closes then. Opening the next file before that let this upload's
  // finish close the new dialog (a flaky "no Cancel button" / "no tool map").
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20_000 });
  if (u1.state.print_stats.state !== 'standby') throw new Error('Upload only started a print');
  if (u1.files.get('two_colour.gcode').size !== gcode.length) throw new Error(`uploaded ${u1.files.get('two_colour.gcode').size} bytes, sent ${gcode.length}`);
  console.log('upload only: file on the printer, no print started');

  // Snapmaker's mapping rules: a TPU filament can't go to any head (none has TPU), so printing is blocked with the reason shown.
  const tpu = Buffer.from(['; generated by mock', 'T0', 'G1 X1', 'T1', 'G1 X2', '; filament used [g] = 3.20, 1.10', '; filament_colour = #E72F1D;#FFFFFF', '; filament_type = PETG;TPU', ''].join('\n'));
  await page.getByTestId('device-gcode-input').setInputFiles({ name: 'flexible.gcode', mimeType: 'text/plain', buffer: tpu });
  await page.getByTestId('tool-map').waitFor();
  await page.getByTestId('map-blocked').filter({ hasText: 'No tool head has TPU' }).waitFor();
  if ((await page.getByLabel('Tool head for filament 2').locator('option:not(:disabled)').count()) !== 0) throw new Error('a head of another type can be chosen for TPU');
  if (!(await page.getByTestId('upload-and-print').isDisabled())) throw new Error('printing allowed with a TPU filament on a PLA head');
  const disabled = await page.getByLabel('Tool head for filament 1').locator('option:disabled').allTextContents();
  if (disabled.length !== 3 || disabled.some((t) => t.includes('PETG'))) throw new Error(`PETG filament: expected the 3 non-PETG heads disabled, got ${disabled.join(' | ')}`);
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'print-dialog-blocked.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  console.log('mapping rules: other filament types greyed out, printing blocked on a mismatch');

  // The two-colour file uploaded above, by name: the file list may not have
  // refreshed yet, and then the newest row is an older one-colour file.
  await page.getByTestId('files-card').locator('li', { hasText: 'two_colour.gcode' }).getByRole('button', { name: 'Print…' }).click();
  await page.getByTestId('tool-map').waitFor();
  await page.getByLabel('Level the bed').uncheck();
  await page.getByTestId('upload-and-print').click();
  await page.getByTestId('print-state').filter({ hasText: 'Printing' }).waitFor({ timeout: 20_000 });
  for (const want of ['SET_PRINT_PREFERENCES BED_LEVEL=0 FLOW_CALIBRATE=0 TIME_LAPSE_CAMERA=0', 'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=1', 'SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=1 MAP_EXTRUDER=0']) {
    if (!u1.scripts.includes(want)) throw new Error(`missing ${want}; got ${u1.scripts.join(' | ')}`);
  }
  console.log('print on the mock: preferences and tool map sent before starting');

  // Skipping an object: the file lists three (EXCLUDE_OBJECT_DEFINE), shown by name on a map and in a list.
  await page.getByTestId('printing-object').waitFor();
  await page.getByRole('button', { name: 'Skip objects…' }).click();
  const skipList = page.getByTestId('skip-objects');
  await skipList.waitFor();
  const names = await skipList.getByTestId('skip-object').locator('.dv-skip-name').allTextContents();
  if (names.join('|') !== 'Calibration cube|Calibration cube 2|Ring') throw new Error(`objects listed as ${names.join(' | ')}`);
  if ((await skipList.locator('.dv-skip-shape').count()) !== 3) throw new Error('the map does not outline 3 objects');
  await skipList.getByTestId('skip-object').filter({ hasText: 'Ring' }).getByRole('button', { name: 'Skip' }).click();
  const sure = page.getByRole('dialog', { name: 'Skip Ring?' });
  await sure.getByText("It can't be printed again in this print.").waitFor();
  if (u1.scripts.some((s) => s.startsWith('EXCLUDE_OBJECT'))) throw new Error('skipped before confirming');
  await sure.getByRole('button', { name: 'Skip Ring' }).click();
  await skipList.getByTestId('skip-object').filter({ hasText: 'Ring' }).getByText('Skipped').waitFor();
  if (!u1.scripts.includes('EXCLUDE_OBJECT NAME=RING_ID_1_COPY_0')) throw new Error(`no EXCLUDE_OBJECT sent; got ${u1.scripts.slice(-5).join(' | ')}`);
  await skipList.getByText('2 of 3 objects still printing.').waitFor();
  // The last object left: skipping it would print nothing, so the question offers to cancel instead.
  await skipList.getByTestId('skip-object').filter({ hasText: 'Calibration cube 2' }).getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('dialog', { name: 'Skip Calibration cube 2?' }).getByRole('button', { name: 'Skip Calibration cube 2' }).click();
  await skipList.getByText('1 of 3 objects still printing.').waitFor();
  await skipList.getByTestId('skip-object').filter({ hasText: /^Calibration cube(?! 2)/ }).getByRole('button', { name: 'Skip' }).click();
  const last = page.getByRole('dialog', { name: 'Calibration cube is the last object' });
  await last.getByRole('button', { name: 'Cancel print' }).waitFor();
  await last.getByRole('button', { name: 'Keep printing' }).click();
  await last.waitFor({ state: 'detached' });
  if (u1.scripts.includes('EXCLUDE_OBJECT NAME=CALIBRATION_CUBE.STL_ID_0_COPY_0')) throw new Error('the last object was skipped');
  if (shots) await page.getByRole('dialog', { name: 'Skip objects' }).screenshot({ path: join(shots, 'skip-objects.png') });
  await page.getByRole('dialog', { name: 'Skip objects' }).getByRole('button', { name: 'Close' }).click();
  console.log('skip objects: map + list, confirmed, EXCLUDE_OBJECT sent, shown as skipped');

  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Paused' }).waitFor();
  await page.getByRole('button', { name: 'Cancel print' }).click();
  await page.getByRole('dialog', { name: 'Cancel print' }).getByRole('button', { name: 'Cancel print' }).click();
  await page.getByTestId('print-state').filter({ hasText: 'Cancelled' }).waitFor();
  console.log('pause and cancel work');

  // The bridge going away is reported, and the page reconnects when it returns.
  bridge.stop();
  await page.getByText('Bridge offline').waitFor({ timeout: 20_000 });
  // The offline help fits the bridge's computer: Linux here, so the installed command and no system choice.
  await page.getByTestId('bridge-offline-help').waitFor();
  const offlineCmd = await page.getByTestId('bridge-offline-command').textContent();
  if (offlineCmd !== '~/.local/bin/cloud-slicer-bridge install') throw new Error(`offline help for a Linux bridge shows: ${offlineCmd}`);
  bridge = startBridge(program, config);
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 40_000 });
  console.log('bridge restart: reconnected by itself');

  // A second copy of the bridge (another window) takes over, and the older one stops rather than taking it back.
  bridge.stop();
  // Wait for the older copy itself to be on the relay: the page may still show the stopped one as connected for a moment.
  let olderUp = false;
  const older = startBridge(program, config, { log: (m) => /Connected to the relay/.test(m) && (olderUp = true) });
  await until('the older copy connected', () => olderUp, 40_000);
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 40_000 });
  // This copy can be removed from the Device tab; it then uninstalls itself (here: only leaves a note and exits).
  bridge = startBridge(program, config, { uninstallMarker });
  await until('the older copy stopped', () => older.exited(), 20_000);
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
  // Any Klipper printer gets the same tool head faces, from its temperatures alone.
  await page.getByRole('heading', { name: 'Tool heads' }).waitFor();
  await page.locator('[data-testid="head-0"] .dv-face').waitFor();
  if (await page.getByTestId('head-sheet').getByRole('button', { name: 'Pick up' }).count()) throw new Error('generic printer offers U1 head buttons');
  await until('both cameras streaming', async () => (await page.getByTestId('camera-tile').count()) === 2, 20_000);
  await page.locator('[data-camera="case"] iframe[data-view="iframe"]').waitFor({ timeout: 20_000 });
  {
    // Desktop, two cameras: side by side, same size; clicking the right one moves it to the left.
    await page.locator('[data-camera="case"][data-main]').waitFor();
    const [a, b] = await Promise.all(['case', 'nozzle'].map((n) => page.locator(`[data-camera="${n}"]`).boundingBox()));
    if (Math.abs(a.width - b.width) > 2 || Math.abs(a.y - b.y) > 2 || !(a.x < b.x)) throw new Error(`desktop: two cameras are not side by side (${JSON.stringify({ a, b })})`);
    await page.getByRole('button', { name: 'Show nozzle big' }).click();
    await page.locator('[data-camera="nozzle"][data-main]').waitFor();
    await page.getByRole('button', { name: 'Show case big' }).click();
    await page.locator('[data-camera="case"][data-main]').waitFor();
    // Alerts sit above the file list, which can run to hundreds of files.
    const [alertsY, filesY] = await Promise.all(['alerts-card', 'files-card'].map((id) => page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().top)));
    if (!(alertsY < filesY)) throw new Error('Alerts card is below the file list');
    console.log('desktop: two cameras side by side, swap with a click; Alerts above Files');
  }
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
  await page.getByRole('button', { name: 'Head right' }).click();
  await until('jogged', () => voron.scripts.includes('G1 X10 F6000'));
  // Printers where the head moves up and down keep "Head up" = Z+.
  await page.getByRole('button', { name: 'Head up' }).click();
  await until('head up sends Z+', () => voron.scripts.includes('G1 Z10 F600'));
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

  // With two printers saved, a new file can go to either one: picking the U1 in the dialog connects to it.
  const sendFile = { name: 'pick printer.gcode', mimeType: 'text/plain', buffer: gcode };
  await page.getByTestId('device-gcode-input').setInputFiles(sendFile);
  const sendTo = page.getByRole('dialog').getByTestId('send-printer');
  await sendTo.locator('option', { hasText: 'voron-mock' }).waitFor({ state: 'attached' });
  if ((await sendTo.locator('option', { hasText: 'voron-mock' }).getAttribute('value')) !== (await sendTo.inputValue())) throw new Error('the dialog should start on the printer on screen');
  if (await page.getByTestId('tool-map').count()) throw new Error('generic printer shows the U1 tool map');
  const u1Id = await sendTo.locator('option', { hasText: 'U1-mock' }).getAttribute('value');
  await page.getByRole('dialog').getByRole('heading', { name: 'Send to voron-mock' }).waitFor();
  await sendTo.selectOption(u1Id);
  await page.getByTestId('tool-map').waitFor({ timeout: 20_000 });
  await page.getByRole('dialog').getByRole('heading', { name: 'Send to U1-mock' }).waitFor();
  await page.getByTestId('upload-only').waitFor();
  await until('upload enabled once the U1 is connected', () => page.getByTestId('upload-only').isEnabled());
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'send-pick-printer.png') });
  await page.getByTestId('upload-only').click();
  await until('file uploaded to the printer picked', () => u1.files.has('pick_printer.gcode'), 20_000);
  // Switching printers before the upload has answered left this dialog open for
  // good, blocking every click after it (a flaky "dialog intercepts pointer events").
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20_000 });
  if (voron.files.has('pick_printer.gcode')) throw new Error('the file went to the printer on screen, not the one picked');
  if (u1.state.print_stats.state === 'printing') throw new Error('Upload only started a print');
  if ((await page.evaluate(() => localStorage.getItem('cloud-slicer:printer-send:v1'))) !== JSON.stringify(u1Id)) throw new Error('the printer sent to is not remembered');
  await page.getByTestId('printer-select').selectOption({ label: 'voron-mock' });
  await page.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
  console.log('send dialog: printer picker sends to the printer chosen and remembers it');

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Already there when the page connects: read with server.exception.query.
  u1.setExceptions([runout, { id: 528, index: 0, code: 11, level: 2, message: '' }]);
  await phone.goto(site);
  await phone.evaluate((p) => localStorage.setItem('cloud-slicer:devices:v1', p), await page.evaluate(() => localStorage.getItem('cloud-slicer:devices:v1')));
  await phone.reload();
  await phone.getByRole('tab', { name: 'Device' }).click();
  await phone.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
  await phone.getByTestId('printer-error').filter({ hasText: 'Homing Anomaly' }).filter({ hasText: 'Error code 0002 0528 0000 0011' }).waitFor();
  await phone.getByTestId('printer-error').filter({ hasText: 'Filament Anomaly' }).waitFor();
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
  if (shots) await phone.getByTestId('job-card').screenshot({ path: join(shots, 'printer-errors-phone.png') });
  u1.setExceptions([]);
  await phone.getByTestId('printer-errors').waitFor({ state: 'detached' });
  console.log('phone layout fits, with the U1 errors read when the page connects');

  // Phone: the camera stays at the top while scrolling and, when not printing, the move controls sit right under it.
  {
    // The job card screenshot above scrolled the page; measure from the top.
    await phone.evaluate(() => document.querySelector('.device').scrollTo(0, 0));
    const gap = await phone.evaluate(() => {
      const cam = document.querySelector('[data-testid="camera-card"]').getBoundingClientRect();
      const move = document.querySelector('[data-testid="motion-card"]').getBoundingClientRect();
      return move.top - cam.bottom;
    });
    if (gap < 0 || gap > 24) throw new Error(`move controls are not right under the camera on a phone (gap ${gap} px)`);
    await phone.evaluate(() => document.querySelector('.device').scrollBy(0, 800));
    const camTop = await phone.getByTestId('camera-card').evaluate((el) => el.getBoundingClientRect().top);
    const deviceTop = await phone.evaluate(() => document.querySelector('.device').getBoundingClientRect().top);
    if (Math.abs(camTop - deviceTop) > 2) throw new Error(`camera scrolled away on a phone (camera at ${camTop}, page top ${deviceTop})`);
    await phone.evaluate(() => document.querySelector('.device').scrollTo(0, 0));
    // Several cameras: one big, the others small beside it; tapping a small one makes it the big one.
    const cur = await phone.getByTestId('printer-select').inputValue();
    await phone.getByTestId('printer-select').selectOption({ label: 'voron-mock' });
    await phone.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
    await until('two cameras on the phone', async () => (await phone.getByTestId('camera-tile').count()) === 2, 20_000);
    await phone.locator('[data-camera="case"][data-main]').waitFor();
    const [big, small] = await Promise.all(['case', 'nozzle'].map((n) => phone.locator(`[data-camera="${n}"]`).evaluate((el) => el.getBoundingClientRect().width)));
    if (!(small < big / 2)) throw new Error(`small camera is not small next to the big one (${small} vs ${big} px)`);
    if (shots) await phone.getByTestId('camera-card').screenshot({ path: join(shots, 'cameras-phone.png') });
    await phone.getByRole('button', { name: 'Show nozzle big' }).click();
    await phone.locator('[data-camera="nozzle"][data-main]').waitFor();
    await phone.getByTestId('printer-select').selectOption(cur);
    await phone.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 20_000 });
    console.log('phone: camera stays on top, move controls under it, small cameras swap in with a tap');
  }

  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.getByTestId('device-gcode-input').setInputFiles(sendFile);
  await phone.getByRole('dialog').getByTestId('send-printer').waitFor();
  const wideDialog = await phone.evaluate(() => [...document.querySelectorAll('.dv-dialog *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)?.className ?? null);
  if (wideDialog !== null) throw new Error(`send dialog is wider than a 390 px phone: ${wideDialog}`);
  if (shots) await phone.screenshot({ path: join(shots, 'send-pick-printer-phone.png') });
  await phone.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  console.log('send dialog with the printer picker fits a phone');

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
  // With only one printer saved there's no picker, but the dialog still names the printer.
  await old.getByTestId('device-gcode-input').setInputFiles(sendFile);
  const sendOld = old.getByRole('dialog', { name: 'Send to Old Voron' });
  await sendOld.waitFor();
  if (await sendOld.getByTestId('send-printer').count()) throw new Error('one printer saved, yet the dialog offers a printer picker');
  await sendOld.getByRole('button', { name: 'Cancel' }).click();
  console.log('send dialog names the only printer');

  // Bridge printers saved before bridges were saved on their own get their bridge back, with no pairing.
  const earlier = await browser.newPage();
  await earlier.goto(site);
  const onlyPrinters = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('cloud-slicer:devices:v1')).filter((d) => d.extra?.kind === 'bridge')));
  await earlier.evaluate((v) => localStorage.setItem('cloud-slicer:devices:v1', v), onlyPrinters);
  await earlier.reload();
  await earlier.getByRole('tab', { name: 'Device' }).click();
  await earlier.getByTestId('manage-open').first().click();
  await earlier.getByTestId('manage-bridge').getByTestId('manage-bridge-state').filter({ hasText: 'Running' }).waitFor({ timeout: 20_000 });
  await earlier.getByTestId('manage-bridge').locator('[data-testid="manage-printer"][data-name="U1-mock"]').waitFor();
  await earlier.close();
  console.log('bridges of printers saved earlier come back on their own');

  // ---- Bridge setup: the apps the relay has --------------------------------------------
  const relayUrl = `http://127.0.0.1:${RELAY_PORT}`;
  const liveRelay = 'https://cloud-slicer-relay.awesomestuff.qzz.io';
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
  // Or on the printer itself: one line over SSH.
  await setup.getByRole('tab', { name: 'On the printer' }).click();
  await setup.getByTestId('bridge-steps-printer').getByTestId('bridge-printer-command').filter({ hasText: `curl -fsSL ${liveRelay}/install.sh | sh -s -- --printer` }).waitFor();
  if (shots) await setup.screenshot({ path: join(shots, 'bridge-setup-printer.png') });
  await setup.getByRole('tab', { name: 'Mac' }).click();
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
  await setup.getByTestId('bridge-not-ready').waitFor();
  console.log('bridge setup: app downloads and the Linux command from the relay, a plain note when it has none');
  // Printers & bridges: the bridge is its own thing, its printers come and go on their own.
  await page.getByTestId('manage-open').first().click();
  const manage = page.getByTestId('manage-dialog');
  const card = manage.getByTestId('manage-bridge');
  await card.getByTestId('manage-bridge-state').filter({ hasText: 'Running' }).waitFor({ timeout: 20_000 });
  await card.getByText(/^Bridge on /).waitFor();
  // A newer bridge is out: Update now asks the bridge, which says plainly why it can't (it wasn't
  // set up to start with its computer here). An installed one downloads, checks and restarts.
  await card.getByTestId('manage-bridge-update').click();
  await card.getByTestId('manage-bridge-update-row').getByRole('alert').filter({ hasText: "can't update itself" }).waitFor();
  console.log('a newer bridge is offered, and the bridge answers Update now');
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'manage.png') });
  const managed = (name) => card.locator(`[data-testid="manage-printer"][data-name="${name}"]`);
  await managed('U1-mock').getByTestId('manage-printer-remove').click();
  await managed('U1-mock').getByTestId('manage-printer-remove-yes').click();
  await until('U1-mock removed', async () => (await page.getByTestId('printer-select').locator('option', { hasText: 'U1-mock' }).count()) === 0);
  await until('the bridge forgot U1-mock too', () => !config.printers().some((p) => p.id === 'u1'));
  await managed('Keyed printer').getByTestId('manage-printer-remove').click();
  await managed('Keyed printer').getByTestId('manage-printer-remove-yes').click();
  // No printers left: the bridge stays, empty.
  await card.getByText('No printers yet.').waitFor();
  console.log('removing printers leaves the bridge');
  // Adding to a saved bridge needs no pairing again.
  await card.getByTestId('manage-bridge-add').click();
  await page.getByTestId('bridge-state').filter({ hasText: 'Connected to the bridge' }).waitFor({ timeout: 20_000 });
  await page.getByRole('dialog', { name: 'Add a printer' }).getByRole('button', { name: 'Close' }).click();
  // Removing the bridge, while it runs, makes it uninstall itself.
  await page.getByTestId('manage-open').first().click();
  await card.getByTestId('manage-bridge-state').filter({ hasText: 'Running' }).waitFor({ timeout: 20_000 });
  await card.getByTestId('manage-bridge-remove').click();
  await card.getByText('will also uninstall itself').waitFor();
  if (shots) await page.getByRole('dialog').screenshot({ path: join(shots, 'manage-remove-bridge.png') });
  await card.getByTestId('manage-bridge-remove-yes').click();
  await until('the bridge uninstalled itself', () => bridge.uninstalled(), 20_000);
  await until('the bridge is gone', async () => (await manage.getByTestId('manage-bridge').count()) === 0);
  if (await manage.getByTestId('manage-leftover').count()) throw new Error('a bridge that removed itself needs no manual command');
  console.log('removing the bridge: it uninstalls itself');
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
