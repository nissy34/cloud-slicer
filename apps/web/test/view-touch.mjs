#!/usr/bin/env node
// Browser end to end for the 3D view on a phone: two fingers always move the
// camera, even when they land on the model (zoomed in until the model fills
// the screen, pinching used to grab the model instead and there was no way
// back out), and the corner buttons: Fit all brings everything back on
// screen, and the views menu turns the camera to Top, Front and the rest.
//
//   node test/view-touch.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4176;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`VIEW FAIL: ${msg}`);
  process.exitCode = 1;
};

// An ASCII STL box, size mm on a side.
const cubeStl = (size) => {
  const v = (x, y, z) => [x, y, z].map((c) => c * size);
  const quads = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  ];
  const tri = (a, b, c) => `facet normal 0 0 0\nouter loop\n${[a, b, c].map((p) => `vertex ${v(...p).join(' ')}`).join('\n')}\nendloop\nendfacet\n`;
  return `solid cube\n${quads.map(([a, b, c, d]) => tri(a, b, c) + tri(a, c, d)).join('')}endsolid cube\n`;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.VIEW_WIDTH ?? 390), height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  page.on('console', (m) => m.text().includes('VIEWDBG') && console.log(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();

  const stl = join(mkdtempSync(join(tmpdir(), 'view-')), 'box.stl');
  writeFileSync(stl, cubeStl(60));
  await page.getByTestId('model-input').setInputFiles(stl);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  // A red model, so its share of the screen can be counted.
  await page.getByLabel('Filament 1 colour').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '#ff2020');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const view = page.getByTestId('viewport');
  await view.scrollIntoViewIfNeeded();
  const box = await view.boundingBox();
  const undo = page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Undo' });
  const undoBefore = await undo.getAttribute('title');

  // The share of the 3D view the model covers: its coloured pixels (red, or
  // pink while selected; the bed and the background are greys).
  const modelShare = async () => {
    await page.waitForTimeout(400);
    const png = (await view.screenshot()).toString('base64');
    return page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      [c.width, c.height] = [img.width, img.height];
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let red = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 70) red++;
      return red / (px.length / 4);
    }, png);
  };

  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  // Two fingers: the first lands, then the second, then they spread (from <
  // to, zooming in) or close (zooming out) about (cx, cy).
  const pinch = async (cx, cy, from, to) => {
    const at = (gap) => [[cx - gap / 2, cy], [cx + gap / 2, cy]];
    await touch('touchStart', [at(from)[0]]);
    await page.waitForTimeout(60);
    await touch('touchStart', at(from));
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', at(from + ((to - from) * i) / 12));
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
  };

  const start = await modelShare();
  console.log(`model covers ${(start * 100).toFixed(0)}% of the view at first`);
  // Zoom in with the fingers off the model, near the bottom corners, until it fills the view.
  for (let i = 0; i < 10 && (await modelShare()) < 0.75; i++) await pinch(box.x + box.width / 2, box.y + box.height - 20, 120, 150);
  const zoomed = await modelShare();
  if (zoomed < 0.75) fail(`zooming in should fill the view with the model: ${(zoomed * 100).toFixed(0)}%`);
  if (shots) await page.screenshot({ path: join(shots, 'zoomed-in.png') });
  console.log(`zoomed in: the model covers ${(zoomed * 100).toFixed(0)}%`);

  // Now every finger lands on the model: pinching must still zoom back out.
  await pinch(box.x + box.width / 2, box.y + box.height / 2, 200, 120);
  await pinch(box.x + box.width / 2, box.y + box.height / 2, 200, 120);
  const out = await modelShare();
  if (shots) await page.screenshot({ path: join(shots, 'pinched-out.png') });
  if (out > zoomed - 0.2) fail(`pinching on the model should zoom out: ${(zoomed * 100).toFixed(0)}% -> ${(out * 100).toFixed(0)}%`);
  else console.log(`pinching on the model zooms out: ${(zoomed * 100).toFixed(0)}% -> ${(out * 100).toFixed(0)}%`);
  if (await page.locator("ul.objects > li.object.active").count()) fail("the pinch selected the model");
  if ((await undo.getAttribute('title')) !== undoBefore) fail(`the pinch moved the model: Undo is now "${await undo.getAttribute('title')}"`);

  // Fit all: zoomed in again, the button brings the whole model back on screen.
  const fit = page.getByRole('button', { name: 'Fit all' });
  if (await fit.count()) {
    for (let i = 0; i < 10 && (await modelShare()) < 0.75; i++) await pinch(box.x + box.width / 2, box.y + box.height - 20, 120, 150);
    await fit.tap();
    await page.waitForTimeout(700);
    const fitted = await modelShare();
    if (fitted > 0.75 || fitted < 0.08) fail(`Fit all should show the whole model: ${(fitted * 100).toFixed(0)}%`);
    else console.log(`Fit all: the model covers ${(fitted * 100).toFixed(0)}%`);
    if (shots) await page.screenshot({ path: join(shots, 'fit-all.png') });

    // The views menu: Top looks straight down on the box, a square.
    await page.getByRole('button', { name: 'Views' }).tap();
    const menu = page.getByRole('menu', { name: 'Views' });
    await menu.waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'views-menu.png') });
    // It stays inside the 3D view and clear of the toolbar on a phone.
    const m = await menu.boundingBox();
    const bar = await page.getByRole('toolbar', { name: 'Object tools' }).boundingBox();
    if (m.x < box.x || m.x + m.width > box.x + box.width || m.y < bar.y + bar.height) fail('the views menu runs outside the 3D view or under the toolbar');
    await menu.getByRole('menuitem', { name: 'Top' }).tap();
    await page.waitForTimeout(700);
    if (await menu.isVisible()) fail('the views menu should close after picking a view');
    if (shots) await page.screenshot({ path: join(shots, 'top-view.png') });
    const top = await modelShare();
    if (top < 0.08) fail(`the top view should show the model: ${(top * 100).toFixed(0)}%`);
    console.log(`Top view: the model covers ${(top * 100).toFixed(0)}%`);
    // And the camera still turns with one finger and zooms with two afterwards.
    await pinch(box.x + box.width / 2, box.y + box.height / 2, 120, 200);
    if ((await modelShare()) <= top) fail('pinching after the top view should zoom in');
  }

  // One finger on the model still moves it. Each step is past the 6 px a
  // long press may wander: with 6 px steps the first one still counted as
  // holding still, and when a slow test machine took over half a second to
  // deliver the next, the press became a long press and opened the object menu.
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [[cx + i * 10, cy]]);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', []);
  await page.waitForFunction((before) => document.querySelector('[aria-label="Undo"]')?.title !== before, undoBefore, { timeout: 10000 }).catch(() => {});
  if ((await undo.getAttribute('title')) === undoBefore) fail('a one-finger drag on the model should still move it');
  else console.log(`a one-finger drag still moves the model (${await undo.getAttribute('title')})`);

  // With a tool open (the model selected, Move): the corner buttons stay inside the 3D view, clear of the tool's card.
  await page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Move' }).tap();
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: join(shots, 'tool-open.png') });
  const v = await view.boundingBox();
  for (const name of ['Fit all', 'Views']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox();
    if (!b || b.x < v.x || b.x + b.width > v.x + v.width || b.y < v.y || b.y + b.height > v.y + v.height) fail(`${name} is outside the 3D view with a tool open`);
    for (const card of await page.locator('.tool-pop').all()) {
      const c = await card.boundingBox();
      if (c && b && b.x < c.x + c.width && c.x < b.x + b.width && b.y < c.y + c.height && c.y < b.y + b.height) fail(`${name} is under the tool's card`);
    }
  }
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('VIEW OK');
process.exit();
