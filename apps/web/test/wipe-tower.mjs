#!/usr/bin/env node
// Browser end to end for the prime tower on the Prepare plate: a model printed
// with a mix of two filaments gets a tower, dragging it moves it, and the
// slice prints it where it was dropped.
//
//   node test/wipe-tower.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as THREE from 'three';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4176;
const BED = 270;  // the U1's plate
const TOWER = [13, 214.5];  // desktop's spot for a new plate's tower
const TARGET = [150, 40];

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
  console.error(`WIPE TOWER FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

// The 3D view's starting camera (components/Viewport.tsx), to find plate
// points on screen.
async function projector(page) {
  const box = await page.getByTestId('viewport').locator('canvas').boundingBox();
  const camera = new THREE.PerspectiveCamera(40, box.width / box.height, 1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(BED / 2, -BED * 0.75, BED * 0.8);
  camera.lookAt(BED / 2, BED / 2, 0);
  camera.updateMatrixWorld();
  const toScreen = (p) => {
    const v = new THREE.Vector3(...p).project(camera);
    return [box.x + ((v.x + 1) / 2) * box.width, box.y + ((1 - v.y) / 2) * box.height];
  };
  // Where the ray through a point meets the plate (z = 0), as the drag measures it.
  const onPlate = (p) => {
    const c = camera.position;
    const t = c.z / (c.z - p[2]);
    return [c.x + (p[0] - c.x) * t, c.y + (p[1] - c.y) * t, 0];
  };
  return { toScreen, onPlate };
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();

  while ((await page.getByLabel(/^Filament \d+ colour$/).count()) < 2) await page.getByLabel('Add filament').click();
  const mixId = (await page.getByLabel(/^Filament \d+ colour$/).count()) + 1;
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  // Printed with a mix of filaments 1 and 2: the plate needs a prime tower.
  await page.getByLabel('Add mix').click();
  const dialog = page.getByRole('dialog', { name: /mix/i });
  await dialog.getByRole('radio', { name: 'Ratio' }).click();
  await dialog.getByRole('button', { name: /^(Add|Save)/ }).click();
  await page.getByLabel(`Delete mix ${mixId}`).waitFor();
  await page.getByLabel(/^Filament for 3DBenchy/).first().selectOption(String(mixId));
  await page.waitForTimeout(1500);
  await shot(page, 'desktop');

  // Drag it from the back-left corner to the front.
  const { toScreen, onPlate } = await projector(page);
  const grab = [TOWER[0] + 10, TOWER[1] + 10, 15];
  const from = toScreen(grab);
  const hit = onPlate(grab);
  const to = toScreen([hit[0] + TARGET[0] - TOWER[0], hit[1] + TARGET[1] - TOWER[1], 0]);
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 12, from[1] + ((to[1] - from[1]) * i) / 12);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await shot(page, 'desktop-moved');

  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
  const gcode = readFileSync(await download.path(), 'utf8');
  const xs = [], ys = [];
  let inTower = false;
  for (const line of gcode.split('\n')) {
    if (line.startsWith(';TYPE:')) inTower = line.startsWith(';TYPE:Prime tower');
    const m = inTower && /^G1 .*X([-\d.]+) Y([-\d.]+)/.exec(line);
    if (m) xs.push(Number(m[1])), ys.push(Number(m[2]));
  }
  if (!xs.length) throw new Error('the G-code has no prime tower');
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  console.log(`prime tower printed from X${x0} Y${y0}`);
  // The drag is pixels on a 3D view, so allow a few mm.
  if (Math.abs(x0 - TARGET[0]) > 8 || Math.abs(y0 - TARGET[1]) > 8) fail(`tower printed at X${x0} Y${y0}, dragged to X${TARGET[0]} Y${TARGET[1]}`);

  // Back on Prepare the tower stands where it printed; on a phone too.
  await page.getByRole('tab', { name: 'Prepare' }).click().catch(() => page.getByRole('button', { name: 'Prepare' }).click());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  await shot(page, 'phone');
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 2000)}`);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('WIPE TOWER OK');
process.exit();
