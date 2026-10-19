#!/usr/bin/env node
// Browser end to end for the loading screen: on a slow connection the engine
// start shows the printing-nozzle loader with download progress, it goes away
// once the engine is ready, opening a project shows it again, and so does the
// Preview while it reads the G-code after a slice.
//
//   node test/loading.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(web, '../../fixtures/colored_3DBenchy.3mf');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4175;

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
  console.error(`LOADING FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  // About 40 Mbit/s, so the engine download takes a few seconds (worker fetches included).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 5e6, uploadThroughput: 5e6 });
  await page.goto(url);

  const loader = page.getByTestId('print-loader');
  await loader.getByText('Downloading the slicing engine').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => / MB of \d+ MB/.test(document.querySelector('.pl-detail')?.textContent ?? ''), null, { timeout: 30000 });
  const detail = await loader.locator('.pl-detail').textContent();
  const [, total] = detail.match(/of (\d+) MB/) ?? [];
  if (!(Number(total) >= 5)) fail(`engine download total looks wrong: "${detail}"`);
  const bar = Number(await loader.getByRole('progressbar').getAttribute('aria-valuenow'));
  if (!(bar > 0 && bar < 100)) fail(`progress bar should be part way, got ${bar}`);
  console.log(`engine downloading: ${detail} (${bar}%)`);
  if (shots) await page.screenshot({ path: join(shots, 'engine-download.png') });

  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  if (await loader.isVisible()) fail('loader still shown after the engine is ready');
  console.log('engine ready, loader gone');

  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();

  // Remember every label the loader shows while the project opens (it can be quick).
  await page.evaluate(() => {
    window.loaderLabels = [];
    new MutationObserver(() => {
      const label = document.querySelector('[data-testid="print-loader"] .pl-label')?.textContent;
      if (label && !window.loaderLabels.includes(label)) window.loaderLabels.push(label);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByTestId('model-input').setInputFiles(project);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  const labels = await page.evaluate(() => window.loaderLabels);
  if (!labels.includes('Opening colored_3DBenchy.3mf')) fail(`no loader while opening the project, saw ${JSON.stringify(labels)}`);
  if (await loader.isVisible()) fail('loader still shown after the project opened');
  console.log(`project opened, loader showed ${JSON.stringify(labels)}`);

  // After slicing, the Preview shows the loader while it reads the G-code and
  // builds the 3D view, and takes it away once the toolpaths are drawn.
  await page.evaluate(() => (window.loaderLabels = []));
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('layer-label').waitFor({ timeout: 600000 });
  await loader.waitFor({ state: 'hidden', timeout: 60000 });
  const previewLabels = await page.evaluate(() => window.loaderLabels);
  for (const want of ['Reading the G-code', 'Drawing the preview'])
    if (!previewLabels.includes(want)) fail(`no "${want}" loader before the preview, saw ${JSON.stringify(previewLabels)}`);
  console.log(`preview drawn, loader showed ${JSON.stringify(previewLabels)}`);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
