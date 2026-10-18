#!/usr/bin/env node
// Browser end to end for editing filament and printer presets and for preset
// files (signed out, so presets live in this browser): change a filament and
// a printer setting in their settings windows and save them as presets, export
// one preset and all of them, import them back (name collision: keep both),
// import a desktop Orca filament made for another printer onto ours, and
// check a printer we don't have is refused. Screenshots of the import dialog
// on a desktop and a phone go to <out-dir>.
//
//   node test/preset-files.mjs [out-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(web, 'preset-shots');
mkdirSync(out, { recursive: true });
const PORT = 4176;

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
  const filamentMenu = page.getByRole('button', { name: 'Filament preset actions (filament 1)' });
  const filamentPop = page.getByRole('dialog', { name: 'filament preset' });
  const printerMenu = page.getByRole('button', { name: 'Printer preset actions' });
  const printerPop = page.getByRole('dialog', { name: 'printer preset' });
  const filamentPicker = page.getByRole('combobox', { name: 'Filament 1 preset' });
  const printerPicker = page.getByRole('combobox', { name: 'Printer preset' });
  const importDialog = page.getByRole('dialog', { name: 'Import presets' });
  const saveAs = async (menu, pop, name) => {
    await menu.click();
    await pop.getByRole('button', { name: 'Save as new preset…' }).click();
    await pop.getByRole('textbox').fill(name);
    await pop.getByRole('button', { name: 'Save', exact: true }).click();
    await pop.waitFor({ state: 'detached', timeout: 60000 });
  };
  const download = async (click) => {
    const [d] = await Promise.all([page.waitForEvent('download'), click()]);
    const path = join(out, d.suggestedFilename());
    await d.saveAs(path);
    return { name: d.suggestedFilename(), bytes: readFileSync(path), path };
  };
  const openImport = async (menu, pop, files) => {
    await menu.click();
    await pop.getByRole('button', { name: 'Import presets…' }).click();
    await importDialog.waitFor();
    await importDialog.getByLabel('Preset files').setInputFiles(files);
    await importDialog.getByRole('button', { name: /^Import \d+ preset/ }).or(importDialog.getByText('No presets found.')).first().waitFor({ timeout: 60000 });
  };

  await page.goto(url);
  await ready();
  const systemFilament = await filamentPicker.inputValue();
  const systemPrinter = await printerPicker.inputValue();
  let filamentJson;
  let bundle;

  await step('the filament window edits the filament, saves it as a preset, then saves into it', async () => {
    const dialog = await openEditor('Edit filament 1 settings', 'Filament settings');
    const temp = field(dialog, 'Print temperature', 'Other layers');
    await temp.waitFor();
    await setField(temp, '230');
    await dialog.getByText('1 unsaved change').waitFor();
    await editorSaveAs(dialog, 'Hot PLA');
    expect((await filamentPicker.inputValue()) === 'Hot PLA', `slot 1 is ${await filamentPicker.inputValue()}`);
    // Now one of mine: Save to preset writes the change into it.
    await setField(field(dialog, 'Print temperature', 'Other layers'), '231');
    await dialog.getByRole('button', { name: 'Save to preset' }).click();
    await dialog.getByText('Saved Hot PLA.').waitFor({ timeout: 60000 });
    const saved = (await stored()).find((p) => p.name === 'Hot PLA');
    expect(saved?.type === 'filament' && saved.inherits === systemFilament, JSON.stringify(saved));
    expect(/^231(,231)*$/.test(saved.config.nozzle_temperature ?? ''), `saved ${saved.config.nozzle_temperature}`);
    expect((await field(dialog, 'Print temperature', 'Other layers').inputValue()) === '231', 'shown from the preset');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await dialog.waitFor({ state: 'detached' });
  });

  await step('the printer window edits printer settings, and saves as a printer preset', async () => {
    const dialog = await openEditor('Edit printer settings', 'Printer settings');
    await settingsPage(dialog, 'Basic information').click();
    await dialog.getByLabel('Advanced').check();
    await setField(dialog.getByLabel('Z offset', { exact: true }), '0.05');
    await page.screenshot({ path: join(out, 'printer-desktop.png') });
    await editorSaveAs(dialog, 'My U1 tuned');
    expect((await printerPicker.inputValue()) === 'My U1 tuned', `printer is ${await printerPicker.inputValue()}`);
    const saved = (await stored()).find((p) => p.name === 'My U1 tuned');
    expect(saved?.type === 'printer' && saved.inherits === systemPrinter && saved.config.z_offset === '0.05', JSON.stringify(saved));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('a preset exports as desktop Orca preset JSON', async () => {
    await filamentPicker.selectOption('Hot PLA');
    await filamentMenu.click();
    const file = await download(() => filamentPop.getByRole('button', { name: 'Export preset' }).click());
    filamentJson = file.path;
    expect(file.name === 'Hot PLA.json', file.name);
    const preset = JSON.parse(file.bytes.toString('utf8'));
    expect(preset.name === 'Hot PLA' && preset.inherits === systemFilament && preset.from === 'User' && preset.version, JSON.stringify(preset).slice(0, 300));
    // Desktop writes vectors as JSON arrays.
    expect(Array.isArray(preset.nozzle_temperature) && preset.nozzle_temperature[0] === '231', `nozzle_temperature ${JSON.stringify(preset.nozzle_temperature)}`);
    if (await filamentPop.isVisible()) await page.keyboard.press('Escape');
  });

  await step('all presets export as one bundle', async () => {
    await printerMenu.click();
    const file = await download(() => printerPop.getByRole('button', { name: 'Export all my presets' }).click());
    bundle = file.path;
    const entries = Object.keys(unzipSync(new Uint8Array(file.bytes))).sort();
    expect(JSON.stringify(entries) === JSON.stringify(['bundle_structure.json', 'filament/Hot PLA.json', 'printer/My U1 tuned.json']), entries.join(', '));
    if (await printerPop.isVisible()) await page.keyboard.press('Escape');
  });

  await step('deleted presets come back from the bundle', async () => {
    for (const [menu, pop] of [
      [filamentMenu, filamentPop],
      [printerMenu, printerPop],
    ]) {
      await menu.click();
      await pop.getByRole('button', { name: 'Delete…' }).click();
      await pop.getByRole('button', { name: 'Delete', exact: true }).click();
      await pop.waitFor({ state: 'detached', timeout: 60000 });
    }
    expect((await stored()).length === 0, 'all deleted');
    await openImport(filamentMenu, filamentPop, [bundle]);
    await importDialog.getByRole('listitem', { name: 'Printer My U1 tuned' }).waitFor();
    await importDialog.getByRole('listitem', { name: 'Filament Hot PLA' }).waitFor();
    await importDialog.getByRole('button', { name: 'Import 2 presets' }).click();
    await importDialog.getByText('Imported 2 presets.', { exact: false }).waitFor({ timeout: 60000 });
    await importDialog.getByRole('button', { name: 'Close' }).click();
    const saved = await stored();
    const printer = saved.find((p) => p.name === 'My U1 tuned');
    const filament = saved.find((p) => p.name === 'Hot PLA');
    expect(printer?.config.z_offset === '0.05' && printer.inherits === systemPrinter, JSON.stringify(printer));
    expect(/^231/.test(filament?.config.nozzle_temperature ?? '') && filament.inherits === systemFilament, JSON.stringify(filament));
    // The pickers refresh from the engine once the import has finished.
    const back = await printerPicker
      .locator('option', { hasText: 'My U1 tuned' })
      .first()
      .waitFor({ state: 'attached', timeout: 10000 })
      .then(() => true, () => false);
    expect(back, 'printer back in the picker');
  });

  await step('a name already taken can be kept twice', async () => {
    await openImport(filamentMenu, filamentPop, [filamentJson]);
    const row = importDialog.getByRole('listitem', { name: 'Filament Hot PLA' });
    await row.getByText('You already have a filament preset with this name.').waitFor();
    await row.getByRole('combobox', { name: 'When Hot PLA exists' }).selectOption('keep');
    await importDialog.getByRole('button', { name: 'Import 1 preset' }).click();
    await importDialog.getByText('Imported 1 preset.', { exact: false }).waitFor({ timeout: 60000 });
    await importDialog.getByRole('button', { name: 'Close' }).click();
    const names = (await stored()).filter((p) => p.type === 'filament').map((p) => p.name).sort();
    expect(JSON.stringify(names) === JSON.stringify(['Hot PLA', 'Hot PLA (2)']), names.join(', '));
  });

  await step('a filament from another printer goes onto one of ours; a printer we lack is refused', async () => {
    const bambuFilament = join(out, 'Bambu silk.json');
    writeFileSync(
      bambuFilament,
      JSON.stringify({
        filament_settings_id: ['My Bambu Silk'],
        name: 'My Bambu Silk',
        from: 'User',
        inherits: 'Bambu PLA Silk @BBL X1C',
        version: '2.0.0.0',
        filament_type: ['PLA'],
        nozzle_temperature: ['228'],
        filament_start_gcode: ['; bambu only'],
        some_retired_option: ['1'],
      }),
    );
    const x1c = join(out, 'X1C.json');
    writeFileSync(
      x1c,
      JSON.stringify({
        printer_settings_id: 'My X1C',
        name: 'My X1C',
        from: 'User',
        inherits: 'Bambu Lab X1 Carbon 0.4 nozzle',
        version: '2.0.0.0',
        printer_model: 'Bambu Lab X1 Carbon',
        machine_start_gcode: 'G28',
      }),
    );
    await openImport(filamentMenu, filamentPop, [bambuFilament, x1c]);
    const refused = importDialog.getByRole('listitem', { name: 'Printer My X1C' });
    await refused.getByText(/which this app doesn't have/).waitFor();
    const row = importDialog.getByRole('listitem', { name: 'Filament My Bambu Silk' });
    await row.getByText('Bambu PLA Silk @BBL X1C').waitFor();
    const base = await row.getByRole('combobox', { name: 'Base for My Bambu Silk' }).inputValue();
    expect(/PLA/.test(base), `base ${base}`);
    await row.getByText(/setting this version of Orca doesn't have was left out/).waitFor();
    await importDialog.screenshot({ path: join(out, 'import-desktop.png') });
    await importDialog.getByRole('button', { name: 'Import 1 preset' }).click();
    await importDialog.getByText('Imported 1 preset.', { exact: false }).waitFor({ timeout: 60000 });
    await importDialog.getByRole('button', { name: 'Close' }).click();
    const saved = (await stored()).find((p) => p.name === 'My Bambu Silk');
    expect(saved?.inherits === base && /^228/.test(saved.config.nozzle_temperature ?? ''), JSON.stringify(saved));
    expect(!('filament_start_gcode' in saved.config), 'printer-specific filament G-code dropped');
    expect(!(await stored()).some((p) => p.name === 'My X1C'), 'X1C not imported');
  });

  await step('with two filaments each filament window edits its own filament', async () => {
    await page.getByRole('button', { name: 'Add filament' }).click();
    await page.getByRole('combobox', { name: 'Filament 2 preset' }).waitFor();
    let dialog = await openEditor('Edit filament 2 settings', 'Filament 2 settings');
    const before = await field(dialog, 'Print temperature', 'Other layers').inputValue();
    await setField(field(dialog, 'Print temperature', 'Other layers'), '204');
    await dialog.getByRole('button', { name: 'Close' }).click();
    dialog = await openEditor('Edit filament 1 settings', 'Filament 1 settings');
    const first = await field(dialog, 'Print temperature', 'Other layers').inputValue();
    expect(first !== '204', `filament 1 shows ${first}, filament 2 had ${before}`);
    await dialog.getByRole('button', { name: 'Close' }).click();
    dialog = await openEditor('Edit filament 2 settings', 'Filament 2 settings');
    expect((await field(dialog, 'Print temperature', 'Other layers').inputValue()) === '204', 'filament 2 keeps its change');
    await dialog.getByText('(modified)').waitFor();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Remove filament 2' }).click();
  });

  await step('the import dialog fits a phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openImport(filamentMenu, filamentPop, [bundle]);
    const box = await importDialog.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390, `dialog ${JSON.stringify(box)}`);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll <= 390, `page is ${scroll}px wide`);
    await page.screenshot({ path: join(out, 'import-phone.png') });
    await importDialog.getByRole('button', { name: 'Cancel' }).click();
  });

  await step('the filament window fills a phone screen', async () => {
    const dialog = await openEditor('Edit filament 1 settings', 'Filament settings');
    await field(dialog, 'Print temperature', 'Other layers').waitFor();
    const box = await dialog.boundingBox();
    expect(box && box.x >= 0 && Math.round(box.width) === 390, `dialog ${JSON.stringify(box)}`);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll <= 390, `page is ${scroll}px wide`);
    await page.screenshot({ path: join(out, 'filament-phone.png') });
    await dialog.getByRole('button', { name: 'Close' }).click();
  });
} catch {
  // reported by step(); a picture of where it stopped
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log(`PRESET FILES OK (${results.length} tests)`);
process.exit();
