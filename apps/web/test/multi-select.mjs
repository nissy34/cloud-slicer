#!/usr/bin/env node
// Browser end to end for choosing several models at once, like desktop Orca:
// Ctrl+click and Shift+click in the object list, Ctrl+A, Esc, a Shift+drag
// rectangle in the 3D view (Alt+drag takes out), the move tool's fields and
// the arrow keys moving the whole group, the group's right-click menu (Copy
// and Ctrl+V paste as a block, Arrange selection, Delete), and on a phone
// "Choose several" from the long-press menu with taps and a drag rectangle.
//
//   node test/multi-select.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4183;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`MULTI-SELECT FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  return page;
}

// ASCII STL cubes, size mm on a side.
const cubeStl = (size) => {
  const v = (x, y, z) => [x, y, z].map((c) => c * size);
  const quads = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  ];
  const tri = (a, b, c) => `facet normal 0 0 0\nouter loop\n${[a, b, c].map((p) => `vertex ${v(...p).join(' ')}`).join('\n')}\nendloop\nendfacet\n`;
  return `solid cube\n${quads.map(([a, b, c, d]) => tri(a, b, c) + tri(a, c, d)).join('')}endsolid cube\n`;
};
const dir = mkdtempSync(join(tmpdir(), 'multi-'));
const cubes = ['red', 'green', 'blue'].map((name, k) => {
  const file = join(dir, `${name}.stl`);
  writeFileSync(file, cubeStl(20 + k * 5));
  return file;
});

const rows = (page) => page.locator('ul.objects > li.object');
const waitObjects = (page, n) => page.waitForFunction((n) => document.querySelectorAll('ul.objects > li.object').length === n, n, { timeout: 60000 });
const chosenCount = (page) => page.locator('ul.objects > li.object[aria-selected="true"]').count();
const waitChosen = (page, n, what) =>
  page
    .waitForFunction((n) => document.querySelectorAll('ul.objects > li.object[aria-selected="true"]').length === n, n, { timeout: 30000 })
    .catch(async () => fail(`${what}: ${n} chosen expected, ${await chosenCount(page)} are`));
