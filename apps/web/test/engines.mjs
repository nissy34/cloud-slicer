#!/usr/bin/env node
// Browser end to end for the two engines: the setup wizard's first step picks
// the engine new projects use, the page switches to it, New project with the
// other engine switches back, and a 3MF saved by an engine opens with that
// engine again.
//
//   node test/engines.mjs [screenshot-dir]
//
// Needs `npm run build` first, with both engines copied (public/engine and
// public/engine-orca).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/tetrahedron.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4181;

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
  console.error(`ENGINES FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const badge = page.locator('.engine-badge');
  const engineIs = async (name, empty = true) => {
    if (empty) await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    await page.waitForFunction((n) => document.querySelector('.engine-badge')?.textContent?.startsWith(n), name, { timeout: 120000 });
    console.log(`engine: ${await badge.innerText()}`);
  };
  const projectButton = page.getByRole('button', { name: /^Project/ });

  await page.goto(url);
  await engineIs('Snapmaker Orca');

  // The wizard starts with the engine; picking OrcaSlicer and finishing switches the empty page to it.
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  const choice = wizard.getByRole('radio', { name: 'OrcaSlicer', exact: true });
  await choice.waitFor();
  if ((await wizard.getByRole('radio', { name: 'Snapmaker Orca', exact: true }).getAttribute('aria-checked')) !== 'true') fail('Snapmaker Orca is not picked to start with');
  await choice.click();
  if (shots) {
    await page.screenshot({ path: join(shots, 'wizard-engine.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(shots, 'wizard-engine-phone.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('button', { name: 'Next' }).click({ timeout: 60000 });
  await wizard.getByRole('button', { name: 'Finish' }).click();
  await engineIs('OrcaSlicer');

  // A model, then Download 3MF: saved by OrcaSlicer.
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await projectButton.click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download 3MF' }).click()]);
  const saved = join(mkdtempSync(join(tmpdir(), 'engines-')), download.suggestedFilename());
  await download.saveAs(saved);
  console.log(`downloaded ${download.suggestedFilename()} (${readFileSync(saved).length} bytes)`);

  // New project with the other engine.
  await projectButton.click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('menuitem', { name: 'New project with Snapmaker Orca' }).click();
  await engineIs('Snapmaker Orca');
  await projectButton.click();
  if (!(await page.getByRole('menuitem', { name: 'New project with Snapmaker Orca' }).isVisible())) fail('the menu should offer Snapmaker Orca by name (OrcaSlicer is the default now)');
  await page.keyboard.press('Escape');

  // The OrcaSlicer project opens with OrcaSlicer again.
  await page.getByTestId('project-input').setInputFiles(saved);
  await page.getByText('the engine this project was made with').waitFor({ timeout: 120000 });
  await engineIs('OrcaSlicer', false);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 300000 });
  console.log('reopened with OrcaSlicer and sliced');
  if (shots) await page.screenshot({ path: join(shots, 'reopened-orca.png') });

  // A fresh page starts with the default engine straight away.
  await page.reload();
  await engineIs('OrcaSlicer');

  // On a phone the Project menu names the engine (no room for the badge).
  await page.setViewportSize({ width: 390, height: 844 });
  await projectButton.click();
  const note = await page.getByTestId('project-engine').innerText();
  if (!note.includes('OrcaSlicer 2.4.2')) fail(`Project menu says "${note}"`);
  if (shots) await page.screenshot({ path: join(shots, 'project-menu-phone.png') });
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 3000)}`);
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
if (!process.exitCode) console.log('ENGINES OK');
process.exit(process.exitCode ?? 0);
