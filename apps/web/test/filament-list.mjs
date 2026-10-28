#!/usr/bin/env node
// Browser end to end for the filament list grouped by brand, like Snapmaker
// Orca 2.4.1's filament menu (lib/filament-order.ts): a heading per brand,
// Snapmaker first in Snapmaker's own order, then Generic, the rest by name.
//
//   node test/filament-list.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { openPicker } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4182;
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

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

async function step(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`not ok - ${name}\n  ${e.message.split('\n').join('\n  ')}`);
    process.exitCode = 1;
    throw e;
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function run(name, options) {
  const page = await browser.newPage(options);
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText(/Open a model to start|Tap to open a model/).first().waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();

  await step(`${name}: filaments are grouped by brand, Snapmaker's in Snapmaker's order`, async () => {
    const list = await openPicker(page, 'Filament 1 preset');
    // Each heading and the rows under it, in order.
    const groups = await list.evaluate((el) => {
      const out = [];
      for (const child of el.children) {
        if (child.classList.contains('menu-label')) out.push({ brand: child.textContent.trim(), rows: [] });
        else if (child.getAttribute('role') === 'option' && !child.classList.contains('picker-action') && out.length)
          out.at(-1).rows.push(child.querySelector('.picker-label')?.textContent?.trim() ?? '');
      }
      return out;
    });
    console.log(`${name}: ${groups.map((g) => `${g.brand} (${g.rows.length})`).join(', ')}`);
    const brands = groups.map((g) => g.brand);
    expect(brands[0] === 'Snapmaker', `Snapmaker first, got ${brands[0]}`);
    expect(brands[1] === 'Generic', `Generic second, got ${brands[1]}`);
    const rest = brands.slice(2);
    expect(rest.every((b, i) => i === 0 || rest[i - 1] < b), `the other brands by name: ${rest.join(', ')}`);
    const snapmaker = groups[0].rows.map((r) => r.replace(/^Snapmaker /, ''));
    console.log(`${name}: Snapmaker ${snapmaker.slice(0, 8).join(' | ')}`);
    expect(snapmaker.slice(0, 3).join('|') === 'PLA SnapSpeed|PLA Matte|PETG HF', `Snapmaker's order first: ${snapmaker.slice(0, 3).join(', ')}`);
    if (shots) await page.screenshot({ path: join(shots, `${name}-filament-list.png`) });
    await page.keyboard.press('Escape');
  });

  await page.close();
}

try {
  await run('desktop', { viewport: { width: 1280, height: 900 } });
  await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
} finally {
  await browser.close();
  process.kill(-server.pid);
}
