#!/usr/bin/env node
// Browser end to end for Prepare's layout and dialogs (monkey test findings):
// a long object name ends in "…" and keeps its row's buttons in the sidebar,
// the Paint card fits (titled by what it paints, overhang options for supports), a long project name keeps "Project ▾" on one line,
// opening and closing the Text tool leaves no text behind, the preset menu
// names the preset as its dropdown does and opens upward near the bottom,
// Online projects closes with Esc and a click outside, unsaved changes are
// asked about in the app's own dialog, the top bar fits from 768 px up, and
// on a phone the four buttons after slicing fit in one row.
//
//   node test/layout-fixes.mjs [screenshot-dir]
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
const PORT = 4174;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
const url = `http://localhost:${PORT}/`;
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`LAYOUT FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

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
const model = join(mkdtempSync(join(tmpdir(), 'layout-')), 'Flarewing-Dragon_byHollowmaker_v1.1eb_with_a_much_longer_name.stl');
writeFileSync(model, cubeStl(20));

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  // The browser's own confirm() must never show: the app asks in its own dialog.
  page.on('dialog', (d) => {
    fail(`the browser's own dialog showed: "${d.message()}"`);
    void d.dismiss();
  });
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  return page;
}

// Whether el's box lies inside the panel's, horizontally.
const insidePanel = (page, selector) =>
  page.evaluate((sel) => {
    const panel = document.querySelector('.panel').getBoundingClientRect();
    return [...document.querySelectorAll(sel)].every((e) => {
      const r = e.getBoundingClientRect();
      return r.left >= panel.left - 1 && r.right <= panel.right + 1;
    });
  }, selector);

