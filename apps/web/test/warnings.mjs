#!/usr/bin/env node
// Browser end to end for desktop's plate and slicing warnings: an object
// moved over the plate's edge shows darker past the edge, says so and can't
// be sliced; moved back it slices, and the slice's warnings (here: a ledge
// with supports off) show under the slice result, on a computer and a phone.
//
//   node test/warnings.mjs [screenshot-dir]
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
const PORT = 4179;

// A 10 mm cube with a 20 mm ledge sticking out from its top: it needs support.
function ledgeStl() {
  const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
  const tris = [[0, 0, 0], [10, 0, 10], [20, 0, 10]].flatMap(([x, y, z]) => {
    const v = (i, j, k) => [x + i * 10, y + j * 10, z + k * 10];
    return [
      ...quad(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
      ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)), ...quad(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)),
      ...quad(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)), ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)),
    ];
  });
  return `solid ledge\n${tris.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((p) => `vertex ${p.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid ledge\n`;
}
const model = join(mkdtempSync(join(tmpdir(), 'warnings-')), 'ledge.stl');
writeFileSync(model, ledgeStl());

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
const url = `http://localhost:${PORT}/`;
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`WARNINGS FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }));

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
  await page.goto(url);
  await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
  await page.getByRole('dialog', { name: 'Set up your printers' }).getByRole('button', { name: 'Not now' }).click();
  await page.getByTestId('model-input').setInputFiles(model);
  await page.getByText('Ready to slice').waitFor({ timeout: 120000 });
  return page;
}

// Moves the object with the Move tool's X field (plate mm, of its origin: the ledge's left side).
async function moveX(page, x) {
  // On a phone the object list hides while a tool is open; the tool stays on the object.
  if ((await page.getByLabel('Position X').count()) === 0) {
    await page.locator('ul.objects > li.object').first().locator('.object-name').click();
    await page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Move' }).click();
  }
  const field = page.getByLabel('Position X');
  await field.fill(String(x));
  await field.press('Enter');
}

const slicePlate = (page) => page.getByRole('button', { name: /^Slice plate/ });

try {
  for (const [name, viewport, mobile] of [['desktop', { width: 1280, height: 860 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const page = await open(viewport, mobile);

    // Over the right edge: darker past it, a message, and no slicing.
    await moveX(page, 250);
    const outside = page.getByTestId('objects-outside');
    await outside.waitFor({ timeout: 30000 });
    const text = await outside.innerText();
    if (!/laid over the plate boundaries/.test(text) || !/ledge/.test(text)) fail(`${name}: outside message reads "${text}"`);
    if (!(await slicePlate(page).isDisabled())) fail(`${name}: Slice plate works with an object over the edge`);
    await shot(page, `${name}-outside`);
    // Unselected and framed, the part past the edge is darker, like desktop.
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByTestId('viewport').locator('canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('z');
    await page.waitForTimeout(1000);
    await shot(page, `${name}-outside-close`);
    console.log(`${name}: an object over the plate edge is reported and can't be sliced`);

    // Back on the plate it slices, and the ledge's warning shows.
    await moveX(page, 120);
    await outside.waitFor({ state: 'detached', timeout: 30000 });
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByTestId('viewport').locator('canvas').click({ position: { x: 5, y: 5 } });
    await slicePlate(page).click();
    await page.getByTestId('slice-stats').waitFor({ timeout: 600000 });
    const warnings = page.getByTestId('slice-warnings');
    await warnings.waitFor({ timeout: 30000 });
    const list = await warnings.innerText();
    if (!/re-orient the object or enable support generation/.test(list)) fail(`${name}: slice warnings read "${list}"`);
    if (await page.getByRole('button', { name: 'Download G-code' }).isDisabled()) fail(`${name}: a slice with only warnings can't be downloaded`);
    await page.getByTestId('gcode-preview').waitFor();
    await page.waitForTimeout(2000);
    await shot(page, `${name}-warnings`);
    console.log(`${name}: the slice's warnings show: ${list.replace(/\s+/g, ' ')}`);

    // Folded, they keep their count.
    await warnings.getByRole('button', { name: /1 warning/ }).click();
    if (await warnings.locator('li').count()) fail(`${name}: Hide leaves the warnings open`);
    await page.close();
  }
} catch (e) {
  fail(e.message);
  const text = await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(() => '');
  if (text) console.error(`page text:\n${text.slice(0, 2000)}`);
} finally {
  await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
if (!process.exitCode) console.log('WARNINGS OK');
process.exit();
