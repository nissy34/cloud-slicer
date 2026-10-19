#!/usr/bin/env node
// Browser end to end for the engine restarting itself after a crash (on a
// phone, most often running out of memory while slicing): the page starts a
// new engine, reopens the project and says what happened, and slicing works
// again. The crash is faked by firing the engine worker's error event, the
// way a wasm abort reaches the page.
//
//   node test/restart.mjs [screenshot.png]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
const PORT = 4176;

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
  console.error(`RESTART FAIL: ${msg}`);
  process.exitCode = 1;
};
const expect = (ok, msg) => ok || fail(msg);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  // Keep the engine workers, to crash the current one.
  await page.addInitScript(() => {
    const Real = window.Worker;
    window.__workers = [];
    window.Worker = class extends Real {
      constructor(...args) {
        super(...args);
        window.__workers.push(this);
      }
    };
  });
  const crash = () =>
    page.evaluate(() => {
      const w = window.__workers.filter((w) => w.onerror).at(-1);
      w.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught RuntimeError: unreachable' }));
    });
  const workers = () => page.evaluate(() => window.__workers.filter((w) => w.onerror).length);

  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  const sliceButton = page.getByRole('button', { name: 'Slice plate' });
  const cancel = page.getByTestId('actionbar').getByRole('button', { name: 'Cancel' });
  const stats = page.getByTestId('slice-stats');

  // A crash while slicing: a new engine starts and the model comes back.
  await sliceButton.click();
  await cancel.waitFor();
  // Past the copy the page keeps before slicing, into the slice itself.
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Slicing"]')?.getAttribute('aria-valuenow')) > 0, null, { timeout: 120000 });
  await crash();
  await page.getByText(/so it restarted/).waitFor({ timeout: 120000 });
  expect(await page.getByText('restarted and reopened your project').isVisible(), `project reopened: ${await page.getByTestId('actionbar').textContent()}`);
  expect(await workers() === 2, 'a second engine started');
  expect(!(await page.getByText('Changes made since your last slice were lost').isVisible()), 'nothing was lost');
  expect(!(await page.getByText('could not start').isVisible()), 'no "could not start" message');
  await page.getByText('Ready to slice').waitFor({ timeout: 10000 });

  // The new engine slices.
  await sliceButton.click();
  await stats.waitFor({ timeout: 300000 });

  // A crash after slicing comes back too.
  await crash();
  await page.getByText('restarted and reopened your project').waitFor({ timeout: 120000 });
  expect(await workers() === 3, 'a third engine started');
  await page.getByText('Ready to slice').waitFor({ timeout: 10000 });
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });

  if (!process.exitCode) console.log('restart OK');
} catch (e) {
  fail(e.stack ?? e.message);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
