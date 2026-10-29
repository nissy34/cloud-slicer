#!/usr/bin/env node
// Browser end to end for the pressure advance calibration, laid out like
// desktop's PA Calibration dialog: Bowden and Pattern reset the PA range to
// desktop's defaults, Pattern shows the speed and acceleration lists, and
// creating it puts one test per speed and acceleration pair on the plate
// whose G-code prints the pattern through every PA step. Also opens the
// dialog on a phone.
//
//   node test/calibration.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pickerOf } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4178;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`CALIBRATION FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  return page;
}

// The PA dialog with Pattern picked.
async function patternDialog(page) {
  await page.getByRole('button', { name: 'Calibration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Calibration' });
  await pickerOf(dialog, 'Calibration test').selectOption('pressureAdvance');
  await pickerOf(dialog, 'Method').selectOption('pattern');
  return dialog;
}

const value = (dialog, label) => dialog.getByLabel(label, { exact: true }).inputValue();

try {
  const page = await open({ width: 1280, height: 800 }, false);
  const dialog = await patternDialog(page);
  if ((await value(dialog, 'End PA')) !== '0.08' || (await value(dialog, 'PA step')) !== '0.005')
    fail(`pattern range ${await value(dialog, 'End PA')} / ${await value(dialog, 'PA step')}, expected desktop's 0.08 / 0.005`);
  await pickerOf(dialog, 'Extruder type').selectOption('bowden');
  if ((await value(dialog, 'End PA')) !== '1' || (await value(dialog, 'PA step')) !== '0.05') fail('Bowden does not reset the range to 1 / 0.05');
  await pickerOf(dialog, 'Extruder type').selectOption('direct');
  await dialog.getByLabel('Speeds (mm/s)').fill('60, 120');
  await dialog.getByLabel('Accelerations (mm/s²)').fill('3000');
  if (await dialog.getByLabel('Print numbers').count()) fail('Print numbers shows for the pattern');
  if (shots) await page.screenshot({ path: join(shots, 'pa-pattern-desktop.png') });
  await dialog.getByRole('button', { name: 'Create test' }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object').length === 2, null, { timeout: 60000 });
  const names = await page.locator('ul.objects > li.object .object-name').allInnerTexts();
  if (names.join() !== 'pa_pattern_60_3000,pa_pattern_120_3000') fail(`objects ${names}`);
  console.log(`pattern test on the plate: ${names.join(', ')}`);

  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
  const gcode = readFileSync(await download.path(), 'utf8');
  const layers = (gcode.match(/; start pressure advance pattern for layer/g) ?? []).length;
  const pa = new Set([...gcode.matchAll(/^SET_PRESSURE_ADVANCE ADVANCE=([\d.]+)/gm)].map((m) => Number(m[1])));
  for (let i = 0; i <= 16; i++) if (!pa.has(Number((i * 0.005).toFixed(3)))) fail(`PA ${i * 0.005} missing from the G-code`);
  if (layers < 4) fail(`pattern on only ${layers} layers`);
  console.log(`sliced: pattern on ${layers} layer blocks, ${pa.size} PA values`);
  await page.getByTestId('layer-label').waitFor({ timeout: 120000 });
  if (shots) await page.screenshot({ path: join(shots, 'pa-pattern-preview-desktop.png') });

  const phone = await open({ width: 390, height: 844 }, true);
  const phoneDialog = await patternDialog(phone);
  await phoneDialog.getByLabel('Speeds (mm/s)').fill('60, 120');
  if (shots) await phone.screenshot({ path: join(shots, 'pa-pattern-phone.png') });
  await pickerOf(phoneDialog, 'Method').selectOption('line');
  if (!(await phoneDialog.getByLabel('Print numbers').isChecked())) fail('Print numbers is off for lines');
  if (shots) await phone.screenshot({ path: join(shots, 'pa-lines-phone.png') });
  await pickerOf(phoneDialog, 'Method').selectOption('pattern');
  await phoneDialog.getByRole('button', { name: 'Create test' }).click();
  await phone.waitForFunction(() => document.querySelectorAll('ul.objects > li.object, .calib-banner').length > 0, null, { timeout: 60000 });
  if (shots) await phone.screenshot({ path: join(shots, 'pa-pattern-plate-phone.png') });
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
