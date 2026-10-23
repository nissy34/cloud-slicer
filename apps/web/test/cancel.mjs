#!/usr/bin/env node
// Browser end to end for stopping a slice: the Cancel button next to the
// progress bar, and (like desktop Orca) a change while slicing stops the slice
// and drops its result. Also checks the engine really stops, rather than the
// page only hiding a slice that keeps running.
//
//   node test/cancel.mjs
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
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
  console.error(`CANCEL FAIL: ${msg}`);
  process.exitCode = 1;
};
const expect = (ok, msg) => ok || fail(msg);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  const sliceButton = page.getByRole('button', { name: 'Slice plate' });
  const cancel = page.getByTestId('actionbar').getByRole('button', { name: 'Cancel' });
  const stats = page.getByTestId('slice-stats');
  const prepare = () => page.getByRole('tab', { name: 'Prepare' }).click();
  const layers = async () => Number((await stats.getAttribute('data-layers')) ?? 0);

  // A full slice, for timing the ones below.
  let t0 = Date.now();
  await sliceButton.click();
  await stats.waitFor({ timeout: 300000 });
  const full = Date.now() - t0;
  const layersAt020 = await layers();
  console.log(`full slice: ${full} ms, ${layersAt020} layers`);
  await prepare();

  // Cancel at once, then slice again: when the engine really stopped, the new
  // result comes in about one slice later, not after the rest of the old one too.
  await sliceButton.click();
  await cancel.waitFor();
  await cancel.click();
  await page.getByText('Slicing cancelled.').waitFor();
  expect(await sliceButton.isEnabled(), 'Slice button is back after Cancel');
  expect(!(await stats.isVisible()), 'no result after Cancel');
  t0 = Date.now();
  await sliceButton.click();
  await stats.waitFor({ timeout: 300000 });
  const again = Date.now() - t0;
  console.log(`cancel, then slice again: ${again} ms`);
  expect(again < full * 1.5 + 2000, `the cancelled slice kept the engine busy (${again} ms vs a full slice of ${full} ms)`);
  await prepare();

  // A setting changed mid-slice stops the slice; its result never shows as current.
  await sliceButton.click();
  await cancel.waitFor();
  const layer = page.getByLabel('Layer height', { exact: true });
  await layer.fill('0.28');
  await layer.press('Enter');
  await page.getByText('Slicing stopped because something changed').waitFor({ timeout: 10000 });
  expect(await sliceButton.isEnabled(), 'Slice button is back after a setting change');
  await page.waitForTimeout(full + 2000);
  expect(!(await stats.isVisible()), 'the stopped slice still showed a result');
  await sliceButton.click();
  await stats.waitFor({ timeout: 300000 });
  const layersAt028 = await layers();
  expect(layersAt028 < layersAt020, `new slice uses the new layer height (${layersAt028} vs ${layersAt020} layers)`);
  await prepare();

  // An edit the engine makes (the filament colour) also stops a running slice.
  await sliceButton.click();
  await cancel.waitFor();
  await page.getByLabel('Filament 1 colour').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '#ff0000');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByText('Slicing stopped because something changed').waitFor({ timeout: 10000 });
  await page.waitForTimeout(full + 2000);
  expect(!(await stats.isVisible()), 'the slice stopped by a colour change still showed a result');

  // Phone width: Cancel sits next to the progress bar too.
  await page.setViewportSize({ width: 390, height: 844 });
  await sliceButton.click();
  await cancel.waitFor();
  const bar = await page.getByTestId('actionbar').getByRole('progressbar').boundingBox();
  const box = await cancel.boundingBox();
  expect(bar && box && Math.abs(bar.y + bar.height / 2 - (box.y + box.height / 2)) < 20 && box.x + box.width <= 390, 'Cancel beside the progress bar on a phone');
  await cancel.click();
  await page.getByText('Slicing cancelled.').waitFor();

  if (!process.exitCode) console.log('cancel OK');
} catch (e) {
  fail(e.stack ?? e.message);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
