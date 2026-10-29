#!/usr/bin/env node
// Browser end to end for how many filaments a project takes (lib/filament-limit.ts).
// fixtures/eight-colour-cubes.3mf is a Bambu Lab X1 Carbon project with 8
// cubes, one per filament (8 colours, two AMS units' worth).
// - OrcaSlicer on the X1 Carbon (single nozzle, AMS): all 8 filaments stay, no
//   warning, + Add stays, it slices with all 8, and the Preview reads the
//   Bambu G-code (layers, line types, no T1000 "filament").
// - Both engines on the U1 (4 heads): all 8 stay and slice (OrcaSlicer used to
//   crash); a plain note says each one gets a head when the print is sent.
//
//   npm run build && node test/filament-count.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pickerValue, pickerOf } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/eight-colour-cubes.3mf');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4183;
const X1C = 'Bambu Lab X1 Carbon 0.4 nozzle';
const U1 = 'Snapmaker U1 (0.4 nozzle)';

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

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(name);
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`not ok - ${name}\n  ${e.message.split('\n').join('\n  ')}`);
    process.exitCode = 1;
    throw e;
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

// A fresh page on `engine`; with `printer`, the setup wizard adds it.
async function open(engine, printer, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`${url}?engine=${engine}`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  if (!printer) {
    await wizard.getByRole('button', { name: 'Not now' }).click();
  } else {
    const search = wizard.getByRole('searchbox', { name: 'Search printers' });
    while (!(await search.isVisible())) await wizard.getByRole('button', { name: 'Next' }).click();
    await search.fill(printer);
    await wizard.locator('.wizard-models li').first().getByRole('button', { name: '0.4', exact: true }).click();
    await wizard.getByRole('button', { name: 'Next' }).click();
    await wizard.getByText('Pick the filaments you use').waitFor({ timeout: 60000 });
    await wizard.getByRole('button', { name: 'Next' }).click();
    await wizard.getByRole('button', { name: 'Finish' }).click();
  }
  await page.getByRole('combobox', { name: 'Process preset' }).waitFor();
  return page;
}

const slots = (page) => page.locator('button.picker[aria-label^="Filament "][aria-label$=" preset"]');
const slice = async (page) => {
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 300000 });
};
// The filaments the Preview's colour key lists, by number.
async function filamentsInPreview(page) {
  await pickerOf(page, 'Colour by').selectOption('filament');
  // The key fills in once the G-code has been read: a row per filament.
  const rows = page.getByTestId('filament-stats').locator('[data-filament]');
  await rows.first().waitFor({ timeout: 120000 });
  return (await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-filament')))).map(Number);
}

try {
  await step('OrcaSlicer, X1 Carbon: all 8 filaments stay and slice', async () => {
    const page = await open('orca', 'X1 Carbon');
    await page.getByTestId('model-input').setInputFiles(model);
    await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
    expect((await pickerValue(page, 'Printer preset')) === X1C, 'the project opens on its X1 Carbon');
    expect((await slots(page).count()) === 8, `${await slots(page).count()} filaments`);
    expect(!(await page.getByTestId('filament-limit').count()), 'no filament-count note on a single-nozzle printer');
    expect(await page.getByRole('button', { name: 'Add filament' }).isVisible(), '+ Add is there');
    await shot(page, 'x1c-prepare');
    await slice(page);
    const layers = await page.getByTestId('slice-stats').getAttribute('data-layers');
    expect(layers === '50', `layers: ${layers}`);
    const used = await filamentsInPreview(page);
    expect(used.join() === '1,2,3,4,5,6,7,8', `the Preview lists filaments ${used.join()}`);
    expect(!(await page.getByText('goes beyond the plate').count()), 'no off-plate warning');
    await pickerOf(page, 'Colour by').selectOption('feature');
    expect(await page.getByTestId('legend').getByText('Outer wall').isVisible(), 'the Preview reads the Bambu line types');
    await shot(page, 'x1c-preview');
    await page.close();
  });

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ])
    for (const engine of ['orca', 'snapmaker'])
      await step(`${engine === 'orca' ? 'OrcaSlicer' : 'Snapmaker Orca'}, U1 (${viewport.name}): all 8 filaments slice, each gets a head when sent`, async () => {
        const page = await open(engine, null, viewport);
        await page.getByTestId('model-input').setInputFiles(model);
        const dialog = page.getByRole('dialog', { name: 'Convert this project?' });
        await dialog.waitFor({ timeout: 120000 });
        await pickerOf(dialog, 'Convert to printer').selectOption(U1);
        await dialog.getByRole('button', { name: 'Convert' }).click();
        await page.getByText(/Converted from/).waitFor({ timeout: 120000 });
        expect((await slots(page).count()) === 8, `${await slots(page).count()} filaments`);
        const note = page.getByTestId('filament-limit');
        expect(/8 filaments on 4 heads: you pick which head/.test(await note.innerText()), `note: ${await note.innerText()}`);
        expect(!(await note.getAttribute('class')).includes('warn'), 'a plain note, not a warning');
        expect(await page.getByRole('button', { name: 'Add filament' }).isVisible(), '+ Add is there');
        await note.scrollIntoViewIfNeeded();
        await shot(page, `${engine}-u1-${viewport.name}`);
        if (viewport.name === 'phone') return void (await page.close());
        await slice(page);
        const used = await filamentsInPreview(page);
        await shot(page, `${engine}-u1-preview`);
        expect(used.join() === '1,2,3,4,5,6,7,8', `the Preview lists filaments ${used.join()}`);
        await page.close();
      });
} catch {
  // reported by step()
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log(`FILAMENT COUNT OK (${results.length} tests)`);
process.exit();
