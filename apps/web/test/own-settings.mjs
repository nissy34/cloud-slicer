#!/usr/bin/env node
// Browser end to end for a project remembering which settings are yours, as
// desktop Orca does (different_settings_to_system): a saved project lists the
// settings you changed, and opening it takes only those on top of the presets,
// so a value the presets have changed since (an engine or preset update) comes
// from today's presets. A project without the list keeps every value it has.
//
//   node test/own-settings.mjs
//
// Needs `npm run build` first.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/tetrahedron.stl');
const PORT = 4193;

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

const SETTINGS = 'Metadata/project_settings.config';
// The saved project as if the presets had changed since: a setting you never
// touched has another value in the file. `keepList` false also drops the list.
function olderPresets(buffer, keepList) {
  const files = unzipSync(new Uint8Array(buffer));
  const config = JSON.parse(strFromU8(files[SETTINGS]));
  config.top_shell_layers = '9';
  if (!keepList) delete config.different_settings_to_system;
  files[SETTINGS] = strToU8(JSON.stringify(config));
  return Buffer.from(zipSync(files));
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Close window' }).click());
  const layer = page.getByLabel('Layer height', { exact: true });
  const projectButton = page.getByRole('button', { name: /^Project/ });
  const open = async (buffer) => {
    await page.goto(url);
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    await page.getByTestId('model-input').setInputFiles({ name: 'mine.3mf', mimeType: 'model/3mf', buffer });
    const notice = page.getByText(/Loaded \d+ settings? from the project/);
    await notice.waitFor({ timeout: 120000 });
    const text = (await notice.textContent()).trim();
    console.log(`  ${text}`);
    return Number(/Loaded (\d+)/.exec(text)[1]);
  };

  let saved;
  await step('a saved project lists the settings you changed', async () => {
    await page.goto(url);
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    await page.getByTestId('model-input').setInputFiles(model);
    await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
    await layer.fill('0.16');
    await layer.press('Enter');
    await projectButton.click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download 3MF' }).click()]);
    saved = readFileSync(await download.path());
    const list = JSON.parse(strFromU8(unzipSync(new Uint8Array(saved))[SETTINGS])).different_settings_to_system;
    console.log(`  different_settings_to_system: ${JSON.stringify(list)}`);
    expect(Array.isArray(list) && list.some((e) => e.split(';').includes('layer_height')), 'layer_height listed');
    expect(!list.some((e) => e.split(';').includes('top_shell_layers')), 'top_shell_layers not listed');
  });

  await step('opening it takes only your changes; the rest comes from today\'s presets', async () => {
    const n = await open(olderPresets(saved, true));
    expect((await layer.inputValue()) === '0.16', `layer height ${await layer.inputValue()}`);
    expect(n === 1, `${n} settings loaded, expected only the layer height`);
  });

  await step('a project without the list keeps every value it has (as before)', async () => {
    const n = await open(olderPresets(saved, false));
    expect((await layer.inputValue()) === '0.16', `layer height ${await layer.inputValue()}`);
    expect(n === 2, `${n} settings loaded, expected the layer height and top shell layers`);
  });
} catch {
  // reported by step()
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log(`OWN SETTINGS OK (${results.length} tests)`);
process.exit();
