#!/usr/bin/env node
// Browser end to end for the object toolbar over the 3D view: adding a model
// keeps the one already there, simplify halves the triangles, lay on face
// turns the object, variable layer height makes an adaptive profile, measure
// picks two features and measures between them, and the toolbar fits a phone
// (and the page itself never scrolls there).
//
//   node test/toolbar.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(web, '../../fixtures');
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4174;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
const url = `http://localhost:${PORT}/`;
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`TOOLBAR FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  return page;
}

const objectRows = (page) => page.locator('ul.objects > li.object');
// The rotation the Lay on face panel shows; it is gone while nothing is selected, so don't wait long.
const rotation = (page, timeout = 1000) => page.getByLabel('Current rotation').innerText({ timeout });

try {
  const page = await open({ width: 1280, height: 800 }, false);
  await page.getByTestId('model-input').setInputFiles(join(fixtures, '3DBenchy.stl'));
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  const toolbar = page.getByRole('toolbar', { name: 'Object tools' });
  await toolbar.waitFor();
  for (const name of ['Undo', 'Redo', 'Add models', 'Add plate', 'Auto orient', 'Arrange all objects', 'Split to objects', 'Split to parts', 'Move', 'Rotate', 'Scale', 'Lay on face', 'Cut', 'Support painting', 'Seam painting', 'Colour painting'])
    await toolbar.getByRole('button', { name }).waitFor();
  console.log('toolbar shows desktop Orca\'s tools');

  // Add a second model: it joins the first instead of replacing it.
  await page.getByTestId('model-input').setInputFiles(join(fixtures, 'tetrahedron.stl'));
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object').length === 2, null, { timeout: 60000 });
  console.log('adding a model keeps the one on the plate');

  await objectRows(page).first().locator('.object-name').click();
  const box = await page.getByTestId('viewport').boundingBox();

  // Rotate: the gizmo panel opens.
  await toolbar.getByRole('button', { name: 'Rotate' }).click();
  const rotate = page.getByRole('region', { name: 'Rotate' });
  await rotate.waitFor();
  if (shots) await page.screenshot({ path: join(shots, 'toolbar-desktop-rotate.png') });
  // Exact values go in the gizmo's own panel, like desktop.
  await rotate.getByLabel('Rotation Z').fill('90');
  await rotate.getByLabel('Rotation Z').press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="Rotation Z"]')?.value === '90', null, { timeout: 30000 });
  await rotate.getByLabel('Rotation Z').fill('0');
  await rotate.getByLabel('Rotation Z').press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="Rotation Z"]')?.value === '0', null, { timeout: 30000 });
  console.log('rotation typed in the Rotate panel');
  // The panel opens under the toolbar, like desktop's gizmo panels.
  const barBottom = (await toolbar.boundingBox()).y + (await toolbar.boundingBox()).height;
  if ((await rotate.boundingBox()).y < barBottom) fail('the Rotate panel should open under the toolbar');

  // Undo and redo with the keyboard, like desktop.
  await page.locator('body').press('Control+z');
  await page.waitForFunction(() => document.querySelector('[aria-label="Rotation Z"]')?.value === '90', null, { timeout: 30000 });
  await page.locator('body').press('Control+y');
  await page.waitForFunction(() => document.querySelector('[aria-label="Rotation Z"]')?.value === '0', null, { timeout: 30000 });
  console.log('Ctrl+Z / Ctrl+Y undo and redo the rotation');

  // Cut shows its plane; the height follows the panel.
  await toolbar.getByRole('button', { name: 'Cut' }).click();
  const cut = page.getByRole('region', { name: 'Cut' });
  await cut.waitFor();
  await cut.getByLabel('Cut height in mm').fill('12');
  await cut.getByLabel('Cut height in mm').press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="Cut height"]')?.value === '12', null, { timeout: 10000 });
  await page.waitForTimeout(300);
  if (shots) await page.screenshot({ path: join(shots, 'toolbar-desktop-cut.png') });
  console.log('cut plane follows the height');

  // Simplify (from the object list): the count it would leave, then Apply
  // halves the boat's triangles, and Ctrl+Z brings them back.
  const triangles = async () => {
    await page.getByRole('button', { name: 'Simplify', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Simplify' });
    await page.waitForFunction(() => /→/.test(document.querySelector('[aria-label="Triangles"]')?.textContent ?? ''), null, { timeout: 60000 });
    return { panel, now: Number((await panel.getByLabel('Triangles').innerText()).match(/([\d,]+) triangles/)[1].replace(/,/g, '')) };
  };
  const { panel: simplify, now: before } = await triangles();
  await simplify.getByRole('radio', { name: 'Decimate ratio' }).click();
  await page.waitForFunction(() => /→/.test(document.querySelector('[aria-label="Triangles"]')?.textContent ?? ''), null, { timeout: 60000 });
  if (shots) await page.screenshot({ path: join(shots, 'simplify-desktop.png') });
  await simplify.getByRole('button', { name: 'Apply' }).click();
  await simplify.waitFor({ state: 'detached', timeout: 60000 });
  const { now: after } = await triangles();
  if (Math.abs(after - before / 2) > before * 0.02) fail(`simplify at 50% should halve the triangles: ${before} -> ${after}`);
  await page.locator('body').press('Control+z');
  await page.waitForTimeout(500);
  await page.getByRole('region', { name: 'Simplify' }).getByRole('button', { name: 'Done' }).click();
  const { now: undone } = await triangles();
  if (undone !== before) fail(`undo should bring the triangles back: ${undone} vs ${before}`);
  await page.getByRole('region', { name: 'Simplify' }).getByRole('button', { name: 'Done' }).click();
  console.log(`simplify: ${before} -> ${after} triangles, undo brings ${undone} back`);
  // Variable layer height: Adaptive gives the object its own layer profile; Reset takes it away.
  await toolbar.getByRole('button', { name: 'Variable layer height' }).click();
  const layersPanel = page.getByRole('region', { name: 'Variable layer height' });
  await layersPanel.waitFor();
  const summary = layersPanel.getByLabel('Layer heights');
  await page.waitForFunction(() => /^Plain/.test(document.querySelector('[aria-label="Layer heights"]')?.textContent ?? ''), null, { timeout: 30000 });
  const plainText = await summary.innerText();
  await layersPanel.getByRole('button', { name: 'Adaptive' }).click();
  await page.waitForFunction(() => /^Variable/.test(document.querySelector('[aria-label="Layer heights"]')?.textContent ?? ''), null, { timeout: 30000 });
  const adaptiveText = await summary.innerText();
  if (adaptiveText.match(/(\d+) layers/)?.[1] === plainText.match(/(\d+) layers/)?.[1]) fail(`adaptive kept the layer count: ${plainText} / ${adaptiveText}`);
  if (shots) await page.screenshot({ path: join(shots, 'layers-desktop-adaptive.png') });
  // Holding on the chart adds detail around that height.
  const chart = await layersPanel.getByRole('img', { name: 'Layer height profile' }).boundingBox();
  await page.mouse.move(chart.x + chart.width / 2, chart.y + chart.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await layersPanel.getByRole('button', { name: 'Reset' }).click();
  await page.waitForFunction(() => /^Plain/.test(document.querySelector('[aria-label="Layer heights"]')?.textContent ?? ''), null, { timeout: 30000 });
  console.log(`variable layer height: ${plainText} -> ${adaptiveText} -> reset`);

  // Lay on face: click the highlighted faces over the boat until it turns.
  await toolbar.getByRole('button', { name: 'Lay on face' }).click();
  await page.getByRole('region', { name: 'Lay on face' }).waitFor();
  const start = await rotation(page, 10000);
  // Points over the view, nearest the middle (where the boat is) first. A
  // click that misses the object deselects it, like desktop: pick it again.
  const points = [];
  for (let y = 0.3; y <= 0.7; y += 0.04) for (let x = 0.35; x <= 0.65; x += 0.04) points.push([x, y]);
  points.sort((a, b) => Math.hypot(a[0] - 0.5, a[1] - 0.45) - Math.hypot(b[0] - 0.5, b[1] - 0.45));
  let turned = false;
  let laid = '';
  for (const [i, [x, y]] of points.entries()) {
    if (!(await page.getByRole('region', { name: 'Lay on face' }).isVisible())) {
      await objectRows(page).first().locator('.object-name').click();
      await toolbar.getByRole('button', { name: 'Lay on face' }).click();
    }
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(100);
    if (shots && i === 0) await page.screenshot({ path: join(shots, 'toolbar-desktop-flatten.png') });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);
    const now = await rotation(page, 3000).catch(() => start);
    turned = now !== start;
    if (turned) {
      laid = now;
      break;
    }
  }
  if (shots && turned) {
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, 'toolbar-desktop-laid.png') });
  }
  if (!turned) fail('lay on face did not turn the object');
  else {
    // It stays laid (and the object stays selected) once the click is done.
    const after = await rotation(page, 3000).catch(() => 'no object selected');
    if (after !== laid) fail(`after lay on face the panel showed ${laid}, then ${after}`);
    console.log(`lay on face: ${start} -> ${after}`);
  }

  // Measure: hovering shows the feature under the pointer, two clicks measure between them.
  await page.keyboard.press('Escape');
  await toolbar.getByRole('button', { name: 'Measure' }).click();
  const measure = page.getByRole('region', { name: 'Measure' });
  await measure.waitFor();
  let picked = 0;
  for (const [x, y] of points) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
    const hovered = await measure.getByLabel('Feature under the pointer').waitFor({ timeout: 1500 }).then(() => true, () => false);
    if (!hovered && !picked) continue;
    if (shots && !picked) await page.screenshot({ path: join(shots, 'measure-desktop-hover.png') });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
    picked = (await measure.getByLabel('Feature 2').isVisible()) ? 2 : (await measure.getByLabel('Feature 1').isVisible()) ? 1 : 0;
    if (picked === 2) break;
  }
  if (picked < 2) fail('measure did not pick two features');
  else {
    await measure.getByLabel('Measurement').waitFor({ timeout: 10000 });
    const figures = await measure.getByLabel('Measurement').innerText();
    if (!/Distance|Angle/.test(figures)) fail(`measure showed no distance or angle: ${figures}`);
    if (shots) await page.screenshot({ path: join(shots, 'measure-desktop.png') });
    console.log(`measure: ${figures.replace(/\s+/g, ' ')}`);
  }
  await page.close();

  const phone = await open({ width: 390, height: 844 }, true);
  await phone.getByTestId('model-input').setInputFiles(join(fixtures, '3DBenchy.stl'));
  await phone.getByText('Ready to slice').waitFor({ timeout: 120000 });
  const bar = phone.getByRole('toolbar', { name: 'Object tools' });
  const barBox = await bar.boundingBox();
  if (barBox.x < 0 || barBox.x + barBox.width > 390) fail(`toolbar is off the screen: ${JSON.stringify(barBox)}`);
  const scrolls = await bar.evaluate((el) => el.scrollWidth > el.clientWidth);
  if (!scrolls) fail('on a phone the toolbar should scroll sideways');
  const pageScroll = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (pageScroll) fail('the page scrolls sideways on a phone');
  await bar.getByRole('button', { name: 'Rotate' }).tap();
  await phone.getByRole('region', { name: 'Rotate' }).waitFor();
  if (shots) await phone.screenshot({ path: join(shots, 'toolbar-phone-rotate.png') });
  await bar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await phone.waitForTimeout(200);
  const undoBox = await bar.getByRole('button', { name: 'Undo' }).boundingBox();
  if (!undoBox || undoBox.x < 0 || undoBox.x + undoBox.width > 390) fail(`Undo should stay on screen while the toolbar scrolls: ${JSON.stringify(undoBox)}`);
  await bar.getByRole('button', { name: 'Lay on face' }).tap();
  await phone.waitForTimeout(500);
  // On a phone the tool's card sits under the 3D view, not over the plate.
  const card = await phone.getByRole('region', { name: 'Lay on face' }).boundingBox();
  const view = await phone.getByTestId('viewport').boundingBox();
  if (!card || card.y < view.y + view.height - 1) fail(`the phone tool card covers the 3D view: ${JSON.stringify({ card, view })}`);
  if (shots) await phone.screenshot({ path: join(shots, 'toolbar-phone-flatten.png') });
  console.log('phone: toolbar scrolls inside the screen');

  // The page itself must never scroll on a phone. Android Chrome makes the
  // document taller than the screen while its address bar slides away; a
  // scrollable page then hid the top bar and left a blank strip under the
  // action bar. Recreate the taller document and scroll everything there is.
  await phone.addStyleTag({ content: 'body::after { content: ""; display: block; height: 120px; }' });
  await phone.evaluate(() => {
    document.querySelector('.body').scrollTop = 1e6;
    window.scrollTo(0, 1e6);
  });
  await phone.waitForTimeout(300);
  const edges = await phone.evaluate(() => ({
    pageScroll: window.scrollY,
    topbar: document.querySelector('.topbar').getBoundingClientRect().top,
    actionbar: document.querySelector('.actionbar').getBoundingClientRect().bottom,
    screen: window.innerHeight,
  }));
  if (edges.pageScroll !== 0 || edges.topbar !== 0) fail(`the top bar scrolled off a phone: ${JSON.stringify(edges)}`);
  if (Math.abs(edges.actionbar - edges.screen) > 1) fail(`the action bar is not at the bottom of a phone: ${JSON.stringify(edges)}`);
  if (shots) await phone.screenshot({ path: join(shots, 'toolbar-phone-layout.png') });
  console.log('phone: top bar and action bar stay on screen');
} catch (e) {
  fail(e.message);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('TOOLBAR OK');
process.exit();
