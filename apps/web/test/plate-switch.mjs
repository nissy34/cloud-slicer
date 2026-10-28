#!/usr/bin/env node
// Browser end to end for picking another plate while one slices, and after:
// each plate keeps its own slice, as on desktop. The picked plate shows at
// once even though the engine is busy slicing (the page keeps every plate's
// picture), the slice still finishes, and the page stays on the picked plate
// with a "Plate 1 sliced · View" link. Preview has the plate tabs too and shows
// the picked plate's slice, or its models see-through with a line saying it isn't sliced yet.
//
//   node test/plate-switch.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
// Three plates: a Benchy (slow enough to pick a plate meanwhile), then a
// tetrahedron on plates 2 and 3.
const benchy = join(web, '../../fixtures/3DBenchy.stl');
const tetrahedron = join(web, '../../fixtures/tetrahedron.stl');
const shots = process.argv[2];
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
  console.error(`PLATE SWITCH FAIL: ${msg}`);
  process.exitCode = 1;
};
const expect = (ok, msg) => ok || fail(msg);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
    page.on('pageerror', (e) => fail(`page error: ${e.message}`));
    const shot = (name) => shots && page.screenshot({ path: join(shots, `${name}-${phone ? 'phone' : 'desktop'}.png`) });
    await page.goto(url);
    await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
    await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
    await page.getByTestId('model-input').setInputFiles(benchy);
    await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
    const tab = (n) => page.getByRole('tablist', { name: 'Plates' }).getByRole('tab', { name: new RegExp(`^${n}\\b`) });
    const bar = page.getByTestId('actionbar');
    const stats = page.getByTestId('slice-stats');
    const progress = page.getByTestId('slice-progress');
    const sliceButton = bar.getByRole('button', { name: /^Slice plate/ });
    for (const n of [2, 3]) {
      await page.getByRole('button', { name: 'Add plate' }).click();
      await tab(n).waitFor();
      await tab(n).click();
      await page.getByTestId('model-input').setInputFiles(tetrahedron);
      await page.getByText('Ready to slice').waitFor({ timeout: 60000 });
    }
    await tab(1).click();
    await page.getByText('Ready to slice').waitFor();
    const viewport = page.getByTestId('viewport');
    await page.waitForTimeout(500);
    const plate1 = await viewport.screenshot();

    // Pick plate 2 while plate 1 slices: it shows at once and the slice goes on.
    await sliceButton.click();
    await progress.getByText(/[1-9]\d*%/).waitFor({ timeout: 60000 });
    await tab(2).click();
    await page.waitForTimeout(700);
    expect(await progress.isVisible(), 'still slicing when plate 2 was picked (test too slow)');
    expect(!plate1.equals(await viewport.screenshot()), 'plate 2 did not show while plate 1 sliced');
    expect(await progress.isVisible(), 'the slice goes on after picking plate 2');
    expect((await progress.innerText()).includes('Plate 1:'), 'the progress says it is plate 1 slicing');
    await shot('1-picked-plate-2-while-slicing');

    // It finishes: the page stays on plate 2, with a link to plate 1's slice.
    const away = page.getByTestId('sliced-away');
    await away.waitFor({ timeout: 300000 });
    expect((await away.innerText()).includes('Plate 1 sliced'), 'the link names plate 1');
    expect(await tab(2).getAttribute('aria-selected') === 'true', 'plate 2 is still shown');
    expect(!(await page.getByText('Slicing stopped').isVisible()), 'nothing stopped the slice');
    await shot('2-plate-1-sliced-link');

    // View: Preview shows plate 1's slice.
    await away.getByRole('button', { name: 'View' }).click();
    await stats.waitFor({ timeout: 30000 }).catch(() => fail('View did not show plate 1 slice'));
    expect(await tab(1).getAttribute('aria-selected') === 'true', 'View picked plate 1');
    await page.getByTestId('legend').waitFor({ timeout: 60000 });
    await page.getByText(/Reading the G-code|Drawing the preview/).waitFor({ state: 'hidden', timeout: 60000 });
    await shot('3-preview-plate-1');

    // Preview's plate tabs: plate 3 isn't sliced, plate 1 still is.
    await tab(3).click();
    // Its models show see-through, with a line saying so.
    const note = page.getByTestId('not-sliced');
    await note.getByText("Plate 3 isn't sliced yet.").waitFor({ timeout: 5000 }).catch(() => fail('Preview of plate 3 does not say it is not sliced'));
    await page.getByTestId('unsliced-preview').waitFor({ timeout: 5000 }).catch(() => fail('Preview of plate 3 does not show its models'));
    expect(await sliceButton.innerText() === 'Slice plate 3', 'Preview offers to slice plate 3');
    // On a phone the Slice bar sits right under the view, so the line has no button.
    if (phone) expect(!(await note.getByRole('button').isVisible()), "the phone's line has no button");
    else expect((await note.getByRole('button').innerText()) === 'Slice plate 3', "the line's button slices plate 3");
    await shot('4-preview-plate-3-not-sliced');
    await tab(1).click();
    await stats.waitFor({ timeout: 5000 }).catch(() => fail('plate 1 lost its slice after picking plate 3'));

    // Prepare: switching plates there keeps the slice too.
    await page.getByRole('tab', { name: 'Prepare' }).click();
    await tab(3).click();
    expect(!(await stats.isVisible()), 'plate 3 shows no slice');
    await tab(1).click();
    await stats.waitFor({ timeout: 5000 }).catch(() => fail('plate 1 lost its slice after a plate switch in Prepare'));

    // Slicing plate 2 too keeps both.
    await tab(2).click();
    await sliceButton.click();
    await stats.waitFor({ timeout: 300000 }).catch(async () => {
      await shot('x-plate-2');
      throw new Error(`plate 2 did not slice: ${await bar.innerText()}`);
    });
    expect(await tab(2).getAttribute('aria-selected') === 'true', 'plate 2 slice shows on plate 2');
    await tab(1).click();
    await stats.waitFor({ timeout: 5000 }).catch(() => fail("plate 1's slice went when plate 2 was sliced"));
    await page.close();
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
if (!process.exitCode) console.log('plate switch: OK');
