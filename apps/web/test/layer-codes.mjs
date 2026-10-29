#!/usr/bin/env node
// Browser end to end for desktop's layer slider items in the Preview: on a
// computer, + on the layer slider adds a pause at the shown layer (a marker on
// the slider, the slice marked out of date until sliced again, then the pause
// is in the G-code), custom G-code is added and edited, and a marker jumps to
// its layer; on a phone the same menu opens by a tap, above the slider, with
// the model still in view, and a long press on the slider opens it too.
//
//   node test/layer-codes.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = resolve(web, process.env.LAYER_MODEL ?? '../../fixtures/tetrahedron.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4178;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`LAYER CODES FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function sliced(viewport, mobile, filaments = 1) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: 'dark', acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  for (let n = 1; n < filaments; n++) await page.getByRole('button', { name: 'Add filament' }).click();
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('layer-label').waitFor({ timeout: 300000 });
  return page;
}

/** Puts the layer slider on layer n (1-based). */
async function toLayer(page, n) {
  await page.getByRole('slider', { name: 'Layer' }).evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, n - 1);
  await page.waitForFunction((n) => document.querySelector('[data-testid=layer-label]')?.textContent?.startsWith(`${n} /`), n);
}

const gcodeOf = async (page) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
  return readFileSync(await download.path(), 'utf8');
};
const label = (page) => page.getByTestId('layer-label').innerText();

