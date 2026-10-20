#!/usr/bin/env node
// Browser end to end for the object toolbar over the 3D view: it shows on an
// empty plate with its object tools greyed out, adding a model keeps the one
// already there, simplify halves the triangles, brim ears go on the corners and
// where the bed is clicked, lay on face turns the object, variable layer height
// makes an adaptive profile, measure picks two features and measures between
// them, the object menu (right click or ⋯) renames, clones and exports, mesh
// boolean joins two parts, text and SVG shapes go on a model (text following
// its surface, turned and slid over it) or make an object
// of their own, Assemble joins two cubes and puts a face of one onto the
// other, and the toolbar fits a phone (and the page itself
// never scrolls there; an open tool stacks the toolbar, its card and the 3D
// view with the settings hidden).
//
//   node test/toolbar.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
// An ASCII STL cube, size mm on a side.
const cubeStl = (size) => {
  const v = (x, y, z) => [x, y, z].map((c) => c * size);
  const quads = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  ];
  const tri = (a, b, c) => `facet normal 0 0 0\nouter loop\n${[a, b, c].map((p) => `vertex ${v(...p).join(' ')}`).join('\n')}\nendloop\nendfacet\n`;
  return `solid cube\n${quads.map(([a, b, c, d]) => tri(a, b, c) + tri(a, c, d)).join('')}endsolid cube\n`;
};
// The rotation the Lay on face panel shows; it is gone while nothing is selected, so don't wait long.
const rotation = (page, timeout = 1000) => page.getByLabel('Current rotation').innerText({ timeout });

