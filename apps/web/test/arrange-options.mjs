#!/usr/bin/env node
// Browser end to end for desktop's Arrange pop-up on the toolbar: on an empty
// plate the button says why it waits; with models it opens Spacing (slider and
// box, "0 means auto spacing."), Auto rotate, Allow multiple materials on same
// plate and Align to Y axis (greyed while Auto rotate is on), Arrange and Reset.
// Align to Y axis turns a long box front to back, Auto rotate lays it across,
// the spacing sets the gap, the options are kept in this browser, and on
// a phone the pop-up fits the screen and closes after Arrange.
//
//   node test/arrange-options.mjs [screenshot-dir]
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
const PORT = 4186;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`ARRANGE FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(context, viewport, mobile) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  return page;
}

// An ASCII STL box, x by y by z mm, centred on x = y = 0 (so its position is its centre).
const boxStl = (x, y, z) => {
  const v = (a, b, c) => [(a - 0.5) * x, (b - 0.5) * y, c * z];
  const quads = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  ];
  const tri = (a, b, c) => `facet normal 0 0 0\nouter loop\n${[a, b, c].map((p) => `vertex ${v(...p).join(' ')}`).join('\n')}\nendloop\nendfacet\n`;
  return `solid box\n${quads.map(([a, b, c, d]) => tri(a, b, c) + tri(a, c, d)).join('')}endsolid box\n`;
};
const dir = mkdtempSync(join(tmpdir(), 'arrange-'));
const cube = join(dir, 'cube20.stl');
const bar = join(dir, 'bar40.stl');
writeFileSync(cube, boxStl(20, 20, 20));
writeFileSync(bar, boxStl(40, 10, 10));

const waitObjects = (page, n) =>
  page.waitForFunction((n) => document.querySelectorAll('ul.objects > li.object').length === n, n, { timeout: 60000 });
const tools = (page) => page.getByRole('toolbar', { name: 'Object tools' });
const arrangeButton = (page) => tools(page).getByRole('button', { name: 'Arrange all objects' });
const pop = (page) => page.getByRole('dialog', { name: 'Arrange options' });
// An object's engine value in the Move or Rotate card ("Position X", "Rotation Z").
async function field(page, object, key, label) {
  // Let go of what is chosen first: a click on the chosen object's name renames it.
  await page.locator('body').press('Escape');
  await page.locator('ul.objects .object-name').nth(object).click();
  await page.keyboard.press(key);
  const box = page.getByLabel(label, { exact: true });
  await box.waitFor();
  await page.waitForFunction((l) => document.querySelector(`input[aria-label="${l}"]`)?.dataset.value !== undefined, label, { timeout: 10000 });
  const v = Number(await box.getAttribute('data-value'));
  await page.keyboard.press('Escape');
  return v;
}

// Arranges from the pop-up and waits for the slice bar to come back.
async function arrange(page) {
  await pop(page).getByRole('button', { name: 'Arrange', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByText('Ready to slice').waitFor({ timeout: 60000 });
  // Desktop keeps the pop-up open; close it so the tool keys reach the 3D view.
  await page.keyboard.press('Escape');
  await pop(page).waitFor({ state: 'detached', timeout: 5000 });
}

// Reads `read` until `ok` holds (the engine may still be arranging), up to 30 s; the last value.
async function until(read, ok) {
  let v;
  for (let t = 0; t < 30; t++) {
    v = await read();
    if (ok(v)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return v;
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const page = await open(desktop);

  // Empty plate: the button explains instead of opening.
  // (aria-disabled: Playwright would wait for it to be enabled, so force the click.)
  await arrangeButton(page).click({ force: true });
  await page.getByText('Arrange all objects works on a model: open one first.').waitFor({ timeout: 5000 });
  if (await pop(page).count()) fail('the Arrange pop-up opened on an empty plate');

  await page.getByTestId('model-input').setInputFiles([cube, bar]);
  await waitObjects(page, 2);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  await arrangeButton(page).click();
  await pop(page).waitFor({ timeout: 5000 });
  await pop(page).getByText('0 means auto spacing.').waitFor();
  const sw = (name) => pop(page).getByRole('checkbox', { name });
  if (!(await sw('Allow multiple materials on same plate').isChecked())) fail('Allow multiple materials should start on, like desktop');
  if (await sw('Auto rotate for arrangement').isChecked()) fail('Auto rotate should start off, like desktop');
  if ((await pop(page).getByLabel('Spacing in mm').inputValue()) !== '0') fail('spacing should start at 0 (auto)');
  if (shots) await page.screenshot({ path: join(shots, 'arrange-desktop.png') });

  // Auto rotate greys out Align to Y axis.
  await sw('Auto rotate for arrangement').check();
  if (!(await sw('Align to Y axis').isDisabled())) fail('Align to Y axis should be greyed while Auto rotate is on');
  await sw('Auto rotate for arrangement').uncheck();

  // Align to Y axis: the 40 mm bar turns front to back.
  await sw('Align to Y axis').check();
  await arrange(page);
  const bar0 = await until(async () => Math.abs(await field(page, 1, 'r', 'Rotation Z')), (v) => Math.abs(v - 90) <= 1);
  if (Math.abs(bar0 - 90) > 1) fail(`Align to Y axis should turn the bar by 90°, got ${bar0}`);
  console.log('Align to Y axis turns the long bar front to back');

  // Auto rotate (Align to Y axis then greyed): the bar lies across again; a 30 mm gap.
  await arrangeButton(page).click();
  await pop(page).waitFor();
  await sw('Auto rotate for arrangement').check();
  await pop(page).getByLabel('Spacing in mm').fill('30');
  await arrange(page);
  const bar1 = await until(async () => Math.abs(await field(page, 1, 'r', 'Rotation Z')) % 180, (v) => Math.min(v, 180 - v) <= 1);
  if (Math.min(bar1, 180 - bar1) > 1) fail(`Auto rotate should lay the bar across, got ${bar1}°`);
  // One row: the cube (deeper) first, then the bar, 20/2 + 30 + 40/2 = 60 mm between their centres.
  const gap = await until(async () => Math.abs((await field(page, 1, 'm', 'Position X')) - (await field(page, 0, 'm', 'Position X'))), (v) => Math.abs(v - 60) <= 0.5);
  if (Math.abs(gap - 60) > 0.5) fail(`30 mm spacing should put the centres 60 mm apart, got ${gap}`);
  console.log('Auto rotate lays it across, the spacing sets the gap');

  // Kept in this browser, like desktop's app config.
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('cloud-slicer:arrange:v1') ?? '{}'));
  if (kept.spacing !== 30 || kept.rotate !== true) fail(`the options should be kept in this browser, got ${JSON.stringify(kept)}`);
  await arrangeButton(page).click();
  await pop(page).waitFor();
  if ((await pop(page).getByLabel('Spacing in mm').inputValue()) !== '30') fail('the spacing should still read 30 when the pop-up opens again');
  await pop(page).getByRole('button', { name: 'Reset' }).click();
  if ((await pop(page).getByLabel('Spacing in mm').inputValue()) !== '0' || (await sw('Auto rotate for arrangement').isChecked())) fail('Reset should bring back the defaults');
  await page.keyboard.press('Escape');
  console.log('the options are kept in this browser, Reset brings back the defaults');

  // Phone: the pop-up fits the screen and closes after Arrange.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
  const phone = await open(phoneContext);
  await phone.getByTestId('model-input').setInputFiles([cube, bar]);
  await waitObjects(phone, 2);
  await phone.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await arrangeButton(phone).tap();
  await pop(phone).waitFor({ timeout: 5000 });
  const r = await pop(phone).boundingBox();
  if (!r || r.x < 0 || r.x + r.width > 390 || r.y + r.height > 844) fail(`the pop-up runs off a phone screen: ${JSON.stringify(r)}`);
  if (shots) await phone.screenshot({ path: join(shots, 'arrange-phone.png') });
  await pop(phone).getByRole('button', { name: 'Arrange', exact: true }).tap();
  await pop(phone).waitFor({ state: 'detached', timeout: 10000 });
  const pageScroll = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (pageScroll) fail('the page scrolls sideways on a phone');
  console.log('on a phone the pop-up fits and closes after Arrange');
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
if (!process.exitCode) console.log('arrange options: ok');
