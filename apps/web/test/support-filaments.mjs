#!/usr/bin/env node
// Browser end to end for the support filament questions and the PLA + PETG
// plate notice (Snapmaker Orca 2.4.1, lib/option-toggles.ts): a two-colour
// Benchy printed in PETG and PLA shows the notice under the plate; picking PLA
// as the support interface offers the settings that separate the two, and
// picking PLA as the support base warns, No putting Default back.
//
//   node test/support-filaments.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { pick, pickerRows } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4181;
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const model = join(web, '../../fixtures/colored_3DBenchy.3mf');

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

async function step(name, fn) {
  try {
    await fn();
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const shot = async (file) => shots && (await page.screenshot({ path: join(shots, `${file}.png`) }));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });

  await step('PETG and PLA on one plate show the notice', async () => {
    expect(!(await page.getByTestId('pla-petg').count()), 'no notice while every filament is PLA');
    // Filament 1 (the hull) becomes PETG; the rest stay PLA.
    const rows = await pickerRows(page, 'Filament 1 preset');
    const petg = rows.find((r) => /^Snapmaker PETG/.test(r.label)) ?? rows.find((r) => /PETG/.test(r.label));
    await pick(page, 'Filament 1 preset', petg.value);
    const notice = page.getByTestId('pla-petg');
    await notice.waitFor({ timeout: 30000 });
    expect(/PLA and PETG/.test(await notice.innerText()), `notice: ${await notice.innerText()}`);
    expect((await notice.getByRole('link', { name: 'How to' }).getAttribute('href'))?.includes('wiki.snapmaker.com'), 'links to the guide');
    await shot('notice');
  });

  const search = page.getByRole('searchbox', { name: 'Search process settings' });
  const prompt = page.getByRole('alertdialog');
  const setNumber = async (label, value) => {
    const box = page.getByLabel(label, { exact: true });
    await box.fill(value);
    await box.press('Enter');
  };

  await step('PLA as the interface under PETG offers the settings that separate them', async () => {
    await search.fill('enable support');
    await page.getByLabel('Enable support', { exact: true }).check();
    await search.fill('support/raft');
    await setNumber('Support/raft interface', '2');
    await prompt.getByText(/Detected PLA as support interface material for PETG models/).waitFor();
    expect(/Top Z distance: .* → 0 mm/.test(await prompt.innerText()), 'lists what changes');
    await shot('interface-question');
    await prompt.getByRole('button', { name: 'Change them' }).click();
    await prompt.waitFor({ state: 'detached' });
    await search.fill('top z distance');
    const topZ = await page.getByLabel('Top Z distance', { exact: true }).inputValue();
    expect(parseFloat(topZ) === 0, `top Z distance set to 0, got ${topZ}`);
  });

  await step('PLA as the support base under PETG warns, Use Default puts it back', async () => {
    await search.fill('support/raft');
    await setNumber('Support/raft base', '2');
    await prompt.getByText(/Non-soluble support materials are not recommended for support base/).waitFor();
    await shot('base-warning');
    await prompt.getByRole('button', { name: 'Use Default' }).click();
    await prompt.waitFor({ state: 'detached' });
    const base = await page.getByLabel('Support/raft base', { exact: true }).inputValue();
    expect(base === '0', `support base back to Default, got ${base}`);
  });
} finally {
  await browser.close();
  process.kill(-server.pid);
}
