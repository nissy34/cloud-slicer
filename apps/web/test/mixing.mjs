#!/usr/bin/env node
// Browser end to end for colour mixing: make a mix of two filaments, give it to
// the model, slice, and check the G-code alternates between both tools.
//
//   node test/mixing.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pickerOf } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
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

const fail = (msg) => {
  console.error(`MIXING FAIL: ${msg}`);
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
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();

  // Two filaments, blue and yellow.
  while ((await page.getByLabel(/^Filament \d+ colour$/).count()) < 3) await page.getByLabel('Add filament').click();
  // Colour inputs need a real input event for React to see the change.
  const setColour = (label, c) =>
    page.getByLabel(label).evaluate((el, c) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, c);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, c);
  await setColour('Filament 1 colour', '#0000ff');
  await page.waitForTimeout(1000);
  await setColour('Filament 2 colour', '#ffff00');
  await page.waitForTimeout(1000);
  await setColour('Filament 3 colour', '#ff0000');
  await page.waitForTimeout(1000);
  const total = await page.getByLabel(/^Filament \d+ colour$/).count();
  const mixId = total + 1;

  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  // Ratio mix, 50/50 by default.
  await page.getByLabel('Add mix').click();
  const dialog = page.getByRole('dialog', { name: /mix/i });
  await dialog.waitFor();
  await page.waitForTimeout(500);
  await shot(page, 'dialog-ratio');
  for (const mode of ['Cycle', 'Match', 'Gradient']) {
    await dialog.getByRole('radio', { name: mode }).click();
    if (mode === 'Match') {
      await dialog.getByLabel('Target colour hex').fill('#40A040');
      await dialog.getByLabel('Target colour hex').press('Enter');
      await page.waitForTimeout(1500);
    } else await page.waitForTimeout(300);
    await shot(page, `dialog-${mode.toLowerCase()}`);
  }
  await dialog.getByRole('radio', { name: 'Ratio' }).click();

  // Mixing recommendations (desktop's swatch grid): Ratio offers each pair at 50:50.
  const suggestions = dialog.getByRole('region', { name: 'Mixing recommendations' });
  await suggestions.waitFor({ timeout: 10000 });
  const pairs = (total * (total - 1)) / 2;
  const shown = await suggestions.getByRole('button').count();
  if (shown !== pairs) fail(`Ratio should recommend ${pairs} pairs, shows ${shown}`);
  await suggestions.getByRole('button', { name: 'Use F1(50%) + F2(50%)' }).click();
  await page.waitForTimeout(300);
  if (!(await dialog.getByText('F1 50% + F2 50%').count())) fail('tapping a recommendation should set F1 50% + F2 50%');

  // Gradient: each pair both ways, drawn as a fade.
  await dialog.getByRole('radio', { name: 'Gradient' }).click();
  await page.waitForTimeout(800);
  if ((await suggestions.getByRole('button').count()) !== pairs * 2) fail('Gradient should recommend each pair both ways');
  await suggestions.getByRole('button', { name: 'Use F2 → F1' }).click();
  await page.waitForTimeout(300);
  if (!(await dialog.getByText('F2 → F1').count())) fail('tapping F2 → F1 should make that gradient');
  await shot(page, 'gradient-recommendations');

  // Three filaments in Ratio: the triangle with the three shares under it.
  await dialog.getByRole('radio', { name: 'Ratio' }).click();
  if (total >= 3) {
    await dialog.getByRole('button', { name: '+ Add a third filament' }).click();
    const tri = dialog.getByTestId('mix-triangle');
    await tri.waitFor();
    const tb = await tri.boundingBox();
    // Drag to the top corner: filament 1 takes the most (90% at most).
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const label = (await dialog.locator('.mix-preview strong').innerText()).trim();
    // The top corner is the first row's filament.
    const first = Number(/^F\d+ (\d+)%/.exec(label)?.[1]);
    if (!(first >= 70 && first <= 90)) fail(`dragging to the top corner should give the first filament 70-90%, got "${label}"`);
    const triples = await suggestions.getByRole('button').count();
    const n = Math.min(total, 6);
    const expected = ((n * (n - 1) * (n - 2)) / 6) * 4;
    if (triples !== expected) fail(`three-filament Ratio should recommend ${expected} triples, shows ${triples}`);
    await shot(page, 'ratio-triangle');
    await dialog.getByRole('button', { name: 'Remove this filament from the mix' }).first().click();
    await dialog.getByRole('combobox').first().waitFor().catch(() => {});
    // Back to F1 + F2 50:50 for the slice below.
    await suggestions.getByRole('button', { name: 'Use F1(50%) + F2(50%)' }).click();
  } else console.log('fewer than 3 filaments: triangle not checked');
  await dialog.getByRole('button', { name: /^(Add|Save)/ }).click();
  await page.getByLabel(`Delete mix ${mixId}`).waitFor();
  console.log(`mix added as filament ${mixId}`);

  // The model prints with the mix.
  const select = pickerOf(page, 'Filament for 3DBenchy.stl');
  await select.selectOption(String(mixId));
  await page.waitForTimeout(500);
  await shot(page, 'prepare');

  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
  await page.getByTestId('layer-label').waitFor({ timeout: 120000 });
  await pickerOf(page, 'Colour by').selectOption('filament');
  await page.waitForTimeout(1000);
  await shot(page, 'preview');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
  const gcode = readFileSync(await download.path(), 'utf8');
  const tools = (t) => (gcode.match(new RegExp(`^T${t}\\b`, 'gm')) ?? []).length;
  console.log(`tool changes: T0 ${tools(0)}, T1 ${tools(1)}, T2 ${tools(2)}`);
  if (!tools(0) || !tools(1)) fail('the mix should print with both T0 and T1');
  if (tools(2)) fail('the mix should not use T2');

  // Phone: the panel and the dialog fit.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.getByLabel(`Edit mix ${mixId}`).scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, 'phone-panel');
  await page.getByLabel(`Edit mix ${mixId}`).click();
  await page.waitForTimeout(500);
  await shot(page, 'phone-dialog');
  const phoneDialog = page.getByRole('dialog', { name: /mix/i });
  await phoneDialog.getByRole('button', { name: '+ Add a third filament' }).click();
  await page.waitForTimeout(800);
  await phoneDialog.getByTestId('mix-triangle').scrollIntoViewIfNeeded();
  await shot(page, 'phone-triangle');
  await phoneDialog.getByRole('region', { name: 'Mixing recommendations' }).scrollIntoViewIfNeeded();
  await shot(page, 'phone-recommendations');
  const box = await page.getByRole('dialog', { name: /mix/i }).boundingBox();
  if (!box || box.width > 390) fail(`dialog is ${box?.width}px wide on a 390px phone`);
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 2000)}`);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('MIXING OK');
process.exit();
