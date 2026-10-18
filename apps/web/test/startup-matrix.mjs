#!/usr/bin/env node
// Starts the engine under browser settings that differ from CI's (time zone,
// language, CPU count) and in the current stable Google Chrome as well as
// Playwright's bundled Chromium, since startup has failed on users' machines
// while the plain smoke test passed.
//
//   node test/startup-matrix.mjs        # needs `npm run build` first
//   STARTUP_CHROME=1 …                  # also run in stable Chrome (npx playwright install chrome)
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4174;
const url = `http://localhost:${PORT}/`;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: web, stdio: 'pipe', detached: true });
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()));
  server.on('exit', (code) => fail(new Error(`vite preview exited (${code})`)));
});

const variants = [
  {},
  { timezoneId: 'Asia/Jerusalem', locale: 'he-IL' },
  { timezoneId: 'America/Los_Angeles', locale: 'en-US', cores: 16 },
  { timezoneId: 'Asia/Jerusalem', locale: 'en-US', cores: 32 },
  { timezoneId: 'UTC', locale: 'en-US', cores: 1 },
  { timezoneId: 'UTC', locale: 'en-US', cores: 64 },
];

const browsers = [
  await chromium.launch(
    process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
  ),
];
if (process.env.STARTUP_CHROME) browsers.push(await chromium.launch({ channel: 'chrome' }));
let failed = 0;
let runs = 0;
try {
  for (const browser of browsers) for (const { cores, ...options } of variants) {
    runs++;
    const label = `Chrome ${browser.version()} ${JSON.stringify({ ...options, cores })}`;
    const context = await browser.newContext(options);
    if (cores) {
      // Workers have their own navigator, so patch it in the worker script itself
      // (the engine's pthreads run the same file).
      await context.route(/\/engine\/engine-worker\.js/, async (route) => {
        const res = await route.fetch();
        const body = `Object.defineProperty(WorkerNavigator.prototype, 'hardwareConcurrency', { get: () => ${cores} });\n${await res.text()}`;
        await route.fulfill({ response: res, body });
      });
    }
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(e.message));
    await page.goto(url);
    const outcome = await Promise.race([
      page.getByText('Open a model to start').waitFor({ timeout: 120000 }).then(() => 'ok'),
      page.getByText(/could not start/).waitFor({ timeout: 120000 }).then(async () => page.getByText(/could not start/).innerText()),
    ]).catch((e) => `timeout: ${e.message.split('\n')[0]}`);
    if (outcome !== 'ok') failed++;
    console.log(`${outcome === 'ok' ? 'OK  ' : 'FAIL'} ${label}${outcome === 'ok' ? '' : `\n  ${outcome}`}`);
    for (const l of logs) console.log(`  console: ${l}`);
    await context.close();
  }
} finally {
  for (const browser of browsers) await browser.close();
  process.kill(-server.pid);
}
if (failed) {
  console.error(`STARTUP MATRIX: ${failed} of ${runs} failed`);
  process.exitCode = 1;
}
