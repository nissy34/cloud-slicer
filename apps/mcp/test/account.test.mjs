// The add-on signed in to a Cloud Slicer account: the person's own presets come
// from the site's /api/presets (a stand-in site here; the real site's side, and
// signing in itself, are tested in apps/web/test/accounts.mjs).
//   node build.mjs && node --test test/account.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'mcp-account-'));
const TOKEN = 'test-token';
const PRESETS = [
  { type: 'printer', name: 'My U1', inherits: 'Snapmaker U1 (0.4 nozzle)', config: { retraction_length: '0.6,0.6,0.6,0.6' }, version: 1, updatedAt: 1 },
  { type: 'process', name: 'My fast', inherits: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)', config: { layer_height: '0.28', wall_loops: '3' }, version: 1, updatedAt: 1 },
  { type: 'filament', name: 'My PLA', inherits: 'Snapmaker PLA Basic @U1', config: { nozzle_temperature: '212' }, version: 1, updatedAt: 1 },
  // A printer of another brand: its brand loads first.
  { type: 'printer', name: 'My MK4', inherits: 'Prusa MK4 0.4 nozzle', config: {}, version: 1, updatedAt: 1 },
];
const asked = [];
let signedIn = true;
const site = createServer((req, res) => {
  asked.push(req.url);
  const send = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (!signedIn || req.headers.authorization !== `Bearer ${TOKEN}`) return req.url === '/api/me' ? send(200, { user: null }) : send(401, { error: 'Sign in first' });
  if (req.url === '/api/me') return send(200, { user: { name: 'Alice', email: 'alice@example.com' } });
  if (req.url === '/api/presets') return send(200, { presets: PRESETS });
  send(404, { error: 'not here' });
});
let client;

async function tool(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const body = r.content[0].text;
  if (r.isError) return { error: body };
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

before(async () => {
  await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${site.address().port}`;
  const file = join(dir, 'account.json');
  writeFileSync(file, JSON.stringify({ site: url, token: TOKEN, name: 'Alice', email: 'alice@example.com' }));
  client = new Client({ name: 'test', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(here, '../dist/server.mjs')],
      env: { ...process.env, CLOUD_SLICER_SITE: url, CLOUD_SLICER_ACCOUNT_FILE: file },
      stderr: 'inherit',
    }),
  );
});
after(async () => {
  await client.close();
  site.close();
  rmSync(dir, { recursive: true, force: true });
});

test('signed in: says who, and the account\'s own presets are there to choose', async () => {
  const me = await tool('account');
  assert.equal(me.email, 'alice@example.com');
  const printers = await tool('find_printers', { search: 'my' });
  assert.deepEqual(printers.yours, ['My U1', 'My MK4']);
  await tool('choose_presets', { printer: 'My U1' });
  const lists = await tool('list_presets', { search: 'my' });
  assert.deepEqual(lists.processes, [{ name: 'My fast', yours: true }]);
  assert.ok(lists.filaments.some((f) => f.name === 'My PLA' && f.yours));
  const chosen = await tool('choose_presets', { process: 'My fast', filaments: ['My PLA'] });
  assert.ok(!chosen.error && !chosen.notFound, JSON.stringify(chosen));
  const read = await tool('read_settings', { keys: ['layer_height', 'wall_loops', 'nozzle_temperature', 'retraction_length'] });
  const value = (k) => String(read[k]?.value ?? read[k]);
  assert.equal(value('layer_height'), '0.28', JSON.stringify(read));
  assert.equal(value('wall_loops'), '3');
  assert.match(value('nozzle_temperature'), /^212/);
  assert.match(value('retraction_length'), /^0\.6/);
  // Another brand's printer of their own loads that brand.
  const mk4 = await tool('choose_presets', { printer: 'My MK4' });
  assert.equal(mk4.printer, 'My MK4', JSON.stringify(mk4));
  assert.equal(asked.filter((u) => u === '/api/presets').length, 1, 'presets are fetched once, not on every call');
});

test('signed out on the site: the add-on notices, forgets the sign-in, and its presets go', async () => {
  signedIn = false;
  const me = await tool('account');
  assert.equal(me.signedIn, false, JSON.stringify(me));
  assert.match(me.problem, /sign-in ended/);
  assert.equal(existsSync(join(dir, 'account.json')), false);
  const printers = await tool('find_printers', { search: 'my' });
  assert.equal(printers.yours, undefined, JSON.stringify(printers).slice(0, 200));
  assert.match((await tool('sign_in')).error ?? '', /The site answered/, 'signing in again asks the site for a new code');
});
