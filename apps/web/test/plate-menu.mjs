#!/usr/bin/env node
// Browser end to end for desktop Orca's plate menu: a right click on the empty
// plate opens it (with the plate items greyed out while nothing is on it) and
// adds a primitive as a new object; a second primitive goes beside the first;
// a right click off the plate opens the add-only menu, which adds a handy
// model; the plate is renamed, Delete all empties it; and on a phone a long
// press opens the menu, without lifting the finger picking an item.
//
//   node test/plate-menu.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4177;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`PLATE MENU FAIL: ${msg}`);
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

const objects = (page) => page.locator('ul.objects > li.object');
const waitObjects = (page, n) =>
  page.waitForFunction((n) => document.querySelectorAll('ul.objects > li.object').length === n, n, { timeout: 60000 });

try {
  const page = await open({ width: 1280, height: 800 }, false);
  const box = await page.getByTestId('viewport').boundingBox();
  const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  const rightClick = (x, y) => page.mouse.click(...at(x, y), { button: 'right' });
  const plateMenu = page.getByRole('menu', { name: 'Plate menu' });
  const addMenu = page.getByRole('menu', { name: 'Add menu' });

  // The empty plate: its own items wait for a model, adding works.
  await rightClick(0.5, 0.55);
  await plateMenu.waitFor({ timeout: 5000 });
  for (const name of ['Arrange', 'Auto orient', 'Delete all', 'Delete plate'])
    if (!(await plateMenu.getByRole('menuitem', { name, exact: true }).isDisabled())) fail(`${name} is usable on an empty plate`);
  for (const name of ['Rename plate…', 'Add primitive', 'Add handy models', 'Add models…']) await plateMenu.getByRole('menuitem', { name, exact: true }).waitFor();
  await plateMenu.getByRole('menuitem', { name: 'Add primitive' }).click();
  for (const name of ['Cube', 'Cylinder', 'Sphere', 'Cone', 'Disc', 'Torus', 'Text', 'SVG…']) await plateMenu.getByRole('menuitem', { name, exact: true }).waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'plate-menu-desktop.png') });
  await plateMenu.getByRole('menuitem', { name: 'Cube', exact: true }).click();
  await waitObjects(page, 1);
  if ((await objects(page).first().locator('.object-name').innerText()).trim() !== 'Cube') fail('the new object is not called Cube');
  console.log('right click on the empty plate adds a cube');

  // The plate menu from a spot of the plate no object covers.
  const onFreePlate = async () => {
    for (const [x, y] of [[0.35, 0.75], [0.9, 0.75], [0.5, 0.4], [0.75, 0.4], [0.3, 0.7], [0.7, 0.7]]) {
      await rightClick(x, y);
      if (await plateMenu.waitFor({ timeout: 1500 }).then(() => true, () => false)) return true;
      await page.keyboard.press('Escape');
    }
    return false;
  };

  // A second primitive beside the cube.
  if (!(await onFreePlate())) fail('no right click on the plate beside the cube opened the plate menu');
  else {
    if (await plateMenu.getByRole('menuitem', { name: 'Arrange', exact: true }).isDisabled()) fail('Arrange is off with a cube on the plate');
    await plateMenu.getByRole('menuitem', { name: 'Add primitive' }).click();
    await plateMenu.getByRole('menuitem', { name: 'Cylinder', exact: true }).click();
    await waitObjects(page, 2);
    console.log('a second primitive joins the first');
  }

  // Off the plate: only the add items, like desktop's menu on empty space.
  await rightClick(0.5, 0.2);
  await addMenu.waitFor({ timeout: 5000 });
  if (await addMenu.getByRole('menuitem', { name: 'Arrange', exact: true }).count()) fail('the menu off the plate has plate items');
  await addMenu.getByRole('menuitem', { name: 'Add handy models' }).click();
  if (shots) await page.screenshot({ path: join(shots, 'add-menu-desktop.png') });
  await addMenu.getByRole('menuitem', { name: 'Voron Cube', exact: true }).click();
  await waitObjects(page, 3);
  console.log('right click off the plate adds a handy model');
  await page.getByText('Ready to slice').waitFor({ timeout: 60000 });
  if (shots) await page.screenshot({ path: join(shots, 'plate-menu-added-desktop.png') });

  // Rename the plate; a second plate shows it on the tabs.
  if (!(await onFreePlate())) throw new Error('no free spot on the plate for its menu');
  await plateMenu.getByRole('menuitem', { name: 'Rename plate…' }).click();
  await plateMenu.getByLabel('Plate name').fill('Shapes');
  await plateMenu.getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Add plate' }).click();
  await page.getByRole('tab', { name: /Shapes/ }).waitFor({ timeout: 30000 });
  await page.getByRole('tab', { name: /Shapes/ }).click();
  console.log('the plate is renamed');

  // Delete all empties the plate, and undo brings it all back.
  if (!(await onFreePlate())) throw new Error('no free spot on the plate for its menu');
  await plateMenu.getByRole('menuitem', { name: 'Delete all' }).click();
  await waitObjects(page, 0);
  await page.locator('body').press('Control+z');
  await waitObjects(page, 3);
  console.log('Delete all empties the plate, undo brings it back');
  await page.close();

  // A phone: a long press on the plate opens the menu; lifting the finger picks nothing.
  const phone = await open({ width: 390, height: 844 }, true);
  const view = phone.getByTestId('viewport');
  await view.scrollIntoViewIfNeeded();
  const pbox = await view.boundingBox();
  const cdp = await phone.context().newCDPSession(phone);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  const [px, py] = [pbox.x + pbox.width / 2, pbox.y + pbox.height * 0.6];
  await touch('touchStart', [[px, py]]);
  await phone.waitForTimeout(800);
  const phoneMenu = phone.getByRole('menu', { name: 'Plate menu' });
  if (!(await phoneMenu.isVisible())) fail('a long press on the plate opened no menu');
  await touch('touchEnd', []);
  await phone.waitForTimeout(300);
  if (!(await phoneMenu.isVisible())) fail('lifting the finger closed the plate menu or picked an item');
  else {
    await phoneMenu.getByRole('menuitem', { name: 'Add primitive' }).tap();
    if (shots) await phone.screenshot({ path: join(shots, 'plate-menu-phone.png') });
    await phoneMenu.getByRole('menuitem', { name: 'Sphere', exact: true }).tap();
    await waitObjects(phone, 1);
    console.log('a long press on a phone opens the plate menu and adds a sphere');
  }

  // Two fingers are the camera's: a long two-finger hold opens nothing.
  await touch('touchStart', [[px - 40, py]]);
  await phone.waitForTimeout(40);
  await touch('touchStart', [[px - 40, py], [px + 40, py - 120]]);
  await phone.waitForTimeout(800);
  await touch('touchEnd', []);
  if (await phone.locator('.plate-menu').count()) fail('a two-finger hold opened the plate menu');
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
