#!/usr/bin/env node
// Browser end to end for the Preview's colour key: a two-filament plate shows
// each filament's grams and the filament changes as in the G-code's own
// statistics, split into model / support / tower columns like desktop, every "Colour by" view draws its scale, and tapping a line type
// hides it from the 3D view and shows it again.
//
//   node test/preview-views.mjs [screenshot-dir]
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
const second = join(web, '../../fixtures/tetrahedron.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4180;

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
  console.error(`PREVIEW VIEWS FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

/** The 3D view left of the key (top right) as PNG bytes, after it has had a moment to redraw. */
async function view(page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const box = await page.getByTestId('gcode-preview').boundingBox();
  return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width * 0.6, height: box.height * 0.8 } });
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();

  while ((await page.getByLabel(/^Filament \d+ colour$/).count()) < 2) await page.getByLabel('Add filament').click();
  await page.getByTestId('model-input').setInputFiles([model, second]);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await pickerOf(page, 'Filament for tetrahedron.stl').selectOption('2');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
  const gcode = readFileSync(await download.path(), 'utf8');
  const footer = (key) => (new RegExp(`^; ${key.replace(/[[\]\\]/g, '\\$&')} = (.*)$`, 'm').exec(gcode)?.[1] ?? '').split(',').map(Number);
  const grams = footer('filament used [g]');
  // Switches between extruding filaments, like desktop's "Filament change times".
  let changes = 0, last = -1, tool = 0;
  for (const line of gcode.split('\n')) {
    const t = /^T(\d+)/.exec(line);
    if (t) tool = Number(t[1]);
    else if (/^G[123] .*E\d*\.?\d+/.test(line) && /[XY]/.test(line) && !/E-/.test(line)) {
      if (last >= 0 && tool !== last) changes++;
      last = tool;
    }
  }
  console.log(`G-code: ${grams.join(', ')} g, ${changes} filament changes`);

  await page.getByTestId('layer-label').waitFor({ timeout: 120000 });
  await page.getByTestId('legend').waitFor();
  await page.waitForTimeout(1000);
  await shot(page, 'line-type');

  // Hiding a line type takes it out of the picture; showing it puts it back.
  const before = await view(page);
  const wall = page.locator('.legend-item', { hasText: 'Outer wall' });
  await wall.click();
  if ((await wall.getAttribute('aria-pressed')) !== 'false') fail('Outer wall did not turn off in the key');
  const hidden = await view(page);
  if (hidden.equals(before)) fail('hiding Outer wall did not change the 3D view');
  await shot(page, 'outer-wall-hidden');
  await wall.click();
  const shownAgain = await view(page);
  if (!shownAgain.equals(before)) fail('showing Outer wall again did not bring the view back');
  console.log('Outer wall hides and shows');

  // The filament view: grams per filament as in the G-code, and the filament changes.
  const colourBy = page.getByLabel('Colour by');
  await colourBy.selectOption('filament');
  const stats = page.getByTestId('filament-stats');
  await stats.waitFor();
  const text = await stats.innerText();
  console.log(`filament key:\n${text}`);
  // Each filament's total (the table's last column, weight over length) is the
  // G-code's, give or take the last digit shown.
  const rows = await stats.locator('tbody tr').all();
  const shown = await Promise.all(rows.map(async (r) => [Number(await r.locator('td').first().innerText()), parseFloat(await r.locator('td').last().innerText())]));
  for (const [i, g] of grams.entries()) {
    const row = shown.find(([f]) => f === i + 1);
    if (g > 0 && !(row && Math.abs(row[1] - g) <= (g < 10 ? 0.01 : 0.1) + 1e-9)) fail(`filament ${i + 1}'s ${g} g is not in the key (${row?.[1]} g)`);
  }
  const shownChanges = Number(await page.getByTestId('tool-changes').innerText());
  if (shownChanges !== changes) fail(`key shows ${shownChanges} filament changes, the G-code has ${changes}`);
  if (changes < 1) fail('a two-filament plate should change filament at least once');
  // Split like desktop: a Model column always, a Tower column when the G-code has a
  // prime tower, and no column every filament has nothing in.
  const heads = await stats.locator('thead th').allInnerTexts();
  console.log(`filament columns: ${heads.join(' | ')}`);
  if (!heads.includes('Model')) fail(`no Model column: ${heads.join(', ')}`);
  if (heads.includes('Tower') !== /^;TYPE:Prime tower/m.test(gcode)) fail(`Tower column ${heads.includes('Tower') ? 'shown without' : 'missing with'} a prime tower`);
  for (const [i, h] of heads.entries()) {
    if (i === 0 || h === 'Total') continue;
    const cells = await stats.locator(`tbody tr td:nth-child(${i + 1})`).allInnerTexts();
    if (cells.every((c) => c.trim() === '–')) fail(`the ${h} column is empty for every filament`);
  }
  await shot(page, 'filament');

  // Desktop's time estimate under the key, in every view: the total is the G-code's.
  const printing = /^; estimated printing time \(normal mode\) = (.*)$/m.exec(gcode)?.[1]?.trim();
  for (const v of ['filament', 'feature', 'speed']) {
    await colourBy.selectOption(v);
    const total = (await page.getByTestId('total-time').innerText()).trim();
    if (total !== printing) fail(`${v}: the key's total time is ${total}, the G-code says ${printing}`);
  }
  const times = await page.getByTestId('time-stats').innerText();
  if (!/Model printing time/.test(times)) fail(`time block: ${times}`);
  console.log(`time block: ${times.replace(/\n/g, ' | ')}`);
  if ((await page.getByTestId('slice-stats').innerText()).match(/filament|layers/)) fail('the bottom bar still shows filament or layers');
  await colourBy.selectOption('filament');

  // Every value view draws a scale with numbers and its own colours.
  let previous = await view(page);
  for (const v of ['speed', 'height', 'width', 'flow', 'layerTime', 'layerTimeLog', 'fan', 'temperature']) {
    await colourBy.selectOption(v);
    const key = page.getByTestId('range-key');
    await key.waitFor();
    const ticks = (await key.locator('.range-ticks span').allInnerTexts()).filter(Boolean);
    if (!ticks.length) fail(`${v}: the scale has no values`);
    const img = await view(page);
    // Temperature is one value for the whole print, so it may look like the fan view; the rest differ.
    if (v !== 'temperature' && img.equals(previous)) fail(`${v}: the 3D view did not change colour`);
    previous = img;
    console.log(`${v}: ${(await key.locator('.range-title').innerText())} ${ticks.join(' / ')}`);
    if (v === 'speed' || v === 'layerTime') await shot(page, v);
  }

  // Phone: the key is a strip above the 3D view, never over it, and the page does not scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  if (await page.getByRole('button', { name: 'Show colour key' }).isVisible()) await page.getByRole('button', { name: 'Show colour key' }).click();
  await colourBy.selectOption('filament');
  await page.waitForTimeout(500);
  await shot(page, 'phone-filament');
  await colourBy.selectOption('speed');
  await page.waitForTimeout(500);
  await shot(page, 'phone-speed');
  await colourBy.selectOption('feature');
  await page.locator('.legend-item', { hasText: 'Sparse infill' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'phone-line-type');
  const scrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight + 1);
  if (scrolls) fail('the phone page scrolls');
  const legend = await page.getByTestId('legend').boundingBox();
  const canvas = await page.getByTestId('gcode-preview').boundingBox();
  if (legend.y + legend.height > canvas.y + 1) fail('the key covers the 3D view on a phone');
  if (canvas.height < 200) fail(`the key leaves only ${canvas.height}px of 3D view on a phone`);
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('PREVIEW VIEWS OK');
process.exit();
