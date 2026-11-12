// The add-on and the person's printers, against pretend printers only (NOTHING
// here touches hardware): a pretend U1 behind the real bridge (Go) and a local
// relay (wrangler dev), and a pretend Klipper printer reached directly, with a
// stand-in site that lists them. Status, upload only, and upload and print,
// which asks on screen every time and starts nothing on a no.
//   node build.mjs && node --test test/printers.test.mjs
// Needs Go, and npm ci in apps/device-relay and apps/web (the bridge test helpers).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { bridgeConfig, bridgeProgram, browserKey, startBridge } from '../../web/test/device/go-bridge.mjs';
import { startMockPrinter } from '../../web/test/device/mock-printer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../fixtures');
const dir = mkdtempSync(join(tmpdir(), 'mcp-printers-'));
const RELAY_PORT = 8797;
const relay = `http://127.0.0.1:${RELAY_PORT}`;
const TOKEN = 'test-token';
const cfg = { relay, bridgeId: 'mcp-test-bridge', key: 'mcp-test-key-0123456789', printers: [] };
let u1, voron, bridge, relayProc, site, client, plain;
const asked = [];
/** What the person answers on screen. */
let answer = 'decline';
const prompts = [];

async function connect(capabilities) {
  const c = new Client({ name: 'test', version: '1' }, { capabilities });
  if (capabilities.elicitation)
    c.setRequestHandler(ElicitRequestSchema, (req) => {
      prompts.push(req.params.message);
      return { action: answer, ...(answer === 'accept' && { content: {} }) };
    });
  await c.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(here, '../dist/server.mjs')],
      env: { ...process.env, CLOUD_SLICER_SITE: `http://127.0.0.1:${site.address().port}`, CLOUD_SLICER_ACCOUNT_FILE: join(dir, 'account.json') },
      stderr: 'inherit',
    }),
  );
  return c;
}

async function tool(c, name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  const body = r.content[0].text;
  if (r.isError) return { error: body };
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

const until = async (what, fn, ms = 30_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await fn()) return;
  assert.fail(`timed out waiting for ${what}`);
};

before(async () => {
  u1 = await startMockPrinter({ hostname: 'U1-mcp', printStep: 0.0005 });
  voron = await startMockPrinter({ generic: true, hostname: 'voron-mcp' });
  cfg.printers = [{ id: 'u1', name: 'U1-mcp', url: u1.url, apiKey: '' }];
  relayProc = spawn('npx', ['wrangler', 'dev', '--port', String(RELAY_PORT), '--ip', '127.0.0.1', '--persist-to', join(dir, 'relay')], {
    cwd: resolve(here, '../../device-relay'),
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, NO_COLOR: '1' },
  });
  let log = '';
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`relay did not start:\n${log}`)), 90_000);
    const watch = (d) => (log += d) && /Ready on/.test(log) && (clearTimeout(timer), ok());
    relayProc.stdout.on('data', watch);
    relayProc.stderr.on('data', watch);
  });
  bridge = startBridge(bridgeProgram(), bridgeConfig(cfg));
  const devices = [
    { id: 'p1', name: 'My U1', preset: 'Snapmaker U1 (0.4 nozzle)', url: '', hasApiKey: true, extra: { kind: 'bridge', relay, bridgeId: cfg.bridgeId, printer: 'u1' }, version: 1, updatedAt: 1 },
    { id: 'b1', name: 'Bridge on the PC', preset: '', url: '', hasApiKey: true, extra: { kind: 'bridge-agent', relay, bridgeId: cfg.bridgeId }, version: 1, updatedAt: 1 },
    { id: 'p2', name: 'Voron', preset: '', url: voron.url, hasApiKey: false, extra: { kind: 'direct' }, version: 1, updatedAt: 1 },
  ];
  site = createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`);
    const send = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Sign in first' });
    if (req.url === '/api/me') return send(200, { user: { name: 'Alice', email: 'alice@example.com' } });
    if (req.url === '/api/presets') return send(200, { presets: [] });
    if (req.url === '/api/devices') return send(200, { devices });
    if (req.url === '/api/devices/p1/secret') return send(200, { apiKey: browserKey(cfg.key) });
    if (req.url === '/api/devices/p2/secret') return send(200, { apiKey: null });
    // A local relay takes no tickets.
    if (req.url === '/api/relay/ticket') return send(503, { error: 'no tickets here' });
    send(404, { error: 'not here' });
  });
  await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
  writeFileSync(join(dir, 'account.json'), JSON.stringify({ site: `http://127.0.0.1:${site.address().port}`, token: TOKEN }));
  client = await connect({ elicitation: {} });
  plain = await connect({});
});

