#!/usr/bin/env node
// Browser end to end: serve the built site, open a model, slice, download the
// G-code and check it is a real U1 print file.
//
//   node test/smoke.mjs [model] [screenshot.png]
//   SMOKE_URL=https://… node test/smoke.mjs      # test a deployed site instead
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = resolve(process.argv[2] ?? join(web, '../../fixtures/3DBenchy.stl'));
const shot = process.argv[3] ? resolve(process.argv[3]) : null;
const PORT = 4173;

let server;
let url = process.env.SMOKE_URL;
if (!url) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe' });
  url = `http://localhost:${PORT}/`;
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
}

const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);

  if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error('page is not cross-origin isolated (COOP/COEP)');
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  console.log('engine ready');

  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  console.log(`loaded ${model}`);

  const t0 = Date.now();
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
  console.log(`sliced in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${await page.getByTestId('slice-stats').innerText()}`);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download G-code' }).click(),
  ]);
  const gcode = readFileSync(await download.path(), 'utf8');
  if (!/^PRINT_START/m.test(gcode)) fail('G-code has no PRINT_START (U1 start G-code missing)');
  if (!/^EXCLUDE_OBJECT_DEFINE/m.test(gcode)) fail('G-code has no EXCLUDE_OBJECT_DEFINE');
  const layers = (gcode.match(/^;LAYER_CHANGE/gm) ?? []).length;
  if (layers < 10) fail(`only ${layers} layers`);
  console.log(`${download.suggestedFilename()}: ${(gcode.length / 1e6).toFixed(1)} MB, ${layers} layers`);

  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  await page.getByTestId('layer-label').waitFor({ timeout: 120000 });
  console.log(`preview: layer ${await page.getByTestId('layer-label').innerText()}`);

  if (shot) await page.screenshot({ path: shot });
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  server?.kill();
}
if (!process.exitCode) console.log('SMOKE OK');
