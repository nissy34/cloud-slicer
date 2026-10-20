#!/usr/bin/env node
// Browser end to end, in both engines, for a project from another slicer: a
// Bambu Studio 2.5 project for the Bambu Lab A1 mini brings Bambu Studio's own
// start and filament-change G-code, written for variables these engines don't
// all have (flush_volumetric_speeds). Like desktop, the project keeps its own
// G-code: OrcaSlicer fills it in and its G-code carries Bambu Studio 2.5's
// start lines; Snapmaker Orca can't, so it slices with the A1 mini's own G-code
// and says why. The same file marked as made by the engine itself keeps its
// G-code; given a variable the engine doesn't know, slicing stops with an error
// naming the G-code, the line and the variable.
//
//   node test/foreign-gcode.mjs [screenshot-dir]
//
// Needs `npm run build` first, with both engines copied (public/engine and
// public/engine-orca).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = join(web, '../../fixtures/calib-cube-10-dual-colour-merged.3mf');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4184;
const PRINTER = 'Bambu Lab A1 mini 0.4 nozzle';

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
  console.error(`FOREIGN G-CODE FAIL: ${msg}`);
  process.exitCode = 1;
};

// The same project as if `engine` had saved it, with a start G-code line using
// a variable no engine has (a user's own custom G-code).
function ownProject(engine) {
  const files = unzipSync(new Uint8Array(readFileSync(modelPath)));
  const model = strFromU8(files['3D/3dmodel.model']).replace(
    /<metadata name="Application">[^<]*<\/metadata>/,
    engine === 'orca' ? '<metadata name="Application">BambuStudio-02.06.00.51</metadata>\n <metadata name="OrcaSlicer">2.4.2</metadata>' : '<metadata name="Application">Snapmaker_Orca-2.4.0</metadata>',
  );
  files['3D/3dmodel.model'] = strToU8(model);
  const config = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
  config.machine_start_gcode = `G28\nM117 {not_a_real_variable}\n`;
  config.change_filament_gcode = 'G1 E-1';
  files['Metadata/project_settings.config'] = strToU8(JSON.stringify(config));
  return { name: 'own-project.3mf', mimeType: 'model/3mf', buffer: Buffer.from(zipSync(files)) };
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const ready = () => page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const picker = page.getByRole('combobox', { name: 'Printer preset' });
  const error = page.locator('.error-text[role="alert"]');
  const open = async (file) => {
    if (await page.getByRole('tab', { name: 'Prepare' }).count()) await page.getByRole('tab', { name: 'Prepare' }).first().click();
    await page.getByTestId('model-input').setInputFiles(file);
    const replace = page.getByRole('button', { name: /Open as a new project|Open project/ });
    if (await replace.first().isVisible({ timeout: 3000 }).catch(() => false)) await replace.first().click();
    await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  };
  const shoot = async (name) => {
    if (!shots) return;
    await page.screenshot({ path: join(shots, `${name}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(shots, `${name}-phone.png`) });
    await page.setViewportSize({ width: 1280, height: 800 });
  };
  const slice = async () => {
    await page.getByRole('button', { name: /^Slice plate/ }).click();
    await Promise.race([page.getByTestId('slice-stats').waitFor({ timeout: 300000 }), error.first().waitFor({ timeout: 300000 })]);
    return (await error.count()) ? (await error.first().innerText()).trim() : '';
  };

  await page.goto(url);
  await ready();
  // Setup: the A1 mini.
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('searchbox', { name: 'Search printers' }).fill('a1 mini');
  await wizard.locator('.wizard-models li').first().getByRole('button', { name: '0.4', exact: true }).click();
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByText('Pick the filaments you use').waitFor({ timeout: 60000 });
  await wizard.getByRole('button', { name: 'Next' }).click();
  await wizard.getByRole('button', { name: 'Finish' }).click();

  for (const engine of ['snapmaker', 'orca']) {
    if (engine === 'orca') {
      await page.goto(`${url}?engine=orca`);
      await ready();
    }
    await picker.selectOption(PRINTER);

    // Bambu Studio 2.5's project slices in both engines.
    await open(modelPath);
    const sliced = await slice();
    if (sliced) fail(`${engine}: the Bambu Studio project didn't slice: ${sliced}`);
    else console.log(`${engine}: sliced: ${await page.getByTestId('slice-stats').innerText()}`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()]);
    const bambuStart = readFileSync(await download.path(), 'utf8').includes('M1002 gcode_claim_action:54');
    const note = page.getByText(/so the printer's own G-code is used/);
    const noteText = (await note.count()) ? (await note.first().innerText()).trim() : '';
    console.log(`${engine}: Bambu Studio 2.5's start G-code in the output: ${bambuStart}; note: ${noteText || '(none)'}`);
    if (engine === 'orca') {
      // OrcaSlicer fills it in: the file's own G-code, as on desktop.
      if (!bambuStart) fail('orca: the G-code is not the project\'s own Bambu Studio 2.5 G-code');
      if (noteText) fail(`orca: unexpected note: ${noteText}`);
    } else {
      // Snapmaker Orca can't: the A1 mini's own G-code, and a note saying why.
      if (bambuStart) fail('snapmaker: the G-code still has Bambu Studio 2.5\'s start lines');
      if (!/Bambu Studio 2\.5's G-code doesn't work in Snapmaker Orca \(“flush_volumetric_speeds”\)/.test(noteText)) fail(`snapmaker: the note doesn't say why: ${noteText || '(none)'}`);
      if (shots) await page.waitForTimeout(5000); // the Preview reads the G-code
      await shoot('bambu-note');
    }
    await page.getByRole('tab', { name: 'Prepare' }).first().click().catch(() => {});

    // The engine's own project keeps its G-code; an unknown variable is named.
    await open(ownProject(engine));
    const message = await slice();
    console.log(`${engine}: ${message}`);
    if (engine === 'snapmaker') await shoot('gcode-error');
    if (!/Start G-code[^\n]*line 2: “not_a_real_variable” isn't a setting this slicer knows/i.test(message))
      fail(`${engine}: the error doesn't name the G-code, line and variable: ${message || '(it sliced)'}`);
  }
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
if (!process.exitCode) console.log('FOREIGN G-CODE OK');
process.exit(process.exitCode ?? 0);
