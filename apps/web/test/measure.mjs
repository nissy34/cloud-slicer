#!/usr/bin/env node
// Browser check for the Measure tool's circles and undo, like desktop Orca's:
// on desktop, pointing at a washer's rim shows its circle with diameter and
// radius; a picked feature picked again is let go; Esc lets go of the last pick
// and Delete starts over (the washer stays); each pick has a Reset button. On a
// phone (touch) a tap near the rim picks the circle, which a finger could never
// hit with desktop's 0.5 mm, and Reset lets go of it.
//
//   node test/measure.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4187;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});
const fail = (msg) => {
  console.error(`MEASURE FAIL: ${msg}`);
  process.exitCode = 1;
};
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

// A washer: 30 mm across with a 10 mm hole, 5 mm tall, 96 sides.
function washerStl() {
  const n = 96;
  const p = (r, k, z) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), z];
  const t = [];
  for (let k = 0; k < n; k++) {
    const [o0, o1, O0, O1] = [p(15, k, 0), p(15, k + 1, 0), p(15, k, 5), p(15, k + 1, 5)];
    const [i0, i1, I0, I1] = [p(5, k, 0), p(5, k + 1, 0), p(5, k, 5), p(5, k + 1, 5)];
    t.push([o0, o1, O1], [o0, O1, O0], [i0, I1, i1], [i0, I0, I1], [O0, O1, I1], [O0, I1, I0], [o0, i1, o1], [o0, i0, i1]);
  }
  const facets = t.map((x) => `facet normal 0 0 0\nouter loop\n${x.map((q) => `vertex ${q.join(' ')}`).join('\n')}\nendloop\nendfacet`);
  return `solid washer\n${facets.join('\n')}\nendsolid washer\n`;
}
const washer = join(mkdtempSync(join(tmpdir(), 'measure-')), 'washer.stl');
writeFileSync(washer, washerStl());

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(washer);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  return page;
}
const titles = (panel) => panel.locator('.measure-title').allInnerTexts();

try {
  // Desktop: a mouse points at the rim (Orca's own 0.5 mm) along the middle of the view.
  {
    const page = await open({ width: 1280, height: 800 }, false);
    await page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Measure' }).click();
    const panel = page.getByRole('region', { name: 'Measure' });
    await panel.waitFor();
    const box = await page.getByTestId('viewport').boundingBox();
    let rim = null;
    for (let fx = 0.3; fx <= 0.7 && !rim; fx += 0.002) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.5);
      await page.waitForTimeout(40);
      if ((await titles(panel))[0] === 'Circle') rim = fx;
    }
    if (rim === null) throw new Error('pointing along the washer never showed a circle');
    const figures = await panel.getByLabel('Feature under the pointer').innerText();
    if (!/Diameter\s+(30|10)\.000 mm/.test(figures) || !/Radius\s+(15|5)\.000 mm/.test(figures)) fail(`the circle's figures: ${figures}`);
    if (shots) await page.screenshot({ path: join(shots, 'measure-desktop-circle.png') });
    console.log(`desktop: the rim shows ${figures.replace(/\s+/g, ' ')}`);

    // Pick the circle, then the face beside it.
    await page.mouse.click(box.x + box.width * rim, box.y + box.height * 0.5);
    await panel.getByLabel('Feature 1').waitFor();
    // Picking it again lets go of it.
    await page.mouse.click(box.x + box.width * rim, box.y + box.height * 0.5);
    await panel.getByLabel('Feature 1').waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail('picking the circle again did not let go of it'));
    await page.mouse.click(box.x + box.width * rim, box.y + box.height * 0.5);
    await panel.getByLabel('Feature 1').waitFor();
    // The pointer went left to right, so the rim found is the washer's left edge: its face is to the right.
    await page.mouse.click(box.x + box.width * (rim + 0.012), box.y + box.height * 0.5);
    const second = await panel.getByLabel('Feature 2').waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (!second) fail('no second feature next to the rim');
    else {
      await panel.getByLabel('Measurement').waitFor({ timeout: 10000 });
      if (shots) await page.screenshot({ path: join(shots, 'measure-desktop-two.png') });
      // Esc lets go of the last pick; the tool stays open.
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.keyboard.press('Escape');
      await panel.getByLabel('Feature 2').waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail('Esc did not let go of the second pick'));
      if (!(await panel.getByLabel('Feature 1').isVisible())) fail('Esc let go of the first pick too');
      if (await panel.getByLabel('Measurement').isVisible()) fail('the measurement stayed after Esc');
      console.log('desktop: Esc lets go of the last pick');
    }
    // Reset beside a pick lets go of it.
    await panel.getByRole('button', { name: 'Reset 1' }).click();
    await panel.getByLabel('Feature 1').waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail('Reset did not let go of the pick'));
    // Delete starts over and never deletes the washer.
    await page.mouse.click(box.x + box.width * rim, box.y + box.height * 0.5);
    await panel.getByLabel('Feature 1').waitFor();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.keyboard.press('Delete');
    await panel.getByLabel('Feature 1').waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail('Delete did not start over'));
    await page.waitForTimeout(500);
    if ((await page.locator('ul.objects > li.object').count()) !== 1) fail('Delete in Measure deleted the washer');
    // With nothing picked, Esc closes the tool as before.
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail('Esc with nothing picked did not close Measure'));
    console.log('desktop: Reset lets go of a pick, Delete starts over and keeps the washer, Esc then closes the tool');
    await page.close();
  }

  // Phone: a tap has no hover to aim with, so taps near the rim reach the circle.
  {
    const page = await open({ width: 390, height: 844 }, true);
    await page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Measure' }).tap();
    const panel = page.getByRole('region', { name: 'Measure' });
    await panel.waitFor();
    await page.waitForTimeout(800);
    const box = await page.getByTestId('viewport').boundingBox();
    let circle = null;
    for (let fx = 0.3; fx <= 0.7 && !circle; fx += 0.01) {
      await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * 0.5);
      await page.waitForTimeout(300);
      const t = await titles(panel);
      if (t[0] === '1. Circle') circle = await panel.getByLabel('Feature 1').innerText();
      else if (t.length) await panel.getByRole('button', { name: 'Reset 1' }).tap();
    }
    if (!circle) fail('no tap on the washer picked a circle');
    else {
      if (!/Radius\s+(15|5)\.000 mm/.test(circle)) fail(`the tapped circle's figures: ${circle}`);
      if (shots) await page.screenshot({ path: join(shots, 'measure-phone-circle.png') });
      console.log(`phone: a tap picked ${circle.replace(/\s+/g, ' ')}`);
      await panel.getByRole('button', { name: 'Reset 1' }).tap();
      await panel.getByLabel('Feature 1').waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail('Reset did not let go of the pick on a phone'));
      console.log('phone: Reset lets go of the pick');
    }
    await page.close();
  }
} catch (e) {
  fail(e.stack || e.message);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
