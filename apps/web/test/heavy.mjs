#!/usr/bin/env node
// Browser end to end for big models: opening one with over a million
// triangles offers to simplify it (slicing it could need more memory than a
// browser page may have), and the button brings it to about half a million.
// On a phone the question comes before the model is drawn: Cancel drops it,
// Simplify brings it down first, and "Don't ask again" opens it as is from then on.
//
//   node test/heavy.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4176;
const shots = process.argv[2] ? resolve(process.argv[2]) : null;

// A finely divided sphere: 2 x 720 x 740 = 1,065,600 triangles (binary STL).
function sphereStl(path, rings = 720, segments = 740, r = 40) {
  const point = (i, j) => {
    const t = (Math.PI * i) / rings, p = (2 * Math.PI * j) / segments;
    return [r * Math.sin(t) * Math.cos(p), r * Math.sin(t) * Math.sin(p), r + r * Math.cos(t)];
  };
  const count = 2 * rings * segments;
  const buf = Buffer.alloc(84 + 50 * count);
  buf.writeUInt32LE(count, 80);
  let at = 84;
  const tri = (a, b, c) => {
    at += 12;  // normal: worked out from the corners when read
    for (const v of [a, b, c]) for (const x of v) (buf.writeFloatLE(x, at), (at += 4));
    at += 2;
  };
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      const a = point(i, j), b = point(i + 1, j), c = point(i + 1, j + 1), d = point(i, j + 1);
      tri(a, b, c);
      tri(a, c, d);
    }
  writeFileSync(path, buf);
  return count;
}
const model = join(mkdtempSync(join(tmpdir(), 'heavy-')), 'big-sphere.stl');
const made = sphereStl(model);

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
  console.error(`HEAVY FAIL: ${msg}`);
  process.exitCode = 1;
};

// A phone: a touch screen is its only pointer.
async function phone() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  const question = page.getByTestId('simplify-first');
  const ask = async () => {
    await page.getByTestId('model-input').setInputFiles(model);
    await question.waitFor({ timeout: 180000 });
  };

  await ask();
  const text = await question.innerText();
  if (!text.includes('This model has 1.1 million triangles')) fail(`the question should give the model's size: "${text}"`);
  if (text.includes('painting')) fail('an unpainted model should not warn about paint');
  console.log(`phone asked: ${text.replace(/\s+/g, ' ').trim()}`);
  if (shots) await page.screenshot({ path: join(shots, 'simplify-first-phone.png') });

  const objects = () => page.locator('ul.objects > li.object').count();
  await question.getByRole('button', { name: 'Cancel' }).click();
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  console.log('phone cancel: the plate is empty again');

  await ask();
  await question.getByRole('button', { name: 'Simplify' }).click();
  await page.getByText('Ready to slice').waitFor({ timeout: 180000 });
  await page.waitForTimeout(1000);
  if (await page.getByTestId('heavy-model').isVisible()) fail('after Simplify the model should be light enough');
  console.log('phone simplify: opened simplified');

  // Added to a plate with a model on it, Cancel takes only the new one back.
  await ask();
  await question.getByRole('button', { name: 'Cancel' }).click();
  await question.waitFor({ state: 'detached' });
  await page.getByText('Ready to slice').waitFor({ timeout: 60000 });
  if ((await objects()) !== 1) fail(`Cancel should leave the one simplified model, found ${await objects()}`);
  console.log('phone cancel while adding: the plate keeps what it had');

  // Opened as is, with "Don't ask again": the note offers Simplify, and the next one opens without asking.
  await ask();
  await question.getByLabel("Don't ask again on this device").check();
  await question.getByRole('button', { name: 'Open as is' }).click();
  await page.getByTestId('heavy-model').waitFor({ timeout: 180000 });
  if (shots) await page.screenshot({ path: join(shots, 'simplify-first-open-as-is.png') });
  await page.getByTestId('model-input').setInputFiles(model);
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object').length >= 3, null, { timeout: 180000 });
  if (await question.isVisible()) fail('"Don\'t ask again" should stop the question');
  console.log("phone don't ask again: opened as is, then not asked");
  await context.close();
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(model);

  const offer = page.getByTestId('heavy-model');
  await offer.waitFor({ timeout: 180000 });
  if (await page.getByTestId('simplify-first').isVisible()) fail('a computer should not be asked before opening');
  const text = await offer.innerText();
  if (!text.includes('1.1 million triangles')) fail(`the offer should give the model's size: "${text}"`);
  console.log(`offered: ${text.trim()}`);
  if (shots) {
    await page.screenshot({ path: join(shots, 'heavy-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, 'heavy-phone.png') });
    await page.setViewportSize({ width: 1280, height: 860 });
  }

  await page.getByTestId('actionbar').getByRole('button', { name: 'Simplify model' }).click();
  await offer.waitFor({ state: 'detached', timeout: 180000 });
  await page.getByText('Ready to slice').waitFor({ timeout: 180000 });

  // The Simplify tool counts what is left.
  await page.locator('ul.objects > li.object').first().locator('.object-name').click();
  await page.getByRole('button', { name: 'Simplify', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Simplify' });
  await page.waitForFunction(() => /\d/.test(document.querySelector('[aria-label="Triangles"]')?.textContent ?? ''), null, { timeout: 60000 });
  const left = Number((await panel.getByLabel('Triangles').innerText()).match(/([\d,]+) triangles/)[1].replace(/,/g, ''));
  if (left > 550_000 || left < 400_000) fail(`simplify should leave about 500,000 of ${made} triangles, left ${left}`);
  console.log(`simplified: ${made} -> ${left} triangles`);
  await phone();
  if (!process.exitCode) console.log('heavy OK');
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
