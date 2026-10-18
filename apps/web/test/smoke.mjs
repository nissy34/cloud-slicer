#!/usr/bin/env node
// Browser end to end: serve the built site, open a model, slice, download the
// G-code and check it is a real U1 print file.
//
//   node test/smoke.mjs [model] [screenshot.png]
//   SMOKE_URL=https://… node test/smoke.mjs      # test a deployed site instead
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { gcodeThumbnails } from './device/mock-printer.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = resolve(process.argv[2] ?? join(web, '../../fixtures/3DBenchy.stl'));
const shot = process.argv[3] ? resolve(process.argv[3]) : null;
const PORT = 4173;

let server;
let url = process.env.SMOKE_URL;
if (!url) {
  // Own process group, so the whole tree (npx -> vite) can be stopped at the end;
  // killing npx alone leaves vite running and the test never exits.
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
  url = `http://localhost:${PORT}/`;
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
}

// Share of a PNG's pixels that are not transparent (8-bit RGBA, unfiltered rows, as Orca writes them).
function opaqueShare(png) {
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const idat = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at))
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
  const raw = inflateSync(Buffer.concat(idat));
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (raw[y * (w * 4 + 1) + 1 + x * 4 + 3] > 0) n++;
  return n / (w * h);
}

const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.error(`console: ${m.text()}`));
  await page.goto(url);

  if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error('page is not cross-origin isolated (COOP/COEP)');
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  console.log('engine ready');

  // First visit: the setup wizard opens by itself.
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  console.log('setup wizard shown and closed');

  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  console.log(`loaded ${model}`);

  const t0 = Date.now();
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
  console.log(`sliced in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${await page.getByTestId('slice-stats').innerText()}`);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download G-code' }).click(),
  ]);
  const gcode = readFileSync(await download.path(), 'utf8');
  if (!/^PRINT_START/m.test(gcode)) fail('G-code has no PRINT_START (U1 start G-code missing)');
  if (!/^EXCLUDE_OBJECT_DEFINE/m.test(gcode)) fail('G-code has no EXCLUDE_OBJECT_DEFINE');
  const layers = (gcode.match(/^;LAYER_CHANGE/gm) ?? []).length;
  if (layers < 10) fail(`only ${layers} layers`);
  console.log(`${download.suggestedFilename()}: ${(gcode.length / 1e6).toFixed(1)} MB, ${layers} layers`);

  // The plate picture, in the sizes the U1 profile asks for, found the way Moonraker finds it.
  const thumbs = gcodeThumbnails(gcode);
  const sizes = thumbs.map((t) => `${t.width}x${t.height}`).join(', ');
  if (sizes !== '48x48, 300x300') fail(`thumbnails: [${sizes}], expected 48x48 and 300x300`);
  for (const t of thumbs) {
    const share = opaqueShare(t.png);
    // The model fills a good part of the picture; the rest is transparent.
    if (share < 0.1 || share > 0.95) fail(`${t.width}x${t.height} thumbnail is ${(share * 100).toFixed(0)}% model`);
  }
  if (process.env.SMOKE_THUMBNAIL && thumbs.length) writeFileSync(process.env.SMOKE_THUMBNAIL, thumbs.at(-1).png);
  console.log(`thumbnails: ${sizes}`);

  // Slicing switches to the Preview tab on its own.
  await page.getByTestId('layer-label').waitFor({ timeout: 120000 });
  console.log(`preview: layer ${await page.getByTestId('layer-label').innerText()}`);

  if (shot) await page.screenshot({ path: shot });
} catch (e) {
  fail(e.message);
  // What the page showed instead (an engine start-up error, a dialog, ...).
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 3000)}`);
} finally {
  await browser.close();
  if (server) process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('SMOKE OK');
process.exit();
