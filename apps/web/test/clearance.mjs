#!/usr/bin/env node
// Browser end to end for printing object by object: two Benchies side by side
// on a plate set to print By object get desktop's clearance outlines and print
// order numbers, the slice's complaint (they are too close for the tool head)
// with the printer's values, and Slice waits; Arrange spaces them by the
// clearance and Slice is back. On a phone the same message shows.
//
//   node test/clearance.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4186;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`CLEARANCE FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function run(viewport, mobile, name) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles([model, model]);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  // The plate prints object by object (its own setting, from the plate's icon).
  // The icons lie on the bed; the canvas lists where each one is on screen.
  const icon = await page.waitForFunction(() => {
    const c = document.querySelector('canvas[data-plate-icons]');
    return c && JSON.parse(c.dataset.plateIcons)['Plate 1 settings'];
  }, null, { timeout: 10000 });
  await page.mouse.click(...(await icon.jsonValue()));
  const win = page.getByRole('dialog', { name: 'Plate 1 settings' });
  await win.getByRole('radiogroup', { name: 'Print sequence' }).getByRole('radio', { name: 'By object' }).click();
  await win.getByRole('button', { name: 'Save' }).click();
  await win.waitFor({ state: 'hidden' });

  const notice = page.getByTestId('clearance-notice');
  await notice.waitFor({ timeout: 30000 });
  const text = await notice.innerText();
  if (!/too close/.test(text)) fail(`${name}: the message says "${text}"`);
  if (!/72\.5 mm/.test(text)) fail(`${name}: the message doesn't give the printer's 72.5 mm clearance: "${text}"`);
  const orders = (await page.locator('.clearance-order').allInnerTexts()).sort().join(',');
  if (orders !== '#1,#2') fail(`${name}: print order numbers ${orders}`);
  if ((await page.locator('.clearance-order.bad').count()) !== 2) fail(`${name}: the touching outlines aren't red`);
  const sliceButton = page.getByRole('button', { name: /^Slice plate/ });
  if (!(await sliceButton.isDisabled())) fail(`${name}: Slice works while the tool head would hit an object`);
  await shot(page, `clearance-${name}-too-close`);

  await notice.getByRole('button', { name: 'Arrange' }).click();
  await notice.waitFor({ state: 'detached', timeout: 30000 });
  if (await sliceButton.isDisabled()) fail(`${name}: Slice still waits after Arrange`);
  if ((await page.locator('.clearance-order.bad').count()) !== 0) fail(`${name}: outlines still red after Arrange`);
  await shot(page, `clearance-${name}-arranged`);
  console.log(`${name}: too close is shown and blocks Slice; Arrange spaces the objects for the tool head`);
  await page.close();
}

try {
  await run({ width: 1280, height: 860 }, false, 'desktop');
  await run({ width: 390, height: 844 }, true, 'phone');
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('CLEARANCE OK');
process.exit();
