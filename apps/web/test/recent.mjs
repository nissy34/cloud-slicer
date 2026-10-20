#!/usr/bin/env node
// Browser end to end for Recent files: a model opened from this device shows
// under the empty plate's Open model button after a reload, newest first, opens
// again with one tap, is listed in the Project menu, and Clear recent files
// empties the list.
//
//   node test/recent.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(web, '../../fixtures');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4183;

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
  console.error(`RECENT FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  // Phone sized: where the phone's own file picker is the problem.
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const ready = async () => {
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
    if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
  };
  await page.goto(url);
  await ready();
  if (await page.locator('.recent-files').count()) fail('a first visit should have no Recent files');

  // Open two models from "this device", one after the other.
  for (const name of ['tetrahedron.stl', '3DBenchy.stl']) {
    await page.getByTestId('model-input').setInputFiles(join(fixtures, name));
    await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  }
  console.log('opened two models');

  await page.reload();
  await ready();
  const recent = page.locator('.recent-files');
  await recent.waitFor({ timeout: 10000 });
  const names = await recent.locator('.recent-name').allTextContents();
  if (names.join() !== '3DBenchy.stl,tetrahedron.stl') fail(`Recent files should be newest first, got ${JSON.stringify(names)}`);
  console.log(`after reload: ${names.join(', ')}`);
  if (shots) await page.screenshot({ path: join(shots, 'recent-empty-plate.png') });

  await recent.getByRole('button', { name: /tetrahedron\.stl/ }).click();
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  console.log('reopened tetrahedron.stl from Recent files');

  await page.getByRole('button', { name: /Project/ }).first().click();
  const menu = page.getByRole('menu', { name: 'Project' });
  await menu.waitFor();
  const inMenu = await menu.locator('.recent-name').allTextContents();
  if (inMenu.join() !== 'tetrahedron.stl,3DBenchy.stl') fail(`Project menu should list the reopened file first, got ${JSON.stringify(inMenu)}`);
  if (shots) await page.screenshot({ path: join(shots, 'recent-project-menu.png') });
  await menu.getByRole('menuitem', { name: 'Clear recent files' }).click();

  await page.reload();
  await ready();
  await page.waitForTimeout(1000);
  if (await page.locator('.recent-files').count()) fail('Clear recent files should empty the list');
  console.log('cleared');
} finally {
  await browser.close();
  process.kill(-server.pid);
}
if (!process.exitCode) console.log('RECENT OK');
