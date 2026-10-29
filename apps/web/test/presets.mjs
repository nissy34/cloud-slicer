#!/usr/bin/env node
// Browser end to end for the user's own presets (signed out, so they live in
// this browser): change a setting, save it as a process preset, find it again
// after a reload (an unsaved change is not), rename it, save a filament preset
// from a slot, delete both.
//
//   node test/presets.mjs
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pickerOf } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4174;

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

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const ready = async () => {
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
    if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('combobox', { name: 'Process preset' }).waitFor();
  };
  const processPicker = pickerOf(page, 'Process preset');
  const processMenu = page.getByRole('button', { name: 'Process preset actions' });
  const pop = page.getByRole('dialog', { name: 'process preset' });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cloud-slicer:user-presets:v1') || '[]'));

  await page.goto(url);
  await ready();
  const systemProcess = await processPicker.inputValue();

  await step('a changed setting saves as a new process preset', async () => {
    const layer = page.getByLabel('Layer height', { exact: true });
    await layer.fill('0.28');
    await layer.press('Enter');
    await page.getByText(/settings? changed from the presets/).waitFor();
    await processMenu.click();
    await pop.getByText('1 unsaved change').waitFor();
    await pop.getByRole('button', { name: 'Save as new preset…' }).click();
    await pop.getByRole('textbox').fill('My fast');
    await pop.getByRole('button', { name: 'Save', exact: true }).click();
    await pop.waitFor({ state: 'detached', timeout: 60000 });
    expect((await processPicker.inputValue()) === 'My fast', `selected ${await processPicker.inputValue()}`);
    expect((await page.getByLabel('Layer height', { exact: true }).inputValue()) === '0.28', 'layer height kept');
    expect(!(await page.getByText(/settings? changed from the presets/).isVisible()), 'the change is now part of the preset');
    const saved = await stored();
    expect(saved.length === 1 && saved[0].type === 'process' && saved[0].inherits === systemProcess, JSON.stringify(saved));
    expect(saved[0].config.layer_height === '0.28' && !('print_settings_id' in saved[0].config), JSON.stringify(saved[0].config));
  });

  await step('the preset is there after a reload, still selected', async () => {
    await page.reload();
    await ready();
    expect((await processPicker.inputValue()) === 'My fast', `selected ${await processPicker.inputValue()}`);
    expect((await page.getByLabel('Layer height', { exact: true }).inputValue()) === '0.28', 'layer height from the preset');
  });

  await step('an unsaved change is gone after a reload, the preset stays', async () => {
    const layer = page.getByLabel('Layer height', { exact: true });
    await layer.fill('0.3');
    await layer.press('Enter');
    await page.getByText(/settings? changed from the presets/).waitFor();
    await page.reload();
    await ready();
    expect((await processPicker.inputValue()) === 'My fast', `selected ${await processPicker.inputValue()}`);
    expect((await page.getByLabel('Layer height', { exact: true }).inputValue()) === '0.28', 'layer height back to the preset');
    expect(!(await page.getByText(/settings? changed from the presets/).isVisible()), 'no changed settings after a reload');
  });

  await step('rename keeps it selected', async () => {
    await processMenu.click();
    await pop.getByRole('button', { name: 'Rename…' }).click();
    await pop.getByRole('textbox').fill('My draft');
    await pop.getByRole('button', { name: 'Rename' }).click();
    await pop.waitFor({ state: 'detached', timeout: 60000 });
    expect((await processPicker.inputValue()) === 'My draft', `selected ${await processPicker.inputValue()}`);
    const saved = await stored();
    expect(saved.length === 1 && saved[0].name === 'My draft', JSON.stringify(saved.map((p) => p.name)));
  });

  await step('a filament slot saves its own preset', async () => {
    await page.getByRole('button', { name: 'Filament preset actions (filament 1)' }).click();
    const fpop = page.getByRole('dialog', { name: 'filament preset' });
    await fpop.getByRole('button', { name: 'Save as new preset…' }).click();
    await fpop.getByRole('textbox').fill('My PLA');
    await fpop.getByRole('button', { name: 'Save', exact: true }).click();
    await fpop.waitFor({ state: 'detached', timeout: 60000 });
    const slot = pickerOf(page, 'Filament 1 preset');
    expect((await slot.inputValue()) === 'My PLA', `slot 1 is ${await slot.inputValue()}`);
    expect((await stored()).some((p) => p.type === 'filament' && p.name === 'My PLA'), 'stored');
  });

  await step('delete goes back to the system preset', async () => {
    await processMenu.click();
    await pop.getByRole('button', { name: 'Delete…' }).click();
    await pop.getByRole('button', { name: 'Delete', exact: true }).click();
    await pop.waitFor({ state: 'detached', timeout: 60000 });
    expect((await processPicker.inputValue()) === systemProcess, `selected ${await processPicker.inputValue()}`);
    expect(!(await processPicker.choices()).some((c) => c.includes('My draft')), 'gone from the list');
    expect((await stored()).every((p) => p.type !== 'process'), 'removed from storage');
  });
} catch {
  // reported by step()
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log(`PRESETS OK (${results.length} tests)`);
process.exit();
