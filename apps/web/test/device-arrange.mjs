#!/usr/bin/env node
// Arranging the Device tab cards (device/layout.ts, device/ui/Arrange.tsx), against a pretend U1 only
// (test/device/mock-printer.mjs): move a card across the top, hide one, half width, 3 columns, fold,
// reload (kept), back to default; then the phone's one column.
//
//   npm run build && node test/device-arrange.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startMockPrinter } from './device/mock-printer.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PAGE_PORT = 4176;
const children = [];

function serve(cmd, args, cwd, ready) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, NO_COLOR: '1' },
  });
  children.push(child);
  let log = '';
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`${cmd} ${args.join(' ')} did not start:\n${log}`)), 90_000);
    const watch = (d) => {
      log += d;
      if (ready.test(log)) {
        clearTimeout(timer);
        ok();
      }
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => fail(new Error(`${cmd} exited (${code}):\n${log}`)));
  });
}

const fail = (msg) => {
  throw new Error(msg);
};

/** Drags a card by its grip onto a target, in small steps (the drag starts after a few pixels). */
async function drag(page, card, target) {
  // A tall window, so the card and where it goes are both on screen.
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: 2400 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const grip = page.getByTestId(`grip-${card}`);
  const from = await grip.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 4 });
  const to = await target.boundingBox();
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 30), { steps: 20 });
  await page.waitForTimeout(150);
  await page.mouse.move(to.x + to.width / 2 + 2, to.y + Math.min(to.height / 2, 30) + 2, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.setViewportSize(size);
}

const zoneOf = (page, card) => page.locator(`[data-card='${card}']`).evaluate((el) => el.closest('[data-zone]')?.getAttribute('data-zone') ?? null);