after(async () => {
  await client?.close();
  await plain?.close();
  bridge?.stop();
  if (relayProc) process.kill(-relayProc.pid);
  site?.close();
  await u1?.close();
  await voron?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('lists the account\'s printers, and how one is doing through its bridge', async () => {
  assert.deepEqual(await tool(client, 'printers'), [
    { name: 'My U1', preset: 'Snapmaker U1 (0.4 nozzle)', through: 'bridge' },
    { name: 'Voron', through: 'direct' },
  ]);
  assert.match((await tool(client, 'printer_status')).error, /Say which printer: My U1, Voron/);
  const s = await tool(client, 'printer_status', { printer: 'my u1' });
  assert.equal(s.connection, 'online', JSON.stringify(s));
  assert.equal(s.state, 'standby');
  assert.ok(s.temperatures.some((t) => /bed/i.test(t.name)), JSON.stringify(s.temperatures));
  assert.deepEqual(
    s.filaments.map((f) => [f.material, f.loaded]),
    [['PLA', true], ['PETG', true], ['PLA', true], ['not set', false]],
  );
});

test('upload only puts the file on the printer and starts nothing', async () => {
  const sliced = await tool(client, 'open_model', { path: resolve(fixtures, 'tetrahedron.stl') });
  assert.ok(!sliced.error, sliced.error);
  const { gcodeFile, error } = await tool(client, 'slice', { out: dir });
  assert.ok(!error, error);
  const sent = await tool(client, 'send_to_printer', { printer: 'My U1' });
  assert.equal(sent.sent, true, JSON.stringify(sent));
  assert.equal(sent.started, false);
  assert.ok(u1.files.has(sent.path), `${sent.path} on the printer`);
  assert.equal(u1.state.print_stats.state, 'standby');
  assert.equal(prompts.length, 0, 'upload only asks nothing');
  // A printer reached directly takes it too.
  const direct = await tool(client, 'send_to_printer', { printer: 'Voron', file: gcodeFile });
  assert.equal(direct.sent, true, JSON.stringify(direct));
  assert.ok(voron.files.has(direct.path));
  assert.equal(voron.state.print_stats.state, 'standby');
  assert.equal(voron.files.has('cube.gcode'), false, 'nothing was sent');
});

test('upload and print asks every time: no sends nothing, yes uploads and starts it the U1 way', async () => {
  for (const f of [...u1.files.keys()]) if (f !== 'calibration_cube.gcode') u1.files.delete(f);
  answer = 'decline';
  const no = await tool(client, 'send_to_printer', { printer: 'My U1', print: true });
  assert.equal(no.started, false, JSON.stringify(no));
  assert.equal(no.sent, false);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Start printing .* on My U1\?/);
  assert.match(prompts[0], /filament 1 \(PLA\) from T1/);
  assert.deepEqual([...u1.files.keys()], ['calibration_cube.gcode'], 'nothing was uploaded');
  assert.equal(u1.state.print_stats.state, 'standby');

  answer = 'accept';
  const yes = await tool(client, 'send_to_printer', { printer: 'My U1', print: true });
  assert.equal(yes.started, true, JSON.stringify(yes));
  assert.equal(prompts.length, 2, 'asked again');
  await until('the pretend U1 to print', () => u1.state.print_stats.state === 'printing');
  assert.ok(u1.scripts.some((s) => /SET_PRINT_USED_EXTRUDERS/.test(s)), 'the U1 is told which heads the file uses');
  assert.equal(u1.stats.localPrints.at(-1)?.path ?? u1.stats.localPrints.at(-1)?.filename, yes.path);

  // Busy: refused before anything is asked or sent.
  await until('the add-on to see it print', async () => (await tool(client, 'printer_status', { printer: 'My U1' })).state === 'printing');
  const busy = await tool(client, 'send_to_printer', { printer: 'My U1', print: true });
  assert.match(busy.error, /already printing/);
  assert.equal(prompts.length, 2);
});

test('an app that can\'t ask on screen never starts a print', async () => {
  const file = join(dir, 'cube.gcode');
  writeFileSync(file, '; filament_type = PLA\nG28\nM84\n');
  const r = await tool(plain, 'send_to_printer', { printer: 'Voron', file, print: true });
  assert.match(r.error, /can't ask the person on screen/);
  assert.equal(voron.state.print_stats.state, 'standby');
  assert.equal(voron.files.has('cube.gcode'), false, 'nothing was sent');
});
