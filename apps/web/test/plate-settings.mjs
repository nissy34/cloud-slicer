#!/usr/bin/env node
// Browser end to end for desktop Orca's Plate settings window: the plate menu
// opens it; the plate gets its own print sequence (By object), plate type and
// first layer filament order; the sidebar's Plate type says the plate uses its
// own; the slice prints with them (the G-code's settings say so); "Project"
// gives the settings back to the project. On a phone the window opens from the
// plate settings icon beside the plate.
//
//   node test/plate-settings.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/tetrahedron.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4185;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`PLATE SETTINGS FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  return page;
}

// The value of one setting in the G-code's settings block at its end.
const setting = (gcode, key) => new RegExp(`^; ${key} = (.*)$`, 'm').exec(gcode)?.[1];

async function sliceGcode(page) {
  await page.getByRole('button', { name: /^Slice plate/ }).click();
  await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
  return readFileSync(await download.path(), 'utf8');
}

try {
  const page = await open({ width: 1280, height: 860 }, false);
  const filaments = page.getByLabel(/^Filament \d+ colour$/);
  for (let n = await filaments.count(); n < 2; n++) {
    await page.getByLabel('Add filament').click();
    await filaments.nth(n).waitFor();
  }
  await page.getByTestId('model-input').setInputFiles([model]);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  // The plate menu, from the plate beside the model.
  const box = await page.getByTestId('viewport').boundingBox();
  const plateMenu = page.getByRole('menu', { name: 'Plate menu' });
  for (const [x, y] of [[0.3, 0.75], [0.75, 0.75], [0.3, 0.45], [0.7, 0.45]]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y, { button: 'right' });
    if (await plateMenu.isVisible().catch(() => false)) break;
  }
  await plateMenu.getByRole('menuitem', { name: 'Plate settings…' }).click();
  const win = page.getByRole('dialog', { name: 'Plate 1 settings' });
  await win.waitFor({ timeout: 5000 });
  for (const group of ['Print sequence', 'Spiral vase', 'First layer filament order', 'Other layers filament order'])
    if ((await win.getByRole('radiogroup', { name: group }).getByRole('radio', { checked: true }).innerText()).match(/^(Project|Auto)/) === null)
      fail(`${group} doesn't start on the project's`);

  await win.getByRole('radiogroup', { name: 'Print sequence' }).getByRole('radio', { name: 'By object' }).click();
  const types = win.getByLabel('Plate type');
  const projectType = await page.getByRole('combobox', { name: 'Plate type' }).first().inputValue();
  const other = (await types.locator('option').evaluateAll((os) => os.map((o) => o.value))).find((v) => v && v !== projectType);
  await types.selectOption(other);
  await win.getByRole('radiogroup', { name: 'First layer filament order' }).getByRole('radio', { name: 'Custom' }).click();
  const chips = win.getByRole('list', { name: 'First layer filament order' }).getByRole('listitem');
  if ((await chips.count()) !== 2) fail(`the first layer order lists ${await chips.count()} filaments, not 2`);
  // Filament 2 dragged in front of filament 1.
  const [a, b] = [await chips.nth(0).boundingBox(), await chips.nth(1).boundingBox()];
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 - ((b.x - a.x) * i) / 8, b.y + b.height / 2);
  await page.mouse.up();
  const order = (await chips.allInnerTexts()).map((t) => t.trim()).join(',');
  if (order !== '2,1') fail(`dragging filament 2 first left the order ${order}`);
  await shot(page, 'plate-settings-desktop');
  await win.getByRole('button', { name: 'Save' }).click();
  await win.waitFor({ state: 'hidden' });

  // The sidebar's Plate type says the plate uses its own.
  const note = page.locator('.plate-note').first();
  await note.waitFor({ timeout: 5000 });
  if (!/Plate 1 uses/.test(await note.innerText())) fail(`the sidebar note says "${await note.innerText()}"`);
  await shot(page, 'plate-settings-sidebar-note');

  const gcode = await sliceGcode(page);
  if (setting(gcode, 'print_sequence') !== 'by object') fail(`the G-code prints ${setting(gcode, 'print_sequence')}, not by object`);
  if (setting(gcode, 'curr_bed_type') !== other) fail(`the G-code's plate type is ${setting(gcode, 'curr_bed_type')}, not ${other}`);
  if (setting(gcode, 'first_layer_print_sequence') !== '2,1') fail(`the G-code's first layer order is ${setting(gcode, 'first_layer_print_sequence')}`);
  console.log('the slice prints with the plate settings');

  // Back to the project's settings.
  await page.getByRole('tab', { name: 'Prepare' }).click().catch(() => page.getByRole('button', { name: 'Prepare' }).click());
  await note.getByRole('button', { name: 'Plate settings' }).click();
  await win.waitFor({ timeout: 5000 });
  await win.getByRole('radiogroup', { name: 'Print sequence' }).getByRole('radio', { name: 'Project' }).click();
  await win.getByLabel('Plate type').selectOption('');
  await win.getByRole('radiogroup', { name: 'First layer filament order' }).getByRole('radio', { name: 'Auto' }).click();
  await win.getByRole('button', { name: 'Save' }).click();
  await page.locator('.plate-note').waitFor({ state: 'detached', timeout: 5000 });
  const back = await sliceGcode(page);
  if (setting(back, 'print_sequence') !== 'by layer') fail(`with the project's settings the G-code prints ${setting(back, 'print_sequence')}`);
  console.log("\"Project\" gives the settings back to the project");
  await page.close();

  // A phone: two plates, the gear on the shown plate's tab opens the window.
  const phone = await open({ width: 390, height: 844 }, true);
  await phone.getByTestId('model-input').setInputFiles([model]);
  await phone.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await phone.getByRole('button', { name: 'Add plate' }).click();
  await phone.getByRole('tab', { name: /^1/ }).click();
  // Desktop's icon beside the plate.
  await phone.getByRole('toolbar', { name: 'Plate 1 icons' }).getByRole('button', { name: 'Plate 1 settings' }).click();
  const phoneWin = phone.getByRole('dialog', { name: 'Plate 1 settings' });
  await phoneWin.waitFor({ timeout: 5000 });
  await phoneWin.getByRole('radiogroup', { name: 'Print sequence' }).getByRole('radio', { name: 'By object' }).click();
  await shot(phone, 'plate-settings-phone');
  await phoneWin.getByRole('button', { name: 'Save' }).click();
  await phone.locator('.plate-tab.active .plate-own').waitFor({ timeout: 5000 });
  await shot(phone, 'plate-settings-phone-tabs');
  console.log('phone: the plate icon opens the window, the tab shows the plate has its own settings');
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 2000)}`);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('PLATE SETTINGS OK');
process.exit();