try {
  const page = await open({ width: 1440, height: 900 }, false);
  const undoTitle = () => page.getByRole('button', { name: 'Undo' }).getAttribute('title');

  // A long project name shortens with "…"; "Project ▾" stays on one line.
  // Measured again for a few seconds: the name and its font can still be
  // settling just after "Ready to slice" (seen on the CI runner).
  const measure = () =>
    page.evaluate(() => {
      const label = document.querySelector('.project-label').getBoundingClientRect();
      const name = document.querySelector('.project-name-text');
      return { labelHeight: label.height, shortened: name.scrollWidth > name.clientWidth };
    });
  let button = await measure();
  for (let i = 0; i < 20 && !(button.shortened && button.labelHeight <= 24); i++) {
    await page.waitForTimeout(250);
    button = await measure();
  }
  if (button.labelHeight > 24) fail(`"Project ▾" wraps: ${button.labelHeight}px tall`);
  if (!button.shortened) fail('the long project name is not shortened');
  console.log('project button: one line, name shortened');

  // The top bar fits between phone and wide desktop: nothing past the window
  // or below the bar, and the three tabs are whole.
  for (const width of [768, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    const bar = await page.evaluate(() => {
      const top = document.querySelector('.topbar');
      const box = top.getBoundingClientRect();
      const out = [...top.querySelectorAll('*')]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5 || r.bottom > box.bottom + 0.5);
        })
        .map((e) => `${e.className || e.tagName}: ${(e.textContent || '').trim().slice(0, 20)}`);
      const tabs = [...top.querySelectorAll('[role=tab]')].filter((t) => t.scrollWidth > t.clientWidth + 1 || !t.getBoundingClientRect().width);
      return { out, cut: tabs.map((t) => t.textContent), docWidth: document.documentElement.scrollWidth };
    });
    if (bar.out.length) fail(`top bar at ${width}px: ${bar.out.join(' | ')} sticks out`);
    if (bar.cut.length) fail(`top bar at ${width}px: tabs cut off: ${bar.cut.join(', ')}`);
    if (bar.docWidth > width) fail(`top bar at ${width}px: the page scrolls sideways (${bar.docWidth}px)`);
    if (shots) await page.screenshot({ path: join(shots, `layout-topbar-${width}.png`), clip: { x: 0, y: 0, width, height: 60 } });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log('top bar fits at 768, 900, 1024 and 1280 px');

  // A long object name shortens; its filament, ⋯, Delete and the rest stay in the sidebar.
  await page.locator('.object-name').first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).waitFor();
  const panel = await page.evaluate(() => {
    const p = document.querySelector('.panel');
    return { client: p.clientWidth, scroll: p.scrollWidth };
  });
  if (panel.scroll > panel.client) fail(`the sidebar content is ${panel.scroll}px wide in a ${panel.client}px panel`);
  for (const sel of ['.object-row .filament-pick', '.object-row .object-more', '.transform-row.actions button'])
    if (!(await insidePanel(page, sel))) fail(`${sel} sticks out of the sidebar`);
  if (shots) await page.screenshot({ path: join(shots, 'layout-long-name.png') });
  console.log('long object name: row buttons in the sidebar');

  // The Paint card fits its content, a long name in "Clear … paint on …" included.
  await page.getByRole('button', { name: /^Support painting/ }).click();
  const card = page.locator('.tool-pop').filter({ has: page.locator('.paint-panel') });
  await card.waitFor();
  const fits = await card.evaluate((e) => e.scrollWidth <= e.clientWidth);
  if (!fits) fail('the Paint card is cut on the right');
  if (shots) await page.screenshot({ path: join(shots, 'layout-paint.png') });
  // The toolbar button decides what is painted: the card says it, with no tabs of its own.
  if (!(await card.getByText('Support painting', { exact: true }).isVisible())) fail('the Paint card does not say it paints supports');
  if (await card.getByRole('radiogroup', { name: 'What to paint' }).count()) fail('the Paint card still has its own what-to-paint tabs');
  await card.getByText('Highlight overhangs').click();
  if (!(await card.getByLabel('Overhang angle').isVisible())) fail('Highlight overhangs shows no angle');
  const fitsAll = await card.evaluate((e) => e.scrollWidth <= e.clientWidth);
  if (!fitsAll) fail('the Paint card is cut on the right with the overhang options');
  await card.getByRole('button', { name: 'Done' }).click();
  console.log('paint card fits');

  // Opening and closing the Text tool leaves nothing behind (Esc, then Done).
  const before = await undoTitle();
  const textTool = page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: /^Text shape/ });
  for (const close of ['Escape', 'Done']) {
    if (!(await page.locator('.object.active').count())) await page.locator('.object-name').first().click();
    await page.locator('.object.active').waitFor();
    await textTool.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo"]')?.getAttribute('title')?.startsWith('Undo Add text'), null, { timeout: 60000 });
    // Esc in the text box stays with the box (as in every text field); from the 3D view it closes the tool.
    if (close === 'Escape') await page.evaluate(() => document.activeElement?.blur()).then(() => page.keyboard.press('Escape'));
    else await page.locator('.text-panel').getByRole('button', { name: 'Done' }).click();
    await page.waitForFunction((t) => document.querySelector('[aria-label="Undo"]')?.getAttribute('title') === t, before, { timeout: 30000 }).catch(() => {});
    const now = await undoTitle();
    if (now !== before) fail(`after ${close} the Text tool left "${now}" (was "${before}")`);
    const parts = await page.locator('.volume-name').count();
    if (parts) fail(`after ${close} the object has ${parts} parts listed`);
  }
  const redo = await page.getByRole('button', { name: 'Redo' }).isDisabled();
  if (!redo) fail('closing the Text tool left a Redo step');
  console.log('text tool: an unchanged new text is taken back on close');

  // The preset menu calls the preset what its dropdown does, and opens upward near the bottom.
  if (!(await page.locator('.object.active').count())) await page.locator('.object-name').first().click();
  const processMore = page.getByRole('button', { name: 'Process preset actions' });
  await processMore.evaluate((e) => {
    const p = document.querySelector('.panel');
    p.scrollTop += e.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom + 4;
  });
  await processMore.click();
  const pop = page.getByRole('dialog', { name: 'process preset' });
  await pop.waitFor();
  const title = await pop.locator('.preset-pop-title').innerText();
  const shown = await page.locator('.panel button.picker .picker-value').allInnerTexts();
  if (title.includes('@') || !shown.includes(title)) fail(`the menu says "${title}", the dropdowns "${shown.join('", "')}"`);
  await page.waitForTimeout(200);
  const where = await pop.evaluate((e) => ({ bottom: e.getBoundingClientRect().bottom, top: e.getBoundingClientRect().top, panel: document.querySelector('.panel').getBoundingClientRect().bottom }));
  if (where.bottom > where.panel + 1 || where.top < 0) fail(`the Process menu runs off the panel: ${JSON.stringify(where)}`);
  if (shots) await page.screenshot({ path: join(shots, 'layout-process-menu.png') });
  await page.keyboard.press('Escape');
  console.log(`process menu: "${title}", opens upward`);

  // Online projects closes with Esc and its ✕, never with a click outside it (like every window).
  const projectButton = page.getByRole('button', { name: /^Project/ });
  const online = page.getByRole('dialog', { name: 'Online projects' });
  for (const how of ['Escape', 'close', 'outside']) {
    await projectButton.click();
    await page.getByRole('menuitem', { name: 'Online projects…' }).click();
    await online.waitFor();
    if (how === 'Escape') await page.keyboard.press('Escape');
    else if (how === 'close') await online.getByRole('button', { name: 'Close window' }).click();
    else {
      await page.mouse.click(8, 890);
      await page.waitForTimeout(300);
      if (!(await online.isVisible())) fail('a click outside closed Online projects');
      await page.keyboard.press('Escape');
    }
    await online.waitFor({ state: 'detached', timeout: 5000 }).catch(() => fail(`Online projects stays open after ${how}`));
  }
  console.log('online projects: Esc and ✕ close it, a click outside does not');

  // Unsaved changes: the app's own question; Cancel keeps the model, Discard changes clears it.
  const ask = page.getByTestId('ask-dialog');
  await projectButton.click();
  await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
  await ask.waitFor();
  if (!(await ask.getByRole('heading', { name: 'Discard unsaved changes?' }).isVisible())) fail('the question has no title');
  if (shots) await page.screenshot({ path: join(shots, 'layout-discard.png') });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await ask.waitFor({ state: 'detached' });
  if (!(await page.getByText('Ready to slice').isVisible())) fail('Cancel cleared the plate');
  await projectButton.click();
  await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
  await ask.getByRole('button', { name: 'Discard changes' }).click();
  await page.getByText('Open a model to start').waitFor({ timeout: 30000 });
  console.log('unsaved changes: asked in the app');
  await page.close();

  // Phone: Prepare, Preview and Device are tabs at the bottom; after slicing, Download, Send and Slice plate fit in one row.
  const phone = await open({ width: 412, height: 915 }, true);
  const tabBar = phone.getByTestId('bottom-tabs');
  await tabBar.waitFor();
  if (await phone.locator('.topbar .tabs').isVisible()) fail('the top bar still shows the tabs on a phone');
  const tabs = await tabBar.getByRole('tab').allInnerTexts();
  if (tabs.map((t) => t.trim()).join('|') !== 'Prepare|Preview|Device') fail(`the bottom tabs are ${JSON.stringify(tabs)}`);
  const barBox = await tabBar.boundingBox();
  if (!barBox || Math.abs(barBox.y + barBox.height - 915) > 1) fail(`the tab bar is not at the bottom: ${JSON.stringify(barBox)}`);
  await phone.getByRole('button', { name: /^Slice plate/ }).click();
  await phone.getByTestId('slice-stats').waitFor({ timeout: 300000 });
  await phone.getByRole('tab', { name: 'Prepare' }).click();
  await phone.getByRole('button', { name: 'Send to printer' }).waitFor();
  if (await phone.getByRole('button', { name: 'Preview', exact: true }).isVisible()) fail('the Slice bar still has a Preview button beside the Preview tab');
  // As desktop: nothing changed since slicing, so Slice is greyed out.
  if (!(await phone.getByRole('button', { name: /^Slice plate/ }).isDisabled())) fail('Slice plate is not greyed out right after slicing');
  const row = await phone.evaluate(() =>
    [...document.querySelectorAll('.actionbar .actions button')]
      .filter((b) => b.offsetParent)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.innerText, right: r.right, top: Math.round(r.top), clipped: b.scrollWidth > b.clientWidth };
      }),
  );
  const width = await phone.evaluate(() => window.innerWidth);
  if (row.length !== 3) fail(`the action bar has ${row.length} buttons: ${JSON.stringify(row)}`);
  if (row.some((b) => b.right > width + 1 || b.clipped)) fail(`a button is cut off: ${JSON.stringify(row)}`);
  if (new Set(row.map((b) => b.top)).size !== 1) fail(`the buttons wrap: ${JSON.stringify(row)}`);
  const actionBottom = await phone.evaluate(() => document.querySelector('.actionbar').getBoundingClientRect().bottom);
  if (Math.abs(actionBottom - barBox.y) > 1) fail(`the Slice bar does not sit on the tab bar: ${actionBottom} vs ${barBox.y}`);
  await phone.waitForTimeout(1500);
  if (shots) await phone.screenshot({ path: join(shots, 'layout-phone-sliced.png') });
  await phone.getByRole('tab', { name: 'Device' }).click();
  await phone.getByTestId('device-screen').waitFor();
  if (shots) await phone.screenshot({ path: join(shots, 'layout-phone-device.png') });
  console.log(`phone after slicing: ${row.map((b) => b.text).join(' | ')}`);
} catch (e) {
  fail(e.message);
  if (shots) for (const [i, pg] of browser.contexts().flatMap((c) => c.pages()).entries()) await pg.screenshot({ path: join(shots, `layout-failed-${i}.png`) }).catch(() => {});
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('LAYOUT OK');
process.exit();
