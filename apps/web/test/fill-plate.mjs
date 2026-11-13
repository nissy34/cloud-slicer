#!/usr/bin/env node
// Browser end to end for the Clone form's number box and desktop's "Fill bed
// with copies": the box can be emptied on the way to another number (it used
// to snap back to 1), and Fill plate with copies (object menu, or the Clone
// form's Fill plate) fills the plate with instances, all on the plate.
//
//   node test/fill-plate.mjs [screenshot-dir]
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
const PORT = 4187;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
const url = `http://localhost:${PORT}/`;
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`FILL FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Close window' }).click();
  await page.getByTestId('model-input').setInputFiles(join(fixtures, 'tetrahedron.stl'));
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  return page;
}

const objectMenu = async (page) => {
  await page.locator('ul.objects > li.object').first().locator(':scope > .object-row').getByRole('button', { name: /^More for / }).click();
  return page.locator('.object-menu');
};
// The ×N by the object's name in the list: how many instances it has.
const instances = async (page) => {
  const text = (await page.locator('ul.objects > li.object').first().locator('.object-row .muted').first().textContent().catch(() => '')) ?? '';
  return Number(text.replace(/[^0-9]/g, '')) || 1;
};
const waitFor = async (page, test, ms = 60000) => {
  for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(250)) if (await test()) return true;
  return false;
};

async function run(page, name, viaForm) {
  const menu = await objectMenu(page);
  await menu.getByRole('menuitem', { name: 'Clone…' }).click();
  const box = menu.getByLabel('Number of copies');
  // Emptying the box leaves it empty; typing then gives that number, not 1 in front of it.
  await box.press('Backspace');
  if ((await box.inputValue()) !== '') fail(`${name}: the emptied box shows "${await box.inputValue()}", not nothing`);
  await box.pressSequentially('7');
  if ((await box.inputValue()) !== '7') fail(`${name}: typing 7 in the emptied box gave "${await box.inputValue()}"`);
  else console.log(`${name}: the box can be emptied and takes 7`);
  if (shots) await page.screenshot({ path: join(shots, `${name}-clone-form.png`) });
  if (viaForm) await menu.getByRole('button', { name: 'Fill plate' }).click();
  else {
    await menu.getByRole('button', { name: 'Back' }).click();
    if (shots) {
      await menu.getByRole('menuitem', { name: 'Fill plate with copies' }).hover();
      await page.screenshot({ path: join(shots, `${name}-menu.png`) });
    }
    await menu.getByRole('menuitem', { name: 'Fill plate with copies' }).click();
  }
  if (!(await waitFor(page, async () => (await instances(page)) > 10 && !(await page.locator('.loading-overlay').count())))) {
    return fail(`${name}: the plate did not fill (${await instances(page)} instances)`);
  }
  await page.waitForTimeout(1000);
  const n = await instances(page);
  const loose = await page.getByText(/outside the plate|off the plate/i).count();
  if (loose) fail(`${name}: a copy ended up off the plate`);
  console.log(`${name}: the plate filled with ${n} copies`);
  if (shots) await page.screenshot({ path: join(shots, `${name}-filled.png`) });
}

try {
  const desktop = await open({ width: 1400, height: 900 }, false);
  await run(desktop, 'desktop', false);
  await desktop.close();
  const phone = await open({ width: 390, height: 844 }, true);
  await run(phone, 'phone', true);
  await phone.close();
} catch (e) {
  fail(e.stack || e.message);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
