#!/usr/bin/env node
// Browser check for the rotate ring, like desktop Orca's: the turn follows the
// pointer round the ring (pressed on the ring and taken a quarter of the way
// round, the angle shown is about that), on the ring it steps in 5°, in the
// middle third it steps in 45°, far outside the pin still follows the
// pointer, and the yellow outer ring turns too, on desktop and on a phone (touch).
//
//   node test/rotate-ring.mjs [screenshot-dir]
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
const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});
const fail = (msg) => {
  console.error(`ROTATE RING FAIL: ${msg}`);
  process.exitCode = 1;
};
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

// The Z ring on screen, from its blue pixels: its middle and half widths (an ellipse seen from above at a slant).
async function zRing(page) {
  const view = page.getByTestId('viewport');
  const box = await view.boundingBox();
  const png = (await view.screenshot()).toString('base64');
  const ring = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    [c.width, c.height] = [img.width, img.height];
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    // TransformControls draws only the half of each ring facing the camera
    // (the Z ring's front half): its middle is level with its left and right ends.
    let [x0, x1, y1, yAtX0] = [Infinity, -Infinity, -Infinity, 0];
    for (let y = 0; y < c.height; y++)
      for (let x = Math.round(c.width * 0.25); x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (!(px[i + 2] > 200 && px[i] < 40 && px[i + 1] < 40)) continue;
        if (x < x0) [x0, yAtX0] = [x, y];
        [x1, y1] = [Math.max(x1, x), Math.max(y1, y)];
      }
    return x0 < x1 ? { cx: (x0 + x1) / 2, cy: yAtX0, a: (x1 - x0) / 2, b: y1 - yAtX0 } : null;
  }, png);
  if (!ring) return null;
  return { cx: box.x + ring.cx, cy: box.y + ring.cy, a: ring.a, b: ring.b };
}

// A point on the ring's ellipse, `turn` degrees on from its front (screen bottom), `reach` out from the middle.
const at = (r, turn, reach = 1) => {
  const t = Math.PI / 2 - (turn * Math.PI) / 180; // front = straight down the screen; turning left (counter-clockwise seen from above) moves it right
  return [r.cx + reach * r.a * Math.cos(t), r.cy + reach * r.b * Math.sin(t)];
};

async function drag(page, r, turn, { reach = 1, touch = false, shot } = {}) {
  const steps = 24;
  // Pressed front left, clear of the X ring seen edge on down the middle.
  const from = -40;
  const [x, y] = at(r, from, 1);
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const point = (px, py) => [{ x: px, y: py }];
  if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) });
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  for (let k = 1; k <= steps; k++) {
    const rr = 1 + ((reach - 1) * k) / steps;
    const [px, py] = at(r, from + (turn * k) / steps, rr);
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(px, py) });
    else await page.mouse.move(px, py);
  }
  await page.waitForTimeout(250);
  const text = await page.getByTestId('rotate-angle').innerText({ timeout: 3000 }).catch(() => '');
  if (shot && shots) await page.screenshot({ path: join(shots, shot) });
  if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await page.mouse.up();
  await page.waitForTimeout(300);
  return text;
}

async function run(name, viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(join(fixtures, '3DBenchy.stl'));
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await page.locator('ul.objects > li.object').first().locator('.object-name').click().catch(() => {});
  await page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Rotate' }).click();
  await page.getByRole('region', { name: 'Rotate' }).waitFor();
  await page.waitForTimeout(800);
  const r = await zRing(page);
  if (shots) await page.screenshot({ path: join(shots, `${name}-before.png`) });
  console.log(name, JSON.stringify(r));
  if (!r) return fail(`${name}: no blue Z ring on screen`);
  const touch = mobile;
  // On the ring, a quarter turn plus a bit: steps to the 5° mark under the
  // pointer (the ring is seen at a slant, so its angles on screen are only near the real ones).
  const onRing = await drag(page, r, 92, { touch, shot: `${name}-on-ring.png` });
  console.log(`${name}: on the ring, pointer 92° round → ${onRing}`);
  if (!/^\+(7[0-9]|8[0-9]|9[0-9]|100)°$/.test(onRing) || Number(onRing.replace('°', '')) % 5) fail(`${name}: the turn should follow the pointer and sit on a 5° mark, got "${onRing}"`);
  // In the middle third: 45° steps.
  const r2 = (await zRing(page)) ?? r;
  const middle = await drag(page, r2, 60, { reach: 0.5, touch, shot: `${name}-middle.png` });
  console.log(`${name}: in the middle third, pointer 60° round → ${middle}`);
  if (Math.abs(Number(middle.replace('°', ''))) % 45) fail(`${name}: the middle third should step in 45°, got "${middle}"`);
  // Far outside the ring: the pin still follows the pointer round.
  const r3 = (await zRing(page)) ?? r;
  const far = await drag(page, r3, 60, { reach: 2.2, touch, shot: `${name}-far.png` });
  console.log(`${name}: far outside, pointer 60° round → ${far}`);
  if (!/^\+(4[0-9]|5[0-9]|6[0-9]|7[0-9])°$/.test(far)) fail(`${name}: far out the pin should still follow the pointer, got "${far}"`);
  // The yellow outer ring (a quarter bigger, facing the camera): pressed at its
  // lower left and taken round towards the bottom, it turns and shows the angle.
  const r4 = (await zRing(page)) ?? r;
  const e = 1.25 * r4.a;
  const cy = r4.cy - 10; // the object's middle sits a little above the Z ring seen from above
  const turnE = async () => {
    const pt = (deg) => [r4.cx + e * Math.cos((deg * Math.PI) / 180), cy + e * Math.sin((deg * Math.PI) / 180)];
    const [x, y] = pt(180);
    const cdp = touch ? await page.context().newCDPSession(page) : null;
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    else (await page.mouse.move(x, y), await page.mouse.down());
    for (let k = 1; k <= 12; k++) {
      const [px, py] = pt(180 - k * 5);
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py }] });
      else await page.mouse.move(px, py);
    }
    await page.waitForTimeout(250);
    const text = await page.getByTestId('rotate-angle').innerText({ timeout: 3000 }).catch(() => '');
    if (shots) await page.screenshot({ path: join(shots, `${name}-yellow.png`) });
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    return text;
  };
  const yellow = await turnE();
  console.log(`${name}: yellow ring, pointer 60° round → ${yellow}`);
  if (!/^[+-](4[0-9]|5[0-9]|6[0-9]|7[0-9])°$/.test(yellow)) fail(`${name}: the yellow ring should follow the pointer, got "${yellow}"`);
  await page.close();
}

try {
  await run('desktop', { width: 1280, height: 800 }, false);
  await run('phone', { width: 390, height: 844 }, true);
} catch (e) {
  fail(e.stack || e.message);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
