#!/usr/bin/env node
// Browser end to end for the first visit's setup wizard, in a fresh browser
// each time: nothing is picked before you pick it; after Finish the printer
// list holds only the printers you picked (in the engine you chose, which
// names some of them differently), the first one is selected, and the list's
// "Add or remove printers…" entry opens the wizard's printer page, which can
// save on its own. Picking the other engine first moves the empty first
// project to it, so the printer and filament pages list that engine's
// presets; and the filaments you picked show in both engines under each one's
// names (one row per filament, however many printers it has presets for).
//
//   node test/first-run.mjs [screenshot-dir]
//
// Needs `npm run build` first, with both engines copied (public/engine and
// public/engine-orca).
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
const PORT = 4184;

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
  console.error(`FIRST RUN FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

/**
 * A first visit: the wizard with engine `engine`, picking `search`'s first
 * model at 0.4 mm. Checks the printer list after Finish holds only `expect`, selected.
 */
async function firstRun({ label, engine, search, expect, badge, other, filaments }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  const shot = async (name) => {
    if (!shots) return;
    await page.screenshot({ path: join(shots, `${name}-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(shots, `${name}-phone.png`) });
    await page.setViewportSize({ width: 1280, height: 860 });
  };
  try {
    await page.goto(url);
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
    await wizard.waitFor({ timeout: 30000 });
    await wizard.getByRole('radio', { name: engine }).click();
    await wizard.getByRole('button', { name: 'Next' }).click();
    // A different engine starts first (the wizard comes back on its printer page).
    await wizard.getByRole('searchbox', { name: 'Search printers' }).waitFor({ timeout: 180000 });
    const running = await page.locator('.engine-badge').innerText();
    if (!running.startsWith(badge)) fail(`${label}: the printer page lists ${running}'s printers, not ${badge}'s`);
    // Nothing is picked until you pick it (the app starts on a U1, which you may not have).
    const picked = await wizard.locator('.wizard-models button[aria-pressed=true]').count();
    if (picked) fail(`${label}: ${picked} printer(s) already picked on a first visit`);
    if (!(await wizard.getByRole('button', { name: 'Next' }).isDisabled())) fail(`${label}: Next works with no printer picked`);
    await wizard.getByRole('searchbox', { name: 'Search printers' }).fill(search);
    // (OrcaSlicer's U1 has a second 0.4 button, for its 0.4+0.6 nozzle preset.)
    await wizard.locator('.wizard-models li').first().getByRole('button', { name: '0.4', exact: true }).first().click();
    await wizard.getByRole('button', { name: 'Next' }).click();
    await wizard.getByText('Pick the filaments you use').waitFor({ timeout: 60000 });
    await wizard.locator('.wizard-filaments').waitFor({ timeout: 60000 });
    // One row per filament and one group per brand.
    const groups = await wizard.locator('.wizard-filaments details').evaluateAll((ds) =>
      ds.map((d) => ({ vendor: d.querySelector('summary').firstChild.textContent.trim(), rows: [...d.querySelectorAll('li')].map((li) => li.textContent.trim()) })),
    );
    const vendors = groups.map((g) => g.vendor.toLowerCase());
    if (new Set(vendors).size !== vendors.length) fail(`${label}: a brand shows twice: ${groups.map((g) => g.vendor).join(', ')}`);
    for (const g of groups) if (new Set(g.rows).size !== g.rows.length) fail(`${label}: ${g.vendor} lists a filament twice: ${g.rows.join(', ')}`);
    await shot(`${label}-filaments`);
    await wizard.getByRole('button', { name: 'Next' }).click({ timeout: 60000 });
    await wizard.getByRole('button', { name: 'Finish' }).click();
    await wizard.waitFor({ state: 'hidden', timeout: 30000 });
    await page.waitForFunction((n) => document.querySelector('.engine-badge')?.textContent?.startsWith(n), badge, { timeout: 180000 });
    const picker = page.getByRole('combobox', { name: 'Printer preset' });
    await page.waitForFunction(
      (v) => {
        const s = document.querySelector('select[aria-label="Printer preset"]');
        return s && !s.disabled && s.value === v;
      },
      expect,
      { timeout: 120000 },
    ).catch(() => {});
    const value = await picker.inputValue();
    if (value !== expect) fail(`${label}: "${value}" selected, not "${expect}"`);
    const options = (await picker.locator('option').allInnerTexts()).map((o) => o.trim());
    console.log(`${label}: selected "${value}", list: ${options.join(' | ')}`);
    const printers = options.filter((o) => !o.startsWith('Add or remove printers'));
    if (printers.length !== 1 || !printers[0].startsWith(expect)) fail(`${label}: the list should hold only ${expect}: ${options.join(' | ')}`);
    if (!options.includes('Add or remove printers…')) fail(`${label}: no "Add or remove printers…" in the list`);
    // A native list doesn't show in screenshots: open it as a list box for the picture.
    const open = (on) => page.evaluate((o) => document.querySelector('select[aria-label="Printer preset"]')?.setAttribute('size', o ? '4' : '1'), on);
    await open(true);
    await shot(`${label}-picker`);
    await open(false);

    // A reload keeps the printer.
    await page.reload();
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    await page.waitForFunction((v) => document.querySelector('select[aria-label="Printer preset"]')?.value === v, expect, { timeout: 60000 }).catch(() => {});
    if ((await picker.inputValue()) !== expect) fail(`${label}: after a reload "${await picker.inputValue()}" is selected`);

    // The list's last entry opens the wizard on its printer page, with your printer picked.
    await picker.selectOption({ label: 'Add or remove printers…' });
    await wizard.getByRole('searchbox', { name: 'Search printers' }).waitFor({ timeout: 10000 });
    const pickedNow = await wizard.locator('.wizard-models button[aria-pressed=true]').count();
    if (pickedNow !== 1) fail(`${label}: the wizard shows ${pickedNow} printers picked, not 1`);
    if ((await picker.inputValue()) !== expect) fail(`${label}: opening the wizard changed the printer to "${await picker.inputValue()}"`);
    await shot(`${label}-add-printers`);
    // Changing your printers later saves from this page.
    if (!(await wizard.getByRole('button', { name: 'Save', exact: true }).isVisible())) fail(`${label}: no Save on the printer page when changing printers`);
    await wizard.getByRole('button', { name: 'Not now' }).click();
    if (filaments) await checkFilaments(page, `${label} in ${badge}`, filaments);

    // Switching the empty project to the other engine keeps only your printer (not the U1 the engine used to start on).
    if (other) {
      await page.getByRole('combobox', { name: 'Slicer engine' }).selectOption({ label: other.engine });
      await page.waitForFunction((n) => document.querySelector('.engine-badge')?.textContent?.startsWith(n), other.engine, { timeout: 180000 });
      // The engine first selects what it had before, then the printer carried over (slow on a busy machine).
      await page.waitForFunction((v) => document.querySelector('select[aria-label="Printer preset"]')?.value === v, other.expect, { timeout: 180000 }).catch(() => {});
      const there = (await picker.locator('option').allInnerTexts()).map((o) => o.trim()).filter((o) => !o.startsWith('Add or remove printers'));
      console.log(`${label} -> ${other.engine}: selected "${await picker.inputValue()}", list: ${there.join(' | ')}`);
      if ((await picker.inputValue()) !== other.expect) fail(`${label}: in ${other.engine} "${await picker.inputValue()}" is selected, not "${other.expect}"`);
      if (there.length !== 1) fail(`${label}: in ${other.engine} the list holds ${there.join(' | ')}`);
      if (filaments) await checkFilaments(page, `${label} in ${other.engine}`, filaments);
    }
  } catch (e) {
    fail(`${label}: ${e.message}`);
    const text = await page.locator('body').innerText().catch(() => '');
    if (text) console.error(`page text:\n${text.slice(0, 3000)}`);
  } finally {
    await context.close();
  }
}