try {
  const page = await open({ width: 1280, height: 800 }, false);
  // The toolbar is there before any model, its object tools waiting greyed out.
  const toolbar = page.getByRole('toolbar', { name: 'Object tools' });
  await toolbar.waitFor();
  if ((await toolbar.getByRole('button', { name: 'Move' }).getAttribute('aria-disabled')) !== 'true') fail('Move is usable with no model');
  if ((await toolbar.getByRole('button', { name: 'Add models' }).getAttribute('aria-disabled')) === 'true') fail('Add models is off with no model');
  await toolbar.getByRole('button', { name: 'Cut' }).click({ force: true });  // aria-disabled: still clickable, to explain itself
  await page.getByText('Cut works on a model: open one first.').waitFor({ timeout: 5000 });
  if (shots) await page.screenshot({ path: join(shots, 'toolbar-empty.png') });
  console.log('the toolbar shows on an empty plate, its object tools waiting for a model');
  await page.getByTestId('model-input').setInputFiles(join(fixtures, '3DBenchy.stl'));
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
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
  // The field is rebuilt once the engine has turned the object, so wait for a
  // new field rather than the typed value (typing into the old one gets lost).
  const typeRotation = async (value) => {
    const field = rotate.getByLabel('Rotation Z');
    await field.evaluate((el) => (el.dataset.typed = '1'));
    await field.fill(value);
    await field.press('Enter');
    await page.waitForFunction(
      (v) => {
        const el = document.querySelector('[aria-label="Rotation Z"]');
        return el?.value === v && !el.dataset.typed;
      },
      value,
      { timeout: 30000 },
    );
  };
  await typeRotation('90');
  await typeRotation('0');
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
  await toolbar.getByRole('button', { name: 'Cut' }).click({ force: true });  // aria-disabled: still clickable, to explain itself
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
  // Brim ears: the panel offers to switch the brim type, ears go on the
  // corners, a click on the bed adds one, and Remove all takes them away.
  await toolbar.getByRole('button', { name: 'Brim ears' }).click();
  const brim = page.getByRole('region', { name: 'Brim ears' });
  await brim.waitFor();
  const ears = brim.getByLabel('Ears');
  const earCount = async () => Number((await ears.innerText()).match(/^(\d+)/)?.[1] ?? NaN);
  await ears.waitFor({ timeout: 30000 });
  const usePainted = brim.getByRole('button', { name: 'Use brim ears for this object' });
  if (await usePainted.isVisible()) {
    await usePainted.click();
    await usePainted.waitFor({ state: 'detached', timeout: 30000 });
  }
  await brim.getByRole('button', { name: 'Add ears on the corners' }).click();
  await page.waitForFunction(() => /^[1-9]/.test(document.querySelector('[aria-label="Ears"]')?.textContent ?? ''), null, { timeout: 30000 });
  const corners = await earCount();
  // A click on the bed below the boat adds one more.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.7);
  await page.waitForFunction((n) => Number(document.querySelector('[aria-label="Ears"]')?.textContent?.match(/^(\d+)/)?.[1]) === n + 1, corners, { timeout: 30000 });
  if (shots) await page.screenshot({ path: join(shots, 'toolbar-desktop-brim.png') });
  console.log(`brim ears: ${corners} on the corners, one more by clicking the bed`);
  await brim.getByRole('button', { name: 'Remove all' }).click();
  await page.waitForFunction(() => /^0 ears/.test(document.querySelector('[aria-label="Ears"]')?.textContent ?? ''), null, { timeout: 30000 });
  await page.locator('body').press('Control+z');
  await page.waitForFunction((n) => Number(document.querySelector('[aria-label="Ears"]')?.textContent?.match(/^(\d+)/)?.[1]) === n + 1, corners, { timeout: 30000 });
  console.log('Remove all clears the ears and undo brings them back');
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

  // The object menu: a right click on an object in the 3D view, or ⋯ in the object list.
  await page.keyboard.press('Escape');
  const objectMenu = page.locator('.object-menu');
  let menuAt = null;
  for (const [x, y] of points) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y, { button: 'right' });
    if (await objectMenu.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
      menuAt = [x, y];
      break;
    }
  }
  if (!menuAt) fail('a right click on an object opened no menu');
  else {
    for (const name of ['Clone…', 'Center', 'Split', 'Mirror', 'Delete', 'Auto orient', 'Simplify model…', 'Printable', 'Rename…', 'Change filament', 'Object settings', 'Scale to fit the plate', 'Units', 'Replace with STL…', 'Export as STL'])
      await objectMenu.getByRole(/^(Printable)$/.test(name) ? 'menuitemcheckbox' : 'menuitem', { name, exact: true }).waitFor({ timeout: 3000 });
    await objectMenu.getByRole('menuitem', { name: 'Mirror' }).click();
    await objectMenu.getByRole('menuitem', { name: 'Along X axis' }).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'object-menu-desktop.png') });
    await page.keyboard.press('Escape');
    await objectMenu.waitFor({ state: 'detached' });
    console.log('right click opens the object menu');
  }

  // Rename from the object list's ⋯ button.
  const more = (n) => objectRows(page).nth(n).locator(':scope > .object-row').getByRole('button', { name: /^More for / });
  await more(0).click();
  await objectMenu.getByRole('menuitem', { name: 'Rename…' }).click();
  await objectMenu.getByLabel('Name').fill('Boat');
  await objectMenu.getByRole('button', { name: 'Rename' }).click();
  await objectRows(page).first().getByText('Boat').waitFor({ timeout: 30000 });
  console.log('rename from the object list');

  // Simplify model… opens the Simplify panel on that object.
  await more(0).click();
  await objectMenu.getByRole('menuitem', { name: 'Simplify model…' }).click();
  await page.getByRole('region', { name: 'Simplify' }).getByRole('button', { name: 'Done' }).click();
  console.log('Simplify model opens the Simplify panel');

  // Clone 2, arranged: two more objects; undo (twice: clone, then arrange) takes them back.
  await more(0).click();
  await objectMenu.getByRole('menuitem', { name: 'Clone…' }).click();
  await objectMenu.getByLabel('Number of copies').fill('2');
  await objectMenu.getByRole('button', { name: 'Clone' }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object').length === 4, null, { timeout: 60000 });
  await page.locator('body').press('Control+z');
  await page.locator('body').press('Control+z');
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object').length === 2, null, { timeout: 60000 });
  console.log('clone adds two objects, undo removes them');

  // Not printable, then printable again; the check mark follows.
  await more(0).click();
  await objectMenu.getByRole('menuitemcheckbox', { name: 'Printable' }).click();
  await objectMenu.waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
  await more(0).click();
  if ((await objectMenu.getByRole('menuitemcheckbox', { name: 'Printable' }).getAttribute('aria-checked')) !== 'false') fail('Printable stayed checked');
  await objectMenu.getByRole('menuitemcheckbox', { name: 'Printable' }).click();

  // Export as STL downloads the boat.
  await more(0).click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), objectMenu.getByRole('menuitem', { name: 'Export as STL' }).click()]);
  if (download.suggestedFilename() !== 'Boat.stl') fail(`exported as ${download.suggestedFilename()}`);
  const stl = await download.createReadStream().then(async (st) => { let n = 0; for await (const c of st) n += c.length; return n; });
  if (stl < 1000 * 50) fail(`the exported STL is only ${stl} bytes`);
  console.log(`export as STL: ${download.suggestedFilename()}, ${stl} bytes`);

  // Parts and modifiers from the object menu: a modifier cube gets its own
  // settings, turns into a negative part, a part comes from a file, and
  // deleting one is undone like any edit.
  const volumes = objectRows(page).first().locator('ul.volumes > li');
  await more(0).click();
  await objectMenu.getByRole('menuitem', { name: 'Add modifier' }).click();
  await objectMenu.getByRole('menuitem', { name: 'Cube', exact: true }).click();
  await volumes.nth(1).getByText('Modifier').waitFor({ timeout: 30000 });
  await page.getByText('Modifier settings').waitFor();
  // Desktop's full list: a modifier gets part settings (and everything else a part can carry), never object-only ones.
  await page.getByLabel('Add a setting to this modifier').click();
  const picker = page.getByRole('region', { name: 'Settings to add to this modifier' });
  const search = picker.getByLabel('Search settings');
  for (const key of ['ironing_type', 'top_shell_thickness', 'overhang_1_4_speed', 'minimum_sparse_infill_area', 'fuzzy_skin', 'layer_height', 'enable_support', 'brim_type']) {
    await search.fill(key.replace(/_/g, ' '));
    const offered = (await picker.locator(`[data-key="${key}"]`).count()) > 0;
    const objectOnly = ['layer_height', 'enable_support', 'brim_type'].includes(key);
    if (offered === objectOnly) fail(objectOnly ? `a modifier can't add the object-only ${key}` : `a modifier can add ${key}`);
  }
  await search.fill('');
  await picker.getByRole('button', { name: /^Strength/ }).click();
  await picker.locator('[data-key="sparse_infill_density"]').click();
  await picker.getByRole('button', { name: 'Done' }).click();
  await page.locator('.object-settings-group').getByText(/infill density/i).first().waitFor({ timeout: 30000 });
  await toolbar.getByRole('button', { name: 'Move' }).click();
  if (shots) await page.screenshot({ path: join(shots, 'parts-modifier.png') });
  await page.keyboard.press('Escape');
  await volumes.nth(1).getByRole('button', { name: /^More for part / }).click();
  await objectMenu.getByRole('menuitem', { name: 'Change type' }).click();
  await objectMenu.getByRole('menuitemradio', { name: 'Negative part' }).click();
  await volumes.nth(1).getByText('Negative part').waitFor({ timeout: 30000 });
  await more(0).click();
  await objectMenu.getByRole('menuitem', { name: 'Add part' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), objectMenu.getByRole('menuitem', { name: 'Load…' }).click()]);
  await chooser.setFiles(join(fixtures, 'tetrahedron.stl'));
  await volumes.nth(2).waitFor({ timeout: 30000 });
  const names = await volumes.locator('.volume-name').allInnerTexts();
  if (names.length !== 3 || !/tetrahedron\.stl/.test(names[1]) || !/Negative part/.test(names[2])) fail(`parts come first, then the negative part: ${names}`);
  await volumes.nth(2).getByRole('button', { name: /^More for part / }).click();
  await objectMenu.getByRole('menuitem', { name: 'Delete' }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object:first-child ul.volumes > li').length === 2, null, { timeout: 30000 });
  await page.locator('body').press('Control+z');
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object:first-child ul.volumes > li').length === 3, null, { timeout: 30000 });
  console.log(`parts and modifiers: ${names.join(' | ')}; delete and undo`);

  // Mesh boolean from the object menu: the boat and the tetrahedron part
  // become one part, undone like any edit.
  await more(0).click();
  await objectMenu.getByRole('menuitem', { name: 'Mesh boolean…' }).click();
  const booleanPanel = page.getByRole('region', { name: 'Mesh boolean' });
  await booleanPanel.waitFor();
  await booleanPanel.getByRole('radio', { name: 'Difference' }).click();
  await booleanPanel.getByLabel('Subtract with').waitFor();
  await booleanPanel.getByRole('radio', { name: 'Union' }).click();
  await booleanPanel.getByLabel('Part 1').selectOption({ index: 0 });
  await booleanPanel.getByLabel('Part 2').selectOption({ index: 1 });
  if (shots) await page.screenshot({ path: join(shots, 'boolean-desktop.png') });
  await booleanPanel.getByRole('button', { name: 'Union', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object:first-child ul.volumes > li').length === 2, null, { timeout: 60000 });
  const joined = await volumes.locator('.volume-name').allInnerTexts();
  if (!/ - union/.test(joined[0])) fail(`the union takes the first part's place: ${joined}`);
  await booleanPanel.getByRole('button', { name: 'Done' }).click();
  await page.locator('body').press('Control+z');
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object:first-child ul.volumes > li').length === 3, null, { timeout: 30000 });
  console.log(`mesh boolean: ${joined.join(' | ')}; undo brings the parts back`);

  // Text shape on the selected boat: a text part on its surface, edited live
  // (its name follows the text), in another font. A click on a selected
  // object's name deselects it, so only pick the boat when it isn't.
  if (!/\bactive\b/.test(await objectRows(page).first().getAttribute('class'))) await objectRows(page).first().locator('.object-name').click();
  await toolbar.getByRole('button', { name: 'Text shape' }).click();
  const textPanel = page.getByRole('region', { name: 'Text shape' });
  const textBox = textPanel.getByRole('textbox', { name: 'Text' });
  await textBox.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('ul.objects > li.object:first-child ul.volumes > li').length === 4, null, { timeout: 60000 });
  await textBox.fill('U1');
  await volumes.locator('.volume-name', { hasText: /^U1$/ }).waitFor({ timeout: 30000 });
  await textPanel.getByLabel('Font').selectOption('Noto Serif Bold');
  await page.waitForTimeout(1500);
  if (await page.getByText('this font').count()) fail('the bundled font did not load');
  if (shots) await page.screenshot({ path: join(shots, 'text-on-boat.png') });
  console.log('text shape: a text part on the boat, renamed by its text, in another font');

  // Hebrew: a Latin-only font says which letters it lacks, a built-in Hebrew
  // font has them. A font file that isn't a font shows its error in the
  // tool's card (not above Slice plate), and the next edit that works clears it.
  await textBox.fill('שלום U1');
  const lettersHint = textPanel.getByText(/This font has no letters for ש/);
  await lettersHint.waitFor({ timeout: 30000 });
  await textPanel.getByLabel('Font').selectOption('Rubik');
  await volumes.locator('.volume-name', { hasText: /^שלום U1$/ }).waitFor({ timeout: 30000 });
  await lettersHint.waitFor({ state: 'detached', timeout: 30000 });
  if (shots) await page.screenshot({ path: join(shots, 'text-hebrew.png') });
  const badFont = async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), textPanel.getByLabel('Font').selectOption('__file')]);
    await chooser.setFiles({ name: 'NotAFont.ttf', mimeType: 'font/ttf', buffer: Buffer.from('not a font') });
    await page.locator('.tool-pop .tool-error', { hasText: /can't be read/ }).waitFor({ timeout: 30000 });
    if (await page.locator('.actionbar .error-text').count()) fail('the tool error shows above Slice plate too');
  };
  await badFont();
  if (shots) await page.screenshot({ path: join(shots, 'text-error-in-card.png') });
  await textPanel.getByLabel('Font').selectOption('Noto Serif Bold');
  await textBox.fill('U1');
  await page.locator('.tool-pop .tool-error').waitFor({ state: 'detached', timeout: 30000 });
  console.log('text shape: Hebrew in a Hebrew font, missing letters named, a bad font file errors in the card and the next good edit clears it');

  // On the boat's surface: it follows the surface, turns with the Rotation
  // field, and a drag on it slides it over the boat (one undo step each).
  const errors = page.locator('.error-text');
  const rotationField = textPanel.getByRole('spinbutton', { name: 'Rotation' });
  await rotationField.waitFor({ timeout: 30000 });
  await textPanel.getByLabel('Use surface').check();
  await page.waitForTimeout(2000);
  if (await errors.count()) fail(`use surface: ${await errors.first().innerText()}`);
  await rotationField.fill('30');
  await page.waitForFunction(
    () => Math.abs(Number(document.querySelector('[aria-label="Text shape"] input[aria-label="Rotation"]')?.value) - 30) < 0.5 && !!document.querySelector('canvas[data-shape-at]'),
    null,
    { timeout: 30000 },
  );
  await rotationField.fill('0');
  await page.waitForTimeout(1500);
  const shapeAt = async () => (await page.locator('canvas[data-shape-at]').getAttribute('data-shape-at', { timeout: 30000 })).split(',').map(Number);
  await page.waitForFunction(() => !!document.querySelector('canvas[data-shape-at]'), null, { timeout: 30000 });
  const [sx, sy] = await shapeAt();
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(sx - 3 * k, sy + k);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForFunction(
    (x0) => {
      const at = document.querySelector('canvas[data-shape-at]')?.getAttribute('data-shape-at');
      return !!at && Number(at.split(',')[0]) < x0 - 10;
    },
    sx,
    { timeout: 30000 },
  );
  if (await errors.count()) fail(`sliding the text: ${await errors.first().innerText()}`);
  if (shots) await page.screenshot({ path: join(shots, 'text-slid.png') });
  console.log(`text shape: follows the surface, turns, and slides from ${sx},${sy} to ${(await shapeAt()).join(',')}`);
  // A tool's error goes when the tool closes.
  await badFont();
  await textPanel.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(500);
  if (await page.locator('.error-text').count()) fail(`the text tool's error stays after Done: ${await page.locator('.error-text').first().innerText()}`);

  // SVG from the object menu: an .svg file becomes a part of the boat, then
  // gets wider (its height follows) and engraved.
  await more(0).click();
  await objectMenu.getByRole('menuitem', { name: 'Add part' }).click();
  const [svgChooser] = await Promise.all([page.waitForEvent('filechooser'), objectMenu.getByRole('menuitem', { name: 'SVG…' }).click()]);
  await svgChooser.setFiles(join(fixtures, 'badge.svg'));
  const svgPanel = page.getByRole('region', { name: 'SVG shape' });
  const svgWidth = svgPanel.getByRole('spinbutton', { name: 'Width' });
  await svgWidth.waitFor({ timeout: 60000 });
  if (Math.abs(Number(await svgWidth.inputValue()) - 20) > 0.1) fail(`the SVG keeps its 20 mm width: ${await svgWidth.inputValue()}`);
  await volumes.locator('.volume-name', { hasText: /^badge$/ }).waitFor({ timeout: 30000 });
  await svgWidth.fill('40');
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="SVG shape"] input[aria-label="Height"]')?.value) === 20, null, { timeout: 30000 });
  await svgPanel.getByRole('radio', { name: 'Engraved' }).click();
  await svgPanel.getByRole('radio', { name: 'Engraved', checked: true }).waitFor({ timeout: 30000 });
  if (shots) await page.screenshot({ path: join(shots, 'svg-on-boat.png') });
  await svgPanel.getByRole('button', { name: 'Done' }).click();
  console.log('SVG shape: a part from an .svg file, made wider and engraved');
  await page.close();

  // On an empty plate Text makes an object of its own.
  const empty = await open({ width: 1280, height: 800 }, false);
  await empty.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Text shape' }).click();
  await empty.getByRole('region', { name: 'Text shape' }).getByRole('textbox', { name: 'Text' }).fill('Label');
  await empty.locator('ul.objects > li.object .object-name', { hasText: /^Label$/ }).waitFor({ timeout: 60000 });
  if (shots) await empty.screenshot({ path: join(shots, 'text-object.png') });
  console.log('text shape: on an empty plate it is an object of its own');
  // Opening an .svg file makes an SVG object, its tool open.
  await empty.getByTestId('model-input').setInputFiles(join(fixtures, 'badge.svg'));
  await empty.locator('ul.objects > li.object .object-name', { hasText: /^badge$/ }).waitFor({ timeout: 60000 });
  await empty.getByRole('region', { name: 'SVG shape' }).getByRole('spinbutton', { name: 'Depth' }).waitFor({ timeout: 30000 });
  console.log('SVG shape: opening an .svg file makes an object of its own');
  await empty.close();

  // Assemble: a face on each of two cubes; they are two objects, so join them
  // first, then Center coincidence puts one face on the other; undo takes both back.
  const cubes = await open({ width: 1280, height: 800 }, false);
  const cubeFiles = ['cube-a.stl', 'cube-b.stl'].map((name) => {
    const path = join(mkdtempSync(join(tmpdir(), 'assemble-')), name);
    writeFileSync(path, cubeStl(20));
    return path;
  });
  await cubes.getByTestId('model-input').setInputFiles(cubeFiles);
  await cubes.waitForFunction(() => document.querySelectorAll('ul.objects > li.object').length === 2, null, { timeout: 120000 });
  await cubes.getByText('Ready to slice').waitFor({ timeout: 120000 });
  await cubes.keyboard.press('Escape');
  await cubes.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Assemble' }).click();
  const assemblePanel = cubes.getByRole('region', { name: 'Assemble' });
  await assemblePanel.getByRole('radio', { name: 'Face and face', checked: true }).waitFor();
  const cubesView = await cubes.getByTestId('viewport').boundingBox();
  // The cubes stand one behind the other: a face of the front one (scanning up
  // from the bottom of the view), then one of the back one (scanning down).
  const pickIn = async (ys, label) => {
    for (const y of ys)
      for (let x = 0.4; x <= 0.6; x += 0.01) {
        await cubes.mouse.move(cubesView.x + cubesView.width * x, cubesView.y + cubesView.height * y);
        if (!(await assemblePanel.getByLabel('Feature under the pointer').waitFor({ timeout: 300 }).then(() => true, () => false))) continue;
        await cubes.mouse.down();
        await cubes.mouse.up();
        if (await assemblePanel.getByLabel(label).waitFor({ timeout: 3000 }).then(() => true, () => false)) return true;
      }
    return false;
  };
  const up = Array.from({ length: 40 }, (_, i) => 0.75 - i * 0.01);
  if (!(await pickIn(up, 'Feature 1')) || !(await pickIn([...up].reverse(), 'Feature 2'))) fail('assemble did not pick a face on each cube');
  else {
    const joinButton = assemblePanel.getByRole('button', { name: 'Join into one object' });
    await joinButton.waitFor({ timeout: 10000 });
    if (shots) await cubes.screenshot({ path: join(shots, 'assemble-two-objects.png') });
    await joinButton.click();
    await cubes.locator('ul.objects > li.object .object-name', { hasText: /^Assembly$/ }).waitFor({ timeout: 30000 });
    if ((await objectRows(cubes).count()) !== 1) fail('joining left more than one object');
    const centre = assemblePanel.getByRole('button', { name: 'Center coincidence' });
    await centre.waitFor({ timeout: 10000 });
    await centre.click();
    await cubes.waitForFunction(() => Number(document.querySelector('[aria-label="Assemble"] input[aria-label="Parallel distance"]')?.value) === 0, null, { timeout: 30000 });
    if (shots) await cubes.screenshot({ path: join(shots, 'assemble-centred.png') });
    // 5 mm apart, face to face.
    await assemblePanel.getByRole('spinbutton', { name: 'Parallel distance' }).fill('5');
    await assemblePanel.getByRole('button', { name: 'Set distance' }).click();
    await cubes.waitForFunction(() => Math.abs(Math.abs(Number(document.querySelector('[aria-label="Assemble"] input[aria-label="Parallel distance"]')?.value)) - 5) < 1e-3, null, { timeout: 30000 });
    // Undo: back to the cubes face on face, joined, then to two objects.
    for (let i = 0; i < 3; i++) await cubes.keyboard.press('Control+z');
    await cubes.waitForFunction(() => document.querySelectorAll('ul.objects > li.object').length === 2, null, { timeout: 30000 });
    console.log('assemble: two cubes joined into one object, a face put onto the other, set 5 mm apart, then undone');
  }
  await cubes.close();

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
  // Opening a tool with the settings scrolled into view used to scroll the
  // toolbar away. Now the toolbar, the tool's card and the 3D view stack in
  // that order, all on screen, and the settings hide until Done.
  await phone.getByRole('region', { name: 'Rotate' }).getByRole('button', { name: 'Done' }).tap();
  await phone.evaluate(() => (document.querySelector('.body').scrollTop = 400));
  await bar.getByRole('button', { name: 'Lay on face' }).tap();
  await phone.waitForTimeout(500);
  const card = await phone.getByRole('region', { name: 'Lay on face' }).boundingBox();
  const view = await phone.getByTestId('viewport').boundingBox();
  const top = await bar.boundingBox();
  if (!card || top.y < 0 || card.y < top.y + top.height - 1 || view.y < card.y + card.height - 1)
    fail(`a phone tool should stack toolbar, card, then 3D view: ${JSON.stringify({ top, card, view })}`);
  if (view.height < 844 * 0.3) fail(`the 3D view is too small with a tool open: ${JSON.stringify(view)}`);
  if (await phone.getByRole('heading', { name: 'Printer' }).isVisible()) fail('the settings should hide while a phone tool is open');
  if (shots) await phone.screenshot({ path: join(shots, 'toolbar-phone-flatten.png') });
  await phone.getByRole('region', { name: 'Lay on face' }).getByRole('button', { name: 'Done' }).tap();
  await phone.getByRole('heading', { name: 'Printer' }).waitFor();
  console.log('phone: toolbar scrolls inside the screen; a tool stacks toolbar, card and 3D view with the settings hidden');

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
  if (shots) for (const [i, pg] of browser.contexts().flatMap((c) => c.pages()).entries()) await pg.screenshot({ path: join(shots, `failed-${i}.png`) }).catch(() => {});
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('TOOLBAR OK');
process.exit();
