#!/usr/bin/env node
// Browser end to end for converting a Bambu Lab project to the U1: only the
// model settings the project's author changed come along (Bambu Studio lists
// them in different_settings_to_system); the ones left at Bambu's defaults,
// like its 0.2 mm first layer, take the U1's. The same project with that list
// removed shows the old behaviour, every model setting that differs.
//
//   node test/convert.mjs
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;
const projectPath = join(web, '../../fixtures/Button-for-S-trousers.3mf');

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

// The same project without the list of changed settings.
function withoutChangedList(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const name = 'Metadata/project_settings.config';
  const config = JSON.parse(strFromU8(files[name]));
  delete config.different_settings_to_system;
  files[name] = strToU8(JSON.stringify(config));
  return Buffer.from(zipSync(files));
}

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
  // Opens `file`, converts it to the U1 keeping the model settings, and
  // returns how many settings came from the project.
  const convert = async (file) => {
    await page.goto(url);
    await ready();
    await page.getByTestId('model-input').setInputFiles(file);
    const dialog = page.getByRole('dialog', { name: 'Convert this project?' });
    await dialog.waitFor({ timeout: 120000 });
    await dialog.getByRole('button', { name: 'Convert' }).click();
    const notice = page.getByText(/Converted from Bambu Lab H2D/);
    await notice.waitFor({ timeout: 120000 });
    const text = await notice.textContent();
    console.log(`  ${text.trim()}`);
    return Number(/Loaded (\d+) setting/.exec(text)?.[1] ?? 0);
  };
  const firstLayer = () => page.getByLabel('Initial layer height', { exact: true }).inputValue();

  let before = 0;
  await step('without the list of changed settings, every differing model setting is kept (old behaviour)', async () => {
    before = await convert({ name: 'Button-for-S-trousers.3mf', mimeType: 'model/3mf', buffer: withoutChangedList(readFileSync(projectPath)) });
    expect(before > 0, 'some settings kept');
    expect((await firstLayer()) === '0.2', `first layer ${await firstLayer()}`);
  });

  await step('with it, only what the author changed is kept; the rest are the U1 defaults', async () => {
    const after = await convert(projectPath);
    console.log(`  changed settings: ${before} before, ${after} after`);
    expect(after < before, `${after} not fewer than ${before}`);
    // The author changed only print_sequence (by object), which the U1 preset has too.
    expect(after <= 1, `${after} settings kept`);
    expect((await firstLayer()) !== '0.2', 'first layer is the U1 default, not Bambu\'s 0.2');
  });
} catch {
  // reported by step()
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log(`CONVERT OK (${results.length} tests)`);
process.exit();
