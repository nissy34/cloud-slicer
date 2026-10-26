#!/usr/bin/env node
// Browser end to end for switching an open project to the other engine:
// changed settings on an empty plate carrying over both ways, then a
// model printed with a colour mix in Snapmaker Orca, the Slicer engine dropdown's
// "Switch this project to OrcaSlicer?" pop-up listing what won't carry over,
// then the project in OrcaSlicer with the mix turned into its main filament,
// sliced, and back to Snapmaker Orca.
//
//   node test/engine-switch.mjs [screenshot-dir]
//
// Needs `npm run build` first, with both engines copied (public/engine and
// public/engine-orca).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pickerValue } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/tetrahedron.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4183;

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
  console.error(`ENGINE SWITCH FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const engineIs = (name) =>
    page.waitForFunction((n) => document.querySelector('.engine-badge')?.textContent?.startsWith(n), name, { timeout: 180000 });
  const sliceTools = async () => {
    await page.getByRole('button', { name: /^Slice plate/ }).click();
    await page.getByTestId('slice-stats').waitFor({ timeout: 300000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
    const gcode = readFileSync(await download.path(), 'utf8');
    await page.getByRole('tab', { name: 'Prepare' }).click().catch(() => {});
    return [0, 1, 2, 3].map((t) => (gcode.match(new RegExp(`^T${t}\\b`, 'gm')) ?? []).length);
  };

  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  await engineIs('Snapmaker Orca');
  const engineSelect = page.getByTestId('engine-select');
  const ask = page.getByTestId('engine-switch');
  const layer = page.getByLabel('Layer height', { exact: true });
  const printer = { inputValue: () => pickerValue(page, 'Printer preset') };
  const search = page.getByRole('searchbox', { name: 'Search process settings' });

  // An empty plate: a changed setting both engines have moves over with the
  // printer, without a question (it used to start a fresh project and drop them).
  await layer.fill('0.28');
  await layer.press('Enter');
  const printerBefore = await printer.inputValue();
  await engineSelect.selectOption('orca');
  await engineIs('OrcaSlicer');
  await page.getByText('Your changed settings came along').waitFor({ timeout: 180000 });
  if (await ask.count()) fail('switching an empty plate with a shared change asked first');
  if ((await layer.inputValue()) !== '0.28') fail(`empty plate: layer height ${await layer.inputValue()} in OrcaSlicer, not 0.28`);
  if ((await printer.inputValue()) !== printerBefore) fail(`empty plate: printer ${await printer.inputValue()} in OrcaSlicer, not ${printerBefore}`);
  console.log('empty plate: layer height 0.28 and the printer carried to OrcaSlicer');

  // And back, with a change Snapmaker Orca doesn't have: the pop-up names it,
  // the shared change still carries.
  await search.fill('combine brims');
  await page.getByLabel('Combine brims', { exact: true }).click();
  await search.fill('');
  await engineSelect.selectOption('snapmaker');
  await ask.waitFor();
  const emptyText = await ask.innerText();
  console.log(`empty plate pop-up:\n${emptyText}`);
  for (const want of ["Settings Snapmaker Orca doesn't have", 'Combine brims', 'Your printer, presets and changed settings move over'])
    if (!emptyText.includes(want)) fail(`the empty plate pop-up doesn't say "${want}"`);
  if (emptyText.includes('Layer height')) fail('the pop-up lists layer height, which carries over');
  await shot(page, 'empty-switch-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'empty-switch-phone');
  await page.setViewportSize({ width: 1280, height: 860 });
  await ask.getByRole('button', { name: 'Switch to Snapmaker Orca' }).click();
  await engineIs('Snapmaker Orca');
  await page.getByText('Now slicing with Snapmaker Orca').waitFor({ timeout: 180000 });
  if ((await layer.inputValue()) !== '0.28') fail(`empty plate: layer height ${await layer.inputValue()} back in Snapmaker Orca, not 0.28`);
  console.log('empty plate: back to Snapmaker Orca, layer height still 0.28');

  // A model printed with a 30/70 mix of filaments 1 and 2: filament 2 is the main one.
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  // A plain model on built-in presets with only shared changes loses nothing:
  // the Slicer engine dropdown switches without asking, and the changes carry.
  await shot(page, 'engine-desktop');
  for (const [to, back] of [['OrcaSlicer', 'Snapmaker Orca'], ['Snapmaker Orca', 'OrcaSlicer']]) {
    await engineSelect.selectOption({ label: to });
    await page.getByText(`This project now slices with ${to}`).waitFor({ timeout: 180000 });
    await engineIs(to);
    if (await ask.count()) fail(`switching a plain model to ${to} asked first`);
    if ((await layer.inputValue()) !== '0.28') fail(`with a model: layer height ${await layer.inputValue()} in ${to}, not 0.28`);
    console.log(`plain model: ${back} -> ${to} without a question`);
  }
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  while ((await page.getByLabel(/^Filament \d+ colour$/).count()) < 2) await page.getByLabel('Add filament').click();
  const mixId = (await page.getByLabel(/^Filament \d+ colour$/).count()) + 1;
  await page.getByLabel('Add mix').click();
  const mixDialog = page.getByRole('dialog', { name: /mix/i });
  await mixDialog.waitFor();
  // A range input needs a real input event for React to see the change.
  await mixDialog.getByLabel('Mix ratio').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '70');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await mixDialog.getByRole('button', { name: /^(Add|Save)/ }).click();
  await page.getByLabel(`Delete mix ${mixId}`).waitFor();
  await page.getByLabel(/^Filament for tetrahedron/).first().selectOption(String(mixId));
  await page.waitForTimeout(500);

  // With a mix on the model, the other engine asks first.
  await engineSelect.selectOption('orca');
  await ask.waitFor();
  const text = await ask.innerText();
  console.log(`pop-up:\n${text}`);
  for (const want of ['Switch this project to OrcaSlicer?', 'Colour mixes become plain filaments', "won't bring these back"])
    if (!text.includes(want)) fail(`the pop-up doesn't say "${want}"`);
  await shot(page, 'switch-desktop');

  // Cancel changes nothing.
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await engineIs('Snapmaker Orca');
  if (await ask.count()) fail('the pop-up is still open after Cancel');
  if ((await engineSelect.inputValue()) !== 'snapmaker') fail('Cancel left the dropdown on OrcaSlicer');

  // On a phone the pop-up fits, its list scrolls inside and the buttons show.
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'engine-phone');
  await engineSelect.selectOption('orca');
  await ask.waitFor();
  const box = await ask.boundingBox();
  if (!box || box.width > 390 || box.y < 0 || box.y + box.height > 844) fail(`pop-up at ${JSON.stringify(box)} on a 390x844 phone`);
  if (!(await ask.getByRole('button', { name: 'Switch to OrcaSlicer' }).isVisible())) fail('Switch is not visible on the phone');
  await shot(page, 'switch-phone');
  const scrolled = await page.evaluate(() => document.scrollingElement.scrollTop);
  if (scrolled) fail(`the page scrolled by ${scrolled}px`);

  await ask.getByRole('button', { name: 'Switch to OrcaSlicer' }).click();
  await engineIs('OrcaSlicer');
  await page.getByText('This project now slices with OrcaSlicer').waitFor({ timeout: 180000 });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await shot(page, 'switched-desktop');
  const filament = await page.getByLabel(/^Filament for tetrahedron/).first().inputValue();
  if (filament !== '2') fail(`the mix should have become filament 2, the object has ${filament}`);
  const orcaTools = await sliceTools();
  console.log(`OrcaSlicer tool changes: ${orcaTools.join(', ')}`);

  // And back: nothing to lose now, so no question; the mix does not come back.
  await engineSelect.selectOption('snapmaker');
  await engineIs('Snapmaker Orca');
  await page.getByText('This project now slices with Snapmaker Orca').waitFor({ timeout: 180000 });
  const back = await page.getByLabel(/^Filament for tetrahedron/).first().inputValue();
  if (back !== '2') fail(`back in Snapmaker Orca the object has filament ${back}`);
  if (await page.getByLabel(`Delete mix ${mixId}`).count()) fail('the mix came back');
  if (await ask.count()) fail('switching back asked first');
  const tools = await sliceTools();
  console.log(`Snapmaker Orca tool changes: ${tools.join(', ')}`);
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 3000)}`);
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
if (!process.exitCode) console.log('ENGINE SWITCH OK');
process.exit(process.exitCode ?? 0);
