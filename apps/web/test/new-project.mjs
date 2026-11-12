#!/usr/bin/env node
// Browser end to end for New project with changed settings, like desktop
// Orca: the selected presets stay, and changes not saved into a preset bring
// up "Keep your changed settings?" with Keep, Discard and Save…; "Remember my
// choice" answers without asking (the settings panel offers Ask again); and
// Undo can't bring the old project's model back.
//
//   node test/new-project.mjs [screenshot-dir]
//
// Needs `npm run build` first.
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pickerValue } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/tetrahedron.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4191;

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
  console.error(`NEW PROJECT FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Close window' }).click();

  const layer = page.getByLabel('Layer height', { exact: true });
  const question = page.getByTestId('preset-changes');
  const undo = page.getByRole('button', { name: /^Undo/ });
  const processName = () => pickerValue(page, 'Process preset');
  const setLayer = async (v) => {
    await layer.fill(v);
    await layer.press('Enter');
  };
  const addModel = async () => {
    await page.getByTestId('model-input').setInputFiles(model);
    await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  };
  const newProject = async () => {
    await page.getByRole('button', { name: /^Project/ }).click();
    await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
    // Signed out, a model with unsaved changes asks first, as before.
    await page
      .getByTestId('ask-dialog')
      .getByRole('button', { name: 'Discard changes' })
      .click({ timeout: 3000 })
      .catch(() => {});
  };
  const startProcess = await processName();
  const short = startProcess.replace(/\s*@.*$/, '');

  // Keep: the change comes along, the model doesn't, and Undo can't bring it back.
  await setLayer('0.16');
  await addModel();
  await newProject();
  await question.waitFor({ timeout: 30000 });
  const text = await question.innerText();
  console.log(`question:\n${text}`);
  for (const want of ['Some presets have changed settings', `Process: ${short} (1 change)`, 'Remember my choice'])
    if (!text.includes(want)) fail(`the question doesn't say "${want}"`);
  await page.waitForTimeout(500);
  await shot(page, 'question-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'question-phone');
  await page.setViewportSize({ width: 1280, height: 860 });
  await question.getByRole('button', { name: 'Keep', exact: true }).click();
  await page.getByText('Open a model to start').waitFor({ timeout: 60000 });
  if ((await layer.inputValue()) !== '0.16') fail(`Keep: layer height ${await layer.inputValue()}, not 0.16`);
  if ((await processName()) !== startProcess) fail(`Keep: process ${await processName()}, not ${startProcess}`);
  if (await undo.isEnabled()) fail('Undo is on after New project');
  console.log('keep: layer height 0.16 kept, plate empty, Undo off');

  // Cancel: nothing changes.
  await addModel();
  await newProject();
  await question.getByRole('button', { name: 'Cancel' }).click();
  await question.waitFor({ state: 'detached' });
  if (!(await page.getByText('Ready to slice').isVisible())) fail('Cancel cleared the plate');
  if ((await layer.inputValue()) !== '0.16') fail('Cancel dropped the change');
  console.log('cancel: model and change stay');

  // Discard: back to the preset's value, same preset selected.
  await newProject();
  await question.getByRole('button', { name: 'Discard' }).click();
  await page.getByText('Open a model to start').waitFor({ timeout: 60000 });
  if ((await layer.inputValue()) !== '0.2') fail(`Discard: layer height ${await layer.inputValue()}, not 0.2`);
  if ((await processName()) !== startProcess) fail(`Discard: process ${await processName()}, not ${startProcess}`);
  console.log('discard: layer height back to 0.2');

  // Save…: a system preset's changes become a new preset, selected, with nothing left changed.
  await setLayer('0.12');
  await newProject();
  await question.getByRole('button', { name: 'Save…' }).click();
  const save = page.getByTestId('preset-changes-save');
  const name = save.getByLabel(new RegExp(`^Process: ${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const suggested = await name.inputValue();
  if (suggested !== `${short} - Copy`) fail(`Save suggests "${suggested}"`);
  await page.waitForTimeout(500);
  await shot(page, 'save-desktop');
  await name.fill('My fine process');
  await save.getByRole('button', { name: 'Save', exact: true }).click();
  await save.waitFor({ state: 'detached', timeout: 60000 });
  for (let i = 0; i < 60 && (await processName()) !== 'My fine process'; i++) await page.waitForTimeout(500);
  if ((await processName()) !== 'My fine process') fail(`Save: process ${await processName()}, not My fine process`);
  if ((await layer.inputValue()) !== '0.12') fail(`Save: layer height ${await layer.inputValue()}, not 0.12`);
  if (await page.getByText(/changed from the presets/).count()) fail('Save left changes behind');
  console.log('save: saved as "My fine process" and selected, no changes left');

  // Remember my choice: Discard without asking, until Ask again.
  await setLayer('0.16');
  await newProject();
  await question.getByLabel(/Remember my choice/).check();
  await question.getByRole('button', { name: 'Discard' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="preset-changes"]'));
  await setLayer('0.16');
  await page.getByText('New project discards them without asking.').waitFor();
  await newProject();
  await page.waitForTimeout(1500);
  if (await question.count()) fail('the remembered choice still asked');
  if ((await layer.inputValue()) !== '0.12') fail(`remembered Discard: layer height ${await layer.inputValue()}, not 0.12`);
  await setLayer('0.16');
  await page.getByRole('button', { name: 'Ask again' }).click();
  await newProject();
  await question.waitFor({ timeout: 30000 });
  await question.getByRole('button', { name: 'Keep', exact: true }).click();
  console.log('remember: Discard without asking, then Ask again asks');
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 3000)}`);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
