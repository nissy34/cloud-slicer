#!/usr/bin/env node
// Browser end to end for a mesh boolean of two separate objects: two cubes
// added from the plate menu and moved to overlap, then Mesh boolean on one of
// them offers the other's part; Union makes them one object with one part,
// and undo brings both back. Desktop, then a phone (long press, taps).
//
//   node test/boolean-objects.mjs [screenshot-dir]
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
const PORT = 4178;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`BOOLEAN OBJECTS FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

const objects = (page) => page.locator('ul.objects > li.object');
const waitObjects = (page, n) =>
  page.waitForFunction((n) => document.querySelectorAll('ul.objects > li.object').length === n, n, { timeout: 60000 });

async function run(name, viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  const tap = (locator) => (mobile ? locator.tap() : locator.click());

  // The plate menu: a right click, or on a phone a long press.
  const view = page.getByTestId('viewport');
  const cdp = mobile ? await page.context().newCDPSession(page) : null;
  const plateMenu = page.getByRole('menu', { name: 'Plate menu' });
  const openMenu = async (x, y) => {
    const box = await view.boundingBox();
    const [px, py] = [box.x + box.width * x, box.y + box.height * y];
    if (!mobile) await page.mouse.click(px, py, { button: 'right' });
    else {
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
      await touch('touchStart', [[px, py]]);
      await page.waitForTimeout(800);
      await touch('touchEnd', []);
    }
    if (await plateMenu.waitFor({ timeout: 1500 }).then(() => true, () => false)) return true;
    await page.keyboard.press('Escape');
    return false;
  };
  const addCube = async (n) => {
    for (const [x, y] of [[0.5, 0.6], [0.3, 0.75], [0.7, 0.75], [0.5, 0.4], [0.75, 0.45], [0.25, 0.45]]) {
      if (!(await openMenu(x, y))) continue;
      await tap(plateMenu.getByRole('menuitem', { name: 'Add primitive' }));
      await tap(plateMenu.getByRole('menuitem', { name: 'Cube', exact: true }));
      return waitObjects(page, n);
    }
    throw new Error('no spot on the plate opened the plate menu');
  };
  await addCube(1);
  await addCube(2);

  const toolbar = page.getByRole('toolbar', { name: 'Object tools' });
  const select = async (n) => {
    const row = objects(page).nth(n);
    if (!/\bactive\b/.test(await row.getAttribute('class'))) await tap(row.locator('.object-name'));
  };
  const position = page.getByRole('region', { name: 'Move' });
  // Where the first cube is, then the second one over it (cubes are 27 mm).
  await select(0);
  await tap(toolbar.getByRole('button', { name: 'Move' }));
  const x = Number(await position.getByLabel('Position X').inputValue());
  const y = Number(await position.getByLabel('Position Y').inputValue());
  await tap(position.getByRole('button', { name: 'Done' }));
  await select(1);
  await tap(toolbar.getByRole('button', { name: 'Move' }));
  for (const [axis, v] of [['X', x + 12], ['Y', y + 8]]) {
    await position.getByLabel(`Position ${axis}`).fill(String(v));
    await position.getByLabel(`Position ${axis}`).press('Enter');
    await page.waitForFunction(([axis, v]) => Number(document.querySelector(`[aria-label="Position ${axis}"]`)?.value) === v, [axis, v], { timeout: 30000 });
  }
  await tap(position.getByRole('button', { name: 'Done' }));

  // Mesh boolean on the second cube offers the first cube's part.
  await tap(toolbar.getByRole('button', { name: 'Mesh boolean' }));
  const panel = page.getByRole('region', { name: 'Mesh boolean' });
  await panel.waitFor();
  const second = panel.getByLabel('Part 2');
  const groups = await second.locator('optgroup').evaluateAll((gs) => gs.map((g) => g.label));
  if (groups.length !== 2) fail(`${name}: the parts are not grouped by object: ${groups}`);
  const picked = await second.evaluate((s) => s.selectedOptions[0]?.parentElement?.label);
  if (picked !== groups[1]) fail(`${name}: Part 2 does not start on the other object (${picked})`);
  await panel.getByText('The two objects become one object.').waitFor();
  if (shots) await page.screenshot({ path: join(shots, `boolean-objects-${name}.png`) });
  await tap(panel.getByRole('button', { name: 'Union', exact: true }));
  await waitObjects(page, 1);
  // One object of one part: nothing left to pair up.
  await panel.getByText('This combines two parts').waitFor({ timeout: 30000 });
  const joined = (await objects(page).first().locator('.object-name').innerText()).trim();
  if (joined !== 'Assembly') fail(`${name}: the joined object is called ${joined}`);
  if (shots) await page.screenshot({ path: join(shots, `boolean-objects-${name}-after.png`) });
  console.log(`${name}: two cubes joined by a union into one ${joined} object of one part`);

  await tap(panel.getByRole('button', { name: 'Done' }));
  if (!mobile) {
    await page.locator('body').press('Control+z');
    await waitObjects(page, 2);
    console.log(`${name}: undo brings both cubes back`);
  }
  await page.close();
}

try {
  await run('desktop', { width: 1280, height: 800 }, false);
  await run('phone', { width: 390, height: 844 }, true);
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