try {
  // Two filaments, the model printing with the first: Change filament is offered.
  const page = await sliced({ width: 1280, height: 800 }, false, 2);
  const menu = page.getByRole('menu', { name: 'Layer menu' });
  const add = page.getByRole('button', { name: /at this layer/ });
  const total = Number((await label(page)).split('/')[1].split('·')[0]);
  if (!(total > 20)) throw new Error(`only ${total} layers`);
  const mid = Math.round(total / 2);
  // Far enough up for its marker to sit clear of the pause's.
  const far = mid + Math.round(total / 4);

  // Add a pause at the middle layer.
  await toLayer(page, mid);
  const z = (await label(page)).split('·')[1].trim().replace(' mm', '');
  await add.click();
  await menu.waitFor({ timeout: 5000 });
  for (const name of ['Add pause', 'Add custom G-code…', 'Jump to layer…']) await menu.getByRole('menuitem', { name, exact: true }).waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'layer-menu-desktop.png') });
  await menu.getByRole('menuitem', { name: 'Add pause' }).click();
  await page.getByRole('button', { name: `Layer ${mid}: Pause` }).waitFor({ timeout: 10000 });
  await page.getByTestId('layer-codes-outdated').waitFor({ timeout: 5000 });
  if ((await add.getAttribute('aria-label')) !== 'Change what happens at this layer') fail('the button does not offer to change the pause');
  console.log(`pause added at layer ${mid} (${z} mm), slice marked out of date`);

  // Custom G-code a few layers up, then edited.
  await toLayer(page, far);
  await add.click();
  await menu.getByRole('menuitem', { name: 'Add custom G-code…' }).click();
  await menu.getByRole('textbox', { name: 'Custom G-code' }).fill('M117 FIRST');
  await menu.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: `Layer ${far}: Custom G-code: M117 FIRST` }).waitFor({ timeout: 10000 });
  await add.click();
  await menu.getByRole('menuitem', { name: 'Edit custom G-code…' }).click();
  const box = menu.getByRole('textbox', { name: 'Custom G-code' });
  if ((await box.inputValue()) !== 'M117 FIRST') fail('editing does not start from the G-code there');
  await box.fill('M117 LAYER_MARK');
  await menu.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: `Layer ${far}: Custom G-code: M117 LAYER_MARK` }).waitFor({ timeout: 10000 });
  console.log('custom G-code added and edited');

  // A filament change near the top.
  const top = total - 3;
  await toLayer(page, top);
  const topZ = Number((await label(page)).split('·')[1].trim().replace(' mm', ''));
  await add.click();
  await menu.locator('[data-filament="2"]').click();
  await page.getByRole('button', { name: `Layer ${top}: Change to filament 2` }).waitFor({ timeout: 10000 });
  if (shots) await page.screenshot({ path: join(shots, 'layer-markers-desktop.png') });
  console.log('filament change added');

  // A marker takes the slider to its layer.
  await toLayer(page, 3);
  await page.getByRole('button', { name: `Layer ${mid}: Pause` }).click();
  if (!(await label(page)).startsWith(`${mid} /`)) fail(`the pause marker went to ${await label(page)}`);

  // Slice again: the G-code has both, and the warning goes.
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('layer-label').waitFor({ timeout: 300000 });
  if (await page.getByTestId('layer-codes-outdated').count()) fail('still marked out of date after slicing');
  const gcode = await gcodeOf(page);
  const layerAt = (z) => gcode.indexOf(`;Z:${z}\n`);
  const pauseAt = gcode.indexOf(';PAUSE_PRINT');
  if (pauseAt < 0) fail('no pause in the G-code');
  else if (!(pauseAt > layerAt(Number(z)))) fail(`the pause is not at the layer at ${z} mm`);
  if ((gcode.match(/^M117 LAYER_MARK$/gm) ?? []).length !== 1) fail('the custom G-code is not in the G-code once');
  const fromTop = gcode.slice(layerAt(topZ));
  if (layerAt(topZ) < 0 || fromTop.search(/^T1$/m) < 0) fail(`no change to filament 2 at ${topZ} mm in the G-code`);
  if (fromTop.search(/^T0$/m) >= 0) fail('filament 1 prints after the change');
  await page.getByRole('button', { name: `Layer ${mid}: Pause` }).waitFor();
  console.log('sliced again: the pause, the custom G-code and the filament change are in the G-code');

  // Deleting the pause.
  await toLayer(page, mid);
  await add.click();
  await menu.getByRole('menuitem', { name: 'Delete pause' }).click();
  await page.getByRole('button', { name: `Layer ${mid}: Pause` }).waitFor({ state: 'detached', timeout: 10000 });
  await page.close();

  // A phone: the + button opens the menu above the slider, the model stays in view.
  const phone = await sliced({ width: 390, height: 844 }, true);
  const phoneMenu = phone.getByRole('menu', { name: 'Layer menu' });
  const phoneTotal = Number((await label(phone)).split('/')[1].split('·')[0]);
  await toLayer(phone, Math.round(phoneTotal * 0.6));
  await phone.getByRole('button', { name: /at this layer/ }).tap();
  await phoneMenu.waitFor({ timeout: 5000 });
  const [m, slider, view] = await Promise.all([phoneMenu.boundingBox(), phone.locator('.layer-slider').boundingBox(), phone.getByTestId('gcode-preview').boundingBox()]);
  if (m.y + m.height > slider.y + 1) fail('the menu covers the layer slider');
  if (m.height > view.height * 0.5) fail(`the menu covers ${Math.round((m.height / view.height) * 100)}% of the preview`);
  if (m.x < 0 || m.x + m.width > 390) fail('the menu runs off the screen');
  if (shots) await phone.screenshot({ path: join(shots, 'layer-menu-phone.png') });
  await phoneMenu.getByRole('menuitem', { name: 'Add pause' }).tap();
  await phone.getByRole('button', { name: /: Pause$/ }).waitFor({ timeout: 10000 });
  if (shots) await phone.screenshot({ path: join(shots, 'layer-markers-phone.png') });
  if ((await phone.evaluate(() => document.scrollingElement.scrollHeight)) > 844) fail('the phone page scrolls');
  console.log('phone: + opens the layer menu above the slider and adds a pause');

  // A long press on the slider (the browser's contextmenu) opens it too, like desktop's right click.
  await phone.locator('.layer-slider').evaluate((el) => el.querySelector('input').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  await phoneMenu.waitFor({ timeout: 5000 }).catch(() => fail('a long press on the slider opened no menu'));
  console.log('phone: a long press on the slider opens the layer menu');
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
