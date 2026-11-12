// The colour popup (components/ColourPicker.tsx) end to end: tapping a filament's swatch opens
// desktop Orca's 24 filament colours, a hex code field and Custom (a colour square + hue bar);
// your own colours come back under Recent; it fits a phone. Pass a folder to save screenshots.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { setColour } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = join(web, '../../fixtures/3DBenchy.stl');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4181;

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
  console.error(`COLOUR PICKER FAIL: ${msg}`);
  process.exitCode = 1;
};
const check = (ok, msg) => ok || fail(msg);
const shot = async (page, name) => shots && (await page.waitForTimeout(400), await page.screenshot({ path: join(shots, `${name}.png`) }));

const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => fail(`page error: ${e.message}`));
    await page.goto(url);
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
    await page.getByTestId('model-input').setInputFiles(model);
    await page.getByText('Ready to slice').first().waitFor({ timeout: 120000 });
    if (phone) await page.getByRole('tab', { name: 'Settings' }).first().click().catch(() => {});

    const name = 'Filament 1 colour';
    const swatch = page.getByRole('button', { name, exact: true });
    const pop = page.getByRole('dialog', { name, exact: true });
    const colour = () => swatch.getAttribute('data-colour');
    // The store sets the colour a moment later (through the engine).
    const becomes = async (want) => {
      for (let i = 0; i < 50 && (await colour()) !== want; i++) await page.waitForTimeout(100);
      return (await colour()) === want;
    };

    // ---- the built-in colours: one tap picks and closes ----
    await swatch.click();
    await pop.waitFor();
    const squares = pop.getByRole('group', { name: 'Colours' }).getByRole('button');
    check((await squares.count()) === 24, `24 built-in colours, got ${await squares.count()}`);
    check((await page.locator('input[type=color]').count()) === 0, 'no browser colour box on the page');
    const grid = await pop.getByRole('group', { name: 'Colours' }).evaluate((g) => [g.scrollWidth, g.clientWidth, g.parentElement.scrollWidth, g.parentElement.clientWidth]);
    check(grid[0] <= grid[1] && grid[2] <= grid[3], `the colours fit inside the popup: ${grid}`);
    const box = await pop.boundingBox();
    const vw = page.viewportSize().width;
    check(box && box.x >= 0 && box.x + box.width <= vw, `the popup fits the screen: ${JSON.stringify(box)} in ${vw}`);
    await shot(page, phone ? 'phone-colours' : 'desktop-colours');
    await pop.getByRole('button', { name: 'Red', exact: true }).click();
    await pop.waitFor({ state: 'hidden' });
    check(await becomes('#F72323'), `Red picks #F72323, got ${await colour()}`);

    // ---- the picked one is ticked when it opens again ----
    await swatch.click();
    check((await pop.getByRole('button', { name: 'Red', exact: true }).getAttribute('aria-pressed')) === 'true', 'Red is ticked');
    await page.keyboard.press('Escape');
    await pop.waitFor({ state: 'hidden' });

    // ---- a typed hex code, then it shows under Recent ----
    await setColour(page, name, '3a7d5c');
    check(await becomes('#3A7D5C'), `typed hex sets #3A7D5C, got ${await colour()}`);
    await swatch.click();
    const recent = pop.getByRole('group', { name: 'Recent colours' });
    await recent.waitFor({ timeout: 3000 }).catch(() => fail('own colour not under Recent'));
    check((await recent.getByRole('button', { name: '#3A7D5C' }).count()) === 1, 'Recent has #3A7D5C');

    // ---- Custom: drag on the colour square, Done keeps it ----
    await pop.getByRole('button', { name: 'Custom' }).click();
    const square = pop.locator('.react-colorful__saturation');
    await square.waitFor();
    const s = await square.boundingBox();
    await page.mouse.click(s.x + s.width * 0.8, s.y + s.height * 0.2);
    await shot(page, phone ? 'phone-custom' : 'desktop-custom');
    const typed = await pop.getByLabel('Hex code').inputValue();
    await pop.getByRole('button', { name: 'Done' }).click();
    await pop.waitFor({ state: 'hidden' });
    check(typed !== '#3A7D5C' && (await becomes(typed)), `Custom sets the dragged colour (${typed}), got ${await colour()}`);
    await page.close();
    console.log(`${phone ? 'phone' : 'desktop'}: built-in, typed, recent and custom colours all set the filament`);
  }
  if (!process.exitCode) console.log('COLOUR PICKER OK');
} catch (e) {
  fail(e.stack ?? e);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
