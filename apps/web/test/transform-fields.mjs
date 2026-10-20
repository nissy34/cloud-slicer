#!/usr/bin/env node
// Browser end to end for desktop's exact transform fields and editing keys:
// Scale takes a size in mm as well as a percent, together on all three axes
// while "Scale evenly" is on; Move has a Z that sinks the object into the bed;
// a part picked in the object list gets the same fields; + and - add and
// remove a copy, Ctrl+C / Delete / Ctrl+V take the object away and paste it
// back, Ctrl+K asks how many clones; and on a phone the Scale card fits
// without scrolling under the toolbar, the page itself never scrolling.
//
//   node test/transform-fields.mjs [screenshot-dir]
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
const PORT = 4178;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`TRANSFORM FAIL: ${msg}`);
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

// An ASCII STL cube, size mm on a side.
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
const cube = join(mkdtempSync(join(tmpdir(), 'transform-')), 'cube20.stl');
writeFileSync(cube, cubeStl(20));

const value = (page, label) => page.getByLabel(label, { exact: true }).inputValue();
// Waits for the engine's value (the box may still show what was typed).
const waitValue = (page, label, want) =>
  page.waitForFunction(([l, w]) => document.querySelector(`input[aria-label="${l}"]`)?.dataset.value === w, [label, want], { timeout: 30000 });
const type = async (page, label, v) => {
  const box = page.getByLabel(label, { exact: true });
  await box.fill(String(v));
  await box.press('Enter');
};
const objectCount = (page) => page.locator('ul.objects > li.object').count();
const waitObjects = (page, n) =>
  page.waitForFunction((n) => document.querySelectorAll('ul.objects > li.object').length === n, n, { timeout: 60000 });
const copies = (page) => page.locator('ul.objects > li.object').first().innerText();

try {
  const page = await open({ width: 1280, height: 800 }, false);
  await page.getByTestId('model-input').setInputFiles(cube);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await page.locator('ul.objects .object-name').first().click();

  // Scale: a size in mm, all three axes together while Scale evenly is on.
  await page.keyboard.press('s');
  const scale = page.getByRole('region', { name: 'Scale' });
  await scale.waitFor();
  if ((await value(page, 'Size X')) !== '20') fail(`a 20 mm cube should show Size X 20, got ${await value(page, 'Size X')}`);
  await type(page, 'Size X', 40);
  await waitValue(page, 'Scale Z', '200');
  if ((await value(page, 'Size Y')) !== '40') fail('Size Y should follow Size X while Scale evenly is on');
  if (shots) await page.screenshot({ path: join(shots, 'scale-desktop.png') });
  await scale.getByLabel('Scale evenly').uncheck();
  await type(page, 'Scale Z', 50);
  await waitValue(page, 'Size Z', '10');
  if ((await value(page, 'Size X')) !== '40') fail('with Scale evenly off only Z should change');
  await scale.getByLabel('Scale evenly').check();

  // Move: X, Y and a Z that sinks it into the bed.
  await page.keyboard.press('m');
  const move = page.getByRole('region', { name: 'Move' });
  await move.waitFor();
  const z0 = Number(await value(page, 'Position Z'));
  await type(page, 'Position Z', z0 - 4);
  await waitValue(page, 'Position Z', String(z0 - 4));
  await type(page, 'Position Z', z0 + 30);
  await waitValue(page, 'Position Z', String(z0)).catch(async (e) => fail(`Z back on the bed: ${await value(page, 'Position Z')} vs ${z0}`));
  if (shots) await page.screenshot({ path: join(shots, 'move-desktop.png') });
  await move.getByRole('button', { name: 'Done' }).click();

  // + and - add and remove a copy; the object menu has both too.
  await page.keyboard.press('+');
  await page.waitForFunction(() => document.querySelector('ul.objects > li.object')?.textContent.includes('×2'), null, { timeout: 30000 });
  await page.keyboard.press('-');
  await page.waitForFunction(() => !document.querySelector('ul.objects > li.object')?.textContent.includes('×'), null, { timeout: 30000 });
  if ((await objectCount(page)) !== 1) fail('- should remove a copy, not the object');

  // Ctrl+C, Delete, Ctrl+V: gone and back, with its new size.
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Delete');
  await waitObjects(page, 0);
  await page.keyboard.press('Control+v');
  await waitObjects(page, 1);
  await page.keyboard.press('Control+v');
  await waitObjects(page, 2);
  await page.locator('ul.objects .object-name').first().click();
  await page.keyboard.press('s');
  await waitValue(page, 'Size X', '40');
  await page.getByRole('region', { name: 'Scale' }).getByRole('button', { name: 'Done' }).click();

  // Ctrl+K asks how many clones, like desktop.
  await page.keyboard.press('Control+k');
  const menu = page.getByRole('menu', { name: /menu$/ });
  await menu.getByRole('button', { name: 'Clone', exact: true }).click();
  await waitObjects(page, 3);

  // A part's fields: its place inside the object.
  await page.locator('ul.objects .object-name').first().click();
  await page.getByRole('button', { name: /^More for / }).first().click();
  await page.getByRole('menuitem', { name: 'Add part' }).click();
  await page.getByRole('menuitem', { name: 'Cube' }).click();
  // The added part is picked.
  await page.locator('ul.volumes .volume-name[aria-pressed="true"]').waitFor({ timeout: 30000 });
  await page.keyboard.press('m');
  await page.getByRole('region', { name: 'Move' }).getByText('inside its object').waitFor();
  const px = Number(await value(page, 'Position X'));
  await type(page, 'Position X', px + 7);
  await waitValue(page, 'Position X', String(Math.round((px + 7) * 100) / 100));
  await page.keyboard.press('s');
  await type(page, 'Scale X', 150);
  await waitValue(page, 'Scale Y', '150');
  await page.keyboard.press('Escape');
  await page.close();

  // Phone: the Scale card fits under the toolbar without scrolling, the page never scrolls.
  const phone = await open({ width: 390, height: 844 }, true);
  await phone.getByTestId('model-input').setInputFiles(cube);
  await phone.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await phone.locator('ul.objects .object-name').first().tap();
  await phone.getByRole('button', { name: 'Scale', exact: true }).tap();
  const card = phone.getByRole('region', { name: 'Scale' });
  await card.waitFor();
  await phone.waitForTimeout(500);
  const fits = await card.evaluate((el) => {
    const pop = el.closest('.tool-pop') ?? el;
    return pop.scrollHeight <= pop.clientHeight + 1;
  });
  if (!fits) fail('the Scale card should fit on a phone without scrolling inside it');
  const pageScroll = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight);
  if (pageScroll) fail('the page scrolls on a phone');
  if (shots) await phone.screenshot({ path: join(shots, 'scale-phone.png') });
  await phone.getByRole('button', { name: 'Move', exact: true }).tap();
  await phone.getByRole('region', { name: 'Move' }).waitFor();
  await phone.waitForTimeout(300);
  if (shots) await phone.screenshot({ path: join(shots, 'move-phone.png') });
  await phone.locator('ul.objects .object-name').first().waitFor({ state: 'attached' });
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
if (!process.exitCode) console.log('transform fields: ok');
