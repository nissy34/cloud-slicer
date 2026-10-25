#!/usr/bin/env node
// Browser end to end for the loading screen over slow edits: cloning with
// Arrange on shows "Cloning and arranging" over the 3D view and by the Slice
// button, once, until the copies are drawn; every copy ends up on the plate
// (also the ones the engine first put past its edge); Arrange alone shows it
// once too, a quick edit (Mirror) not at all, and a failing one (Split to
// parts of a single piece) long enough to read before its message.
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

// Notes each change of the bar by Slice and of the loading screen, its going
// included (null), so a short one is not missed (Playwright's own polling can
// stall while the page is busy).
const watch = (page) =>
  page.evaluate(() => {
    const seen = (window.__seen = { bar: [], overlay: [], since: 0, gone: 0, frozen: [] });
    new MutationObserver(() => {
      for (const [key, sel] of [['bar', '.actionbar .status'], ['overlay', '.loading-overlay']]) {
        const text = document.querySelector(sel)?.textContent ?? null;
        if (seen[key].at(-1) !== text && (seen[key].length || text)) {
          seen[key].push(text);
          if (key === 'overlay' && !text) seen.gone = performance.now();
          if (key === 'overlay' && text && !seen.since) seen.since = performance.now();
        }
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    // Times the page was held up (drawing the copies...) for over half a second.
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (window.__seen === seen && e.duration > 500) seen.frozen.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask' });
  });
// Waits until no loading screen is up and nothing has changed for 2 s.
async function settle(page) {
  let last = '';
  for (let quiet = 0, k = 0; quiet < 4 && k < 240; k++) {
    await page.waitForTimeout(500);
    const now = await page.evaluate(() => JSON.stringify(window.__seen) + !!document.querySelector('.loading-overlay'));
    quiet = now === last && now.endsWith('false') ? quiet + 1 : 0;
    last = now;
  }
  return page.evaluate(() => window.__seen);
}
// How often the loading screen came up.
const shows = (seen) => seen.overlay.filter(Boolean).length;
// The page held up after the loading screen went: it went too early.
const frozenAfter = (seen) => seen.frozen.filter(([start]) => seen.gone && start >= seen.gone);
const objectMenu = async (page) => {
  await page.locator('ul.objects > li.object').first().locator(':scope > .object-row').getByRole('button', { name: /^More for / }).click();
  return page.locator('.object-menu');
};

// Clones the first object `copies` times with Arrange on (the form's default).
async function clone(page, copies, name) {
  const menu = await objectMenu(page);
  await menu.getByRole('menuitem', { name: 'Clone…' }).click();
  await menu.getByLabel('Number of copies').fill(String(copies));
  await watch(page);
  const started = Date.now();
  await menu.getByRole('button', { name: 'Clone' }).click();
  // The clone takes seconds.
  if (shots) await page.waitForTimeout(800).then(() => page.screenshot({ path: join(shots, `${name}.png`) }));
  const seen = await settle(page);
  // Every copy ends up on the plate, not only the ones that started on it.
  const count = await page.locator('ul.objects > li.object').count();
  if (count !== copies + 1) fail(`${name}: ${count} objects on the plate, not ${copies + 1}`);
  // Once, for the clone and the arrange together (no gap between them), in the
  // bar by Slice (all a phone shows while its settings are open) too.
  if (shows(seen) !== 1 || !seen.overlay[0]?.includes('Cloning and arranging')) fail(`${name}: the loading screen should come up once, "Cloning and arranging" (saw ${JSON.stringify(seen.overlay)})`);
  if (frozenAfter(seen).length) fail(`${name}: the loading screen went before the copies were drawn (page held up after it: ${JSON.stringify(frozenAfter(seen))})`);
  if (!seen.bar.includes('Cloning and arranging…')) fail(`${name}: no "Cloning and arranging…" by the Slice button (saw ${JSON.stringify(seen.bar)})`);
  if (shots) await page.screenshot({ path: join(shots, `${name}-done.png`) });
  console.log(`${name}: ${copies} copies, all on the plate, the loading screen up once, for ${Date.now() - started} ms in all`);
}

try {
  const desktop = await open({ width: 1400, height: 900 }, false);
  // A quick edit does not flash it.
  const menu = await objectMenu(desktop);
  await menu.getByRole('menuitem', { name: 'Mirror' }).click();
  await watch(desktop);
  await menu.getByRole('menuitem', { name: 'Along X axis' }).click();
  const mirrored = await settle(desktop);
  if (shows(mirrored)) fail(`a quick Mirror showed the loading screen (${JSON.stringify(mirrored.overlay)})`);
  else console.log('a quick edit (Mirror) shows no loading screen');

  await clone(desktop, 8, 'clone-desktop');

  // Arrange on its own shows it at once, and keeps it until the plate is redrawn.
  await watch(desktop);
  await desktop.getByRole('button', { name: 'Arrange all objects' }).click();
  const arranged = await settle(desktop);
  if (shows(arranged) !== 1 || !arranged.overlay[0]?.includes('Arranging all plates')) fail(`Arrange: the loading screen should come up once (saw ${JSON.stringify(arranged.overlay)})`);
  else if (frozenAfter(arranged).length) fail(`Arrange: the loading screen went before the plate was drawn (${JSON.stringify(frozenAfter(arranged))})`);
  else console.log('Arrange shows "Arranging all plates" once, until the plate is drawn');

  // A failing edit: the loading screen does not flash before its message.
  const first = desktop.locator('ul.objects > li.object').first();
  if (!(await first.getAttribute('class')).includes('active')) await first.locator('.object-name').click();
  await watch(desktop);
  await desktop.getByRole('toolbar').first().getByRole('button', { name: 'Split to parts' }).click();
  await desktop.getByText('The parts are single pieces.').waitFor({ timeout: 30000 });
  const split = await settle(desktop);
  const upFor = split.gone - split.since;
  if (shows(split) !== 1 || upFor < 450) fail(`Split to parts: the loading screen flashed before the error (${Math.round(upFor)} ms, ${JSON.stringify(split.overlay)})`);
  else console.log(`a failing Split shows the loading screen for ${Math.round(upFor)} ms, then its message`);
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
