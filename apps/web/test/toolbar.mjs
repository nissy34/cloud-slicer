#!/usr/bin/env node
// Browser end to end for the object toolbar over the 3D view: adding a model
// keeps the one already there, lay on face turns the object, and the toolbar
// fits a phone.
//
//   node test/toolbar.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(web, '../../fixtures');
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
  console.error(`TOOLBAR FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  return page;
}

const objectRows = (page) => page.locator('ul.objects > li.object');
// The rotation the Lay on face panel shows; it is gone while nothing is selected, so don't wait long.
const rotation = (page, timeout = 1000) => page.getByLabel('Current rotation').innerText({ timeout });

try {
  const page = await open({ width: 1280, height: 800 }, false);
  await page.getByTestId('model-input').setInputFiles(join(fixtures, '3DBenchy.stl'));
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  const toolbar = page.getByRole('toolbar', { name: 'Object tools' });
  await toolbar.waitFor();
  for (const name of ['Undo', 'Redo', 'Add models', 'Add plate', 'Auto orient', 'Arrange all objects', 'Split to objects', 'Split to parts', 'Move', 'Rotate', 'Scale', 'Lay on face', 'Cut', 'Support painting', 'Seam painting', 'Colour painting'])
    await toolbar.getByRole('button', { name }).waitFor();
  console.log('toolbar shows desktop Orca\'s tools');

  // Add a second model: it joins the first instead of replacing it.
  await page.getByTestId('model-input').setInputFiles(join(fixtures, 'tetrahedron.stl'));
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object').length === 2, null, { timeout: 60000 });
  console.log('adding a model keeps the one on the plate');

  await objectRows(page).first().locator('.object-name').click();
  const box = await page.getByTestId('viewport').boundingBox();

  // Rotate: the gizmo panel opens.
  await toolbar.getByRole('button', { name: 'Rotate' }).click();
  const rotate = page.getByRole('region', { name: 'Rotate' });
  await rotate.waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'toolbar-desktop-rotate.png') });
  // Exact values go in the gizmo's own panel, like desktop.
  await rotate.getByLabel('Rotation Z').fill('90');
  await rotate.getByLabel('Rotation Z').press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="Rotation Z"]')?.value === '90', null, { timeout: 30000 });
  await rotate.getByLabel('Rotation Z').fill('0');
  await rotate.getByLabel('Rotation Z').press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="Rotation Z"]')?.value === '0', null, { timeout: 30000 });
  console.log('rotation typed in the Rotate panel');
  // The panel opens under the toolbar, like desktop's gizmo panels.
  const barBottom = (await toolbar.boundingBox()).y + (await toolbar.boundingBox()).height;
  if ((await rotate.boundingBox()).y < barBottom) fail('the Rotate panel should open under the toolbar');

  // Undo and redo with the keyboard, like desktop.
  await page.locator('body').press('Control+z');
  await page.waitForFunction(() => document.querySelector('[aria-label="Rotation Z"]')?.value === '90', null, { timeout: 30000 });
  await page.locator('body').press('Control+y');
  await page.waitForFunction(() => document.querySelector('[aria-label="Rotation Z"]')?.value === '0', null, { timeout: 30000 });
  console.log('Ctrl+Z / Ctrl+Y undo and redo the rotation');

  // Cut shows its plane; the height follows the panel.
  await toolbar.getByRole('button', { name: 'Cut' }).click();
  const cut = page.getByRole('region', { name: 'Cut' });
  await cut.waitFor();
  await cut.getByLabel('Cut height in mm').fill('12');
  await cut.getByLabel('Cut height in mm').press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="Cut height"]')?.value === '12', null, { timeout: 10000 });
  await page.waitForTimeout(300);
  if (shots) await page.screenshot({ path: join(shots, 'toolbar-desktop-cut.png') });
  console.log('cut plane follows the height');

  // Lay on face: click the highlighted faces over the boat until it turns.
  await toolbar.getByRole('button', { name: 'Lay on face' }).click();
  await page.getByRole('region', { name: 'Lay on face' }).waitFor();
  const start = await rotation(page, 10000);
  // Points over the view, nearest the middle (where the boat is) first. A
  // click that misses the object deselects it, like desktop: pick it again.
  const points = [];
  for (let y = 0.3; y <= 0.7; y += 0.04) for (let x = 0.35; x <= 0.65; x += 0.04) points.push([x, y]);
  points.sort((a, b) => Math.hypot(a[0] - 0.5, a[1] - 0.45) - Math.hypot(b[0] - 0.5, b[1] - 0.45));
  let turned = false;
  let laid = '';
  for (const [i, [x, y]] of points.entries()) {
    if (!(await page.getByRole('region', { name: 'Lay on face' }).isVisible())) {
      await objectRows(page).first().locator('.object-name').click();
      await toolbar.getByRole('button', { name: 'Lay on face' }).click();
    }
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(100);
    if (shots && i === 0) await page.screenshot({ path: join(shots, 'toolbar-desktop-flatten.png') });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);
    const now = await rotation(page, 3000).catch(() => start);
    turned = now !== start;
    if (turned) {
      laid = now;
      break;
    }
  }
  if (shots && turned) {
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, 'toolbar-desktop-laid.png') });
  }
  if (!turned) fail('lay on face did not turn the object');
  else {
    // It stays laid (and the object stays selected) once the click is done.
    const after = await rotation(page, 3000).catch(() => 'no object selected');
    if (after !== laid) fail(`after lay on face the panel showed ${laid}, then ${after}`);
    console.log(`lay on face: ${start} -> ${after}`);
  }
  await page.close();

  const phone = await open({ width: 390, height: 844 }, true);
  await phone.getByTestId('model-input').setInputFiles(join(fixtures, '3DBenchy.stl'));
  await phone.getByText('Ready to slice').waitFor({ timeout: 120000 });
  const bar = phone.getByRole('toolbar', { name: 'Object tools' });
  const barBox = await bar.boundingBox();
  if (barBox.x < 0 || barBox.x + barBox.width > 390) fail(`toolbar is off the screen: ${JSON.stringify(barBox)}`);
  const scrolls = await bar.evaluate((el) => el.scrollWidth > el.clientWidth);
  if (!scrolls) fail('on a phone the toolbar should scroll sideways');
  const pageScroll = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (pageScroll) fail('the page scrolls sideways on a phone');
  await bar.getByRole('button', { name: 'Rotate' }).tap();
  await phone.getByRole('region', { name: 'Rotate' }).waitFor();
  if (shots) await phone.screenshot({ path: join(shots, 'toolbar-phone-rotate.png') });
  await bar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await phone.waitForTimeout(200);
  const undoBox = await bar.getByRole('button', { name: 'Undo' }).boundingBox();
  if (!undoBox || undoBox.x < 0 || undoBox.x + undoBox.width > 390) fail(`Undo should stay on screen while the toolbar scrolls: ${JSON.stringify(undoBox)}`);
  await bar.getByRole('button', { name: 'Lay on face' }).tap();
  await phone.waitForTimeout(500);
  if (shots) await phone.screenshot({ path: join(shots, 'toolbar-phone-flatten.png') });
  console.log('phone: toolbar scrolls inside the screen');
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('TOOLBAR OK');
process.exit();
