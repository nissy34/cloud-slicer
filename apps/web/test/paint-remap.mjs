#!/usr/bin/env node
// Browser end to end for desktop's "Remap filaments" in colour painting: paint
// part of a model with a colour mix, slice (both of the mix's tools print), then
// remap the mix to filament 1 and slice again (only filament 1 prints). Also
// checks the pop-up of filaments, Cancel, and that the card fits a phone.
//
//   node test/paint-remap.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4174;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
const url = `http://localhost:${PORT}/`;
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`PAINT REMAP FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Close window' }).click();

  // Blue and yellow filaments, and a 50/50 mix of the two after the filaments.
  while ((await page.getByLabel(/^Filament \d+ colour$/).count()) < 2) await page.getByLabel('Add filament').click();
  const setColour = (label, c) =>
    page.getByLabel(label).evaluate((el, c) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, c);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, c);
  await setColour('Filament 1 colour', '#0000ff');
  await page.waitForTimeout(800);
  await setColour('Filament 2 colour', '#ffff00');
  await page.waitForTimeout(800);

  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await page.getByLabel('Add mix').click();
  const dialog = page.getByRole('dialog', { name: /mix/i });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: /^(Add|Save)/ }).click();
  const mix = (await page.getByLabel(/^Filament \d+ colour$/).count()) + 1;
  await page.getByLabel(`Delete mix ${mix}`).waitFor();

  // Paint the top of the boat with the mix: Height range from the middle up.
  await page.getByRole('button', { name: /^Colour painting/ }).click();
  const card = page.locator('.paint-panel');
  await card.waitFor();
  await card.getByRole('radio', { name: `Mix ${mix}` }).click();
  await card.getByRole('radio', { name: 'Height range' }).click();
  await card.getByRole('slider', { name: 'Height range' }).evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, el.max);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const canvas = page.locator('.viewport canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);

  const slice = async () => {
    await page.getByRole('button', { name: /^Slice plate/ }).click();
    await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
    const gcode = readFileSync(await download.path(), 'utf8');
    const tools = (t) => (gcode.match(new RegExp(`^T${t}\\b`, 'gm')) ?? []).length;
    await page.getByRole('tab', { name: 'Prepare' }).click();
    return [tools(0), tools(1)];
  };

  // The button, then desktop's row of squares: each shows the filament its paint becomes.
  const remapButton = card.getByRole('button', { name: 'Remap filaments' });
  if (!(await remapButton.isVisible())) fail('no Remap filaments button in colour painting');
  await shot(page, 'remap-button');
  await remapButton.click();
  const row = card.getByRole('group', { name: 'Remap filaments' });
  await row.waitFor();
  const squares = await row.locator('.paint-filaments > button').count();
  if (squares !== mix) fail(`the remap row should have ${mix} squares (the filaments and the mix), has ${squares}`);
  await shot(page, 'remap-row');
  // Tapping the mix's square opens the small pop-up of filaments.
  await row.getByRole('button', { name: `Filament ${mix} becomes ${mix}` }).click();
  const pop = page.getByRole('dialog', { name: `Filament ${mix} becomes` });
  await pop.waitFor();
  await page.waitForTimeout(400);
  if ((await pop.getByRole('radio').count()) !== mix) fail(`the pop-up should offer all ${mix} filaments`);
  await shot(page, 'remap-popup');
  await pop.getByRole('radio', { name: 'Filament 1' }).click();
  await row.getByRole('button', { name: `Filament ${mix} becomes 1` }).waitFor({ timeout: 3000 }).catch(() => fail('the mix square should show filament 1 after picking it'));
  await shot(page, 'remap-picked');
  // Cancel leaves the paint and closes the row.
  await card.getByRole('button', { name: 'Cancel' }).click();
  if (await row.count()) fail('Cancel should close the remap row');

  // Done painting; slice with the mix painted on.
  await card.getByRole('button', { name: 'Done' }).click();
  const before = await slice();
  console.log(`before remap: T0 ${before[0]}, T1 ${before[1]}`);
  if (!before[0] || !before[1]) fail('the painted mix should print with T0 and T1');

  // Remap the mix to filament 1: only filament 1 prints.
  await page.getByRole('button', { name: /^Colour painting/ }).click();
  await card.getByRole('button', { name: 'Remap filaments' }).click();
  await row.getByRole('button', { name: `Filament ${mix} becomes ${mix}` }).click();
  await page.getByRole('dialog', { name: `Filament ${mix} becomes` }).getByRole('radio', { name: 'Filament 1' }).click();
  await card.getByRole('button', { name: 'Remap', exact: true }).click();
  await page.getByText('Filament remapping finished.').waitFor({ timeout: 30000 });
  await shot(page, 'remapped');
  await card.getByRole('button', { name: 'Done' }).click();
  const after = await slice();
  console.log(`after remap: T0 ${after[0]}, T1 ${after[1]}`);
  if (after[1]) fail('after remapping the mix to filament 1, T1 should not print');

  // Undo brings the mix paint back.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1000);

  // Phone: the card with the row open fits.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Colour painting/ }).click();
  await card.getByRole('button', { name: 'Remap filaments' }).click();
  await row.waitFor();
  await row.scrollIntoViewIfNeeded();
  await shot(page, 'phone-remap-row');
  await row.getByRole('button', { name: 'Filament 2 becomes 2' }).click();
  await page.getByRole('dialog', { name: 'Filament 2 becomes' }).waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'phone-remap-popup');
  const rb = await row.boundingBox();
  if (!rb || rb.x < 0 || rb.x + rb.width > 390) fail(`the remap row runs off a 390px phone: ${JSON.stringify(rb)}`);
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 2000)}`);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('PAINT REMAP OK');
process.exit();
