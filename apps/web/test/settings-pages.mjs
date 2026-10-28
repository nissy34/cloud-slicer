#!/usr/bin/env node
// Browser end to end for desktop's per-extruder settings pages (signed out):
// the printer window has Extruder 1 to 4 pages that each edit their own head's
// value, and Motion ability with the machine limits; the filament window has
// Setting Overrides, where a ticked setting takes the printer's value to start
// from and an unticked one goes back to unset (nil). Phone screenshots go to
// <out-dir>.
//
//   node test/settings-pages.mjs [out-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(web, 'settings-shots');
mkdirSync(out, { recursive: true });
const PORT = 4179;

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

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(name);
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
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const ready = async () => {
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
    if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('combobox', { name: 'Process preset' }).waitFor();
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('cloud-slicer:user-presets:v1') || '[]'));
  // The printer / filament settings window, opened from the ✎ beside its picker.
  const editor = (name) => page.getByRole('dialog', { name, exact: true });
  const openEditor = async (button, name) => {
    await page.getByRole('button', { name: button }).click();
    await editor(name).waitFor();
    return editor(name);
  };
  const settingsPage = (dialog, name) => dialog.getByRole('tablist', { name: 'Settings pages' }).getByRole('tab', { name, exact: true });
  const field = (dialog, group, label) => dialog.locator('fieldset', { has: page.locator('legend', { hasText: group }) }).getByLabel(label, { exact: true });
  const editorSaveAs = async (dialog, name) => {
    await dialog.getByRole('button', { name: 'Save as new preset…' }).click();
    await dialog.getByRole('textbox', { name: /preset name/ }).fill(name);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.getByText(`Saved as ${name}.`).waitFor({ timeout: 60000 });
  };
  const setField = async (locator, value) => {
    await locator.fill(value);
    await locator.press('Enter');
  };
  const tabs = async (dialog) => (await dialog.getByRole('tablist', { name: 'Settings pages' }).getByRole('tab').allTextContents()).map((t) => t.trim());

  await page.goto(url);
  await ready();

  await step('the printer window has desktop pages: Extruder 1 to 4 and Motion ability', async () => {
    const dialog = await openEditor('Edit printer settings', 'Printer settings');
    const names = await tabs(dialog);
    const want = ['Basic information', 'Machine G-code', 'Multimaterial', 'Extruder 1', 'Extruder 2', 'Extruder 3', 'Extruder 4', 'Motion ability', 'Notes'];
    expect(JSON.stringify(names) === JSON.stringify(want), `pages ${names.join(', ')}`);
    await settingsPage(dialog, 'Motion ability').click();
    const speedX = field(dialog, 'Speed limitation', 'Maximum speed X');
    // The U1 has 500 (normal) and 200 (silent); with silent mode off only the normal one shows.
    expect((await speedX.inputValue()) === '500', `speed X ${await speedX.inputValue()}`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('each Extruder page edits its own head, and saves into a printer preset', async () => {
    const dialog = await openEditor('Edit printer settings', 'Printer settings');
    await settingsPage(dialog, 'Extruder 2').click();
    const length = () => field(dialog, 'Retraction', 'Length');
    await setField(length(), '2.5');
    await dialog.getByText('1 unsaved change').waitFor();
    await settingsPage(dialog, 'Extruder 1').click();
    expect((await length().inputValue()) === '1.5', `extruder 1 length ${await length().inputValue()}`);
    await settingsPage(dialog, 'Extruder 2').click();
    expect((await length().inputValue()) === '2.5', `extruder 2 length ${await length().inputValue()}`);
    await dialog.getByRole('group', { name: 'Settings shown' }).getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.screenshot({ path: join(out, 'desktop-extruder.png') });
    await settingsPage(dialog, 'Motion ability').click();
    await setField(field(dialog, 'Speed limitation', 'Maximum speed X'), '450');
    await editorSaveAs(dialog, 'U1 per head');
    const saved = (await stored()).find((p) => p.name === 'U1 per head');
    expect(saved?.config.retraction_length === '1.5,2.5,1.5,1.5', `retraction_length ${saved?.config.retraction_length}`);
    expect(saved?.config.machine_max_speed_x === '450,200', `machine_max_speed_x ${saved?.config.machine_max_speed_x}`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('Setting Overrides: a ticked setting starts at the printer value and saves; unticked is unset', async () => {
    const dialog = await openEditor('Edit filament 1 settings', 'Filament settings');
    expect((await tabs(dialog)).join(',').includes('Cooling,Setting Overrides,Advanced'), `pages ${(await tabs(dialog)).join(', ')}`);
    await settingsPage(dialog, 'Setting Overrides').click();
    const box = dialog.getByLabel("Use this filament's own Length");
    const length = field(dialog, 'Retraction', 'Length');
    expect(!(await box.isChecked()) && (await length.isDisabled()) && (await length.inputValue()) === '1.5', 'unset shows the printer value greyed');
    await box.check();
    expect((await length.isEnabled()) && (await length.inputValue()) === '1.5', 'ticked starts at the printer value');
    await setField(length, '0.6');
    await editorSaveAs(dialog, 'PLA short retract');
    const saved = (await stored()).find((p) => p.name === 'PLA short retract');
    expect(/^0\.6(,0\.6)*$/.test(saved?.config.filament_retraction_length ?? ''), `filament_retraction_length ${saved?.config.filament_retraction_length}`);
    await box.uncheck();
    expect((await length.isDisabled()) && (await length.inputValue()) === '1.5', 'unticked goes back to the printer value');
    await dialog.getByRole('button', { name: 'Save to preset' }).click();
    await dialog.getByText('Saved PLA short retract.').waitFor({ timeout: 60000 });
    const back = (await stored()).find((p) => p.name === 'PLA short retract');
    expect(!back?.config.filament_retraction_length || /^nil(,nil)*$/.test(back.config.filament_retraction_length), `unset saved as ${back?.config.filament_retraction_length}`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('the new pages on a phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    let dialog = await openEditor('Edit printer settings', 'Printer settings');
    await settingsPage(dialog, 'Extruder 2').click();
    await page.screenshot({ path: join(out, 'phone-extruder.png') });
    await settingsPage(dialog, 'Motion ability').click();
    await page.screenshot({ path: join(out, 'phone-motion.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    dialog = await openEditor('Edit filament 1 settings', 'Filament settings');
    await settingsPage(dialog, 'Setting Overrides').click();
    await dialog.getByLabel("Use this filament's own Length").check();
    await page.screenshot({ path: join(out, 'phone-overrides.png') });
    await page.keyboard.press('Escape');
  });
} catch {
  // reported by step(); a picture of where it stopped
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log(`SETTINGS PAGES OK (${results.length} tests)`);
process.exit();