// The U1's PETG, ABS and matte PLA as each engine names them (the picker leaves out the @ part).
const U1_FILAMENTS = { OrcaSlicer: ['Snapmaker PETG', 'Snapmaker ABS', 'Snapmaker PLA Matte'], 'Snapmaker Orca': ['Snapmaker PETG HF', 'Snapmaker ABS', 'Snapmaker PLA Matte'] };

/** The filament picker offers each of `filaments[engine]`. */
async function checkFilaments(page, label, filaments) {
  const engine = Object.keys(filaments).find((e) => label.endsWith(e));
  const want = filaments[engine];
  // The picker fills in once the engine has the printer's filaments.
  const options = page.getByRole('combobox', { name: 'Filament 1 preset' }).locator('option');
  let offered = [];
  for (let i = 0; i < 60; i++) {
    offered = (await options.allInnerTexts()).map((o) => o.trim());
    if (want.every((w) => offered.includes(w))) break;
    await page.waitForTimeout(500);
  }
  console.log(`${label}: ${offered.length} filaments offered`);
  const missing = want.filter((w) => !offered.includes(w));
  if (missing.length) fail(`${label}: the filament picker lacks ${missing.join(', ')} (offers ${offered.join(' | ')})`);
}

try {
  // The U1 with the suggested filaments: PETG and ABS are offered in both engines, though OrcaSlicer names them differently.
  await firstRun({
    label: 'u1-orca',
    engine: 'OrcaSlicer',
    search: 'snapmaker u1',
    expect: 'Snapmaker U1 (0.4 nozzle)',
    badge: 'OrcaSlicer',
    other: { engine: 'Snapmaker Orca', expect: 'Snapmaker U1 (0.4 nozzle)' },
    filaments: U1_FILAMENTS,
  });
  await firstRun({
    label: 'u1-snapmaker',
    engine: 'Snapmaker Orca',
    search: 'snapmaker u1',
    expect: 'Snapmaker U1 (0.4 nozzle)',
    badge: 'Snapmaker Orca',
    other: { engine: 'OrcaSlicer', expect: 'Snapmaker U1 (0.4 nozzle)' },
    filaments: U1_FILAMENTS,
  });
  await firstRun({ label: 'snapmaker', engine: 'Snapmaker Orca', search: 'voron 2.4 350', expect: 'Voron 2.4 350 0.4 nozzle', badge: 'Snapmaker Orca', other: { engine: 'OrcaSlicer', expect: 'Voron 2.4 350 0.4 nozzle' } });
  // Choosing OrcaSlicer moves the first project to it, taking the printer along under OrcaSlicer's name.
  await firstRun({ label: 'orca', engine: 'OrcaSlicer', search: 'elegoo neptune 4', expect: 'Elegoo Neptune 4 0.4 nozzle', badge: 'OrcaSlicer', other: { engine: 'Snapmaker Orca', expect: 'Elegoo Neptune 4 (0.4 nozzle)' } });
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
if (!process.exitCode) console.log('FIRST RUN OK');
process.exit(process.exitCode ?? 0);
