// The add-on and the person's online projects, against a stand-in site and a
// stand-in Google Drive (CLOUD_SLICER_GOOGLE): list, open (takes the project
// over, like opening it on another computer), save over it or as new (asks
// every time; refused when it changed elsewhere), and the print history: a send
// of an online project's plate carries the tag line and makes a record, as a
// send from the site does. The printer is a pretend Klipper printer reached
// directly; nothing here touches hardware, and nothing starts a print.
//   node build.mjs && node --test test/projects.test.mjs
// Needs npm ci in apps/web (the pretend printer).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startMockPrinter } from '../../web/test/device/mock-printer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../fixtures');
const dir = mkdtempSync(join(tmpdir(), 'mcp-projects-'));
const TOKEN = 'test-token';
const DRIVE_KEY = 'drive-key';
let site, google, printer, client, plain;
/** What the person answers on screen. */
let answer = 'decline';
const prompts = [];

// The site's side: the list, versions, devices and print history (functions/_lib/projects.ts, prints.ts).
const projects = new Map();
const prints = [];
const puts = [];
const thumbnails = [];
const takenBy = [];
const project = (p) => ({ size: 0, hasThumbnail: false, createdAt: 1, updatedAt: Date.now(), engine: 'snapmaker', device: null, deviceName: null, plates: 1, printedPlates: 0, driveFile: null, ...p });

// Google's side: the person's Drive (files the app made only).
const driveFiles = new Map();
const uploads = new Map();
const driveNames = new Map();
let folder = null;

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
      env: {
        ...process.env,
        CLOUD_SLICER_SITE: `http://127.0.0.1:${site.address().port}`,
        CLOUD_SLICER_GOOGLE: `http://127.0.0.1:${google.address().port}`,
        CLOUD_SLICER_ACCOUNT_FILE: join(dir, 'account.json'),
      },
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

const body = (req) =>
  new Promise((ok) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => ok(Buffer.concat(parts)));
  });

const until = async (what, fn, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (await fn()) return;
  assert.fail(`timed out waiting for ${what}`);
};

before(async () => {
  printer = await startMockPrinter({ generic: true, hostname: 'voron-projects', printStep: 0.0005 });
  projects.set('proj-cube', project({ id: 'proj-cube', name: 'Dual cube', version: 3, driveFile: 'f-cube', updatedAt: 1000 }));
  projects.set('proj-other', project({ id: 'proj-other', name: 'Spool holder', version: 1, driveFile: 'f-gone', deviceName: 'phone', printedPlates: 1, updatedAt: 2000 }));
  const devices = [{ id: 'p2', name: 'Voron', preset: '', url: printer.url, hasApiKey: false, extra: { kind: 'direct' }, version: 1, updatedAt: 1 }];

  site = createServer(async (req, res) => {
    const send = (status, b) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(b));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Sign in first' });
    const url = new URL(req.url, 'http://site');
    const data = await body(req);
    if (url.pathname === '/api/me') return send(200, { user: { name: 'Alice', email: 'alice@example.com' } });
    if (url.pathname === '/api/presets') return send(200, { presets: [] });
    if (url.pathname === '/api/devices') return send(200, { devices });
    if (url.pathname === '/api/devices/p2/secret') return send(200, { apiKey: null });
    if (url.pathname === '/api/drive/token' && req.method === 'POST') return send(200, { accessToken: DRIVE_KEY, expiresAt: Date.now() + 3600_000 });
    if (url.pathname === '/api/projects') return send(200, { enabled: true, count: projects.size, drive: { connected: true }, projects: [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt) });
    const m = /^\/api\/projects\/([^/]+)(?:\/(device|prints|thumbnail))?$/.exec(url.pathname);
    if (!m) return send(404, { error: 'not here' });
    const [, id, part] = m;
    const p = projects.get(id);
    if (part === 'device') {
      if (!p) return send(404, { error: 'no such project' });
      const { device, deviceName } = JSON.parse(data.toString());
      takenBy.push({ id, device, deviceName });
      Object.assign(p, { device, deviceName });
      return send(200, { project: p });
    }
    if (part === 'prints' && req.method === 'GET') return send(200, { prints: prints.filter((r) => r.projectId === id) });
    if (part === 'prints' && req.method === 'POST') {
      const r = JSON.parse(data.toString());
      prints.push({ projectId: id, at: Date.now(), endedAt: null, duration: null, progress: null, ...r });
      return send(200, { ok: true });
    }
    if (part === 'thumbnail') {
      thumbnails.push({ id, type: req.headers['content-type'], bytes: data });
      return send(200, { ok: true });
    }
    if (req.method === 'GET') return p ? send(200, { project: p }) : send(404, { error: 'no such project' });
    if (req.method === 'PUT') {
      const q = Object.fromEntries(url.searchParams);
      puts.push({ id, ...q });
      // As the site: a save on top of an older version than the newest is refused.
      if (Number(q.baseVersion) !== (p?.version ?? 0)) return send(409, { error: 'changed elsewhere', code: 'conflict' });
      const saved = project({ ...p, id, name: q.name, engine: q.engine, driveFile: q.drive, version: (p?.version ?? 0) + 1, plates: Number(q.plates), device: q.device, deviceName: q.deviceName });
      projects.set(id, saved);
      return send(200, { project: saved });
    }
    send(405, { error: 'no' });
  });

  google = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://google');
    const data = await body(req);
    const send = (status, b, headers = {}) => res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(b));
    if (url.pathname.startsWith('/session/')) {
      // A resumable upload's pieces (no key: the session address is the key).
      const up = uploads.get(url.pathname);
      const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers['content-range'] ?? '');
      if (!up || !range) return send(400, { error: { message: 'bad piece' } });
      up.parts.push(data);
      const have = up.parts.reduce((n, b) => n + b.length, 0);
      if (have < Number(range[3])) return res.writeHead(308, { Range: `bytes=0-${have - 1}` }).end();
      const id = `f-new-${driveFiles.size}`;
      driveFiles.set(id, Buffer.concat(up.parts));
      driveNames.set(id, up.meta);
      return send(200, { id });
    }
    if (req.headers.authorization !== `Bearer ${DRIVE_KEY}`) return send(401, { error: { message: 'Invalid Credentials' } });
    if (url.pathname === '/drive/v3/files' && req.method === 'GET') return send(200, { files: folder ? [{ id: folder }] : [] });
    if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
      const meta = JSON.parse(data.toString());
      assert.equal(meta.name, 'Cloud Slicer');
      folder = 'folder-1';
      return send(200, { id: folder });
    }
    if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
      const session = `/session/${uploads.size + 1}`;
      uploads.set(session, { meta: JSON.parse(data.toString()), parts: [] });
      return send(200, {}, { Location: `http://127.0.0.1:${google.address().port}${session}` });
    }
    const file = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (file && url.searchParams.get('alt') === 'media') {
      const bytes = driveFiles.get(decodeURIComponent(file));
      if (!bytes) return send(404, { error: { message: 'File not found' } });
      return res.writeHead(200, { 'content-type': 'model/3mf', 'content-length': bytes.length }).end(bytes);
    }
    send(404, { error: { message: 'not here' } });
  });

  await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
  await new Promise((ok) => google.listen(0, '127.0.0.1', ok));
  writeFileSync(join(dir, 'account.json'), JSON.stringify({ site: `http://127.0.0.1:${site.address().port}`, token: TOKEN }));
  client = await connect({ elicitation: {} });
  plain = await connect({});
  // The project in the Drive: a U1 project the add-on saved.
  const file = join(dir, 'cube.3mf');
  await tool(client, 'open_model', { path: resolve(fixtures, 'tetrahedron.stl') });
  await tool(client, 'save_project', { path: file });
  driveFiles.set('f-cube', readFileSync(file));
  projects.get('proj-cube').size = driveFiles.get('f-cube').length;
});

