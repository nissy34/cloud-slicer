#!/usr/bin/env node
// Browser end to end for one preset in both engines (src/lib/preset-engines.ts),
// signed out so it lives in this browser: a process preset saved in Snapmaker
// Orca shows in OrcaSlicer on its stand-in base with the same layer height; a
// change saved in OrcaSlicer shows back in Snapmaker Orca, and OrcaSlicer's own
// base is kept for it. A filament preset with a new print temperature does the
// same, on OrcaSlicer's stand-in for its base filament.
//
//   node test/shared-presets.mjs [screenshot-dir]
//
// Needs `npm run build` first, with both engines copied (public/engine and
// public/engine-orca).
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4182;

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

const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const processPicker = page.getByRole('combobox', { name: 'Process preset' });
  const processMenu = page.getByRole('button', { name: 'Process preset actions' });
  const pop = page.getByRole('dialog', { name: 'process preset' });
  const layer = () => page.getByLabel('Layer height', { exact: true });
  const layerIs = async (want) => {
    for (let i = 0; i < 120; i++) {
      if ((await layer().inputValue().catch(() => '')) === want) return;
      await page.waitForTimeout(500);
    }
    throw new Error(`layer height is ${await layer().inputValue()}, not ${want}`);
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cloud-slicer:user-presets:v1') || '[]'));
  const engineIs = (name) =>
    page.waitForFunction((n) => document.querySelector('.engine-badge')?.textContent?.startsWith(n), name, { timeout: 120000 });
  const ready = async (name) => {
    await engineIs(name);
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    await processPicker.waitFor();
  };
  const filamentPicker = page.getByRole('combobox', { name: 'Filament 1 preset' });
  const filamentEditor = page.getByRole('dialog', { name: /^Filament (1 )?settings$/ });
  const temperature = () =>
    filamentEditor.locator('fieldset', { has: page.locator('legend', { hasText: 'Print temperature' }) }).getByLabel('Other layers', { exact: true });
  const openFilamentEditor = async () => {
    await page.getByRole('button', { name: 'Edit filament 1 settings' }).click();
    await temperature().waitFor();
  };
  const switchTo = async (name) => {
    await page.getByTestId('engine-chip').click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
    await ready(name);
  };

  await page.goto(url);
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 120000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  await ready('Snapmaker Orca');
  const snapBase = await processPicker.inputValue();

  await step('a process preset saved in Snapmaker Orca', async () => {
    await layer().fill('0.28');
    await layer().press('Enter');
    await page.getByText(/settings? changed from the presets/).waitFor();
    await processMenu.click();
    await pop.getByRole('button', { name: 'Save as new preset…' }).click();
    await pop.getByRole('textbox').fill('Both engines');
    await pop.getByRole('button', { name: 'Save', exact: true }).click();
    await pop.waitFor({ state: 'detached', timeout: 60000 });
    const [p] = await stored();
    expect(p?.inherits === snapBase && p.config.layer_height === '0.28', JSON.stringify(p));
  });

  await step('shows in OrcaSlicer with the same layer height', async () => {
    await switchTo('OrcaSlicer');
    await processPicker.selectOption('Both engines');
    await layerIs('0.28');
    await processMenu.click();
    await pop.getByText('Your presets are in Snapmaker Orca too').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'preset-in-orca.png') });
    await page.keyboard.press('Escape');
  });

  await step('a change saved in OrcaSlicer keeps its own base', async () => {
    await layer().fill('0.24');
    await layer().press('Enter');
    await page.getByText(/settings? changed from the presets/).waitFor();
    await processMenu.click();
    await pop.getByRole('button', { name: 'Save changes' }).click();
    await pop.waitFor({ state: 'detached', timeout: 60000 });
    const [p] = await stored();
    expect(p.inherits === snapBase && p.config.layer_height === '0.24', JSON.stringify(p));
    expect(p.engines?.orca?.inherits?.startsWith('0.20 Standard @Snapmaker U1'), `OrcaSlicer base ${p.engines?.orca?.inherits}`);
    expect(p.engines?.shared >= 1, 'saved with the shared-settings version');
  });

  await step('and shows back in Snapmaker Orca', async () => {
    await switchTo('Snapmaker Orca');
    await processPicker.selectOption('Both engines');
    await layerIs('0.24');
  });

  await step('a filament preset saved in Snapmaker Orca', async () => {
    await openFilamentEditor();
    await temperature().fill('231');
    await temperature().press('Enter');
    await filamentEditor.getByText('1 unsaved change').waitFor();
    await filamentEditor.getByRole('button', { name: 'Save as new preset…' }).click();
    await filamentEditor.getByRole('textbox', { name: /preset name/ }).fill('Hot PLA');
    await filamentEditor.getByRole('button', { name: 'Save', exact: true }).click();
    await filamentEditor.getByText('Saved as Hot PLA.').waitFor({ timeout: 60000 });
    await filamentEditor.getByRole('button', { name: 'Close' }).click();
    const p = (await stored()).find((x) => x.name === 'Hot PLA');
    expect(p?.type === 'filament' && /^231/.test(p.config.nozzle_temperature ?? ''), JSON.stringify(p));
  });

  await step('shows in OrcaSlicer with the same print temperature', async () => {
    await switchTo('OrcaSlicer');
    await filamentPicker.selectOption('Hot PLA');
    await openFilamentEditor();
    for (let i = 0; i < 60 && (await temperature().inputValue()) !== '231'; i++) await page.waitForTimeout(500);
    expect((await temperature().inputValue()) === '231', `print temperature ${await temperature().inputValue()}`);
    if (shots) await page.screenshot({ path: join(shots, 'filament-in-orca.png') });
    await filamentEditor.getByRole('button', { name: 'Close' }).click();
  });
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log(`SHARED PRESETS OK (${results.length} tests)`);
process.exit();