const bar = (page) => page.getByRole('toolbar', { name: 'Chosen models' });
// Each object's Position X from the move tool, picking them one at a time.
async function positions(page) {
  const out = [];
  const n = await rows(page).count();
  for (let k = 0; k < n; k++) {
    await rows(page).nth(k).locator('.object-name').click();
    await page.keyboard.press('m');
    const box = page.getByLabel('Position X', { exact: true });
    await box.waitFor();
    out.push(Number(await box.getAttribute('data-value')));
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');
  return out;
}
const settled = (page) => page.waitForTimeout(800);

try {
  const page = await open({ width: 1280, height: 800 }, false);
  await page.getByTestId('model-input').setInputFiles(cubes);
  await waitObjects(page, 3);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  // The object list: a click picks one, Ctrl+click adds, Shift+click takes the run.
  await rows(page).nth(0).locator('.object-name').click();
  await rows(page).nth(2).locator('.object-name').click({ modifiers: ['Control'] });
  await waitChosen(page, 2, 'Ctrl+click in the list');
  await page.getByText('2 objects chosen').waitFor();
  await bar(page).getByText('2 chosen').waitFor();
  await rows(page).nth(2).locator('.object-name').click({ modifiers: ['Control'] });
  await waitChosen(page, 1, 'Ctrl+click on a chosen one takes it out');
  await rows(page).nth(2).locator('.object-name').click({ modifiers: ['Shift'] });
  await waitChosen(page, 3, 'Shift+click takes the run');

  // Esc lets go; Ctrl+A takes every model on the plate.
  await page.keyboard.press('Escape');
  await waitChosen(page, 0, 'Esc');
  if (await bar(page).isVisible()) fail('the chosen bar should go with Esc');
  await page.locator('canvas').first().click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('Control+a');
  await waitChosen(page, 3, 'Ctrl+A');
  await page.keyboard.press('Escape');
  await waitChosen(page, 0, 'Esc');

  // A Shift+drag rectangle over the whole plate chooses all three; Alt+drag takes them out.
  const canvas = await page.locator('canvas').first().boundingBox();
  let rectShot = false;
  const drag = async (mod, from, to) => {
    await page.keyboard.down(mod);
    await page.mouse.move(canvas.x + from[0], canvas.y + from[1]);
    await page.mouse.down();
    await page.mouse.move(canvas.x + (from[0] + to[0]) / 2, canvas.y + (from[1] + to[1]) / 2, { steps: 4 });
    await page.mouse.move(canvas.x + to[0], canvas.y + to[1], { steps: 4 });
    if (shots && mod === 'Shift' && !rectShot) {
      rectShot = true;
      await page.screenshot({ path: join(shots, 'rectangle-desktop.png') });
    }
    await page.mouse.up();
    await page.keyboard.up(mod);
  };
  await drag('Shift', [20, 60], [canvas.width - 80, canvas.height - 20]);
  await waitChosen(page, 3, 'Shift+drag over the plate');
  if (shots) await page.screenshot({ path: join(shots, 'chosen-desktop.png') });
  await drag('Alt', [20, 60], [canvas.width - 80, canvas.height - 20]);
  await waitChosen(page, 0, 'Alt+drag over the plate');
  // A small rectangle on empty space chooses nothing.
  await drag('Shift', [10, canvas.height - 60], [40, canvas.height - 30]);
  await waitChosen(page, 0, 'a rectangle on empty space');

  // In the 3D view (labels mark where the models are): a click picks one,
  // Ctrl+click adds, Shift+click adds or takes out; a rectangle over two takes those two.
  await page.keyboard.press('Control+e');
  await page.locator('.object-label').nth(2).waitFor();
  const at = [];
  for (let k = 0; k < 3; k++) {
    const b = await page.locator('.object-label').nth(k).boundingBox();
    at.push([b.x + b.width / 2, b.y + b.height / 2 + 6]);
  }
  await page.keyboard.press('Control+e');
  await page.mouse.click(...at[0]);
  await waitChosen(page, 1, 'a click on a model');
  await page.keyboard.down('Control');
  await page.mouse.click(...at[1]);
  await page.keyboard.up('Control');
  await waitChosen(page, 2, 'Ctrl+click on a model');
  await page.keyboard.down('Shift');
  await page.mouse.click(...at[2]);
  await waitChosen(page, 3, 'Shift+click on a model');
  await page.mouse.click(...at[2]);
  await page.keyboard.up('Shift');
  await waitChosen(page, 2, 'Shift+click on a chosen model');
  await page.keyboard.press('Escape');
  await waitChosen(page, 0, 'Esc');
  const [l, r] = [Math.min(at[0][0], at[1][0]), Math.max(at[0][0], at[1][0])];
  await drag('Shift', [l - 25 - canvas.x, at[0][1] - 30 - canvas.y], [r + 5 - canvas.x, at[0][1] + 30 - canvas.y]);
  await waitChosen(page, 2, 'a rectangle over two of them');
  await page.keyboard.press('r');
  await page.getByRole('region', { name: 'Rotate' }).getByText('both chosen objects').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'rotate-group-desktop.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Move: the fields and the arrow keys move all of them by as much.
  const before = await positions(page);
  await page.keyboard.press('Control+a');
  await waitChosen(page, 3, 'Ctrl+A again');
  await page.keyboard.press('m');
  const card = page.getByRole('region', { name: 'Move' });
  await card.getByText('all 3 chosen objects').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'move-group-desktop.png') });
  const x = page.getByLabel('Position X', { exact: true });
  const cx = Number(await x.getAttribute('data-value'));
  await x.fill(String(cx - 15));
  await x.press('Enter');
  await settled(page);
  await card.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('ArrowRight');
  await settled(page);
  const after = await positions(page);
  after.forEach((v, k) => Math.abs(v - (before[k] - 5)) > 0.05 && fail(`object ${k + 1} should be 5 mm left (−15 then +10): ${before[k]} → ${v}`));

  // The group's menu: right-click on a chosen model (labels mark where they are).
  await page.keyboard.press('Control+a');
  await waitChosen(page, 3, 'Ctrl+A for the menu');
  await page.keyboard.press('Control+e');
  const label = await page.locator('.object-label').first().boundingBox();
  await page.keyboard.press('Control+e');
  await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2 + 6, { button: 'right' });
  const menu = page.getByRole('menu', { name: '3 objects menu' });
  await menu.waitFor({ timeout: 10000 });
  if (shots) await page.screenshot({ path: join(shots, 'group-menu-desktop.png') });

  // Copy, then Ctrl+V pastes all three as new objects, chosen together.
  await menu.getByRole('menuitem', { name: 'Copy' }).click();
  await page.keyboard.press('Control+v');
  await waitObjects(page, 6);
  await waitChosen(page, 3, 'what was pasted');
  // Arrange selection puts them each on a free spot; Delete takes the group away in one go.
  await bar(page).getByRole('button', { name: 'What to do with them' }).click();
  await page.getByRole('menu', { name: '3 objects menu' }).getByRole('menuitem', { name: 'Arrange selection' }).click();
  await settled(page);
  await page.keyboard.press('Delete');
  await waitObjects(page, 3);
  await page.getByRole('button', { name: 'Undo' }).click();
  await waitObjects(page, 6);
  await page.close();

  // Phone: Choose several from the long-press menu, taps, a drag rectangle, the bar.
  const phone = await open({ width: 390, height: 844 }, true);
  await phone.getByTestId('model-input').setInputFiles(cubes);
  await waitObjects(phone, 3);
  await phone.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await phone.locator('ul.objects .object-name').first().tap();
  await phone.getByRole('button', { name: /^More for / }).first().tap();
  await phone.getByRole('menuitem', { name: 'Choose several' }).tap();
  await bar(phone).getByText('1 chosen').waitFor();
  await bar(phone).getByRole('button', { name: 'Select all' }).tap();
  await bar(phone).getByText('3 chosen').waitFor();
  if (shots) await phone.screenshot({ path: join(shots, 'choosing-phone.png') });
  const box = await phone.locator('canvas').first().boundingBox();
  // A one-finger drag from an empty corner draws a rectangle while choosing; over nothing, nothing changes.
  const cdp = await phone.context().newCDPSession(phone);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + x, y: box.y + y }] });
  await touch('touchStart', 8, box.height - 40);
  await touch('touchMove', 20, box.height - 30);
  await touch('touchMove', 30, box.height - 20);
  await touch('touchEnd');
  await bar(phone).getByText('3 chosen').waitFor();
  await bar(phone).getByRole('button', { name: 'Done' }).tap();
  await bar(phone).getByText('3 chosen').waitFor();
  if (await bar(phone).getByRole('button', { name: 'Done' }).isVisible()) fail('Done should end choosing');
  const pageScroll = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (pageScroll) fail('the page scrolls sideways on a phone');
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
if (!process.exitCode) console.log('multi-select: ok');
