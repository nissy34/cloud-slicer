#!/usr/bin/env node
// Browser end to end for the printer's own bed in the 3D view (src/components/Bed.tsx):
// picking a Bambu Lab A1 draws Bambu's bed shape and print sheet picture, the U1
// Snapmaker's, a Prusa MK4 Prusa's, each brand's files fetched only when one of
// its printers is selected. With a screenshot dir it also takes desktop and phone
// pictures of each bed in light and dark theme. Then OrcaSlicer draws its own.
//
//   node test/bed.mjs [screenshot-dir]
//
// Needs `npm run build` first.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4186;
const PRINTERS = [
  { brand: 'BBL', search: 'bambu lab a1', model: 'Bambu Lab A1', preset: 'Bambu Lab A1 0.4 nozzle', texture: 'bbl-3dp-logo.svg', shape: 'bbl-3dp-X1.bed', shot: 'bambu-a1' },
  { brand: 'Snapmaker', search: 'snapmaker u1', model: 'Snapmaker U1', preset: 'Snapmaker U1 (0.4 nozzle)', texture: 'Snapmaker_U1_texture.svg', shape: 'Snapmaker_U1_bed.bed', shot: 'u1' },
  { brand: 'Prusa', search: 'prusa mk4', model: 'Prusa MK4', preset: 'Prusa MK4 0.4 nozzle', texture: 'mk4is.svg', shape: 'mk4_bed.bed', shot: 'prusa-mk4' },
];

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
  console.error(`BED FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  let beds = [];
  page.on('response', (r) => {
    const m = new URL(r.url()).pathname.match(/\/profiles\/beds\/(.+)$/);
    if (m) beds.push(`${m[1]} ${r.status()}`);
  });
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const canvas = page.getByTestId('viewport').locator('canvas');
  const bed = () => canvas.evaluate((c) => ({ texture: c.dataset.bedTexture ?? '', model: c.dataset.bedModel ?? '' }));
  console.log(`start-up bed: ${JSON.stringify(await bed())}, fetched ${beds.join(', ') || 'nothing'}`);

  // The wizard: tick each printer's smallest nozzle (the U1 may be ticked already).
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Next' }).click();
  const search = wizard.getByRole('searchbox', { name: 'Search printers' });
  for (const p of PRINTERS) {
    await search.fill(p.search);
    const row = wizard.locator('.wizard-models li', { has: page.locator('.wizard-model', { hasText: new RegExp(`^${p.model}`) }) }).first();
    const nozzle = row.locator('.chips button', { hasText: '0.4' }).first();
    if ((await nozzle.getAttribute('aria-pressed')) !== 'true') await nozzle.click();
  }
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByText('Pick the filaments you use').waitFor({ timeout: 60000 });
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('button', { name: 'Finish' }).click();
  await wizard.waitFor({ state: 'detached', timeout: 30000 });

  const picker = page.getByRole('combobox', { name: 'Printer preset' });
  const options = (await picker.locator('option').allInnerTexts()).map((o) => o.trim());
  const pick = async (p) => {
    const option = options.find((o) => o.startsWith(p.preset));
    if (!option) throw new Error(`no ${p.model} in the picker: ${options.join(' | ')}`);
    beds = [];
    await picker.selectOption({ label: option });
  };

  for (const p of PRINTERS) {
    await pick(p);
    {
      try {
        await page.waitForFunction(
          ({ texture, shape }) => {
            const c = document.querySelector('[data-testid=viewport] canvas');
            return c?.dataset.bedTexture === texture && c?.dataset.bedModel === shape;
          },
          { texture: p.texture, shape: p.shape },
          { timeout: 30000 },
        );
      } catch {
        fail(`${p.model}: bed ${JSON.stringify(await bed())}, wanted ${p.texture} and ${p.shape}`);
      }
      console.log(`${p.model}: ${JSON.stringify(await bed())}, fetched ${beds.join(', ')}`);
      if (beds.some((b) => !b.endsWith(' 200') && !b.endsWith(' 304'))) fail(`${p.model}: a bed file failed: ${beds.join(', ')}`);
      // Only this printer's brand index and files.
      if (beds.some((b) => !b.startsWith(p.brand))) fail(`${p.model} fetched another brand's bed files: ${beds.join(', ')}`);
    }
    if (shots) {
      await page.waitForTimeout(500);
      for (const theme of ['light', 'dark']) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForTimeout(400);
        const fit = async () => {
          await page.getByRole('button', { name: 'Fit all' }).click();
          await page.waitForTimeout(800);
        };
        await fit();
        await page.screenshot({ path: join(shots, `${p.shot}-desktop-${theme}.png`) });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(600);
        await fit();
        await page.screenshot({ path: join(shots, `${p.shot}-phone-${theme}.png`) });
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(400);
      }
    }
  }

  // OrcaSlicer ships its own beds, beside its own presets.
  beds = [];
  await page.goto(`${url}?engine=orca`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  try {
    await page.waitForFunction(() => document.querySelector('[data-testid=viewport] canvas')?.dataset.bedTexture, null, { timeout: 30000 });
  } catch {
    fail('OrcaSlicer: no bed picture');
  }
  console.log(`OrcaSlicer: ${JSON.stringify(await bed())}, fetched ${beds.join(', ')}`);
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
if (!process.exitCode) console.log('BED OK');
process.exit(process.exitCode ?? 0);
