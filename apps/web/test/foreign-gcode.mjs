#!/usr/bin/env node
// Browser end to end, in both engines, for a project from another slicer: a
// Bambu Studio 2.5 project for the Bambu Lab A1 mini brings Bambu Studio's own
// start and filament-change G-code, written for variables these engines don't
// have (flush_volumetric_speeds). Opening it keeps the A1 mini's own G-code,
// says so, and slices. The same file marked as made by the engine itself keeps
// its G-code; given a variable the engine doesn't know, slicing stops with an
// error naming the G-code, the line and the variable.
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

    // Bambu Studio 2.5's project: the printer's own G-code, a note, and it slices.
    await open(modelPath);
    const note = page.getByText(/The printer's own G-code is used/);
    await note.waitFor({ timeout: 30000 }).catch(() => fail(`${engine}: no note about the printer's own G-code`));
    if (await note.count()) console.log(`${engine}: ${(await note.first().innerText()).trim()}`);
    if (engine === 'snapmaker') await shoot('bambu-note');
    if (!(await note.count()) || !/written for Bambu Studio 2\.5/.test(await note.first().innerText())) fail(`${engine}: the note doesn't name Bambu Studio 2.5`);
    const sliced = await slice();
    if (sliced) fail(`${engine}: the Bambu Studio project didn't slice: ${sliced}`);
    else console.log(`${engine}: sliced: ${await page.getByTestId('slice-stats').innerText()}`);

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