const u1 = await startMockPrinter();
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
let failShot;
try {
  await serve('npx', ['vite', 'preview', '--port', String(PAGE_PORT), '--strictPort'], web, new RegExp(String(PAGE_PORT)));
  const site = `http://localhost:${PAGE_PORT}/`;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.grantPermissions(['notifications'], {
    origin: site.replace(/\/$/, ''),
  });
  const page = await context.newPage();
  failShot = page;
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Not now' }).click());
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(site);
  await page.evaluate((url) => localStorage.setItem('cloud-slicer:printers:v1', JSON.stringify([{ id: 'u1', name: 'U1-mock', kind: 'direct', url, apiKey: '' }])), u1.url);
  const open = async (p) => {
    await p.reload();
    await p.getByRole('tab', { name: 'Device' }).click();
    await p.getByTestId('connection').filter({ hasText: 'Connected' }).waitFor({ timeout: 30_000 });
    await p.getByTestId('toolheads-card').waitFor();
  };
  await open(page);

  // ---- desktop: the D3 default --------------------------------------------------------
  if ((await zoneOf(page, 'camera')) !== 'col0' || (await zoneOf(page, 'files')) !== 'col1') fail('the default should be the D3 layout');
  if (await page.locator('[data-zone="top"]').count()) fail('an empty band across the top should not show outside Arrange');
  if (shots) await page.screenshot({ path: join(shots, 'desktop-default.png') });

  // ---- Arrange ------------------------------------------------------------------------
  await page.getByTestId('arrange-open').click();
  await page.getByTestId('arrange-bar').waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'desktop-arrange.png') });
  await drag(page, 'camera', page.locator('[data-zone="top"]'));
  if ((await zoneOf(page, 'camera')) !== 'top') fail('the camera should move across the top');
  await page.getByTestId('hide-console').click();
  await page.locator("[data-card='camera'] select[aria-label='Camera size']").selectOption('m');
  await page.locator("[data-card='files']").getByRole('button', { name: 'Half width' }).click();
  await page.getByRole('group', { name: 'Columns' }).getByRole('button', { name: '3' }).click();
  await drag(page, 'files', page.locator('[data-zone="col2"]'));
  if ((await zoneOf(page, 'files')) !== 'col2') fail('Files should move into the third column');
  if (shots)
    await page.screenshot({
      path: join(shots, 'desktop-arranging-3-columns.png'),
    });
  await page.getByTestId('arrange-done').click();
  if (await page.getByTestId('console-card').count()) fail('a hidden card should not show after Done');
  console.log('desktop: moved, hid, sized and 3 columns');

  // Fold the print card by its title.
  await page.getByTestId('job-card').getByRole('button', { name: 'Print' }).click();
  if (!(await page.getByTestId('job-card').evaluate((el) => el.classList.contains('dv-folded')))) fail('tapping a card title should fold it');
  await page.waitForTimeout(300);

  // ---- kept after a reload ------------------------------------------------------------
  await open(page);
  if ((await zoneOf(page, 'camera')) !== 'top') fail('the camera should stay across the top after a reload');
  if ((await zoneOf(page, 'files')) !== 'col2') fail('Files should stay in the third column after a reload');
  if (await page.getByTestId('console-card').count()) fail('Console should stay hidden after a reload');
  if (!(await page.getByTestId('job-card').evaluate((el) => el.classList.contains('dv-folded')))) fail('the print card should stay folded after a reload');
  if ((await page.locator('.dv-board').getAttribute('data-columns')) !== '3') fail('3 columns should be kept');
  if (!(await page.locator("[data-card='camera']").evaluate((el) => el.classList.contains('dv-cam-m')))) fail('the camera size should be kept');
  if (shots) await page.screenshot({ path: join(shots, 'desktop-arranged.png') });
  console.log('desktop: the layout is kept after a reload');

  // ---- phone: its own layout, one column ----------------------------------------------
  const phone = await context.newPage();
  failShot = phone;
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.addLocatorHandler(phone.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Not now' }).click());
  await phone.goto(site);
  await open(phone);
  if (!(await phone.getByTestId('console-card').count())) fail('the phone keeps its own layout: Console is not hidden there');
  const order = () => phone.locator('[data-card]').evaluateAll((els) => els.map((el) => el.getAttribute('data-card')));
  if ((await order()).slice(0, 2).join() !== 'camera,motion') fail(`phone default should be camera then Move, got ${await order()}`);
  await phone.getByTestId('arrange-open').click();
  await phone.getByTestId('arrange-bar').waitFor();
  await drag(phone, 'toolheads', phone.locator("[data-card='motion']"));
  if ((await order()).indexOf('toolheads') > 2) fail(`Tool heads should move up, got ${await order()}`);
  if (shots) await phone.screenshot({ path: join(shots, 'phone-arrange.png') });
  const wide = await phone.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > 391)
      .map((el) => el.className)
      .slice(0, 5),
  );
  if (wide.length) fail(`nothing may be wider than the phone: ${wide.join(', ')}`);
  await phone.getByTestId('arrange-done').click();
  if (shots) await phone.screenshot({ path: join(shots, 'phone-arranged.png') });
  const saved = await order();
  await open(phone);
  if ((await order()).join() !== saved.join()) fail('the phone order should be kept after a reload');
  console.log('phone: own order, kept after a reload');

  // ---- back to default ----------------------------------------------------------------
  failShot = page;
  await page.getByTestId('arrange-open').click();
  await page.getByTestId('arrange-reset').click();
  await page.getByTestId('arrange-done').click();
  if ((await zoneOf(page, 'camera')) !== 'col0' || (await zoneOf(page, 'files')) !== 'col1') fail('Back to default should bring D3 back');
  if (!(await page.getByTestId('console-card').count())) fail('Back to default should show Console again');
  console.log('desktop: back to default');
  console.log('device arrange: all good');
} catch (e) {
  if (shots && failShot) await failShot.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await u1.close?.();
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {}
  }
  process.exit(process.exitCode ?? 0);
}
