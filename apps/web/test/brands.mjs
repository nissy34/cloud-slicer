#!/usr/bin/env node
// Browser end to end for every printer brand: the page starts with only the
// Snapmaker presets plus the small catalog; the setup wizard lists every brand
// with the "Direct print" mark on Klipper printers; picking a Voron loads only the
// Voron presets, the printer picker marks it, it slices, and a reload loads
// Voron again. Then OrcaSlicer's catalog lists its own brands.
//
//   node test/brands.mjs [screenshot-dir]
//
// Needs `npm run build` first, with both engines copied (public/engine and
// public/engine-orca).
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/tetrahedron.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4182;
const VORON = 'Voron 2.4 350 0.4 nozzle';

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

const fail = (msg) => {
  console.error(`BRANDS FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  // Preset files the engine fetched: profiles.json and profiles/*.json.
  let fetched = [];
  page.on('request', (r) => {
    const m = new URL(r.url()).pathname.match(/\/(engine(?:-orca)?)\/(profiles(?:\.json|\/[^/]+\.json))$/);
    if (m) fetched.push(`${m[1]}/${m[2]}`);
  });
  const ready = () => page.getByText('Open a model to start').waitFor({ timeout: 120000 });

  const t0 = Date.now();
  await page.goto(url);
  await ready();
  console.log(`start-up ${Date.now() - t0} ms, fetched ${fetched.join(', ')}`);
  if (fetched.some((f) => !['engine/profiles.json', 'engine/profiles/catalog.json'].includes(f))) fail(`start-up fetched brand files: ${fetched.join(', ')}`);
  fetched = [];

  // The wizard's printer page: every brand, Klipper printers marked.
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Next' }).click();
  const brands = await wizard.locator('.wizard-brands summary').count();
  console.log(`wizard lists ${brands} brands`);
  if (brands < 40) fail(`only ${brands} brands in the wizard`);
  const row = (name) => wizard.locator('.wizard-models li', { has: page.locator('.wizard-model', { hasText: new RegExp(`^${name}`) }) });
  if (!(await row('Snapmaker U1').locator('.send-mark').count())) fail('the U1 has no "Direct print" mark');
  if (shots) await page.screenshot({ path: join(shots, 'wizard-brands.png') });

  const search = wizard.getByRole('searchbox', { name: 'Search printers' });
  // Prusa printers print through PrusaLink; an Anker M5 doesn't print from here.
  await search.fill('prusa mk4');
  if (!(await row('Prusa MK4').first().locator('.send-mark').count())) fail('a Prusa MK4 has no "Direct print" mark');
  await search.fill('anker m5');
  if (!(await row('Anker M5').count())) fail('no Anker M5 in the wizard');
  if ((await row('Anker M5').first().locator('.send-mark').count()) !== 0) fail('an Anker M5 has the Direct print mark');
  await search.fill('voron 2.4 350');
  const voron = row('Voron 2.4 350');
  if (!(await voron.locator('.send-mark').count())) fail('the Voron 2.4 350 has no "Direct print" mark');
  await voron.getByRole('button', { name: '0.4', exact: true }).click();
  if (shots) {
    await page.screenshot({ path: join(shots, 'wizard-search.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await search.fill('');
    await wizard.getByText('Only direct print').click();
    await page.screenshot({ path: join(shots, 'wizard-send-only-phone.png') });
    await wizard.getByText('Only direct print').click();
    await page.setViewportSize({ width: 1280, height: 800 });
  }

  // Next loads the Voron presets (and nothing else) for the filament page.
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByText('Pick the filaments you use').waitFor({ timeout: 60000 });
  // A second brand must not hide the other filaments (Orca's default_materials rule, see bundle-profiles.mjs).
  const filamentCount = await wizard.locator('.wizard-filaments input[type=checkbox]').count();
  console.log(`filament page lists ${filamentCount} filaments`);
  if (filamentCount < 100) fail(`only ${filamentCount} filaments for the U1 and the Voron`);
  console.log(`after picking a Voron, fetched ${fetched.join(', ')}`);
  if (fetched.join() !== 'engine/profiles/Voron.json') fail(`expected only Voron.json, fetched ${fetched.join(', ')}`);
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('button', { name: 'Finish' }).click();

  // The picker offers the Voron, marked, and it slices.
  const picker = page.getByRole('combobox', { name: 'Printer preset' });
  const options = await picker.locator('option').allInnerTexts();
  if (!options.some((o) => o.startsWith(VORON) && o.includes('direct print'))) fail(`picker options: ${options.join(' | ')}`);
  await picker.selectOption(VORON);
  await page.getByText('Send prints to it from the Device tab').waitFor({ timeout: 30000 });
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 300000 });
  console.log('sliced on the Voron');
  if (shots) {
    await page.screenshot({ path: join(shots, 'picker-voron.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(shots, 'picker-voron-phone.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
  }

  // A reload loads the Voron at start, and keeps it selected.
  fetched = [];
  await page.reload();
  await ready();
  await page.waitForFunction((v) => document.querySelector('select[aria-label="Printer preset"]')?.value === v, VORON, { timeout: 60000 });
  console.log(`reload fetched ${fetched.join(', ')}`);
  if (!fetched.includes('engine/profiles/Voron.json')) fail('the reload did not load Voron');

  // A printer the Device tab can't reach (not Klipper or Prusa) says to download the G-code.
  await page.getByRole('button', { name: 'Manage' }).click();
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('searchbox', { name: 'Search printers' }).fill('anker m5c');
  await wizard.locator('.wizard-models li').first().locator('.chips button').first().click();
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('button', { name: 'Next' }).click({ timeout: 60000 });
  await wizard.getByRole('button', { name: 'Finish' }).click();
  const anker = (await picker.locator('option').allInnerTexts()).find((o) => /^Anker M5C/.test(o));
  if (!anker) fail('no Anker M5C in the picker');
  else {
    if (anker.includes('direct print')) fail(`"${anker}" says direct print`);
    await picker.selectOption(anker.trim());
    await page.getByText("No direct print for this printer").waitFor({ timeout: 30000 });
    if (shots) await page.screenshot({ path: join(shots, 'picker-anker.png') });
  }

  // OrcaSlicer ships its own catalog.
  fetched = [];
  await page.goto(`${url}?engine=orca`);
  await ready();
  if (fetched.some((f) => !f.startsWith('engine-orca/'))) fail(`OrcaSlicer fetched ${fetched.join(', ')}`);
  await page.getByRole('button', { name: 'Manage' }).click();
  await wizard.getByRole('button', { name: 'Next' }).click();
  const orcaBrands = await wizard.locator('.wizard-brands summary').count();
  console.log(`OrcaSlicer wizard lists ${orcaBrands} brands, fetched ${fetched.join(', ')}`);
  if (orcaBrands < 50) fail(`only ${orcaBrands} brands with OrcaSlicer`);
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 3000)}`);
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
if (!process.exitCode) console.log('BRANDS OK');
process.exit(process.exitCode ?? 0);
