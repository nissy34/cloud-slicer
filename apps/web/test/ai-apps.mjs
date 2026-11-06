#!/usr/bin/env node
// Browser end to end for "Use with an AI app" (components/AiAppsDialog.tsx): the
// Project menu opens it without an account; Claude Desktop shows the download of the
// add-on from the `mcp` release, Other chat apps shows the settings to paste with a
// Copy button; More about it points at the add-on's README. Same window on a phone.
// (The account menu's button is checked in accounts.mjs, which signs in.)
//
//   node test/ai-apps.mjs [screenshot-dir]
//
// Needs `npm run build` first (with the engine copied into public/engine).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const PORT = 4191;
const RELEASE = "https://github.com/nissy34/cloud-slicer/releases/download/mcp";

const server = spawn(
  "npx",
  ["vite", "preview", "--port", String(PORT), "--strictPort"],
  { cwd: web, stdio: "pipe", detached: true },
);
await new Promise((ok, fail) => {
  const timer = setTimeout(
    () => fail(new Error("vite preview did not start")),
    30000,
  );
  server.stdout.on(
    "data",
    (d) => String(d).includes(String(PORT)) && (clearTimeout(timer), ok()),
  );
  server.on("exit", (code) => fail(new Error(`vite preview exited (${code})`)));
});

const fail = (msg) => {
  console.error(`AI APPS FAIL: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH === "/opt/pw-browsers"
    ? { executablePath: "/opt/pw-browsers/chromium" }
    : {},
);

async function check(name, viewport, mobile) {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: `http://localhost:${PORT}`,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => fail(`${name}: page error: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText("Open a model to start").waitFor({ timeout: 120000 });
  const wizard = page.getByRole("dialog", { name: "Set up your printers" });
  await wizard.waitFor({ timeout: 30000 });
  await wizard.getByRole("button", { name: "Not now" }).click();

  await page.locator(".project-button").click();
  await page.getByRole("menuitem", { name: "Use with an AI app…" }).click();
  const dialog = page.getByRole("dialog", { name: "Use with an AI app" });
  await dialog.waitFor();
  if (await page.getByRole("menuitem", { name: "New project" }).isVisible())
    fail(`${name}: the Project menu stayed open`);

  const download = dialog.getByTestId("ai-apps-download");
  if ((await download.getAttribute("href")) !== `${RELEASE}/cloud-slicer.mcpb`)
    fail(`${name}: download link is ${await download.getAttribute("href")}`);
  const more = dialog.getByRole("link", { name: "More about it" });
  if (!(await more.getAttribute("href"))?.endsWith("/apps/mcp/README.md"))
    fail(`${name}: More about it goes to ${await more.getAttribute("href")}`);
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (wide) fail(`${name}: the page scrolls sideways`);
  if (shots)
    await dialog.screenshot({
      path: join(shots, `ai-apps-${name}-desktop.png`),
    });

  await dialog.getByRole("radio", { name: "Other chat apps" }).click();
  const config = JSON.parse(
    await dialog.getByTestId("ai-apps-config").innerText(),
  );
  const args = config.mcpServers?.["cloud-slicer"]?.args ?? [];
  if (
    config.mcpServers?.["cloud-slicer"]?.command !== "npx" ||
    args[1] !== `${RELEASE}/cloud-slicer-mcp.tgz`
  )
    fail(`${name}: settings to paste are ${JSON.stringify(config)}`);
  if (await download.isVisible())
    fail(
      `${name}: the Claude Desktop download still shows under Other chat apps`,
    );
  await dialog.getByRole("button", { name: "Copy" }).click();
  await dialog.getByRole("button", { name: "Copied" }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (JSON.stringify(JSON.parse(copied)) !== JSON.stringify(config))
    fail(`${name}: Copy put ${copied}`);
  if (shots)
    await dialog.screenshot({ path: join(shots, `ai-apps-${name}-other.png`) });

  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "hidden" });
  await context.close();
  console.log(`ai apps ${name}: ok`);
}

try {
  await check("pc", { width: 1280, height: 860 }, false);
  await check("phone", { width: 390, height: 844 }, true);
} catch (e) {
  fail(e.stack ?? String(e));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
