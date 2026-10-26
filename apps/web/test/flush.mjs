#!/usr/bin/env node
// Browser end to end for flushing volumes, in both engines: on a single-nozzle
// multi-material printer (a Bambu Lab A1 mini with its AMS lite) a two-colour
// project gets the Flushing volumes window, its amounts are worked out from
// the colours (dark to light purges more than light to dark), the G-code
// carries exactly those amounts, and raising the multiplier makes the print use
// more filament. The U1 (a head per filament) gets no window and says why.
//
//   node test/flush.mjs [screenshot-dir]
//
// Needs `npm run build` first, with both engines copied (public/engine and
// public/engine-orca).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright';
import { pick } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/calib-cube-10-dual-colour-merged.3mf');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4183;
const PRINTER = 'Bambu Lab A1 mini 0.4 nozzle';

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
  console.error(`FLUSH FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const ready = () => page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const flushButton = page.getByTestId('flush-volumes');
  const dialog = page.getByRole('dialog', { name: 'Flushing volumes' });
  const cell = async (from, to) => Number(await dialog.getByTestId(`flush-${from}-${to}`).getAttribute('data-value'));

  await page.goto(url);
  await ready();

  // The U1: two filaments, no window, and the process settings say why.
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Next' }).click();
  // Nothing is picked on a first visit: the U1 and the A1 mini.
  await wizard
    .locator('.wizard-models li', { has: page.locator('.wizard-model', { hasText: /^Snapmaker U1/ }) })
    .getByRole('button', { name: '0.4', exact: true })
    .click();
  await wizard.getByRole('searchbox', { name: 'Search printers' }).fill('a1 mini');
  await wizard.locator('.wizard-models li').first().getByRole('button', { name: '0.4', exact: true }).click();
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByText('Pick the filaments you use').waitFor({ timeout: 60000 });
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Add filament' }).click();
  await page.getByLabel('Filament 2 colour').waitFor();
  if (await flushButton.count()) fail('the U1 offers a Flushing volumes window');
  await page.getByRole('tab', { name: 'Multimaterial' }).first().click();
  await page.getByTestId('no-flush-hint').waitFor({ timeout: 10000 });
  console.log(`U1: ${await page.getByTestId('no-flush-hint').innerText()}`);
  await page.getByTestId('no-flush-hint').scrollIntoViewIfNeeded();
  if (shots) await page.screenshot({ path: join(shots, 'u1-no-flush.png') });

  for (const engine of ['snapmaker', 'orca']) {
    if (engine === 'orca') {
      await page.goto(`${url}?engine=orca`);
      await ready();
    }
    await pick(page, 'Printer preset', PRINTER);
    // The project: a Bambu Studio 3MF for this printer, dark red and black.
    await page.getByTestId('model-input').setInputFiles(model);
    await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
    // Bambu Studio 2.5's own machine G-code uses variables these engines don't have: back to the presets'.
    const reset = page.getByRole('button', { name: 'Reset all' });
    if (await reset.count()) await reset.first().click();
    await flushButton.waitFor({ timeout: 30000 });
    await flushButton.click();
    await dialog.waitFor();
    console.log(`${engine}: the project's own amounts ${await cell(0, 1)} / ${await cell(1, 0)} mm³`);
    // Desktop's Re-calculate: from the colours.
    await dialog.getByTestId('flush-recalculate').click();
    await dialog.getByTestId('flush-multiplier').fill('1');
    await dialog.getByTestId('flush-multiplier').press('Enter');
    const redToBlack = await cell(0, 1);
    const blackToRed = await cell(1, 0);
    console.log(`${engine}: from the colours, red -> black ${redToBlack} mm³, black -> red ${blackToRed} mm³`);
    if (!(blackToRed > redToBlack)) fail(`${engine}: black to red (${blackToRed}) should purge more than red to black (${redToBlack})`);
    if (redToBlack === 280 || blackToRed === 280) fail(`${engine}: still the 280 mm³ default`);
    if (shots) {
      await page.screenshot({ path: join(shots, `${engine}-window-desktop.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(shots, `${engine}-window-phone.png`) });
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await dialog.getByRole('button', { name: 'Done' }).click();

    // The G-code purges those amounts.
    const slice = async () => {
      await page.getByRole('button', { name: /^Slice plate/ }).click();
      await page.getByTestId('slice-stats').waitFor({ timeout: 300000 });
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
      // A Bambu printer gets its plate in a .gcode.3mf, like desktop: read the plate's G-code from it.
      const bytes = readFileSync(await download.path());
      const zip = bytes[0] === 0x50 && bytes[1] === 0x4b ? unzipSync(new Uint8Array(bytes), { filter: (f) => /^Metadata\/plate_\d+\.gcode$/.test(f.name) }) : null;
      const gcode = zip ? Object.values(zip).map((f) => strFromU8(f)).join('\n') : bytes.toString('utf8');
      const value = (key) => gcode.match(new RegExp(`^; ${key} = (.*)$`, 'm'))?.[1]?.trim();
      const grams = parseFloat(value('total filament used \\[g\\]') ?? value('filament used \\[g\\]')?.split(',').reduce((a, b) => a + parseFloat(b), 0) ?? 'NaN');
      return { matrix: value('flush_volumes_matrix'), multiplier: value('flush_multiplier'), grams, changes: (gcode.match(/^M620 S\d/gm) ?? []).length };
    };
    const one = await slice();
    console.log(`${engine}: G-code flush_volumes_matrix = ${one.matrix}, multiplier ${one.multiplier}, ${one.grams} g, ${one.changes} filament changes`);
    const m = (one.matrix ?? '').split(',').map(Number);
    if (m[1] !== redToBlack || m[2] !== blackToRed) fail(`${engine}: the G-code's table ${one.matrix} is not the window's ${redToBlack}, ${blackToRed}`);
    if (!(one.changes > 0)) fail(`${engine}: no filament change in the G-code`);

    // Twice the multiplier purges more.
    await page.getByRole('tab', { name: 'Prepare' }).click().catch(() => {});
    await flushButton.click();
    await dialog.getByTestId('flush-multiplier').fill('2');
    await dialog.getByTestId('flush-multiplier').press('Enter');
    if ((await cell(0, 1)) !== redToBlack * 2) fail(`${engine}: with multiplier 2 the window shows ${await cell(0, 1)}, not ${redToBlack * 2}`);
    await dialog.getByRole('button', { name: 'Done' }).click();
    const two = await slice();
    console.log(`${engine}: multiplier ${two.multiplier}: ${two.grams} g`);
    if (!(two.grams > one.grams)) fail(`${engine}: multiplier 2 used ${two.grams} g, not more than ${one.grams} g`);
    await page.getByRole('tab', { name: 'Prepare' }).click().catch(() => {});
  }
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
if (!process.exitCode) console.log('FLUSH OK');
process.exit(process.exitCode ?? 0);
