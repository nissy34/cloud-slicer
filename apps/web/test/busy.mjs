#!/usr/bin/env node
// Browser end to end for the loading screen over slow edits: cloning with
// Arrange on shows "Cloning and arranging" over the 3D view and by the Slice
// button while it runs, every copy ends up on the plate (also the ones the
// engine first put past its edge), and the loading screen goes after.
//
//   node test/busy.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(web, '../../fixtures');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4181;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
const url = `http://localhost:${PORT}/`;
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`BUSY FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(join(fixtures, '3DBenchy.stl'));
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  return page;
}

// Notes each text the bar by Slice and the loading screen show, so a short
// one is not missed (Playwright's own polling can stall while the page is busy).
const watch = (page) =>
  page.evaluate(() => {
    const seen = (window.__seen = { bar: [], overlay: [] });
    new MutationObserver(() => {
      for (const [key, sel] of [['bar', '.actionbar .status'], ['overlay', '.loading-overlay']]) {
        const text = document.querySelector(sel)?.textContent;
        if (text && seen[key].at(-1) !== text) seen[key].push(text);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

// Clones the first object `copies` times with Arrange on (the form's default).
async function clone(page, copies, name) {
  await page.locator('ul.objects > li.object').first().locator(':scope > .object-row').getByRole('button', { name: /^More for / }).click();
  const menu = page.locator('.object-menu');
  await menu.getByRole('menuitem', { name: 'Clone…' }).click();
  await menu.getByLabel('Number of copies').fill(String(copies));
  await watch(page);
  const started = Date.now();
  await menu.getByRole('button', { name: 'Clone' }).click();
  // The loading screen shows after a short wait; the clone takes seconds.
  if (shots) await page.waitForTimeout(800).then(() => page.screenshot({ path: join(shots, `${name}.png`) }));
  // Every copy ends up on the plate, not only the ones that started on it.
  await page.waitForFunction((n) => document.querySelectorAll('ul.objects > li.object').length === n, copies + 1, { timeout: 120000 });
  await page.locator('.actionbar .status', { hasText: 'Ready to slice' }).waitFor({ timeout: 30000 });
  if (await page.locator('.loading-overlay').count()) fail(`${name}: the loading screen stayed after cloning`);
  const seen = await page.evaluate(() => window.__seen);
  // In the bar by Slice (all a phone shows while its settings are open) and,
  // on a desktop, over the 3D view.
  if (!seen.bar.includes('Cloning and arranging…')) fail(`${name}: no "Cloning and arranging…" by the Slice button (saw ${JSON.stringify(seen.bar)})`);
  if (!seen.overlay.some((t) => t.includes('Cloning and arranging'))) fail(`${name}: no loading screen while cloning`);
  if (shots) await page.screenshot({ path: join(shots, `${name}-done.png`) });
  console.log(`${name}: ${copies} copies, all on the plate, in ${Date.now() - started} ms with the loading screen up`);
}

try {
  const desktop = await open({ width: 1400, height: 900 }, false);
  await clone(desktop, 8, 'clone-desktop');
  await desktop.close();

  const phone = await open({ width: 390, height: 844 }, true);
  await clone(phone, 4, 'clone-phone');
  await phone.close();
} catch (e) {
  fail(e.stack || e.message);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
