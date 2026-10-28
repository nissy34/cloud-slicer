#!/usr/bin/env node
// Browser end to end for "From printer" in the Filament section (desktop's Sync
// filament): load a mock U1's tool heads into the project on an empty plate
// (replace), then with a model (match colours, add the other heads, replace
// moving the model's filament), a Bambu Lab printer's AMS, and the dialog on a phone. Only the MOCK
// printer (test/device/mock-printer.mjs) is used; nothing is printed.
//
//   npm run build && node test/sync-filaments.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pickerOf } from './picker.mjs';
import { startMockPrinter } from './device/mock-printer.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4174;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
const url = `http://localhost:${PORT}/`;
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(timer);
      ok();
    }
  });
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const check = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

const u1 = await startMockPrinter();
const voron = await startMockPrinter({ generic: true });
// A Bambu Lab P1S as the bridge passes it on: the printer's own report, with its AMS.
const tray = (id, type, line, color) => ({ id: String(id), tray_type: type, tray_sub_brands: line, tray_color: color });
const p1s = await startMockPrinter({
  generic: true,
  hostname: 'P1S-mock',
  brand: 'bambu',
  objects: {
    bambu: {
      ams: { ams: [{ id: '0', tray: [tray(0, 'PLA', 'PLA Basic', 'FFFFFFFF'), tray(1, '', '', '00000000'), tray(2, 'PLA', 'PLA Matte', 'C12E1FFF'), tray(3, 'PETG', 'PETG HF', '000000FF')] }] },
      vt_tray: tray(254, '', '', '00000000'),
    },
  },
});
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
// The printers this browser has saved (signed out: the account store's local copy).
const devices = [
  { id: 'u1', name: 'U1-mock', preset: '', url: u1.url, hasApiKey: false, apiKey: '', extra: { kind: 'direct' }, version: 1, updatedAt: 1 },
  { id: 'voron', name: 'voron-mock', preset: '', url: voron.url, hasApiKey: false, apiKey: '', extra: { kind: 'direct' }, version: 1, updatedAt: 1 },
  { id: 'p1s', name: 'P1S-mock', preset: '', url: p1s.url, hasApiKey: false, apiKey: '', extra: { kind: 'direct' }, version: 1, updatedAt: 1 },
];

async function open(viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.evaluate((d) => {
    localStorage.setItem('cloud-slicer:devices:v1', JSON.stringify(d));
    localStorage.setItem('cloud-slicer:printer-active:v1', JSON.stringify('u1'));
  }, devices);
  await page.reload();
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
  return page;
}

const slots = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('ol.slots li')].map((li) => ({
      colour: li.querySelector('input[type=color]').value.toUpperCase(),
      preset: li.querySelector('button.picker').dataset.value,
    })),
  );

