#!/usr/bin/env node
// Browser end to end for settings that switch other settings on and off
// (desktop's ConfigManipulation) and the settings search: support settings
// grey out with support off, the search finds settings on any page, and
// turning on spiral vase asks to change the settings it needs, Developer
// mode shows desktop's develop settings, and typed
// numbers are checked against the engine's own limits, on a computer and on
// a phone.
//
//   node test/settings.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

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

async function run(name, options) {
  const page = await browser.newPage(options);
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText(/Open a model to start|Tap to open a model/).first().waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
  const search = page.getByRole('searchbox', { name: 'Search process settings' });
  await search.waitFor();
  const shot = async (file) => shots && (await page.screenshot({ path: join(shots, `${name}-${file}.png`) }));

  await step(`${name}: support settings grey out while support is off`, async () => {
    await search.fill('top z distance');
    const topZ = page.getByLabel('Top Z distance', { exact: true });
    await topZ.waitFor();
    expect(await topZ.isDisabled(), 'Top Z distance should be greyed out with support off');
    await search.fill('enable support');
    await page.getByLabel('Enable support', { exact: true }).check();
    await search.fill('top z distance');
    expect(await page.getByLabel('Top Z distance', { exact: true }).isEnabled(), 'Top Z distance should apply with support on');
    await search.fill('enable support');
    await page.getByLabel('Enable support', { exact: true }).uncheck();
  });

  await step(`${name}: the search finds settings on every page`, async () => {
    await search.fill('brim');
    await page.getByRole('group', { name: /Others › Brim/ }).waitFor();
    expect((await page.getByRole('tablist', { name: 'Settings pages' }).count()) === 0, 'page tabs hide while searching');
    await search.evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await shot('search');
    await search.fill('zzz no such setting');
    await page.getByText(/No process settings match/).waitFor();
    await search.fill('');
    await page.getByRole('tab', { name: 'Quality' }).waitFor();
  });

  await step(`${name}: Developer mode shows desktop's develop settings`, async () => {
    const sparse = page.getByLabel('No sparse layers (beta)', { exact: true });
    await search.fill('no sparse layers');
    await page.getByText(/No process settings match/).waitFor();
    expect(!(await page.getByLabel('Developer', { exact: true }).count()), 'Developer only with Advanced on');
    await page.getByLabel('Advanced', { exact: true }).check();
    await page.getByLabel('Developer', { exact: true }).check();
    await sparse.waitFor();
    await page.waitForTimeout(300); // the switch's slide
    await shot('developer');
    await page.getByLabel('Developer', { exact: true }).uncheck();
    await page.getByText(/No process settings match/).waitFor();
    await page.getByLabel('Advanced', { exact: true }).uncheck();
    await search.fill('');
  });

  await step(`${name}: settings that don't apply are hidden on their page`, async () => {
    await page.getByRole('tab', { name: 'Quality' }).click();
    await page.getByLabel('Advanced', { exact: true }).check();
    expect(!(await page.getByLabel('Ironing flow', { exact: true }).count()), 'ironing flow hidden with ironing off');
    await page.getByRole('combobox', { name: 'Ironing Type', exact: true }).selectOption('top');
    await page.getByLabel('Ironing flow', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Ironing Type', exact: true }).selectOption('no ironing');
    await page.getByLabel('Advanced', { exact: true }).uncheck();
  });

  await step(`${name}: spiral vase asks to change the settings it needs`, async () => {
    await search.fill('spiral vase');
    await page.getByLabel('Spiral vase', { exact: true }).check();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByText(/Spiral vase only works when/).waitFor();
    await shot('prompt');
    await dialog.getByRole('button', { name: 'Change them' }).click();
    await dialog.waitFor({ state: 'detached' });
    await search.fill('wall loops');
    expect((await page.getByLabel('Wall loops', { exact: true }).inputValue()) === '1', 'wall loops set to 1');
    await search.fill('spiral vase');
    await page.getByLabel('Spiral vase', { exact: true }).uncheck();
    await search.fill('');
  });

  await step(`${name}: typed numbers are checked against the setting's own limits`, async () => {
    const note = page.locator('.option-note');
    // Not a number: refused, the old value stays, a red line says why.
    await search.fill('line width');
    const width = page.getByLabel('Initial layer', { exact: true });
    const before = await width.inputValue();
    await width.fill('0.7$');
    await width.press('Enter');
    await note.getByText('“0.7$” is not a number.').waitFor();
    expect((await width.inputValue()) === before, `kept ${before}`);
    await shot('invalid');
    // A big "mm or %" number asks which one was meant.
    await width.fill('150');
    await width.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Percent or mm?' });
    await dialog.waitFor();
    await shot('percent-or-mm');
    await dialog.getByRole('button', { name: '150%' }).click();
    await dialog.waitFor({ state: 'detached' });
    expect((await width.inputValue()) === '150%', `150% taken, got ${await width.inputValue()}`);
    expect(!(await note.count()), 'no red line after a good value');
    await width.fill('0,45');
    await width.press('Enter');
    expect((await width.inputValue()) === '0.45', `comma as decimal point, got ${await width.inputValue()}`);
    // Out of range: set to the nearest allowed value.
    await search.fill('sparse infill density');
    const density = page.getByLabel('Sparse infill density', { exact: true });
    await density.fill('150');
    await density.press('Enter');
    await note.getByText(/set to 100%/).waitFor();
    expect((await density.inputValue()) === '100%', `density set to 100%, got ${await density.inputValue()}`);
    await shot('clamped');
    // 100% with a pattern that can't fill it asks, like desktop 2.4.1.
    const fill = page.getByRole('alertdialog');
    await fill.getByText(/infill pattern doesn't support 100% density/).waitFor();
    await fill.getByRole('button', { name: 'Use rectilinear' }).click();
    await fill.waitFor({ state: 'detached' });
    expect((await density.inputValue()) === '100%', `density kept at 100%, got ${await density.inputValue()}`);
    await search.fill('sparse infill pattern');
    const pattern = page.getByRole('combobox', { name: 'Sparse infill pattern', exact: true });
    expect((await pattern.inputValue()) === 'rectilinear', `pattern switched to rectilinear, got ${await pattern.inputValue()}`);
    // Density back first: the preset's pattern at 100% would ask again.
    await search.fill('sparse infill density');
    await page.getByRole('button', { name: /Reset to the preset value: Sparse infill density/ }).click();
    await search.fill('sparse infill pattern');
    await page.getByRole('button', { name: /Reset to the preset value: Sparse infill pattern/ }).click();
    expect(!(await fill.count()), 'no question after putting both back');
    await search.fill('line width');
    await page.getByRole('button', { name: /Reset to the preset value: Initial layer$/ }).click();
    await search.fill('');
  });

  await page.close();
}

try {
  await run('desktop', { viewport: { width: 1280, height: 900 } });
  await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
} finally {
  await browser.close();
  process.kill(-server.pid);
}
