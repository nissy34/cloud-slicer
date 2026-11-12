#!/usr/bin/env node
// Browser end to end for slicing in the background
// (docs/architecture/background-slicing.md): while a plate slices the screen is
// kept awake and the tab title shows the progress; a slice that ends while the
// page is hidden shows a "Slicing done" notification; afterwards the screen may
// sleep again and the title is back. On a phone (touch first) there is no
// notification: a hidden page stops slicing there, so it has to stay on screen.
//
//   node test/background-slice.mjs
//
// Needs `npm run build` first (with the engine copied into public/engine).
// Headless Chromium has no screen to keep awake and no notifications to show, so
// the page's wake lock, notification permission, visibility and service worker
// notifications are stand-ins that record what the app asked for.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
const PORT = 4179;

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
  console.error(`BACKGROUND SLICE FAIL: ${msg}`);
  process.exitCode = 1;
};
const expect = (ok, msg) => ok || fail(msg);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
async function run(phone) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  // Same layout, only the pointer says "touch", so the steps below stay the same.
  if (phone) await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(pointer: coarse)' ? { ...real(q), matches: true, media: q } : real(q));
  });
  await page.addInitScript(() => {
    const log = (window.__bg = { held: 0, asked: 0, notes: [], hidden: false });
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        async request() {
          if (log.hidden) throw new Error('NotAllowedError: page hidden');
          log.asked++;
          log.held++;
          const t = new EventTarget();
          let done = false;
          t.release = async () => {
            if (done) return;
            done = true;
            log.held--;
            t.dispatchEvent(new Event('release'));
          };
          window.__bgLock = t;
          return t;
        },
      },
    });
    Object.defineProperty(window, 'Notification', { value: { permission: 'granted', requestPermission: async () => 'granted' } });
    Object.defineProperty(document, 'visibilityState', { get: () => (log.hidden ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { get: () => log.hidden });
    window.__hide = (h) => {
      log.hidden = h;
      // The browser lets go of the wake lock when the page is hidden.
      if (h) void window.__bgLock?.release();
      document.dispatchEvent(new Event('visibilitychange'));
    };
    ServiceWorkerRegistration.prototype.showNotification = async function (title, options) {
      log.notes.push({ title, body: options?.body ?? '' });
    };
  });
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Close window' }).click();
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  const title = await page.title();
  const bg = () => page.evaluate(() => window.__bg);
  const stats = page.getByTestId('slice-stats');

  // On screen: awake while slicing, progress in the title, no notification at the end.
  await page.getByRole('button', { name: 'Slice plate' }).click();
  await page.waitForFunction(() => /^\d+% · Slicing · /.test(document.title), null, { timeout: 30000 });
  await page.waitForFunction(() => window.__bg.held === 1, null, { timeout: 10000 });
  await stats.waitFor({ timeout: 300000 });
  await page.waitForTimeout(500);
  let b = await bg();
  expect(b.held === 0, `screen still kept awake after the slice (${b.held})`);
  expect((await page.title()) === title, `title not restored: "${await page.title()}"`);
  expect(b.notes.length === 0, `notified while on screen: ${JSON.stringify(b.notes)}`);

  // Hidden mid-slice, back, hidden again: awake again on return; notified at the end (not on a phone).
  await page.getByRole('tab', { name: 'Prepare' }).click();
  const field = page.getByLabel('Layer height', { exact: true });
  await field.fill('0.24');
  await field.press('Enter');
  await stats.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Slice plate' }).click();
  await page.waitForFunction(() => window.__bg.held === 1, null, { timeout: 30000 });
  const asked = (await bg()).asked;
  await page.evaluate(() => window.__hide(true));
  await page.evaluate(() => window.__hide(false));
  await page.waitForFunction((n) => window.__bg.asked > n && window.__bg.held === 1, asked, { timeout: 10000 }).catch(() => {});
  b = await bg();
  expect(b.held === 1 && b.asked > asked, `screen not kept awake again after coming back (held ${b.held}, asked ${b.asked})`);
  await page.evaluate(() => window.__hide(true));
  if (phone) {
    // Still "hidden" to the app; the stand-in only fakes visibility, so the result still draws.
    await stats.waitFor({ timeout: 300000 });
    await page.waitForTimeout(1000);
  } else await page.waitForFunction(() => window.__bg.notes.length > 0, null, { timeout: 300000 });
  b = await bg();
  if (phone) expect(b.notes.length === 0, `notified on a phone: ${JSON.stringify(b.notes)}`);
  else expect(b.notes[0]?.title === 'Slicing done', `notification: ${JSON.stringify(b.notes)}`);
  await page.waitForFunction(() => window.__bg.held === 0, null, { timeout: 10000 }).catch(() => {});
  expect((await bg()).held === 0, 'screen kept awake after the slice');
  await page.evaluate(() => window.__hide(false));
  expect((await page.title()) === title, `title not restored after a hidden slice: "${await page.title()}"`);
  console.log(`background slice (${phone ? 'phone' : 'computer'}): ${JSON.stringify(b.notes)}`);
  await page.close();
}

try {
  await run(false);
  await run(true);
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