try {
  const page = await open({ width: 1280, height: 900 });
  const dialog = page.getByRole('dialog', { name: 'Load filaments from the printer' });

  // ---- empty plate: the printer's three loaded heads replace the list --------------
  await page.getByTestId('sync-filaments').click();
  await dialog.getByTestId('sync-rows').waitFor({ timeout: 30000 });
  check((await dialog.getByRole('radio', { name: 'Replace all' }).getAttribute('aria-checked')) === 'true', 'an empty plate should start on Replace all');
  check((await dialog.getByTestId('sync-rows').locator('li').count()) === 3, 'three loaded heads (T4 is empty)');
  await shot(page, 'desktop-replace');
  await dialog.getByTestId('sync-load').click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('Loaded 3 filaments from U1-mock.').waitFor();
  let s = await slots(page);
  check(JSON.stringify(s.map((x) => x.colour)) === JSON.stringify(['#3E413F', '#E72F1D', '#00FF00']), `colours ${JSON.stringify(s)}`);
  check(/^Snapmaker PLA Matte/.test(s[0].preset), `T1 is Snapmaker PLA Matte: ${s[0].preset}`);
  check(/^Generic PETG/.test(s[1].preset) && /^Generic PLA/.test(s[2].preset), `T2/T3 presets ${JSON.stringify(s)}`);
  console.log('empty plate: three heads loaded with matching presets');

  // ---- with a model: match colours keeps the count and the model's filament ---------
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  const objFilament = pickerOf(page, 'Filament for 3DBenchy.stl');
  await objFilament.selectOption('3');
  await page.waitForTimeout(500);
  // The printer's heads change: T1 white PLA, T2 empty, T3 blue PLA, T4 red PETG.
  u1.patch({
    print_task_config: {
      filament_color_rgba: ['FFFFFFFF', '000000FF', '0000FFFF', 'FF0000FF'],
      filament_type: ['PLA', 'NONE', 'PLA', 'PETG'],
      filament_sub_type: ['Basic', 'NONE', 'Basic', 'Basic'],
      filament_vendor: ['Snapmaker', 'NONE', 'Generic', 'Generic'],
      filament_exist: [true, false, true, true],
    },
  });
  await page.getByTestId('sync-filaments').click();
  await dialog.getByTestId('sync-rows').waitFor();
  check((await dialog.getByRole('radio', { name: 'Match colours' }).getAttribute('aria-checked')) === 'true', 'a plate with a model should start on Match colours');
  await page.waitForTimeout(500);
  // Red PETG has one match, T4; the PLAs go to the closest PLA colour, changed by hand here.
  const pick = (i) => dialog.getByLabel(`Printer filament for filament ${i}`).evaluate((el) => el.selectedOptions[0].textContent);
  check((await pick(2)).startsWith('T4'), `red PETG goes to T4: ${await pick(2)}`);
  check(!(await dialog.getByText('T2 ·').count()), 'the empty head is not offered');
  await dialog.getByLabel('Printer filament for filament 1').selectOption({ label: 'T1 · Snapmaker PLA Basic' });
  await dialog.getByLabel('Printer filament for filament 3').selectOption({ label: 'T3 · Generic PLA Basic' });
  await shot(page, 'desktop-match');
  await dialog.getByTestId('sync-load').click();
  await dialog.waitFor({ state: 'detached' });
  s = await slots(page);
  check(JSON.stringify(s.map((x) => x.colour)) === JSON.stringify(['#FFFFFF', '#FF0000', '#0000FF']), `match colours ${JSON.stringify(s)}`);
  check(/^Snapmaker PLA Basic/.test(s[0].preset), `picked T1 preset ${s[0].preset}`);
  check((await objFilament.inputValue()) === '3', 'the model keeps filament 3');
  console.log('match colours: the count and the model filament stay, colours and presets follow the heads');

  // ---- replace with fewer heads: the model on filament 3 moves -----------------------
  u1.patch({ print_task_config: { filament_type: ['PLA', 'NONE', 'NONE', 'PETG'], filament_exist: [true, false, false, true] } });
  await page.getByTestId('sync-filaments').click();
  await dialog.getByTestId('sync-rows').waitFor();
  await dialog.getByRole('radio', { name: 'Replace all' }).click();
  await dialog.getByText('Objects on filament 3 → 1.').waitFor();
  await dialog.getByTestId('sync-load').click();
  await dialog.waitFor({ state: 'detached' });
  s = await slots(page);
  check(s.length === 2 && s[1].colour === '#FF0000', `replace ${JSON.stringify(s)}`);
  await page.waitForTimeout(500);
  check((await objFilament.inputValue()) === '1', `the model moved to filament 1: ${await objFilament.inputValue()}`);
  console.log('replace: two heads, the model moved from filament 3 to 1');

  // ---- match, adding the other heads --------------------------------------------------
  u1.patch({ print_task_config: { filament_type: ['PLA', 'PLA', 'PLA', 'PETG'], filament_exist: [true, true, true, true] } });
  await page.getByTestId('sync-filaments').click();
  await dialog.getByTestId('sync-rows').waitFor();
  await dialog.getByLabel(/Also add the filaments on the other tool heads/).check();
  await dialog.getByTestId('sync-load').click();
  await dialog.waitFor({ state: 'detached' });
  s = await slots(page);
  check(s.length === 4, `the other two heads were added: ${JSON.stringify(s)}`);
  console.log('match with the other heads: four filaments');

  // ---- a printer that isn't a U1 -------------------------------------------------------
  await page.getByTestId('sync-filaments').click();
  await dialog.getByLabel('Printer', { exact: true }).selectOption({ label: 'voron-mock' });
  await dialog.getByTestId('sync-status').filter({ hasText: "doesn't say what filament is loaded" }).waitFor({ timeout: 30000 });
  check(await dialog.getByTestId('sync-load').isDisabled(), 'nothing to load from a non-U1');
  console.log('a generic Klipper printer says it cannot report filaments');

  // ---- a Bambu Lab printer: its AMS slots -------------------------------------------------
  await dialog.getByLabel('Printer', { exact: true }).selectOption({ label: 'P1S-mock' });
  await dialog.getByTestId('sync-rows').filter({ hasText: 'A1' }).waitFor({ timeout: 30000 });
  const ams = await dialog.getByTestId('sync-rows').innerText();
  for (const word of ['A1 · Bambu PLA Basic', 'A3 · Bambu PLA Matte', 'A4 · Bambu PETG HF']) check(ams.includes(word), `AMS rows: ${ams}`);
  check(!ams.includes('A2') && !ams.includes('Outside spool'), `empty AMS slots are left out: ${ams}`);
  await dialog.getByRole('radio', { name: 'Replace all' }).click();
  await shot(page, 'bambu-ams');
  await dialog.getByLabel('Printer', { exact: true }).selectOption({ label: 'U1-mock' });
  await dialog.getByTestId('sync-rows').waitFor({ timeout: 30000 });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  console.log('a Bambu Lab printer offers its loaded AMS slots');
  await page.close();

  // ---- phone ------------------------------------------------------------------------------
  u1.reset();
  const phone = await open({ width: 390, height: 844 });
  await phone.getByTestId('model-input').setInputFiles(model);
  await phone.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await phone.getByTestId('sync-filaments').scrollIntoViewIfNeeded();
  await shot(phone, 'phone-button');
  await phone.getByTestId('sync-filaments').click();
  const pd = phone.getByRole('dialog', { name: 'Load filaments from the printer' });
  await pd.getByTestId('sync-rows').waitFor({ timeout: 30000 });
  await phone.waitForTimeout(300);
  const wide = await phone.evaluate(() => [...document.querySelectorAll('dialog *')].filter((el) => el.getBoundingClientRect().right > 391).length);
  check(wide === 0, `${wide} elements wider than the phone`);
  await shot(phone, 'phone-match');
  await pd.getByRole('radio', { name: 'Replace all' }).click();
  await shot(phone, 'phone-replace');
  await pd.getByRole('button', { name: 'Cancel' }).click();
  console.log('the dialog fits a phone');
  console.log('SYNC FILAMENTS OK');
} catch (e) {
  console.error(`SYNC FILAMENTS FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await u1.close();
  await voron.close();
  await p1s.close();
  process.kill(-server.pid);
}