after(async () => {
  await client?.close();
  await plain?.close();
  site?.close();
  google?.close();
  await printer?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('lists the online projects, newest first', async () => {
  const { projects: list, note } = await tool(client, 'online_projects');
  assert.equal(note, undefined, 'Drive is connected');
  assert.deepEqual(
    list.map((p) => p.name),
    ['Spool holder', 'Dual cube'],
  );
  assert.equal(list[0].editedOn, 'phone');
  assert.equal(list[0].printedPlates, 1);
});

test('opens one from the Drive, taking it over like another computer would', async () => {
  const opened = await tool(client, 'open_online_project', { project: 'cube' });
  assert.ok(!opened.error, opened.error);
  assert.equal(opened.project, 'Dual cube');
  assert.ok(opened.objects.length >= 1, 'its objects');
  assert.equal(takenBy.at(-1).id, 'proj-cube');
  assert.match(takenBy.at(-1).device, /^ai-app-[0-9a-f]{20}$/);
  assert.equal(takenBy.at(-1).deviceName, 'AI app');
  const { projects: list } = await tool(client, 'online_projects');
  assert.equal(list.find((p) => p.name === 'Dual cube').openHere, true);
  // One whose file was deleted in Drive says so.
  const gone = await tool(client, 'open_online_project', { project: 'Spool holder' });
  assert.match(gone.error, /Couldn't download "Spool holder" from Google Drive: This project is no longer in your Google Drive/);
  // Only a name that picks one project.
  assert.match((await tool(client, 'open_online_project', { project: 'nothing like it' })).error, /No online project called "nothing like it"/);
});

test('a send of its plate carries the tag line and goes into its print history', async () => {
  await tool(client, 'open_online_project', { project: 'Dual cube' });
  const sliced = await tool(client, 'slice', { out: dir });
  assert.ok(!sliced.error, sliced.error);
  const sent = await tool(client, 'send_to_printer', { printer: 'Voron' });
  assert.equal(sent.sent, true, JSON.stringify(sent));
  assert.equal(sent.started, false, 'upload only');
  assert.equal(printer.state.print_stats.state, 'standby');
  // On the printer: the tag after the header block; on this computer the file stays as sliced.
  const onPrinter = printer.files.get(sent.path).text;
  const tag = /^; cloud_slicer_print = proj-cube\/1\/([0-9a-f]+)\/([A-Za-z0-9_-]+)$/m.exec(onPrinter);
  assert.ok(tag, 'tag line on the printer');
  assert.ok(onPrinter.indexOf('; HEADER_BLOCK_END') < tag.index, 'after the header block');
  assert.doesNotMatch(readFileSync(sliced.gcodeFile, 'latin1'), /cloud_slicer_print/);
  await until('the record', () => prints.length === 1);
  const [r] = prints;
  assert.deepEqual(
    { projectId: r.projectId, plate: r.plate, id: r.id, status: r.status, printer: r.printer, printerName: r.printerName, file: r.file, fingerprint: r.fingerprint },
    { projectId: 'proj-cube', plate: 0, id: tag[2], status: 'uploaded', printer: 'p2', printerName: 'Voron', file: sent.path, fingerprint: tag[1] },
  );
  assert.ok(Object.keys(r.summary?.config ?? {}).length, 'what the plate was sliced with');
  const history = await tool(client, 'project_history');
  assert.equal(history.project, 'Dual cube');
  assert.deepEqual(
    history.prints.map((p) => ({ plate: p.plate, result: p.result, printer: p.printer })),
    [{ plate: 1, result: 'Uploaded, not started', printer: 'Voron' }],
  );
  // Another file is not the project's plate: no tag, no record.
  const other = await tool(client, 'send_to_printer', { printer: 'Voron', file: resolve(fixtures, 'oreo-cookie.gcode') });
  assert.equal(other.sent, true);
  assert.doesNotMatch(printer.files.get(other.path).text, /cloud_slicer_print/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(prints.length, 1);
});

test('saving asks every time: no saves nothing, yes saves over it in the Drive', async () => {
  await tool(client, 'open_online_project', { project: 'Dual cube' });
  const before = { uploads: uploads.size, puts: puts.length };
  answer = 'decline';
  const no = await tool(client, 'save_online_project');
  assert.equal(no.saved, false);
  assert.match(prompts.at(-1), /Save the changes over the online project "Dual cube"\? It goes to your Google Drive/);
  assert.deepEqual({ uploads: uploads.size, puts: puts.length }, before, 'nothing went to the Drive or the site');

  answer = 'accept';
  const yes = await tool(client, 'save_online_project');
  assert.deepEqual(yes, { saved: true, project: 'Dual cube', version: 4 });
  const put = puts.at(-1);
  assert.deepEqual({ id: put.id, name: put.name, baseVersion: put.baseVersion, deviceName: put.deviceName, plates: put.plates }, { id: 'proj-cube', name: 'Dual cube', baseVersion: '3', deviceName: 'AI app', plates: '1' });
  assert.equal(driveNames.get(put.drive).name, 'Dual cube.3mf');
  assert.deepEqual(driveNames.get(put.drive).parents, ['folder-1'], 'in the Cloud Slicer folder');
  assert.equal(driveFiles.get(put.drive).subarray(0, 2).toString(), 'PK', 'a 3MF');
  await until('the list picture', () => thumbnails.some((t) => t.id === 'proj-cube'));
  const pic = thumbnails.find((t) => t.id === 'proj-cube');
  assert.equal(pic.type, 'image/png');
  assert.equal(pic.bytes.subarray(1, 4).toString(), 'PNG');

  // Changed on the site since: refused, and nothing is lost.
  projects.get('proj-cube').version = 9;
  const clash = await tool(client, 'save_online_project');
  assert.match(clash.error, /Not saved: "Dual cube" was changed or opened elsewhere since/);

  // As a new one, under a new name.
  const copy = await tool(client, 'save_online_project', { asNew: true, name: 'Dual cube copy' });
  assert.equal(copy.saved, true, JSON.stringify(copy));
  assert.equal(puts.at(-1).baseVersion, '0');
  assert.notEqual(puts.at(-1).id, 'proj-cube');
  assert.equal(driveNames.get(puts.at(-1).drive).name, 'Dual cube copy.3mf');
});

test('a file from this computer is not an online project: saving it needs a name', async () => {
  await tool(client, 'open_model', { path: resolve(fixtures, 'tetrahedron.stl') });
  const { projects: list } = await tool(client, 'online_projects');
  assert.ok(!list.some((p) => p.openHere));
  assert.match((await tool(client, 'save_online_project')).error, /Give the project a name/);
  assert.match((await tool(client, 'project_history')).error, /Say which project/);
});

test('an app that cannot ask on screen asks in the chat, with a one-time code', async () => {
  await tool(plain, 'open_online_project', { project: 'Dual cube copy' });
  const before = uploads.size;
  const ask = await tool(plain, 'save_online_project');
  assert.equal(ask.done, false);
  assert.match(ask.askThePerson, /Save the changes over the online project "Dual cube copy"/);
  assert.equal(uploads.size, before, 'nothing saved yet');
  const yes = await tool(plain, 'save_online_project', { confirm: ask.confirm });
  assert.equal(yes.saved, true, JSON.stringify(yes));
  assert.equal(uploads.size, before + 1);
});
