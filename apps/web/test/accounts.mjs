#!/usr/bin/env node
// Accounts end to end against the real Pages Functions runtime (wrangler pages
// dev, local D1) and a mock Google OAuth server. No browser and no real
// provider: the test follows each redirect itself with its own cookie jar.
//
//   node test/accounts.mjs [site dir]     # default dist/ (after npm run build)
//   ACCOUNTS_ONLY='discarded' node test/accounts.mjs   # only tests whose name has that text
//
// With the built app it also signs in through the real Sign in button in
// Chromium, using the popup flow.
//
// The site is reached as two origins on one port: sign-ins start on
// http://localhost:<port> and the providers call back to http://127.0.0.1:<port>
// (AUTH_ORIGIN), the same split a branch preview has with production.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importJWK, jwtVerify } from 'jose';
import { chromium } from 'playwright';
import { pick, pickerOf } from './picker.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790;
const MOCK_PORT = 8791;
const HOST = `http://localhost:${PORT}`; // where the user is
const AUTH = `http://127.0.0.1:${PORT}`; // AUTH_ORIGIN
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// ---- mock Google -------------------------------------------------------------
// The site sends the browser to accounts.google.com (the test sends it here
// instead) and, in test mode, posts the code to this server's /google/token.
const users = {
  alice: { sub: 'g-alice', name: 'Alice', email: 'alice@example.com', email_verified: true },
  bob: { sub: 'g-bob', name: 'Bob', email: 'bob@example.com', email_verified: true },
  carol: { sub: 'g-carol', name: 'Carol', email: 'carol@example.com', email_verified: true },
  dave: { sub: 'g-dave', name: 'Dave', email: 'Dave@Example.com', email_verified: true },
  gina: { sub: 'g-gina', name: 'Gina', email: 'gina@example.com', email_verified: true },
  hank: { sub: 'g-hank', name: 'Hank', email: 'hank@example.com', email_verified: true },
  ivy: { sub: 'g-ivy', name: 'Ivy', email: 'ivy@example.com', email_verified: true },
  june: { sub: 'g-june', name: 'June', email: 'june@example.com', email_verified: true },
  kim: { sub: 'g-kim', name: 'Kim', email: 'kim@example.com', email_verified: true },
};
let nextUser = 'alice';
let declineDrive = false;
const codes = new Map(); // code -> { user, challenge }
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Unsigned id_token: the site reads the profile from the token Google returned
// straight to it over TLS, without checking a signature (as Google documents).
const idToken = (claims) => `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(claims))}.`;

// A request the page gave up on is dropped; anything else wrong still stops the test.
const mock = createServer((req, res) => mockGoogle(req, res).catch((e) => { if (!e.pageAborted) throw e; res.destroy(); }));
async function mockGoogle(req, res) {
  const url = new URL(req.url, MOCK);
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (url.pathname === '/google/authorize') {
    const q = url.searchParams;
    assert.equal(q.get('client_id'), '123456789012-google-id');
    assert.equal(q.get('code_challenge_method'), 'S256');
    const code = `code-${codes.size + 1}-${Math.random()}`;
    // declineDrive: the person unticks Google Drive on Google's consent screen.
    const scope = declineDrive ? q.get('scope').split(' ').filter((x) => !x.includes('drive')).join(' ') : q.get('scope');
    codes.set(code, { user: users[nextUser], challenge: q.get('code_challenge'), scope });
    const back = new URL(q.get('redirect_uri'));
    if (nextUser === 'cancel') back.searchParams.set('error', 'access_denied');
    else back.searchParams.set('code', code);
    back.searchParams.set('state', q.get('state'));
    return send(302, undefined, { Location: back.toString() });
  }
  if (url.pathname === '/google/token' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const f = new URLSearchParams(body);
    const c = codes.get(f.get('code'));
    codes.delete(f.get('code'));
    const pkceOk = c && b64url(createHash('sha256').update(f.get('code_verifier') ?? '').digest()) === c.challenge;
    const secret = f.get('client_secret') ?? Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString().split(':')[1];
    if (!c || !pkceOk || secret !== 'google-secret') return send(400, { error: 'invalid_grant' });
    const now = Math.floor(Date.now() / 1000);
    return send(200, {
      access_token: `tok-${Math.random()}`,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: c.scope ?? 'openid email profile',
      ...(c.scope?.includes('drive.file') && { refresh_token: `refresh-${Math.random()}` }),
      id_token: idToken({ iss: 'https://accounts.google.com', aud: '123456789012-google-id', iat: now, exp: now + 3600, ...c.user }),
    });
  }
  // Google Drive, as the page (account/drive.ts, routed here by the browser tests) and
  // the server (functions/_lib/drive.ts, in test mode) reach it.
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Location, Range' };
  if (url.pathname.startsWith('/googleapis/')) for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (url.pathname.startsWith('/googleapis/') && req.method === 'OPTIONS') return send(204);
  const authorized = () => (req.headers.authorization ?? '').startsWith('Bearer tok-');
  const readBody = async () => {
    const chunks = [];
    try {
      for await (const chunk of req) chunks.push(chunk);
    } catch (e) {
      // The page gave up on the request (Cancel, a time limit): like Google, drop it rather than fall over.
      console.warn(`mock Google: ${req.method} ${url.pathname} aborted by the page (${e.code ?? e.message})`);
      throw Object.assign(new Error('aborted by the page'), { pageAborted: true });
    }
    return Buffer.concat(chunks);
  };
  if (url.pathname === '/googleapis/drive/v3/files' && req.method === 'GET') {
    if (!authorized()) return send(401, { error: { message: 'Invalid Credentials' } });
    const q = url.searchParams.get('q') ?? '';
    const name = /name = '([^']*)'/.exec(q)?.[1];
    const parent = /'([^']*)' in parents/.exec(q)?.[1];
    // A folder by name (and parent), or every file the app made that isn't in the bin.
    const found = name
      ? [...driveFiles].filter(([, f]) => f.folder && f.name === name && !f.trashed && (!parent || f.parents?.includes(parent)))
      : [...driveFiles].filter(([, f]) => !f.folder && !f.trashed);
    return send(200, { files: found.map(([id]) => ({ id })) });
  }
  if (url.pathname === '/googleapis/drive/v3/files' && req.method === 'POST') {
    if (!authorized()) return send(401, { error: { message: 'Invalid Credentials' } });
    const meta = JSON.parse((await readBody()).toString());
    const id = `folder-${driveFiles.size + 1}-${Math.random().toString(36).slice(2)}`;
    driveFiles.set(id, { name: meta.name, folder: true, parents: meta.parents, bytes: Buffer.alloc(0) });
    return send(200, { id });
  }
  if (url.pathname === '/googleapis/upload/drive/v3/files' && req.method === 'POST') {
    if (!authorized()) return send(401, { error: { message: 'Invalid Credentials' } });
    const meta = JSON.parse((await readBody()).toString());
    const session = `s${Math.random().toString(36).slice(2)}`;
    driveUploads.set(session, meta);
    return send(200, {}, { Location: `${MOCK}/googleapis/upload/session/${session}` });
  }
  // An upload in pieces (Content-Range); 308 + Range says how much has arrived.
  const upload = /^\/googleapis\/upload\/session\/(\w+)$/.exec(url.pathname);
  if (upload && req.method === 'PUT') {
    const meta = driveUploads.get(upload[1]);
    if (!meta) return send(404, { error: { message: 'No upload' } });
    meta.bytes ??= Buffer.alloc(0);
    const piece = await readBody();
    const range = /bytes (?:(\d+)-(\d+)|\*)\/(\d+)/.exec(req.headers['content-range'] ?? '');
    const total = range ? Number(range[3]) : piece.length;
    if (range?.[1] !== undefined) {
      // dropUploads: the connection drops after this piece arrived (the page asks how much Google has, then goes on).
      if (Number(range[1]) === meta.bytes.length) meta.bytes = Buffer.concat([meta.bytes, piece]);
      if (dropUploads > 0 && meta.bytes.length < total) {
        dropUploads--;
        return req.socket.destroy();
      }
    } else if (!range) meta.bytes = piece;
    if (meta.bytes.length < total) return send(308, undefined, meta.bytes.length ? { Range: `bytes=0-${meta.bytes.length - 1}` } : {});
    driveUploads.delete(upload[1]);
    const id = `drive-${Math.random().toString(36).slice(2)}`;
    driveFiles.set(id, { name: meta.name, parents: meta.parents, bytes: meta.bytes });
    uploadedPieces.push(upload[1]);
    return send(200, { id });
  }
  // One file the app made, by id.
  const drivePath = /^\/googleapis\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
  if (drivePath) {
    if (!authorized()) return send(401, { error: { message: 'Invalid Credentials' } });
    const f = driveFiles.get(drivePath[1]);
    if (!f) return send(404, { error: { message: 'File not found' } });
    if (req.method === 'DELETE') return driveFiles.delete(drivePath[1]), send(204);
    if (req.method === 'PATCH') {
      f.name = JSON.parse((await readBody()).toString()).name;
      return send(200, { id: drivePath[1], name: f.name });
    }
    if (url.searchParams.get('alt') === 'media') {
      const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
      const bytes = range ? f.bytes.subarray(Number(range[1]), Number(range[2]) + 1) : f.bytes;
      res.writeHead(range ? 206 : 200, { ...cors, 'Content-Type': 'model/3mf', 'Content-Length': bytes.length });
      return res.end(bytes);
    }
    return send(200, { size: String(f.bytes.length), md5Checksum: createHash('md5').update(f.bytes).digest('hex'), trashed: Boolean(f.trashed) });
  }
  send(404, {});
}
/** The mock Google Drive: id -> { name, bytes }. The page uploads to Google itself; tests put files here. */
const driveFiles = new Map();
const driveUploads = new Map(); // resumable upload session -> the file's name, folder and the bytes so far
const uploadedPieces = []; // finished upload sessions, in order
let dropUploads = 0; // drop the connection after this many pieces (a phone losing signal)
await new Promise((ok) => mock.listen(MOCK_PORT, '127.0.0.1', ok));

// ---- the site under test ----------------------------------------------------
const state = mkdtempSync(join(tmpdir(), 'cs-accounts-'));
let site = resolve(process.argv[2] ?? join(web, 'dist'));
const withApp = existsSync(join(site, 'index.html')) && readFileSync(join(site, 'index.html'), 'utf8').includes('id="root"');
if (!withApp) {
  site = join(state, 'site');
  mkdirSync(site);
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>test</title>');
}
const wrangler = join(web, 'node_modules/.bin/wrangler');
const migrate = spawnSync(wrangler, ['d1', 'migrations', 'apply', 'cloud-slicer', '--local', '--persist-to', state], {
  cwd: web,
  encoding: 'utf8',
});
assert.equal(migrate.status, 0, migrate.stderr + migrate.stdout);

const ticketKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const bindings = {
  OWNER_EMAILS: 'alice@example.com',
  RELAY_TICKET_KEY: JSON.stringify(ticketKeys.privateKey.export({ format: 'jwk' })),
  AUTH_ORIGIN: AUTH,
  TRUSTED_ORIGINS: `${HOST},${AUTH}`,
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
  OAUTH_TEST_BASE: MOCK,
  // A real client id starts with the Cloud project number, which Google's file window needs as its app id.
  GOOGLE_CLIENT_ID: '123456789012-google-id',
  GOOGLE_PICKER_KEY: 'picker-key',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  ACCOUNT_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const server = spawn(
  wrangler,
  ['pages', 'dev', site, '--port', String(PORT), '--ip', '0.0.0.0', '--persist-to', state, ...Object.entries(bindings).flatMap(([k, v]) => ['--binding', `${k}=${v}`])],
  { cwd: web, stdio: 'pipe', detached: true },
);
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${HOST}/api/me`);
      if (r.headers.get('content-type')?.includes('json')) return;
    } catch {
      // not up yet
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(`wrangler pages dev did not start:\n${log}`);
}

const toMock = (u) => u.replace('https://accounts.google.com/o/oauth2/v2/auth', `${MOCK}/google/authorize`);

// ---- a tiny browser: per-host cookie jar, manual redirects --------------------
class Browser {
  jar = new Map(); // host -> Map(name -> value)
  async fetch(url, init = {}) {
    const u = new URL(url);
    const cookies = this.jar.get(u.host) ?? new Map();
    const headers = new Headers(init.headers);
    if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const [name, ...rest] = pair.split('=');
      const maxAge = attrs.find((a) => a.trim().toLowerCase().startsWith('max-age='));
      if (maxAge && Number(maxAge.split('=')[1]) <= 0) cookies.delete(name);
      else cookies.set(name, rest.join('='));
    }
    this.jar.set(u.host, cookies);
    return res;
  }
  /** Follows redirects; returns the final response and every URL visited. */
  async navigate(url) {
    const visited = [url];
    let res = await this.fetch(url);
    while (res.status === 302) {
      url = toMock(new URL(res.headers.get('location'), url).toString());
      visited.push(url);
      res = await this.fetch(url);
    }
    return { res, visited, url };
  }
  cookie(host, name) {
    return this.jar.get(host)?.get(name);
  }
  json(path, method = 'GET', body) {
    return this.fetch(`${HOST}${path}`, {
      method,
      headers: { Origin: HOST, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  async me() {
    return (await (await this.fetch(`${HOST}/api/me`)).json()).user;
  }
}

/** Starts a sign-in the way the app does (POST sign-in/social), returning Google's URL. */
async function startSignIn(browser, { returnTo = '/?tab=prepare', popup = false } = {}) {
  const done = `${HOST}/api/signin-done?${new URLSearchParams({ return: returnTo, ...(popup ? { popup: '1' } : {}) })}`;
  const res = await browser.json('/api/auth/sign-in/social', 'POST', { provider: 'google', callbackURL: done, errorCallbackURL: done, disableRedirect: true });
  assert.equal(res.status, 200, await res.clone().text());
  return toMock((await res.json()).url);
}

async function signIn(browser, user, opts) {
  nextUser = user;
  return browser.navigate(await startSignIn(browser, opts));
}

/** Chromium whose pages reach the mock Google Drive in place of www.googleapis.com. */
async function launchBrowser() {
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
  );
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const context = await newContext(opts);
    await context.route('https://www.googleapis.com/**', async (route) =>
      // A dropped connection at the mock is dropped for the page too.
      route.fetch({ url: route.request().url().replace('https://www.googleapis.com/', `${MOCK}/googleapis/`), maxRedirects: 0 }).then(
        (response) => route.fulfill({ response }),
        () => route.abort('connectionreset'),
      ),
    );
    return context;
  };
  browser.newPage = async (opts) => (await browser.newContext(opts)).newPage();
  return browser;
}

// ---- projects, as the page saves them ------------------------------------------
/** A tiny zip-looking file stands in for the 3MF; the server only checks the signature. */
const zipOf = (text) => Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from(text)]);
let driveIds = 0;
/** Puts a file in the (mock) Google Drive as the page uploads it; returns its id. */
function inDrive(body, name = 'x.3mf') {
  const id = `drive-test-${++driveIds}`;
  driveFiles.set(id, { name, bytes: Buffer.isBuffer(body) ? body : zipOf(body) });
  return id;
}
/** A save: the 3MF goes into their Drive, then the project points at it (body: text or bytes). */
function putProject(b, id, params, body) {
  return b.fetch(`${HOST}/api/projects/${id}?${new URLSearchParams({ ...params, drive: inDrive(body) })}`, { method: 'PUT', headers: { Origin: HOST } });
}
/** What a project's file holds, read from Drive as the page opens it (null: no such project or file). */
async function projectText(b, id) {
  const res = await b.json(`/api/projects/${id}`);
  if (res.status !== 200) return null;
  const f = driveFiles.get((await res.json()).project.driveFile);
  return f ? f.bytes.toString() : null;
}

const tests = [];
const test = (name, fn) => (!process.env.ACCOUNTS_ONLY || name.includes(process.env.ACCOUNTS_ONLY)) && tests.push([name, fn]);
async function waitFor(check, what, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out: ${what}`);
}

test('signed out: /api/me says accounts are on and lists providers', async () => {
  const me = await (await fetch(`${HOST}/api/me`)).json();
  assert.deepEqual(me, { enabled: true, providers: { google: true }, user: null });
});

const alice = new Browser();
test('Google sign-in from another host goes through AUTH_ORIGIN and comes back signed in', async () => {
  const { res, visited, url } = await signIn(alice, 'alice');
  assert.equal(url, `${HOST}/?tab=prepare`);
  assert.equal(res.status, 200);
  assert.ok(visited.some((v) => v.startsWith(`${AUTH}/api/auth/callback/google?`)), 'Google called back to AUTH_ORIGIN');
  assert.ok(visited.some((v) => v.startsWith(`${HOST}/api/auth/callback/google/oauth-proxy?`)), 'the session was set on the starting host');
  const me = await alice.me();
  assert.equal(me.name, 'Alice');
  assert.equal(me.email, 'alice@example.com');
  assert.deepEqual(me.identities.map((i) => i.provider), ['google']);
  assert.equal(await new Browser().me(), null, 'other browsers stay signed out');
});

test('a Google code works once', async () => {
  nextUser = 'alice';
  const b = new Browser();
  const authorize = await fetch(await startSignIn(b), { redirect: 'manual' });
  const cbUrl = authorize.headers.get('location');
  const first = await b.navigate(cbUrl);
  assert.equal(first.url, `${HOST}/?tab=prepare`);
  const again = await new Browser().navigate(cbUrl);
  assert.notEqual(again.url, `${HOST}/?tab=prepare`);
});

test("sign-in can't be started from, or sent back to, another site", async () => {
  // A signed-in browser (one with cookies to abuse) can't be driven from another site.
  const evil = await alice.fetch(`${HOST}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: '/', disableRedirect: true }),
  });
  assert.equal(evil.status, 403);
  const away = await new Browser().json('/api/auth/sign-in/social', 'POST', { provider: 'google', callbackURL: 'https://evil.example/x', disableRedirect: true });
  assert.equal(away.status, 403);
  const { url } = await signIn(new Browser(), 'bob', { returnTo: '//evil.example/x' });
  assert.equal(url, `${HOST}/`);
});

test('cancelling at Google returns with an error in the hash', async () => {
  const b = new Browser();
  const { url } = await signIn(b, 'cancel', { returnTo: '/somewhere' });
  assert.match(url, new RegExp(`^${HOST}/somewhere#auth-error=`));
  assert.equal(await b.me(), null);
});

test('popup sign-in ends on a page that tells the app window', async () => {
  const b = new Browser();
  const { res, url } = await signIn(b, 'bob', { popup: true });
  assert.match(url, /\/api\/signin-done\?/);
  const html = await res.text();
  assert.match(html, /BroadcastChannel\('cloud-slicer-auth'\)/);
  assert.match(html, /"type":"signed-in"/);
  assert.equal((await b.me()).name, 'Bob');
});

test('presets: save, conflict, update, list, delete', async () => {
  const noOrigin = await alice.fetch(`${HOST}/api/presets/filament/My%20PLA`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{"inherits":"x","config":{}}',
  });
  assert.equal(noOrigin.status, 403, 'writes need the page origin');

  const body = { inherits: 'Snapmaker PLA @U1', config: { nozzle_temperature: '215', filament_colour: '#FF0000' }, baseVersion: 0 };
  const created = await alice.json('/api/presets/filament/My%20PLA', 'PUT', body);
  assert.equal(created.status, 200);
  const p = (await created.json()).preset;
  assert.equal(p.version, 1);
  assert.deepEqual(p.config, body.config);

  const conflict = await alice.json('/api/presets/filament/My%20PLA', 'PUT', body);
  assert.equal(conflict.status, 409, 'baseVersion 0 does not overwrite');
  assert.equal((await conflict.json()).current.version, 1);

  const updated = await alice.json('/api/presets/filament/My%20PLA', 'PUT', { ...body, config: { nozzle_temperature: '220' }, baseVersion: 1 });
  assert.equal((await updated.json()).preset.version, 2);
  await alice.json('/api/presets/printer/My%20U1', 'PUT', { inherits: 'Snapmaker U1 (0.4 nozzle)', config: { retraction_length: '0.6' } });

  const all = (await (await alice.json('/api/presets')).json()).presets;
  assert.deepEqual(all.map((x) => `${x.type}:${x.name}:${x.version}`), ['filament:My PLA:2', 'printer:My U1:1']);
  const filaments = (await (await alice.json('/api/presets?type=filament')).json()).presets;
  assert.equal(filaments.length, 1);
  assert.equal(filaments[0].engines, undefined, 'a preset saved by one engine has no other-engine part');

  // OrcaSlicer's part of a preset (src/lib/preset-engines.ts) is stored as sent.
  const engines = { shared: 1, orca: { inherits: 'Generic PLA @System', config: { machine_start_gcode: 'G28' } }, pending: { nozzle_temperature: '215' } };
  const both = await alice.json('/api/presets/filament/My%20PLA', 'PUT', { ...body, engines, baseVersion: 2 });
  assert.deepEqual((await both.json()).preset.engines, engines);
  const reread = (await (await alice.json('/api/presets?type=filament')).json()).presets[0];
  assert.deepEqual(reread.engines, engines);
  assert.equal(reread.version, 3);
  assert.equal((await alice.json('/api/presets/filament/x', 'PUT', { ...body, engines: { orca: { config: { k: 1 } } } })).status, 400, 'engine part values are strings');
  assert.equal((await alice.json('/api/presets/filament/x', 'PUT', { ...body, engines: { other: 1 } })).status, 400, 'no unknown engine fields');

  assert.equal((await alice.json('/api/presets/filament/a%2Fb', 'PUT', body)).status, 400, 'no slashes in names');
  assert.equal((await alice.json('/api/presets/widget/x', 'PUT', body)).status, 404);
  assert.equal((await alice.json('/api/presets/filament/x', 'PUT', { config: { k: 1 } })).status, 400, 'values are strings');

  const bob = new Browser();
  await signIn(bob, 'bob');
  assert.equal((await (await bob.json('/api/presets')).json()).presets.length, 0, "users don't see each other's presets");
  assert.equal((await new Browser().json('/api/presets')).status, 401);

  await alice.json('/api/presets/filament/My%20PLA', 'DELETE');
  const left = (await (await alice.json('/api/presets')).json()).presets;
  assert.deepEqual(left.map((x) => x.name), ['My U1']);
});

test('settings: setup choices by key, with conflicts', async () => {
  const setup = { printers: ['Snapmaker U1 (0.4 nozzle)'], filaments: ['Snapmaker PLA @U1'] };
  const saved = await alice.json('/api/settings/setup', 'PUT', { value: setup, baseVersion: 0 });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).setting.version, 1);
  assert.equal((await alice.json('/api/settings/setup', 'PUT', { value: setup, baseVersion: 0 })).status, 409);
  await alice.json('/api/settings/setup', 'PUT', { value: { ...setup, filaments: [] } });
  const list = (await (await alice.json('/api/settings')).json()).settings;
  assert.deepEqual(list, [{ key: 'setup', value: { ...setup, filaments: [] }, version: 2, updatedAt: list[0].updatedAt }]);
  assert.equal((await alice.json('/api/settings/a%20b', 'PUT', { value: 1 })).status, 400);
  await alice.json('/api/settings/setup', 'DELETE');
  assert.equal((await (await alice.json('/api/settings')).json()).settings.length, 0);
});

test('devices: connection details sync, API key encrypted and only on request', async () => {
  const dev = { name: 'Workshop U1', preset: 'Snapmaker U1 (0.4 nozzle)', url: 'http://192.168.1.50', apiKey: 'sekrit-123', extra: { camera: true } };
  const put = await alice.json('/api/devices/dev-1', 'PUT', dev);
  assert.equal(put.status, 200);
  const saved = (await put.json()).device;
  assert.equal(saved.hasApiKey, true);
  assert.equal(saved.apiKey, undefined, 'saves never echo the key');
  const listed = (await (await alice.json('/api/devices')).json()).devices;
  assert.equal(listed.length, 1);
  assert.equal(JSON.stringify(listed).includes('sekrit'), false, 'lists never include the key');
  assert.deepEqual((await (await alice.json('/api/devices/dev-1/secret')).json()), { apiKey: 'sekrit-123' });

  // At rest it is ciphertext.
  const raw = spawnSync(wrangler, ['d1', 'execute', 'cloud-slicer', '--local', '--persist-to', state, '--json', '--command', 'SELECT api_key_enc FROM devices'], { cwd: web, encoding: 'utf8' });
  assert.match(raw.stdout, /"api_key_enc": "v1\./);
  assert.equal(raw.stdout.includes('sekrit'), false);

  await alice.json('/api/devices/dev-1', 'PUT', { name: 'Workshop U1', url: 'http://192.168.1.51' });
  assert.deepEqual((await (await alice.json('/api/devices/dev-1/secret')).json()), { apiKey: 'sekrit-123' }, 'left out = kept');
  await alice.json('/api/devices/dev-1', 'PUT', { name: 'Workshop U1', apiKey: null });
  assert.deepEqual((await (await alice.json('/api/devices/dev-1/secret')).json()), { apiKey: null });
  assert.equal((await alice.json('/api/devices/dev-1', 'PUT', { name: 'x', url: 'javascript:alert(1)' })).status, 400);

  const bob = new Browser();
  await signIn(bob, 'bob');
  assert.equal((await bob.json('/api/devices/dev-1/secret')).status, 404, "another user can't read it");
  await alice.json('/api/devices/dev-1', 'DELETE');
  assert.equal((await (await alice.json('/api/devices')).json()).devices.length, 0);
});

test('projects: save a 3MF online, thumbnail, conflicts, rename, list, delete', async () => {
  const save = (b, id, name, body, baseVersion) => putProject(b, id, { name, ...(baseVersion !== undefined ? { baseVersion: String(baseVersion) } : {}) }, body);
  assert.equal((await new Browser().json('/api/projects')).status, 401, 'signed out');
  assert.equal(
    (await alice.fetch(`${HOST}/api/projects/p1?name=x&drive=${inDrive('a')}`, { method: 'PUT' })).status,
    403,
    'writes need the page origin',
  );
  assert.equal((await save(alice, 'p1', 'Benchy', Buffer.from('not a zip'), 0)).status, 400, 'only 3MF (zip) files');
  assert.equal((await alice.fetch(`${HOST}/api/projects/p1?name=x`, { method: 'PUT', headers: { Origin: HOST } })).status, 400, 'a save names its file in Drive');

  const created = await save(alice, 'p1', 'Benchy', 'version one', 0);
  assert.equal(created.status, 200, await created.clone().text());
  const p1 = (await created.json()).project;
  assert.deepEqual([p1.name, p1.version, p1.hasThumbnail], ['Benchy', 1, false]);
  assert.match(await projectText(alice, 'p1'), /version one$/);

  // Both devices opened version 1; the phone saves first.
  const phone = new Browser();
  await signIn(phone, 'alice');
  assert.equal((await save(phone, 'p1', 'Benchy', 'from the phone', 1)).status, 200);
  const stale = await save(alice, 'p1', 'Benchy', 'from the laptop', 1);
  assert.equal(stale.status, 409, 'a save based on an old version is refused');
  assert.equal((await stale.json()).current.version, 2);
  assert.match(await projectText(alice, 'p1'), /from the phone$/, 'the newer save is kept');
  assert.equal((await save(alice, 'p1', 'Benchy', 'overwrite', undefined)).status, 200, 'overwrite without baseVersion');
  assert.equal((await save(alice, 'p1', 'Benchy', 'x', 0)).status, 409, 'baseVersion 0 never replaces a project');

  // The list picture lives in the row: WebP or PNG, small, replaced on the next upload.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
  const thumb = (body) => alice.fetch(`${HOST}/api/projects/p1/thumbnail`, { method: 'PUT', headers: { Origin: HOST, 'Content-Type': 'image/png' }, body });
  assert.equal((await thumb(Buffer.from('GIF89a'))).status, 400);
  assert.equal((await thumb(Buffer.concat([png, Buffer.alloc(70 * 1024)]))).status, 413, 'pictures are small');
  assert.equal((await thumb(png)).status, 200);
  let shown = await alice.fetch(`${HOST}/api/projects/p1/thumbnail`);
  assert.equal(shown.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await shown.arrayBuffer()), png);
  assert.equal((await thumb(webp)).status, 200);
  shown = await alice.fetch(`${HOST}/api/projects/p1/thumbnail`);
  assert.equal(shown.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await shown.arrayBuffer()), webp);

  await save(alice, 'p2', 'Cube', 'cube', 0);
  const renamed = await alice.json('/api/projects/p1', 'PATCH', { name: 'Benchy v2' });
  assert.equal((await renamed.json()).project.name, 'Benchy v2');
  const list = await (await alice.json('/api/projects')).json();
  assert.equal(list.enabled, true);
  assert.deepEqual(list.projects.map((p) => [p.name, p.hasThumbnail]), [['Benchy v2', true], ['Cube', false]], 'newest first');
  assert.equal(list.count, 2);
  assert.equal(list.limits, undefined, 'the 200 guard is not shown');
  assert.ok(list.projects.every((p) => driveFiles.has(p.driveFile)), 'each points at its file in Drive');

  const bob = new Browser();
  await signIn(bob, 'bob');
  assert.equal((await (await bob.json('/api/projects')).json()).projects.length, 0, "users don't see each other's projects");
  assert.equal((await bob.json('/api/projects/p1')).status, 404);
  assert.equal((await bob.fetch(`${HOST}/api/projects/p1/thumbnail`)).status, 404);

  const p2File = list.projects.find((p) => p.id === 'p2').driveFile;
  assert.equal((await alice.json('/api/projects/p2', 'DELETE')).status, 200);
  assert.deepEqual((await (await alice.json('/api/projects')).json()).projects.map((p) => p.id), ['p1']);
  assert.ok(!driveFiles.has(p2File), 'its file in Drive goes too');
  assert.equal((await alice.json('/api/projects/bad%20id', 'DELETE')).status, 400);
});

test('sign-in asks for Google Drive (files the app makes), with a refresh key', async () => {
  const b = new Browser();
  const google = new URL(await startSignIn(b));
  assert.match(google.searchParams.get('scope'), /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.equal(google.searchParams.get('access_type'), 'offline');
  nextUser = 'hank';
  await b.navigate(google.toString());
  assert.equal((await b.me()).drive, true);
});

test('projects in Google Drive: connect, save, open, rename, conflict, delete', async () => {
  const file = (text) => Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from(text)]);
  const putInDrive = (id, text) => driveFiles.set(id, { name: 'x.3mf', bytes: file(text) });
  const save = (b, id, name, driveId, baseVersion) =>
    b.fetch(`${HOST}/api/projects/${id}?${new URLSearchParams({ name, drive: driveId, ...(baseVersion !== undefined ? { baseVersion: String(baseVersion) } : {}) })}`, {
      method: 'PUT',
      headers: { Origin: HOST },
    });
  // Sign-in asks for Drive; Gina unticks it on Google's screen.
  const gina = new Browser();
  declineDrive = true;
  await signIn(gina, 'gina');
  declineDrive = false;
  assert.equal((await gina.me()).drive, false);
  let list = await (await gina.json('/api/projects')).json();
  assert.deepEqual(list.drive, { connected: false });
  const refused = await gina.json('/api/drive/token', 'POST');
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).code, 'drive-connect', 'not connected yet');
  putInDrive('drive-file-1', 'one');
  assert.equal((await save(gina, 'd1', 'Drive Benchy', 'drive-file-1', 0)).status, 403, 'a Drive save needs Drive connected');

  // Connect Google Drive: the same Google account, asked for drive.file, through AUTH_ORIGIN like a sign-in.
  const done = `${HOST}/api/signin-done?popup=1&return=%2F`;
  const link = await gina.json('/api/auth/link-social', 'POST', {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    additionalParams: { access_type: 'offline', prompt: 'consent' },
    callbackURL: done,
    errorCallbackURL: done,
    disableRedirect: true,
  });
  assert.equal(link.status, 200, await link.clone().text());
  const google = new URL(toMock((await link.json()).url));
  assert.match(google.searchParams.get('scope'), /drive\.file/);
  assert.equal(google.searchParams.get('access_type'), 'offline');
  nextUser = 'gina';
  const back = await gina.navigate(google.toString());
  assert.equal(back.url, done, 'ends where a popup sign-in ends');
  list = await (await gina.json('/api/projects')).json();
  assert.deepEqual(list.drive, { connected: true });
  assert.equal((await gina.me()).drive, true);
  const token = await (await gina.json('/api/drive/token', 'POST')).json();
  assert.match(token.accessToken, /^tok-/);
  assert.ok(token.expiresAt > Date.now());

  // Google stops accepting the refresh key (a 7-day key from an app in Testing, or access taken away in the
  // Google account): the key can't be renewed, and the answer says where Connect Google Drive is.
  const d1 = (sql) => assert.equal(spawnSync(wrangler, ['d1', 'execute', 'cloud-slicer', '--local', '--persist-to', state, '--command', sql], { cwd: web, encoding: 'utf8' }).status, 0);
  const ginaGoogle = `"userId" = (SELECT id FROM "user" WHERE email = 'gina@example.com') AND "providerId" = 'google'`;
  d1(`UPDATE "account" SET "accessTokenExpiresAt" = '2020-01-01T00:00:00.000Z' WHERE ${ginaGoogle}`);
  const dead = await gina.json('/api/drive/token', 'POST');
  assert.equal(dead.status, 403);
  assert.deepEqual(await dead.json(), {
    error: 'Google Drive needs connecting again. Open the account menu (top right) and press Connect Google Drive.',
    code: 'drive-connect',
  });
  // Still listed as connected (a refused refresh key only shows when it is tried; the page then offers Connect).
  assert.equal((await gina.me()).drive, true);
  // No refresh key at all, and the key ran out: the account menu offers Connect again from the start.
  d1(`UPDATE "account" SET "refreshToken" = NULL WHERE ${ginaGoogle}`);
  assert.equal((await gina.me()).driveReconnect, true, 'no way to renew the key: Connect again');
  // Connecting again gives a fresh key.
  const relink = await gina.json('/api/auth/link-social', 'POST', {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    additionalParams: { access_type: 'offline', prompt: 'consent' },
    callbackURL: done,
    errorCallbackURL: done,
    disableRedirect: true,
  });
  nextUser = 'gina';
  assert.equal((await gina.navigate(toMock((await relink.json()).url))).url, done);
  assert.equal((await gina.me()).driveReconnect, false, 'connected again');
  assert.match((await (await gina.json('/api/drive/token', 'POST')).json()).accessToken, /^tok-/, 'a fresh key works');

  // Save: the page uploaded to Drive; the project points at that file.
  assert.equal((await save(gina, 'd1', 'Drive Benchy', 'not-in-drive', 0)).status, 400, 'only a file that is in their Drive');
  driveFiles.set('drive-notzip', { name: 'x', bytes: Buffer.from('not a zip') });
  assert.equal((await save(gina, 'd1', 'Drive Benchy', 'drive-notzip', 0)).status, 400, 'only 3MF files');
  const created = await save(gina, 'd1', 'Drive Benchy', 'drive-file-1', 0);
  assert.equal(created.status, 200, await created.clone().text());
  const p = (await created.json()).project;
  assert.deepEqual([p.driveFile, p.version, p.size], ['drive-file-1', 1, file('one').length]);
  assert.match(await projectText(gina, 'd1'), /one$/, 'the page opens it from Drive');

  // The next save replaces the Drive file; a save that loses a race leaves nothing behind in Drive.
  putInDrive('drive-file-2', 'two');
  assert.equal((await save(gina, 'd1', 'Drive Benchy', 'drive-file-2', 1)).status, 200);
  assert.ok(!driveFiles.has('drive-file-1'), 'the old file goes');
  putInDrive('drive-file-3', 'stale');
  assert.equal((await save(gina, 'd1', 'Drive Benchy', 'drive-file-3', 1)).status, 409);
  assert.ok(!driveFiles.has('drive-file-3'), "the refused save's file goes");
  assert.ok(driveFiles.has('drive-file-2'), 'the newer file stays');

  // Changed in Drive since (another app saved over it): the next save asks first.
  driveFiles.get('drive-file-2').bytes = file('edited on the PC');
  putInDrive('drive-file-4', 'from the web');
  const changed = await save(gina, 'd1', 'Drive Benchy', 'drive-file-4', 2);
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, 'changed-in-drive');
  assert.ok(!driveFiles.has('drive-file-4') && driveFiles.has('drive-file-2'), 'nothing replaced, nothing left behind');
  putInDrive('drive-file-4', 'from the web');
  assert.equal((await save(gina, 'd1', 'Drive Benchy', 'drive-file-4', undefined)).status, 200, 'Overwrite goes over it');
  // A file deleted in Drive (in the bin) is no conflict: the save just makes it again.
  driveFiles.get('drive-file-4').trashed = true;
  putInDrive('drive-file-2', 'two again');
  assert.equal((await save(gina, 'd1', 'Drive Benchy', 'drive-file-2', 3)).status, 200);

  // Rename renames the file in Drive too; Delete removes it.
  assert.equal((await gina.json('/api/projects/d1', 'PATCH', { name: 'Renamed' })).status, 200);
  assert.equal(driveFiles.get('drive-file-2').name, 'Renamed.3mf');
  assert.equal((await gina.json('/api/projects/d1', 'DELETE')).status, 200);
  assert.ok(!driveFiles.has('drive-file-2'));
});

test('projects: the device editing a project, taking it over', async () => {
  const file = (text) => text;
  const save = (b, id, name, body, baseVersion, extra = {}) =>
    putProject(b, id, { name, ...(baseVersion !== undefined ? { baseVersion: String(baseVersion) } : {}), ...extra }, body);
  const laptop = { device: 'laptop-device-1', deviceName: 'Windows computer' };
  const phoneDevice = { device: 'phone-device-1', deviceName: 'phone' };
  const before = (await (await alice.json('/api/projects')).json()).count;

  // Saved from the laptop: the save records the device editing it.
  const first = await save(alice, 'd2', 'My cube', file('first'), 0, laptop);
  assert.equal(first.status, 200, await first.clone().text());
  assert.deepEqual(
    (({ device, deviceName }) => ({ device, deviceName }))((await first.json()).project),
    { device: laptop.device, deviceName: 'Windows computer' },
  );
  assert.equal((await (await alice.json('/api/projects')).json()).count, before + 1);
  assert.equal((await save(alice, 'd2', 'My cube', file('second'), 1, laptop)).status, 200);

  // The phone takes it over: the laptop's next save is refused with "elsewhere", the phone's goes through.
  const phone = new Browser();
  await signIn(phone, 'alice');
  const took = await phone.json('/api/projects/d2/device', 'POST', phoneDevice);
  assert.equal(took.status, 200, await took.clone().text());
  const state = await (await alice.json('/api/projects/d2')).json();
  assert.deepEqual([state.project.device, state.project.deviceName, state.project.version], [phoneDevice.device, 'phone', 2], 'taking over keeps the version');
  const refused = await save(alice, 'd2', 'My cube', file('laptop edit'), 2, laptop);
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.code, 'elsewhere');
  assert.equal(body.current.deviceName, 'phone');
  assert.match(body.error, /edited on your phone/);
  assert.equal((await save(phone, 'd2', 'My cube', file('phone edit'), 2, phoneDevice)).status, 200);
  // Back on the laptop: "Edit here instead".
  assert.equal((await alice.json('/api/projects/d2/device', 'POST', laptop)).status, 200);
  assert.equal((await save(alice, 'd2', 'My cube', file('laptop again'), 3, laptop)).status, 200);
  assert.equal((await alice.json('/api/projects/d2/device', 'POST', { device: 'x' })).status, 400, 'device ids are checked');
  assert.equal((await phone.json('/api/projects/nope/device', 'POST', phoneDevice)).status, 404);

  assert.equal((await alice.json('/api/projects/d2', 'DELETE')).status, 200);
});

test('print history: sends and marks per plate, the printer\'s word, plates deleted, copies, gone with the project', async () => {
  const ivy = new Browser();
  await signIn(ivy, 'ivy');
  const other = new Browser();
  await signIn(other, 'june');
  const save = (id, plates) => putProject(ivy, id, { name: id, plates: String(plates) }, ' plates');
  assert.equal((await save('ten', 10)).status, 200);
  const add = (id, body, who = ivy) => who.json(`/api/projects/${id}/prints`, 'POST', body);
  const list = async (id, who = ivy) => (await (await who.json(`/api/projects/${id}/prints`)).json()).prints;

  assert.equal((await add('nope', { plate: 0, status: 'sent' })).status, 404, 'only a saved project');
  assert.equal((await add('ten', { plate: 0, status: 'sent' }, other)).status, 404, "not someone else's");
  assert.equal((await add('ten', { plate: 0, status: 'printed' })).status, 400, 'only the printer says printed');
  assert.equal((await new Browser().json('/api/projects/ten/prints', 'POST', { plate: 0, status: 'sent' })).status, 401);

  const summary = { objects: [{ name: 'Benchy', copies: 1, shape: 'a', place: 'b', settings: 'c', paint: 'd' }], plate: 'e', config: { layer_height: '1234abcd' } };
  const sent = await (await add('ten', { plate: 0, status: 'sent', printer: 'u1', printerName: 'U1', file: 'ten_plate_1.gcode', fingerprint: 'F0', summary })).json();
  assert.equal(sent.print.status, 'sent');
  await add('ten', { plate: 1, status: 'uploaded', printer: 'u1', file: 'ten_plate_2.gcode', fingerprint: 'F1' });
  await add('ten', { plate: 2, status: 'marked', fingerprint: 'F2' });
  await add('ten', { plate: 3, status: 'marked', fingerprint: 'F3' });
  await add('ten', { plate: 3, status: 'unmarked' });
  const mine = await list('ten');
  assert.deepEqual(mine.map((p) => [p.plate, p.status]), [[0, 'sent'], [1, 'uploaded'], [2, 'marked'], [3, 'marked'], [3, 'unmarked']]);
  assert.deepEqual(mine[0].summary, summary, 'the summary comes back');
  assert.deepEqual(await list('ten', other), [], "someone else sees none");

  // Waiting for the printer, across projects; the printer's word moves them on.
  const open = (await (await ivy.json('/api/prints/open')).json()).prints;
  assert.deepEqual(open.map((p) => p.file), ['ten_plate_1.gcode', 'ten_plate_2.gcode']);
  assert.equal(open[0].summary, null, 'no summaries in the open list');
  const patch = (id, body, who = ivy) => who.json(`/api/prints/${id}`, 'PATCH', body);
  assert.equal((await patch(sent.print.id, { status: 'printing' }, other)).status, 404);
  assert.equal((await patch(sent.print.id, { status: 'marked' })).status, 400);
  assert.equal((await (await patch(sent.print.id, { status: 'printing' })).json()).print.status, 'printing');
  const done = (await (await patch(sent.print.id, { status: 'printed', duration: 7980, progress: 1 })).json()).print;
  assert.equal(done.status, 'printed');
  assert.equal(done.duration, 7980);
  assert.ok(done.endedAt > 0);
  // Another page saw it end too: an ended print stays as it ended.
  assert.equal((await (await patch(sent.print.id, { status: 'failed' })).json()).print.status, 'printed');
  // Keep as printed: the plate as it is now.
  const kept = (await (await patch(sent.print.id, { fingerprint: 'F0b', summary: { ...summary, plate: 'f' } })).json()).print;
  assert.equal(kept.fingerprint, 'F0b');
  assert.equal(kept.status, 'printed');

  // The Projects list counts plates with a printed mark (plate 0 printed, 2 marked, 3 unmarked).
  const row = (await (await ivy.json('/api/projects')).json()).projects.find((p) => p.id === 'ten');
  assert.equal(row.plates, 10);
  assert.equal(row.printedPlates, 2);

  // Plate 2 deleted: its rows go, plate 3's become plate 2's.
  assert.equal((await ivy.json('/api/projects/ten/prints/plates', 'POST', { order: [0, 1, 3, 4, 5, 6, 7, 8, 9] })).status, 200);
  assert.deepEqual((await list('ten')).map((p) => [p.plate, p.status]), [[0, 'printed'], [1, 'uploaded'], [2, 'marked'], [2, 'unmarked']]);
  // Reordered: plate 1 and plate 2 swap.
  await ivy.json('/api/projects/ten/prints/plates', 'POST', { order: [0, 2, 1, 3, 4, 5, 6, 7, 8] });
  assert.deepEqual((await list('ten')).map((p) => [p.plate, p.status]).sort(), [[0, 'printed'], [1, 'marked'], [1, 'unmarked'], [2, 'uploaded']]);
  assert.equal((await ivy.json('/api/projects/ten/prints/plates', 'POST', { order: [0, 0] })).status, 400);

  // Save a copy: the copy has the finished history; the print still waiting stays the original's.
  assert.equal((await save('copy', 9)).status, 200);
  assert.equal((await ivy.json('/api/projects/copy/prints/copy', 'POST', { from: 'ten' })).status, 200);
  assert.deepEqual((await list('copy')).map((p) => [p.plate, p.status]).sort(), [[0, 'printed'], [1, 'marked'], [1, 'unmarked']]);

  // Only so many rows per plate: the oldest go.
  for (let i = 0; i < 52; i++) await add('copy', { plate: 5, status: i % 2 ? 'marked' : 'unmarked' });
  assert.equal((await list('copy')).filter((p) => p.plate === 5).length, 50);

  // A newer send of the same file to the same printer, or a mark of the plate, ends what still waits: no word.
  const status = async (id) => (await list('copy')).find((p) => p.id === id).status;
  const up = (await (await add('copy', { plate: 6, status: 'uploaded', printer: 'u1', file: 'same.gcode' })).json()).print;
  const resent = (await (await add('copy', { plate: 7, status: 'sent', printer: 'u1', file: 'same.gcode' })).json()).print;
  assert.equal(await status(up.id), 'unknown');
  assert.equal(await status(resent.id), 'sent');
  await add('copy', { plate: 7, status: 'marked' });
  assert.equal(await status(resent.id), 'unknown');
  assert.equal((await patch(up.id, { status: 'printed' })).status, 200);
  assert.equal(await status(up.id), 'unknown', 'no word stays no word');
  assert.equal((await patch(up.id, { status: 'unknown' })).status, 400, 'only the server says no word');
  // A week without word: no word.
  const old = (await (await add('copy', { plate: 8, status: 'sent', printer: 'u1', file: 'old.gcode' })).json()).print;
  const aged = spawnSync(wrangler, ['d1', 'execute', 'cloud-slicer', '--local', '--persist-to', state, '--command', `UPDATE project_prints SET at = ${Date.now() - 8 * 24 * 3600 * 1000} WHERE id = '${old.id}'`], { cwd: web, encoding: 'utf8' });
  assert.equal(aged.status, 0, aged.stderr);
  assert.equal((await (await ivy.json('/api/prints/open')).json()).prints.some((p) => p.id === old.id), false);
  assert.equal(await status(old.id), 'unknown');

  // Deleting the project deletes its history.
  assert.equal((await ivy.json('/api/projects/ten', 'DELETE')).status, 200);
  assert.deepEqual(await list('ten'), []);
  assert.deepEqual((await (await ivy.json('/api/prints/open')).json()).prints, []);
  assert.equal((await list('copy')).length, 57, 'the copy keeps its own');
});

test("print history from the bridge: the file's tag or its name says which plate, with no page open", async () => {
  const kim = new Browser();
  await signIn(kim, 'kim');
  const owner = (await kim.me()).id;
  const relay = 'https://relay.example';
  const browserKey = 'b'.repeat(43);
  // The bridge and its printer as the Device tab saves them (state/device.ts bridgeInput, printerInput).
  assert.equal((await kim.json('/api/devices/br-1', 'PUT', { name: 'Bridge', url: '', apiKey: browserKey, extra: { kind: 'bridge-agent', relay, bridgeId: 'bridge-k001' } })).status, 200);
  assert.equal((await kim.json('/api/devices/u1-k', 'PUT', { name: 'U1 in the garage', url: '', extra: { kind: 'bridge', relay, bridgeId: 'bridge-k001', printer: 'p1' } })).status, 200);
  const saved = await putProject(kim, 'kp', { name: 'kp', plates: '3' }, ' plates');
  assert.equal(saved.status, 200);
  const list = async () => (await (await kim.json('/api/projects/kp/prints')).json()).prints;
  // What the relay sends (apps/device-relay/src/prints.ts).
  const news = (body) =>
    fetch(`${HOST}/api/relay/print`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relay, bridgeId: 'bridge-k001', browserKey, owner, printer: 'p1', printerName: 'U1', tag: '', ...body }) });

  assert.equal((await news({ file: 'a.gcode', state: 'printing', browserKey: 'x'.repeat(43) })).status, 404, 'wrong bridge key');
  assert.equal((await news({ file: 'a.gcode', state: 'printing', owner: 'someone-else' })).status, 404, "someone else's account");
  assert.equal((await news({ file: 'a.gcode', state: 'standby' })).status, 400);

  // Sent from the Send window, by name: printing, then printed.
  const sent = (await (await kim.json('/api/projects/kp/prints', 'POST', { plate: 0, status: 'sent', printer: 'u1-k', printerName: 'U1 in the garage', file: 'kp_plate_1.gcode', fingerprint: 'aaaa1111' })).json()).print;
  assert.equal((await news({ file: 'kp_plate_1.gcode', state: 'printing', progress: 0.01 })).status, 200);
  assert.equal((await list()).find((p) => p.id === sent.id).status, 'printing');
  assert.equal((await news({ file: 'kp_plate_1.gcode', state: 'printing' })).status, 200, 'heard twice: the same');
  await news({ file: 'kp_plate_1.gcode', state: 'complete', duration: 3600, total: 3700, progress: 1 });
  let done = (await list()).find((p) => p.id === sent.id);
  assert.deepEqual([done.status, done.duration, done.progress], ['printed', 3600, 1]);
  assert.equal((await list()).length, 1);

  // Started on the printer's screen from a downloaded file: its tag says which plate, and a record starts.
  // A downloaded file's tag names the record it would make (lib/prints.ts printTagLine).
  const tag = (plate, id = `download-${plate}`, fingerprint = 'bbbb2222') => `; cloud_slicer_print = kp/${plate + 1}/${fingerprint}/${id}`;
  await news({ file: 'usb/plate two.gcode', state: 'printing', tag: tag(1) });
  let two = (await list()).find((p) => p.plate === 1);
  assert.equal(two.id, 'download-1', 'the record the tag names');
  assert.deepEqual([two.status, two.printer, two.printerName, two.fingerprint, two.file], ['printing', 'u1-k', 'U1 in the garage', 'bbbb2222', 'usb/plate two.gcode']);
  await news({ file: 'usb/plate two.gcode', state: 'cancelled', duration: 60, tag: tag(1) });
  two = (await list()).find((p) => p.id === two.id);
  assert.equal(two.status, 'cancelled');
  // Its end heard again after the bridge restarted ("late"): nothing new.
  await news({ file: 'usb/plate two.gcode', state: 'cancelled', duration: 60, tag: tag(1), late: true });
  assert.equal((await list()).filter((p) => p.plate === 1).length, 1);
  // An end never seen start (the bridge was off), tagged: a record of how it ended; heard twice, still one.
  await news({ file: 'p3.gcode', state: 'complete', duration: 120, total: 130, tag: tag(2) });
  await news({ file: 'p3.gcode', state: 'complete', duration: 120, total: 130, tag: tag(2) });
  const three = (await list()).filter((p) => p.plate === 2);
  assert.deepEqual(three.map((p) => p.status), ['printed']);

  // Uploaded only, started later on the printer: by name too. An older end of that name (the printer's last job, longer than since the upload) isn't it.
  const up = (await (await kim.json('/api/projects/kp/prints', 'POST', { plate: 0, status: 'uploaded', printer: 'u1-k', file: 'kp_plate_1.gcode', fingerprint: 'aaaa1111' })).json()).print;
  await news({ file: 'kp_plate_1.gcode', state: 'complete', duration: 3600, total: 3700, late: true });
  assert.equal((await list()).find((p) => p.id === up.id).status, 'uploaded');
  await news({ file: 'kp_plate_1.gcode', state: 'printing' });
  await news({ file: 'kp_plate_1.gcode', state: 'error', duration: 10 });
  assert.equal((await list()).find((p) => p.id === up.id).status, 'failed');

  // Not this account's projects, untagged files nobody sent, a tag with another project: nothing.
  await news({ file: 'other.gcode', state: 'printing' });
  await news({ file: 'other.gcode', state: 'printing', tag: '; cloud_slicer_print = nope/1/cccc3333/nope-0001' });
  await news({ file: 'other.gcode', state: 'printing', tag: '; cloud_slicer_print = ../1/cccc3333/nope-0002' });
  assert.equal((await list()).length, 4);
  assert.deepEqual((await (await kim.json('/api/prints/open')).json()).prints, []);

  // Upload and print: the printer starts (and the bridge says so) before the page records the send.
  // The file's tag names the record the send makes: one record, printing.
  const summary = { objects: [], plate: 'p', config: {} };
  await news({ file: 'kp_plate_3.gcode', state: 'printing', tag: tag(2, 'send-0003', 'dddd4444') });
  const late = (await (await kim.json('/api/projects/kp/prints', 'POST', { id: 'send-0003', plate: 2, status: 'sent', printer: 'u1-k', printerName: 'U1 in the garage', file: 'kp_plate_3.gcode', fingerprint: 'dddd4444', summary })).json()).print;
  assert.equal(late.id, 'send-0003', 'the send is the print the bridge heard');
  assert.equal(late.status, 'printing');
  assert.deepEqual((await list()).filter((p) => p.file === 'kp_plate_3.gcode').map((p) => [p.status, p.summary?.plate]), [['printing', 'p']]);
  // The same id for another plate: refused.
  assert.equal((await kim.json('/api/projects/kp/prints', 'POST', { id: 'send-0003', plate: 0, status: 'sent', printer: 'u1-k', file: 'kp_plate_3.gcode' })).status, 409);
  // The end finds the record by its id, though the file was renamed on the printer.
  await news({ file: 'renamed.gcode', state: 'complete', duration: 600, total: 610, tag: tag(2, 'send-0003', 'dddd4444') });
  assert.equal((await list()).find((p) => p.id === 'send-0003').status, 'printed');
  // Printed again later from the printer's screen: a new record, the first stays printed.
  await news({ file: 'renamed.gcode', state: 'printing', tag: tag(2, 'send-0003', 'dddd4444') });
  const again = (await list()).filter((p) => p.file === 'renamed.gcode' || p.id === 'send-0003');
  assert.deepEqual(again.map((p) => p.status).sort(), ['printed', 'printing']);
  assert.notEqual(again.find((p) => p.status === 'printing').id, 'send-0003');
});

test('admin: only the owner (OWNER_EMAILS) gets the Admin page', async () => {
  assert.equal((await alice.me()).owner, true);
  const bob = new Browser();
  await signIn(bob, 'bob');
  assert.equal((await bob.me()).owner, false);
  assert.equal((await bob.json('/api/admin')).status, 403);
  assert.equal((await new Browser().json('/api/admin')).status, 401);
  // Better Auth's own admin endpoints are owner-only too.
  assert.notEqual((await bob.json('/api/auth/admin/list-users?limit=5')).status, 200);
  const res = await alice.json('/api/admin');
  assert.equal(res.status, 200, await res.clone().text());
  const data = await res.json();
  assert.deepEqual(data.settings, { inviteOnly: false, bridgesPerPerson: 1 });
  const emails = data.users.map((u) => u.email);
  assert.ok(emails.includes('alice@example.com') && emails.includes('bob@example.com'), emails.join());
  const a = data.users.find((u) => u.email === 'alice@example.com');
  assert.equal(a.owner, true);
  assert.ok(a.projects >= 1 && a.presets >= 1 && a.projectsAllowed === true, JSON.stringify(a));
  assert.ok(a.createdAt > Date.now() - 3600_000 && a.lastSeen > Date.now() - 3600_000, `dates: ${a.createdAt} ${a.lastSeen}`);
  assert.equal(data.usage.analytics, 'not-set-up');
  assert.ok(data.usage.meters.find((m) => m.key === 'projects').used > 0);
  assert.ok(data.usage.meters.find((m) => m.key === 'database').used > 0, 'the database size is shown');
});

/** The sign-in popup's closing page: the message the app shows, or null when signed in. */
async function popupResult(browser, user) {
  const { res } = await signIn(browser, user, { popup: true });
  const html = await res.text();
  const m = /"type":"error","message":"([^"]*)"/.exec(html);
  return m ? m[1] : /"type":"signed-in"/.test(html) ? null : `unexpected page: ${html.slice(0, 200)}`;
}

test('invite only: new people are refused with a message; existing and invited ones get in', async () => {
  assert.equal((await alice.json('/api/admin/settings', 'PUT', { inviteOnly: true })).status, 200);
  const carol = new Browser();
  assert.match(await popupResult(carol, 'carol'), /invite only/);
  assert.equal(await carol.me(), null);
  const data = await (await alice.json('/api/admin')).json();
  assert.ok(!data.users.some((u) => u.email === 'carol@example.com'), 'no account was made for carol');
  // Everyone who had an account went on the list when invite only was turned on.
  const bob = new Browser();
  assert.equal(await popupResult(bob, 'bob'), null);
  assert.ok(data.users.find((u) => u.email === 'bob@example.com').allowed);
  // An invite works for an email written in any case.
  assert.equal((await alice.json('/api/admin/invites', 'POST', { email: 'dave@example.com' })).status, 200);
  assert.deepEqual((await (await alice.json('/api/admin')).json()).invites.map((i) => i.email), ['dave@example.com']);
  const dave = new Browser();
  assert.equal(await popupResult(dave, 'dave'), null);
  assert.equal((await dave.me()).name, 'Dave');
  // Taken off the list while invite only: signed out, and refused next time.
  const bobId = (await bob.me()).id;
  assert.equal((await alice.json(`/api/admin/users/${bobId}/disallow`, 'POST', {})).status, 200);
  assert.equal(await bob.me(), null);
  assert.match(await popupResult(bob, 'bob'), /invite only/);
  assert.equal((await alice.json(`/api/admin/users/${bobId}/allow`, 'POST', {})).status, 200);
  assert.equal(await popupResult(bob, 'bob'), null);
  assert.equal((await bob.json('/api/admin/settings', 'PUT', { inviteOnly: false })).status, 403);
  assert.equal((await alice.json('/api/admin/settings', 'PUT', { inviteOnly: false })).status, 200);
  assert.equal(await popupResult(new Browser(), 'carol'), null, 'open again');
});

test('block: signed out everywhere (within 5 minutes) and refused; unblock lets them back', async () => {
  const bob = new Browser();
  await signIn(bob, 'bob');
  const bob2 = new Browser();
  await signIn(bob2, 'bob');
  const bobId = (await bob.me()).id;
  assert.equal((await alice.json(`/api/admin/users/${(await alice.me()).id}/block`, 'POST', {})).status, 400, "the owner can't be blocked");
  assert.equal((await alice.json(`/api/admin/users/${bobId}/block`, 'POST', {})).status, 200);
  // Each browser keeps a signed 5-minute copy of its session (cookieCache in auth.ts), so
  // Block reaches open devices when that copy runs out. Dropping it stands in for the wait.
  for (const b of [bob, bob2]) for (const c of b.jar.values()) for (const name of [...c.keys()]) if (name.endsWith('session_data')) c.delete(name);
  assert.equal(await bob.me(), null);
  assert.equal(await bob2.me(), null);
  assert.equal((await bob.json('/api/presets')).status, 401);
  assert.match(await popupResult(bob, 'bob'), /blocked/);
  const row = (await (await alice.json('/api/admin')).json()).users.find((u) => u.id === bobId);
  assert.equal(row.blocked, true);
  assert.equal((await alice.json(`/api/admin/users/${bobId}/unblock`, 'POST', {})).status, 200);
  assert.equal(await popupResult(bob, 'bob'), null);
});

test('online projects off for one person: saves are refused, presets still save', async () => {
  const bob = new Browser();
  await signIn(bob, 'bob');
  const bobId = (await bob.me()).id;
  assert.equal((await bob.me()).projects, true, 'on unless turned off');
  assert.equal((await alice.json(`/api/admin/users/${bobId}/projects`, 'PUT', { allowed: false })).status, 200);
  assert.equal((await bob.me()).projects, false);
  assert.equal((await (await bob.json('/api/projects')).json()).enabled, false);
  const fileId = inDrive('bob');
  const put = await bob.fetch(`${HOST}/api/projects/p1?name=x&baseVersion=0&drive=${fileId}`, { method: 'PUT', headers: { Origin: HOST } });
  assert.equal(put.status, 403);
  assert.equal((await put.json()).code, 'presets-only');
  assert.ok(!driveFiles.has(fileId), "the refused save's file doesn't stay in their Drive");
  assert.equal((await bob.json('/api/presets/process/Mine', 'PUT', { inherits: 'x', config: {} })).status, 200);
  // Bob signs in from the browser later; his account starts that test without presets.
  assert.equal((await bob.json('/api/presets/process/Mine', 'DELETE')).status, 200);
  const row = (await (await alice.json('/api/admin')).json()).users.find((u) => u.id === bobId);
  assert.equal(row.projectsAllowed, false);
  // Back on: a big project is fine, since it's their Drive's space, not ours.
  assert.equal((await alice.json(`/api/admin/users/${bobId}/projects`, 'PUT', { allowed: true })).status, 200);
  const big = Buffer.alloc(120 * 1024 * 1024);
  big.set([0x50, 0x4b, 3, 4]);
  const bigPut = await putProject(bob, 'big', { name: 'big', baseVersion: '0' }, big);
  assert.equal(bigPut.status, 200, await bigPut.clone().text());
  assert.equal((await bigPut.json()).project.size, big.byteLength);
  assert.equal((await bob.json('/api/projects/big', 'DELETE')).status, 200);
});

test('relay tickets: signed-in accounts only, for one bridge, with a bridge cap the owner sets', async () => {
  const relay = 'https://relay.example';
  assert.equal((await new Browser().json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0001' })).status, 401);
  const carol = new Browser();
  await signIn(carol, 'carol');
  const res = await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0001' });
  assert.equal(res.status, 200, await res.clone().text());
  const { ticket, expiresAt } = await res.json();
  const { payload } = await jwtVerify(ticket, await importJWK(ticketKeys.publicKey.export({ format: 'jwk' }), 'ES256'), { audience: 'cloud-slicer-relay' });
  assert.equal(payload.sub, (await carol.me()).id);
  assert.equal(payload.b, 'bridge-0001');
  assert.equal(payload.cams, 2);
  assert.ok(expiresAt > Date.now() + 3000_000);
  // One bridge per person unless the owner says otherwise (one bridge reaches every printer on its network).
  assert.equal((await (await alice.json('/api/admin')).json()).settings.bridgesPerPerson, 1);
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0001' })).status, 200, 'the same bridge again is fine');
  const second = await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0002' });
  assert.equal(second.status, 403);
  const refused = await second.json();
  assert.equal(refused.code, 'bridge-limit');
  assert.match(refused.error, /one bridge/);
  // The owner raises it for everyone.
  for (const bad of [0, 1.5, -2, '3']) assert.equal((await alice.json('/api/admin/settings', 'PUT', { bridgesPerPerson: bad })).status, 400, `not a bridge number: ${bad}`);
  assert.equal((await alice.json('/api/admin/settings', 'PUT', { bridgesPerPerson: -1 })).status, 200, 'no limit');
  assert.equal((await (await alice.json('/api/admin')).json()).settings.bridgesPerPerson, -1);
  assert.equal((await carol.json('/api/admin/settings', 'PUT', { bridgesPerPerson: 5 })).status, 403);
  assert.equal((await alice.json('/api/admin/settings', 'PUT', { bridgesPerPerson: 3 })).status, 200, 'any whole number');
  assert.equal((await (await alice.json('/api/admin')).json()).settings.inviteOnly, false, 'the other settings are kept');
  for (const id of ['bridge-0002', 'bridge-0003', 'bridge-0001']) assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: id })).status, 200);
  const fourth = await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0004' });
  assert.equal(fourth.status, 403);
  assert.equal((await fourth.json()).code, 'bridge-limit');
  assert.equal((await carol.json('/api/relay/bridges/bridge-0002', 'DELETE')).status, 200);
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0004' })).status, 200, 'a removed bridge frees a place');
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay: 'http://evil.example', bridgeId: 'bridge-0005' })).status, 400);
  // Back to one for everyone: bridges already in use keep working, new ones are refused.
  assert.equal((await alice.json('/api/admin/settings', 'PUT', { bridgesPerPerson: 1 })).status, 200);
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0004' })).status, 200, 'kept');
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0005' })).status, 403);
  // One person can have their own number.
  const carolId = (await carol.me()).id;
  assert.equal((await alice.json(`/api/admin/users/${carolId}/bridges`, 'PUT', { bridges: -2 })).status, 400);
  // No limit for this person: any number of bridges.
  assert.equal((await alice.json(`/api/admin/users/${carolId}/bridges`, 'PUT', { bridges: -1 })).status, 200);
  for (const id of ['bridge-0006', 'bridge-0007']) assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: id })).status, 200, 'no limit');
  for (const id of ['bridge-0006', 'bridge-0007']) assert.equal((await carol.json(`/api/relay/bridges/${id}`, 'DELETE')).status, 200);
  assert.equal((await alice.json(`/api/admin/users/${carolId}/bridges`, 'PUT', { bridges: 4 })).status, 200);
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0005' })).status, 200, "their own number wins over the site's");
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0008' })).status, 403, 'and is a cap too');
  let row = (await (await alice.json('/api/admin')).json()).users.find((u) => u.email === 'carol@example.com');
  assert.equal(row.bridges, 4);
  assert.equal(row.bridgesLimit, 4);
  assert.equal(row.bridgesAllowed, true);
  assert.equal((await alice.json(`/api/admin/users/${carolId}/bridges`, 'PUT', { bridges: null })).status, 200);
  row = (await (await alice.json('/api/admin')).json()).users.find((u) => u.email === 'carol@example.com');
  assert.equal(row.bridgesLimit, null, "back to the site's number");
});

test('the relay is for signed-in people only: signed out gets no ticket', async () => {
  const guest = new Browser();
  assert.equal((await guest.json('/api/relay/ticket', 'POST', { relay: 'https://relay.example', bridgeId: 'bridge-guest1' })).status, 401);
});

test('bridges: the owner turns one off for everyone, or bridges off for one person', async () => {
  const relay = 'https://relay.example';
  const carol = new Browser();
  await signIn(carol, 'carol');
  const carolId = (await carol.me()).id;
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0003' })).status, 200);
  const listed = (await (await alice.json('/api/admin')).json()).bridges.find((b) => b.id === 'bridge-0003');
  assert.ok(listed && listed.people.includes('Carol') && !listed.off, JSON.stringify(listed));
  assert.equal((await alice.json('/api/admin/bridges/bridge-0003/off', 'POST', {})).status, 200);
  const refused = await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0003' });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).code, 'bridge-off');
  assert.equal((await (await alice.json('/api/admin')).json()).bridges.find((b) => b.id === 'bridge-0003').off, true);
  assert.equal((await alice.json('/api/admin/bridges/bridge-0003/on', 'POST', {})).status, 200);
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0003' })).status, 200);
  assert.equal((await alice.json('/api/admin/bridges/no-such-bridge/off', 'POST', {})).status, 404);
  // Remove: an old bridge comes off the list and frees its place.
  const used = async () => (await (await alice.json('/api/admin')).json()).users.find((u) => u.id === carolId).bridges;
  const before = await used();
  assert.equal((await carol.json('/api/admin/bridges/bridge-0003', 'DELETE')).status, 403, 'owner only');
  assert.equal((await alice.json('/api/admin/bridges/bridge-0003', 'DELETE')).status, 200);
  assert.equal(await used(), before - 1);
  assert.ok(!(await (await alice.json('/api/admin')).json()).bridges.some((b) => b.id === 'bridge-0003'));
  assert.equal((await alice.json('/api/admin/bridges/bridge-0003', 'DELETE')).status, 404);
  // One person: no bridges at all, then allowed again; the online projects setting is kept.
  await alice.json(`/api/admin/users/${carolId}/projects`, 'PUT', { allowed: false });
  assert.equal((await alice.json(`/api/admin/users/${carolId}/bridges`, 'PUT', { bridges: 0 })).status, 200);
  const none = await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0003' });
  assert.equal(none.status, 403);
  assert.equal((await none.json()).code, 'no-bridges');
  const row = (await (await alice.json('/api/admin')).json()).users.find((u) => u.id === carolId);
  assert.equal(row.bridgesAllowed, false);
  assert.equal(row.projectsAllowed, false);
  await alice.json(`/api/admin/users/${carolId}/projects`, 'PUT', { allowed: true });
  assert.equal((await alice.json(`/api/admin/users/${carolId}/bridges`, 'PUT', { bridges: null })).status, 200);
  // Carol's other bridges are in use, so the removed one can't come back at one per person...
  const back = await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0003' });
  assert.equal(back.status, 403);
  assert.equal((await back.json()).code, 'bridge-limit');
  // ...until they go unused for 30 days, which frees their places by themselves.
  const sql = `UPDATE relay_bridges SET last_used_at = ${Date.now() - 31 * 24 * 3600_000} WHERE user_id = '${carolId}'`;
  assert.equal(spawnSync(wrangler, ['d1', 'execute', 'cloud-slicer', '--local', '--persist-to', state, '--command', sql], { cwd: web, encoding: 'utf8' }).status, 0);
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0003' })).status, 200);
});

test('setup codes: a bridge joins the account that made the code, once, within the hour', async () => {
  const relay = 'https://relay.example';
  const claim = (body) =>
    fetch(`${HOST}/api/relay/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relay, browserKey: 'k'.repeat(43), ...body }) });
  assert.equal((await new Browser().json('/api/relay/setup', 'POST', { relay })).status, 401);
  // The public half, for giving a relay the exact key (CI does that for the test relay).
  const pub = ticketKeys.publicKey.export({ format: 'jwk' });
  assert.deepEqual(await (await fetch(`${HOST}/api/relay/key`)).json(), { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y });
  const frank = new Browser();
  users.frank = { sub: 'g-frank', name: 'Frank', email: 'frank@example.com', email_verified: true };
  await signIn(frank, 'frank');
  const made = await frank.json('/api/relay/setup', 'POST', { relay });
  assert.equal(made.status, 200, await made.clone().text());
  const { code, expiresAt } = await made.json();
  assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.ok(expiresAt > Date.now() + 3500_000 && expiresAt <= Date.now() + 3600_000);
  assert.equal((await (await frank.json(`/api/relay/setup/${code}`)).json()).state, 'waiting');
  const bob = new Browser();
  await signIn(bob, 'bob');
  assert.equal((await bob.json(`/api/relay/setup/${code}`)).status, 404, "someone else's code");

  const wrong = await claim({ code: 'ZZZZ-ZZZZ', bridgeId: 'bridge-f001' });
  assert.equal(wrong.status, 404);
  assert.equal((await wrong.json()).code, 'wrong');
  assert.equal((await claim({ code, bridgeId: 'bridge-f001', relay: 'https://other.example' })).status, 400, 'for another relay');
  // Typed in lower case without the dash still counts.
  const ok = await claim({ code: code.toLowerCase().replace('-', ''), bridgeId: 'bridge-f001', host: 'FRANK-PC', system: 'win32' });
  assert.equal(ok.status, 200, await ok.clone().text());
  const answer = await ok.json();
  assert.equal(answer.name, 'Bridge on FRANK-PC');
  const { payload } = await jwtVerify(answer.claim, await importJWK(ticketKeys.publicKey.export({ format: 'jwk' }), 'ES256'), { audience: 'cloud-slicer-relay' });
  assert.equal(payload.sub, (await frank.me()).id);
  assert.equal(payload.b, 'bridge-f001');
  assert.equal(payload.claim, true);
  const again = await claim({ code, bridgeId: 'bridge-f002' });
  assert.equal(again.status, 410, 'works once');
  assert.equal((await again.json()).code, 'expired');
  assert.deepEqual(await (await frank.json(`/api/relay/setup/${code}`)).json(), { state: 'used', bridgeId: 'bridge-f001', name: 'Bridge on FRANK-PC' });

  // Saved in the account, with the browser key as its secret.
  const devices = (await (await frank.json('/api/devices')).json()).devices;
  const saved = devices.find((d) => d.extra?.bridgeId === 'bridge-f001');
  assert.ok(saved, JSON.stringify(devices));
  assert.equal(saved.name, 'Bridge on FRANK-PC');
  assert.equal(saved.extra.kind, 'bridge-agent');
  assert.deepEqual(await (await frank.json(`/api/devices/${saved.id}/secret`)).json(), { apiKey: 'k'.repeat(43) });
  // The Admin list names it the way the account saved it, with its printers.
  assert.equal((await frank.json(`/api/devices/u1-f`, 'PUT', { name: 'U1 in the shed', url: '', extra: { kind: 'bridge', relay, bridgeId: 'bridge-f001', printer: 'p1' } })).status, 200);
  const listed = (await (await alice.json('/api/admin')).json()).bridges.find((b) => b.id === 'bridge-f001');
  assert.equal(listed.name, 'Bridge on FRANK-PC');
  assert.equal(listed.printers, 'U1 in the shed');

  // One bridge per person by default: no second code, until the owner gives Frank three.
  const second = await frank.json('/api/relay/setup', 'POST', { relay });
  assert.equal(second.status, 403);
  assert.equal((await second.json()).code, 'bridge-limit');
  assert.equal((await alice.json(`/api/admin/users/${(await frank.me()).id}/bridges`, 'PUT', { bridges: 3 })).status, 200);

  // An hour later the code is no good.
  const late = await (await frank.json('/api/relay/setup', 'POST', { relay })).json();
  const sql = `UPDATE bridge_setup_codes SET expires_at = 1 WHERE used_at IS NULL`;
  assert.equal(spawnSync(wrangler, ['d1', 'execute', 'cloud-slicer', '--local', '--persist-to', state, '--command', sql], { cwd: web, encoding: 'utf8' }).status, 0);
  assert.equal((await (await frank.json(`/api/relay/setup/${late.code}`)).json()).state, 'expired');
  assert.equal((await claim({ code: late.code, bridgeId: 'bridge-f002' })).status, 410);

  // Three bridges for Frank: a fourth code isn't given out.
  for (const id of ['bridge-f002', 'bridge-f003']) {
    const c = (await (await frank.json('/api/relay/setup', 'POST', { relay })).json()).code;
    assert.equal((await claim({ code: c, bridgeId: id })).status, 200);
  }
  const fourth = await frank.json('/api/relay/setup', 'POST', { relay });
  assert.equal(fourth.status, 403);
  assert.equal((await fourth.json()).code, 'bridge-limit');

  // Removed on its own computer: the relay passes on the bridge's key, which proves it, and the account forgets it.
  const owner = (await frank.me()).id;
  const release = (body) =>
    fetch(`${HOST}/api/relay/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relay, bridgeId: 'bridge-f003', owner, ...body }) });
  assert.equal((await release({ browserKey: 'x'.repeat(43) })).status, 404, 'wrong key');
  assert.equal((await release({ browserKey: 'k'.repeat(43), owner: (await bob.me()).id })).status, 404, "someone else's account");
  const gone = await release({ browserKey: 'k'.repeat(43) });
  assert.equal(gone.status, 200, await gone.clone().text());
  assert.deepEqual(await gone.json(), { removed: 1 });
  const left = (await (await frank.json('/api/devices')).json()).devices;
  assert.ok(!left.some((d) => d.extra?.bridgeId === 'bridge-f003'), JSON.stringify(left));
  assert.ok(left.some((d) => d.extra?.bridgeId === 'bridge-f002'), 'the other bridges stay');
  assert.equal((await frank.json('/api/relay/setup', 'POST', { relay })).status, 200, 'its place is free again');
});

test('delete a person: account, presets, printers and the project list go; their Drive files stay', async () => {
  const erin = new Browser();
  users.erin = { sub: 'g-erin', name: 'Erin', email: 'erin@example.com', email_verified: true };
  await signIn(erin, 'erin');
  const erinId = (await erin.me()).id;
  await erin.json('/api/presets/process/Fast', 'PUT', { inherits: 'x', config: {} });
  await erin.json('/api/devices/e1', 'PUT', { name: 'E1', url: 'http://10.0.0.5', apiKey: 'k' });
  const put = await putProject(erin, 'ep', { name: 'x', baseVersion: '0' }, 'erin');
  assert.equal(put.status, 200, await put.clone().text());
  const erinFile = (await put.json()).project.driveFile;
  const before = (await (await alice.json('/api/admin')).json()).usage.meters.find((m) => m.key === 'projects').used;
  assert.equal((await alice.json(`/api/admin/users/${(await alice.me()).id}/delete`, 'POST', {})).status, 400, "the owner can't delete themself here");
  assert.equal((await alice.json(`/api/admin/users/${erinId}/delete`, 'POST', {})).status, 200);
  assert.equal(await erin.me(), null);
  const after = await (await alice.json('/api/admin')).json();
  assert.ok(!after.users.some((u) => u.id === erinId));
  assert.equal(after.usage.meters.find((m) => m.key === 'projects').used, before - 1);
  assert.ok(driveFiles.has(erinFile), 'the file is theirs: it stays in their Drive');
  // Signing up again starts empty.
  await signIn(erin, 'erin');
  assert.notEqual((await erin.me()).id, erinId);
  assert.equal((await (await erin.json('/api/presets')).json()).presets.length, 0);
  assert.equal((await (await erin.json('/api/projects')).json()).projects.length, 0);
});

test('signing in again, on another device, finds the same account', async () => {
  const me = await alice.me();
  assert.equal(me.email, 'alice@example.com');
  const otherDevice = new Browser();
  await signIn(otherDevice, 'alice');
  assert.equal((await otherDevice.me()).id, me.id);
  assert.deepEqual((await (await otherDevice.json('/api/presets')).json()).presets.map((p) => p.name), ['My U1']);
});

test('AI app add-on: signs in with a code the person approves on the site, then uses the account', async () => {
  process.env.CLOUD_SLICER_SITE = HOST;
  const person = new Browser();
  await signIn(person, 'alice');
  const { Account } = await import('../../mcp/src/account.ts');
  const until = async (what, ok, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) if (await ok()) return;
    assert.fail(`timed out waiting for ${what}`);
  };
  // Only the add-on's own name may ask for a code.
  const stranger = await fetch(`${HOST}/api/auth/device/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'someone-else' }) });
  assert.equal(stranger.ok, false, 'an unknown program is refused');

  const file = join(state, 'mcp-account.json');
  const addon = new Account(file);
  assert.equal(addon.signedIn, false);
  const { code, link } = await addon.start();
  assert.match(code, /^[A-Z0-9-]{8,9}$/);
  assert.equal(link, `${AUTH}/?user_code=${code}#link`, 'the link opens the site at the approval window');
  assert.deepEqual((await addon.status()).waiting, { code, link });

  // A signed-out browser can't claim or approve it.
  const nobody = new Browser();
  assert.notEqual((await nobody.json('/api/auth/device/approve', 'POST', { userCode: code })).status, 200);

  // Alice opens the link: the window claims the code for her account, then she taps Connect.
  const seen = await (await person.json(`/api/auth/device?user_code=${encodeURIComponent(code)}`)).json();
  assert.equal(seen.status, 'pending');
  assert.equal((await person.json('/api/auth/device/approve', 'POST', { userCode: code })).status, 200);
  await until('the add-on to pick up the approval', () => addon.signedIn);
  const status = await addon.status();
  assert.equal(status.email, 'alice@example.com');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.email, 'alice@example.com');
  assert.equal(statSync(file).mode & 0o077, 0, 'only this computer user can read the saved sign-in');

  // The next start is still signed in, and the account's presets come with it.
  const again = new Account(file);
  assert.equal(again.signedIn, true);
  assert.ok(Array.isArray((await again.api('/presets')).presets));

  // Turned down on the site: the add-on says so and stays signed out.
  const other = new Account(join(state, 'mcp-other.json'));
  const second = await other.start();
  await person.json(`/api/auth/device?user_code=${encodeURIComponent(second.code)}`);
  assert.equal((await person.json('/api/auth/device/deny', 'POST', { userCode: second.code })).status, 200);
  await until('the add-on to see the refusal', async () => Boolean((await other.status()).problem));
  assert.equal(other.signedIn, false);

  // Codes nobody approved are cleared once they expire, so they never pile up.
  const sql = (q) => JSON.parse(spawnSync(wrangler, ['d1', 'execute', 'cloud-slicer', '--local', '--persist-to', state, '--json', '--command', q], { cwd: web, encoding: 'utf8' }).stdout)[0].results;
  const third = await new Account(join(state, 'mcp-third.json')).start();
  sql(`UPDATE "deviceCode" SET "expiresAt" = '${new Date(Date.now() - 60000).toISOString()}' WHERE "userCode" = '${third.code}'`);
  const fourth = await new Account(join(state, 'mcp-fourth.json')).start();
  const stored = sql(`SELECT "expiresAt" FROM "deviceCode" WHERE "userCode" = '${fourth.code}'`)[0];
  assert.ok(stored && Date.parse(stored.expiresAt) > Date.now(), `dates are stored as ISO text (${stored?.expiresAt})`);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM "deviceCode" WHERE "userCode" = '${third.code}'`)[0].n, 0, 'the expired code was cleared');

  // Signing out ends the session on the site too.
  await again.signOut();
  assert.equal(existsSync(file), false);
  const old = await fetch(`${HOST}/api/me`, { headers: { authorization: `Bearer ${saved.token}` } });
  assert.equal((await old.json()).user, null, 'the old token no longer works');
  await assert.rejects(addon.api('/presets'), /sign/i, 'the other copy finds out on its next call');
});

test('sign out, then delete the account and its presets', async () => {
  const other = new Browser();
  await signIn(other, 'alice');
  assert.equal((await other.json('/api/auth/sign-out', 'POST', {})).status, 200);
  assert.equal(await other.me(), null);

  await alice.json('/api/settings/setup', 'PUT', { value: { printers: ['x'] } });
  await alice.json('/api/devices/d', 'PUT', { name: 'd', apiKey: 'k' });
  assert.equal((await alice.json('/api/auth/delete-user', 'POST', {})).status, 200);
  assert.equal(await alice.me(), null);
  const fresh = new Browser();
  await signIn(fresh, 'alice');
  const me = await fresh.me();
  assert.deepEqual(me.identities.map((i) => i.provider), ['google'], 'a new, empty account');
  assert.equal((await (await fresh.json('/api/presets')).json()).presets.length, 0);
  assert.equal((await (await fresh.json('/api/settings')).json()).settings.length, 0);
  assert.equal((await (await fresh.json('/api/devices')).json()).devices.length, 0);
  assert.equal((await (await fresh.json('/api/projects')).json()).projects.length, 0, 'projects went with the account');
});

const bobBrowser = new Browser();
if (withApp)
  test('browser: the AI app sign-in link asks to connect, shows the code, and Connect signs the add-on in (desktop and phone)', async () => {
    const { Account } = await import('../../mcp/src/account.ts');
    const person = new Browser();
    await signIn(person, 'alice');
    const browser = await launchBrowser();
    const shots = process.env.ACCOUNTS_SHOTS;
    try {
      for (const [name, viewport] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 844 }]]) {
        const addon = new Account(join(state, `mcp-browser-${name}.json`));
        const { code } = await addon.start();
        const context = await browser.newContext({ viewport, colorScheme: 'dark', deviceScaleFactor: 2 });
        await context.addCookies([...person.jar.get(new URL(HOST).host)].map(([n, value]) => ({ name: n, value, url: HOST })));
        const page = await context.newPage();
        await page.goto(`${HOST}/?user_code=${code}#link`);
        const dialog = page.getByRole('dialog', { name: 'Connect an AI app' });
        await dialog.getByTestId('link-code').waitFor({ timeout: 120000 });
        assert.equal(await dialog.getByTestId('link-code').innerText(), code);
        await dialog.getByText('alice@example.com').waitFor();
        assert.equal(await page.getByRole('dialog', { name: 'Set up your printers' }).isVisible(), false, 'the setup wizard waits');
        if (shots) await dialog.screenshot({ path: join(shots, `link-${name}-ask.png`) });
        await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
        await dialog.getByText(/Connected\. Go back to your AI app/).waitFor();
        if (shots) await dialog.screenshot({ path: join(shots, `link-${name}-done.png`) });
        for (let i = 0; i < 80 && !addon.signedIn; i++) await new Promise((r) => setTimeout(r, 250));
        assert.equal(addon.signedIn, true, 'the add-on picked up the approval');
        await dialog.getByRole('button', { name: 'Done' }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(new URL(page.url()).search, '', 'the code leaves the address');
        await context.close();
      }
      // A bare link (from typing the address) asks for the code.
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addCookies([...person.jar.get(new URL(HOST).host)].map(([n, value]) => ({ name: n, value, url: HOST })));
      const page = await context.newPage();
      await page.goto(`${HOST}/#link`);
      const dialog = page.getByRole('dialog', { name: 'Connect an AI app' });
      await dialog.getByLabel('The code your AI app shows').fill('nope1234');
      await dialog.getByRole('button', { name: 'Next' }).click();
      await dialog.getByText("This code isn't valid", { exact: false }).waitFor();
      await context.close();
      // Signed out, it asks to sign in first.
      const signedOut = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const out = await signedOut.newPage();
      await out.goto(`${HOST}/?user_code=ABCD1234#link`);
      const ask = out.getByRole('dialog', { name: 'Connect an AI app' });
      await ask.getByRole('button', { name: 'Continue with Google' }).waitFor({ timeout: 120000 });
      if (shots) await ask.screenshot({ path: join(shots, 'link-signed-out.png') });
      await signedOut.close();
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: the owner opens the Admin page from the account menu (desktop and phone)', async () => {
    const owner = new Browser();
    await signIn(owner, 'alice');
    const dave = new Browser();
    await signIn(dave, 'dave');
    await owner.json(`/api/admin/users/${(await dave.me()).id}/block`, 'POST', {});
    await owner.json('/api/admin/invites', 'POST', { email: 'frank@example.com' });
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addCookies([...owner.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const page = await context.newPage();
      await page.goto(HOST);
      const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
      await page.getByRole('button', { name: /Alice/ }).waitFor({ timeout: 60000 });
      await wizard.waitFor({ timeout: 5000 }).catch(() => {});
      if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
      // The account menu's "Use with an AI app" opens the window (tested in ai-apps.mjs) and closes the menu.
      await page.getByRole('button', { name: /Alice/ }).click();
      await page.getByRole('button', { name: 'Use with an AI app' }).click();
      const aiApps = page.getByRole('dialog', { name: 'Use with an AI app' });
      await aiApps.getByTestId('ai-apps-download').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sign out' }).isVisible(), false, 'account menu closes behind the window');
      await aiApps.getByRole('button', { name: 'Done' }).click();
      await page.getByRole('button', { name: /Alice/ }).click();
      await page.getByRole('button', { name: 'Admin: people and limits' }).click();
      const admin = page.getByTestId('admin');
      await admin.getByText('Free tier use').waitFor();
      await admin.getByText('dave@example.com').waitFor();
      await admin.getByText('Blocked').waitFor();
      await admin.getByText('frank@example.com').waitFor();
      // Invite only, from the page: the switch flips at once, and "Saving…" turns into "Saved".
      let release;
      const held = new Promise((r) => (release = r));
      await page.route('**/api/admin/settings', async (r) => (await held, r.continue()));
      await admin.getByLabel(/Invite only/).click();
      await admin.getByText('Only people on the list can sign in.').waitFor();
      await admin.getByTestId('admin-status').getByText('Saving…').waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'admin-saving.png'), clip: { x: 0, y: 0, width: 1280, height: 330 } });
      release();
      await admin.getByTestId('admin-status').getByText('Saved').waitFor();
      await page.unroute('**/api/admin/settings');
      assert.equal((await (await owner.json('/api/admin')).json()).settings.inviteOnly, true);
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'admin-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      const wide = await page.evaluate(() => [...document.querySelectorAll('.admin *')].filter((e) => e.getBoundingClientRect().right > 391).length);
      assert.equal(wide, 0, 'nothing wider than a phone');
      if (process.env.ACCOUNTS_SHOTS) {
        await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'admin-phone.png') });
        await admin.getByText('People (').scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'admin-phone-people.png') });
      }
      const daveRow = admin.getByTestId('admin-user').filter({ hasText: 'dave@example.com' });
      await daveRow.getByRole('button', { name: 'Delete', exact: true }).click();
      await daveRow.getByText("This can't be undone.", { exact: false }).scrollIntoViewIfNeeded();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'admin-phone-delete.png') });
      await daveRow.getByRole('button', { name: 'Keep' }).click();
      await admin.getByText(/^Bridges \(/).scrollIntoViewIfNeeded();
      await admin.getByTestId('admin-bridge').last().scrollIntoViewIfNeeded();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'admin-phone-bridges.png') });
      // A change the server refuses goes back, with the reason.
      await page.route('**/api/admin/settings', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Test refusal"}' }));
      await admin.getByLabel(/Invite only/).click();
      await admin.getByText(/That change didn't save.*Test refusal/).waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'admin-phone-failed.png'), clip: { x: 0, y: 0, width: 390, height: 600 } });
      await admin.getByText('Only people on the list can sign in.').waitFor();
      await page.unroute('**/api/admin/settings');
      await admin.getByLabel(/Invite only/).click();
      await admin.getByText('Anyone with a Google account can sign in.', { exact: false }).waitFor();
      await admin.getByTestId('admin-status').getByText('Saved').waitFor();
      await page.getByRole('button', { name: 'Back to the slicer' }).click();
      await page.getByTestId('admin').waitFor({ state: 'detached' });
      // Someone else doesn't get the button.
      const other = await browser.newContext();
      const bob = new Browser();
      await signIn(bob, 'bob');
      await other.addCookies([...bob.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const p2 = await other.newPage();
      await p2.goto(HOST);
      await p2.getByRole('button', { name: /Bob/ }).click({ timeout: 60000 });
      await p2.getByText('Signed in with Google').waitFor();
      assert.equal(await p2.getByRole('button', { name: 'Admin: people and limits' }).count(), 0);
    } finally {
      await owner.json(`/api/admin/users/${(await dave.me())?.id ?? ''}/unblock`, 'POST', {}).catch(() => {});
      await browser.close();
    }
  });

if (withApp)
  test('browser: Sign in button, popup sign-in, account menu, sign out', async () => {
    await signIn(bobBrowser, 'bob');
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.context().route('https://accounts.google.com/**', (r) => r.fulfill({ status: 302, headers: { location: toMock(r.request().url()) } }));
      await page.goto(HOST);
      // Choices made while signed out (as the setup wizard would save them).
      await page.evaluate(() => {
        const now = Date.now();
        localStorage.setItem('cloud-slicer:user-settings:v1', JSON.stringify({ setup: { key: 'setup', value: { printers: ['Snapmaker J1'] }, version: 0, updatedAt: now } }));
        localStorage.setItem('cloud-slicer:devices:v1', JSON.stringify([{ id: 'local-1', name: 'Garage J1', preset: 'Snapmaker J1', url: 'http://10.0.0.9', apiKey: 'garage-key', extra: {}, hasApiKey: false, version: 0, updatedAt: now }]));
        localStorage.setItem('cloud-slicer:user-presets:v1', JSON.stringify([{ type: 'process', name: 'Fast', inherits: '0.20mm Standard', config: { wall_loops: '2' }, version: 0, updatedAt: now }]));
      });
      await page.reload();
      nextUser = 'bob';
      await bobBrowser.json('/api/settings/setup', 'PUT', { value: { printers: ['Snapmaker U1 (0.4 nozzle)'] } });
      await page.getByRole('button', { name: 'Sign in' }).click();
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Continue with Google' }).click()]);
      if (!popup.isClosed()) await popup.waitForEvent('close', { timeout: 30000 });
      const menu = page.getByRole('button', { name: /Bob/ });
      await menu.waitFor({ timeout: 30000 });
      await menu.click();
      await page.getByText('Signed in with Google as bob@example.com').waitFor();
      // The browser's preset moves into the account: wait for it there, then the menu counts it.
      let presets = [];
      for (let i = 0; i < 50 && !presets.some((p) => p.name === 'Fast'); i++) {
        if (i) await new Promise((r) => setTimeout(r, 200));
        presets = (await (await bobBrowser.json('/api/presets')).json()).presets;
      }
      assert.deepEqual(presets.map((p) => `${p.type}:${p.name}`), ['process:Fast'], 'the browser preset moved into the account');
      await page.getByText('1 process').waitFor();
      // The merged settings upload after the presets, so wait for them too.
      const merged = { printers: ['Snapmaker U1 (0.4 nozzle)', 'Snapmaker J1'] };
      let settings = [];
      for (let i = 0; i < 50; i++) {
        if (i) await new Promise((r) => setTimeout(r, 200));
        settings = (await (await bobBrowser.json('/api/settings')).json()).settings;
        if (JSON.stringify(settings[0]?.value) === JSON.stringify(merged)) break;
      }
      assert.deepEqual(settings[0].value, { printers: ['Snapmaker U1 (0.4 nozzle)', 'Snapmaker J1'] }, 'browser choices merged into the account');
      // The printers upload after the presets and settings, so wait for it rather than racing it.
      let devices = [];
      for (let i = 0; i < 50 && !devices.length; i++) {
        if (i) await new Promise((r) => setTimeout(r, 200));
        devices = (await (await bobBrowser.json('/api/devices')).json()).devices;
      }
      assert.deepEqual(devices.map((d) => d.name), ['Garage J1']);
      assert.deepEqual(await (await bobBrowser.json('/api/devices/local-1/secret')).json(), { apiKey: 'garage-key' });
      await page.waitForFunction(() => localStorage.getItem('cloud-slicer:devices:v1') === null, null, { timeout: 5000 }).catch(() => {});
      assert.equal(await page.evaluate(() => localStorage.getItem('cloud-slicer:devices:v1')), null, 'local copy cleared once uploaded');
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'account-menu.png') });
      await page.setViewportSize({ width: 390, height: 800 });
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'account-menu-phone.png') });
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByRole('button', { name: 'Sign in' }).waitFor();
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: save a project online, reopen it with its settings, download the 3MF', async () => {
    const browser = await launchBrowser();
    try {
      const carol = new Browser();
      await signIn(carol, 'bob');
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
      await context.addCookies([...carol.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
      await page.goto(HOST);
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
      const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
      if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
      await page.getByRole('button', { name: /Bob/ }).waitFor({ timeout: 30000 });

      await page.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/3DBenchy.stl'));
      await page.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      const layer = page.getByLabel('Layer height', { exact: true });
      await layer.fill('0.28');
      await layer.press('Enter');
      const projectButton = page.getByRole('button', { name: /^Project/ });
      await projectButton.getByText('3DBenchy').waitFor();
      await projectButton.getByLabel('unsaved changes').waitFor();

      // AutoSave keeps the change in this browser only: no question, nothing goes to Drive.
      await projectButton.getByText('Saved in this browser').waitFor({ timeout: 30000 });
      assert.equal(await page.getByTestId('autosave-question').count(), 0, 'AutoSave asks nothing');
      assert.equal((await (await carol.json('/api/projects')).json()).projects.length, 0, 'nothing in Drive before Save');
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'saved-in-this-browser.png') });

      // The first Save names it, like Word.
      await page.keyboard.press('Control+s');
      const naming = page.getByRole('dialog', { name: 'Save project' });
      assert.equal(await naming.getByLabel('Project name').inputValue(), '3DBenchy');
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'save-naming.png') });
      await naming.getByRole('button', { name: 'Save' }).click();
      await page.getByText('Saved “3DBenchy” to your projects').waitFor({ timeout: 60000 });
      await projectButton.getByText('Saved', { exact: true }).waitFor();
      assert.equal(await projectButton.getByLabel('unsaved changes').count(), 0, 'clean after saving');
      const list = await (await carol.json('/api/projects')).json();
      const saved = list.projects.find((p) => p.name === '3DBenchy');
      assert.ok(saved, JSON.stringify(list.projects));
      assert.equal(saved.hasThumbnail, true, 'the 3D view was saved as its thumbnail');
      assert.ok(saved.size > 100_000, `3MF is ${saved.size} bytes`);
      assert.equal(saved.engine, 'snapmaker', 'saved with the engine it slices with');
      // In their Drive: the project in the "Cloud Slicer" folder, and no other folder.
      const folderOf = (name) => [...driveFiles].find(([, f]) => f.folder && f.name === name)?.[0];
      const top = folderOf('Cloud Slicer');
      assert.ok(top, 'the Cloud Slicer folder was made');
      assert.equal(folderOf('Drafts'), undefined, 'no Drafts folder');
      assert.deepEqual(driveFiles.get(saved.driveFile).parents, [top], 'the named project is in Cloud Slicer');
      assert.equal(driveFiles.get(saved.driveFile).name, '3DBenchy.3mf');

      // A change after that stays in this browser until the next Save: Drive keeps the saved version.
      await layer.fill('0.24');
      await layer.press('Enter');
      await projectButton.getByText('Saved in this browser').waitFor({ timeout: 30000 });
      await page.waitForTimeout(3000);
      assert.equal((await (await carol.json('/api/projects')).json()).projects.find((p) => p.id === saved.id)?.version, saved.version, 'AutoSave sent nothing to Drive');

      // A Save the server refuses says so and keeps the change; the next Save that works saves it.
      const refuse = (route) =>
        route.request().method() === 'PUT' && !route.request().url().includes('/thumbnail')
          ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test refusal' }) })
          : route.fallback();
      await page.route('**/api/projects/**', refuse);
      await page.keyboard.press('Control+s');
      await page.getByText('Not saved: Test refusal').waitFor({ timeout: 60000 });
      await projectButton.getByLabel('unsaved changes').waitFor();
      await page.unroute('**/api/projects/**', refuse);
      await page.keyboard.press('Control+s');
      await page.getByText('Saved “3DBenchy” to your projects').waitFor({ timeout: 60000 });
      await projectButton.getByText('Saved', { exact: true }).waitFor({ timeout: 10000 });
      assert.ok((await (await carol.json('/api/projects')).json()).projects.find((p) => p.id === saved.id)?.version > saved.version, 'Save sent the change');

      // Google stops accepting the site's key for their Drive: Save stops, says where to connect again,
      // and the account menu shows Connect Google Drive (it only did when Drive was never connected).
      await page.getByRole('button', { name: /Bob/ }).click();
      assert.equal(await page.getByTestId('connect-drive').count(), 0, 'connected: no Connect button');
      await page.keyboard.press('Escape');
      const refusedKey = (route) =>
        route.fulfill({ status: 401, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: 'Invalid Credentials' } }) });
      await page.route('https://www.googleapis.com/**', refusedKey);
      await layer.fill('0.26');
      await layer.press('Enter');
      await page.keyboard.press('Control+s');
      await page.getByText('Not saved: Google Drive needs connecting again. Open the account menu (top right) and press Connect Google Drive.').waitFor({ timeout: 60000 });
      await page.getByTestId('saving-card').waitFor({ state: 'detached', timeout: 5000 });
      await projectButton.getByLabel('unsaved changes').waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'drive-reconnect-message.png') });
      await page.getByRole('button', { name: /Bob/ }).click();
      await page.getByText("Google Drive needs connecting again: projects can't save to it until then").waitFor();
      await page.getByTestId('connect-drive').waitFor();
      await page.waitForTimeout(300);
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'drive-reconnect-menu.png') });
      await page.keyboard.press('Escape');
      await page.unroute('https://www.googleapis.com/**', refusedKey);
      // With a fresh key, the same Save works.
      await layer.fill('0.24');
      await layer.press('Enter');
      await page.keyboard.press('Control+s');
      await page.getByText('Saved “3DBenchy” to your projects').waitFor({ timeout: 60000 });

      // Another device takes it over: coming back to this tab, it is view only.
      const other = await carol.json(`/api/projects/${saved.id}/device`, 'POST', { device: 'other-device-1234', deviceName: 'phone' });
      assert.equal(other.status, 200);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const banner = page.getByTestId('view-only-banner');
      await banner.getByText('being edited on your phone').waitFor({ timeout: 15000 });
      await projectButton.getByText('View only').waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'view-only.png') });
      // On a phone the banner sits below the top bar, which stays usable.
      await page.setViewportSize({ width: 390, height: 800 });
      await page.waitForTimeout(300);
      const phoneBanner = await page.evaluate(() => {
        const bar = document.querySelector('.topbar').getBoundingClientRect();
        const banner = document.querySelector('[data-testid="view-only-banner"]').getBoundingClientRect();
        const project = document.querySelector('.project-button').getBoundingClientRect();
        const hit = document.elementFromPoint(project.left + project.width / 2, project.top + project.height / 2);
        return { below: banner.top >= bar.bottom - 0.5, projectClickable: !!hit?.closest('.project-button') };
      });
      assert.ok(phoneBanner.below, 'the view-only banner covers the top bar on a phone');
      assert.ok(phoneBanner.projectClickable, 'the Project button is under something on a phone');
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'view-only-phone.png') });
      await page.setViewportSize({ width: 1280, height: 860 });
      await banner.getByRole('button', { name: 'Edit here instead' }).click();
      await banner.waitFor({ state: 'detached', timeout: 60000 });
      assert.equal(await layer.inputValue(), '0.24', 'the latest save came back');
      const mine = await (await carol.json(`/api/projects/${saved.id}`)).json();
      assert.notEqual(mine.project.device, 'other-device-1234', 'this device edits it again');
      await layer.fill('0.28');
      await layer.press('Enter');
      // A Save shows it is saving from the press until it is done: a card, a spinner by the name,
      // and the menu says why Save, Save a copy and Download 3MF wait (here the server is held).
      let letSave;
      const held = new Promise((r) => (letSave = r));
      const hold = async (route) =>
        route.request().method() === 'PUT' && !route.request().url().includes('/thumbnail') ? (await held, route.fallback()) : route.fallback();
      await page.route('**/api/projects/**', hold);
      await page.keyboard.press('Control+s');
      const savingCard = page.getByTestId('saving-card');
      await savingCard.getByText('Saving…').waitFor({ timeout: 30000 });
      await projectButton.getByTestId('save-spinner').waitFor();
      await projectButton.click();
      await page.getByTestId('menu-saving').getByText('Save, Save a copy and Download 3MF wait until it is done.').waitFor();
      // Uploaded to Drive; recording the save can't be stopped halfway, so no Cancel now (#276).
      await page.getByTestId('menu-saving').getByText('Saving… finishing').waitFor();
      await page.getByTestId('menu-saving').getByTestId('save-bar').waitFor();
      assert.equal(await page.getByTestId('menu-cancel-save').count(), 0, 'no Cancel once the save is being recorded');
      for (const row of ['Save', 'Save a copy…', 'Download 3MF'])
        assert.ok(await page.getByRole('menuitem', { name: new RegExp(`^${row.replace('…', '.')}`) }).first().isDisabled(), `${row} waits while saving`);
      await page.mouse.move(900, 400);
      await page.waitForTimeout(400); // the menu fades in
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'saving-menu.png') });
      await page.keyboard.press('Escape');
      if (process.env.ACCOUNTS_SHOTS) {
        await page.setViewportSize({ width: 390, height: 800 });
        await page.mouse.move(200, 400);
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'saving-phone.png') });
        await projectButton.click();
        await page.getByTestId('menu-saving').waitFor();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'saving-menu-phone.png') });
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1280, height: 860 });
      }
      letSave();
      await page.getByText('Saved “3DBenchy” to your projects').waitFor({ timeout: 60000 });
      await page.unroute('**/api/projects/**', hold);
      await savingCard.waitFor({ state: 'detached' });
      assert.equal(await projectButton.getByTestId('save-spinner').count(), 0, 'the spinner goes when saved');
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-saved.png') });

      // A save that gets stuck uploading says how far it got and can be cancelled (#276):
      // here Google never answers the upload; Cancel stops it and the changes stay unsaved.
      await layer.fill('0.2');
      await layer.press('Enter');
      let letUpload;
      const uploadHeld = new Promise((r) => (letUpload = r));
      // The page gave up on these requests (Cancel): they never reach the mock Drive.
      const holdUpload = (route) => uploadHeld.then(() => route.abort().catch(() => {}));
      await page.route(`${MOCK}/googleapis/upload/session/**`, holdUpload);
      await page.keyboard.press('Control+s');
      await savingCard.getByText(/Saving… 0(\.0+)? of [\d.]+ (KB|MB)/).waitFor({ timeout: 30000 });
      await savingCard.getByTestId('save-bar').waitFor();
      await projectButton.click();
      await page.getByTestId('menu-saving').getByText(/Saving… 0(\.0+)? of/).waitFor();
      await page.getByTestId('menu-cancel-save').waitFor();
      await page.mouse.move(900, 400);
      await page.waitForTimeout(400);
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'saving-cancel-menu.png') });
      if (process.env.ACCOUNTS_SHOTS) {
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 390, height: 800 });
        await page.mouse.move(200, 400);
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'saving-cancel-phone.png') });
        await page.setViewportSize({ width: 1280, height: 860 });
        await projectButton.click();
      }
      await page.getByTestId('menu-cancel-save').click();
      await page.getByText('Save cancelled').waitFor({ timeout: 15000 });
      await savingCard.waitFor({ state: 'detached', timeout: 15000 });
      assert.equal(await projectButton.getByTestId('save-spinner').count(), 0, 'the spinner goes when cancelled');
      assert.notEqual(await projectButton.getByTestId('save-status').textContent(), 'Saved', 'a cancelled save leaves the changes unsaved');
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'saving-cancelled.png') });
      letUpload();
      await page.unroute(`${MOCK}/googleapis/upload/session/**`, holdUpload);
      // Saving again works (back to 0.28, which the steps below expect).
      await layer.fill('0.28');
      await layer.press('Enter');
      await page.keyboard.press('Control+s');
      await page.getByText('Saved “3DBenchy” to your projects').waitFor({ timeout: 60000 });
      await savingCard.waitFor({ state: 'detached' });

      // A reload offers the saved project that was open here.
      await page.reload();
      const hereCard = page.getByTestId('continue-card');
      await hereCard.getByText('Continue 3DBenchy?').waitFor({ timeout: 120000 });
      await hereCard.getByText(/You had it open here, edited/).waitFor();
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'continue-here.png') });
      await page.setViewportSize({ width: 390, height: 800 });
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'continue-here-phone.png') });
      await page.setViewportSize({ width: 1280, height: 860 });
      await hereCard.getByRole('button', { name: 'Continue' }).click();
      await hereCard.waitFor({ state: 'detached' });
      await projectButton.getByText('Saved', { exact: true }).waitFor({ timeout: 60000 });
      assert.equal(await layer.inputValue(), '0.28', 'the saved project came back');
      // Answered, the setup wizard comes next when no printers are set up (this test on its own).
      if (await wizard.waitFor({ timeout: 3000 }).then(() => true, () => false)) await wizard.getByRole('button', { name: 'Not now' }).click();

      await projectButton.click();
      await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
      // Its changed layer height: New project asks what to do with it, like desktop.
      await page.getByTestId('preset-changes').getByRole('button', { name: 'Discard' }).click({ timeout: 5000 }).catch(() => {});
      await page.getByText('Open a model to start').waitFor();
      // A new project forgets it: the next reload starts empty.
      await page.reload();
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
      await page.waitForTimeout(5000);
      assert.equal(await hereCard.count(), 0, 'a new project still offered the last one');

      // A fresh visit from "another device" offers to continue it.
      const visitor = await browser.newContext({ viewport: { width: 390, height: 800 } });
      await visitor.addCookies([...carol.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const phonePage = await visitor.newPage();
      await phonePage.goto(HOST);
      const card = phonePage.getByTestId('continue-card');
      await card.getByText('Continue 3DBenchy').waitFor({ timeout: 120000 });
      await card.getByText(/on your (Linux|Windows) computer|on your Mac/).waitFor();
      if (process.env.ACCOUNTS_SHOTS) await phonePage.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'continue-card-phone.png') });
      await card.getByRole('button', { name: 'Not now' }).click();
      await card.waitFor({ state: 'detached' });

      // Files shared to the app (Android's Share menu) open in it.
      await phonePage.reload();
      await phonePage.evaluate(() => navigator.serviceWorker?.ready);
      const shared = await phonePage.evaluate(async () => {
        const stl = await (await fetch('/fixtures/cube.stl').catch(() => null))?.blob();
        const form = new FormData();
        form.append('files', stl ?? new Blob(['solid c\nendsolid c\n']), 'clip.stl');
        const res = await fetch('/share-target', { method: 'POST', body: form });
        return res.url;
      });
      assert.match(shared, /\?shared=1$/, 'the service worker took the shared file');
      await phonePage.goto(shared);
      const ask = phonePage.getByTestId('ask-dialog');
      await ask.getByText('Open clip.stl').waitFor({ timeout: 120000 });
      if (process.env.ACCOUNTS_SHOTS) await phonePage.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'share-target-phone.png') });
      await ask.getByRole('button', { name: 'Add to 3DBenchy' }).waitFor();
      assert.equal(await card.count(), 0, '"Not now" keeps the Continue card away, and the question replaces it');
      await ask.getByRole('button', { name: 'Cancel' }).click();
      await visitor.close();

      // A project saved on another device in the last day is offered on a new browser. Continue opens it,
      // and the card doesn't come back. This tab starts on the other engine, so opening it restarts the
      // engine, which used to look for the card again while the project was still loading.
      const latest = (await (await carol.json(`/api/projects/${saved.id}`)).json()).project;
      const bytes = driveFiles.get(latest.driveFile).bytes;
      const laptopSave = await putProject(carol, 'from-laptop', { name: 'From my laptop', device: 'laptop-device-9', deviceName: 'Windows computer', engine: 'snapmaker' }, bytes);
      assert.equal(laptopSave.status, 200, await laptopSave.clone().text());
      const second = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await second.addCookies([...carol.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const secondPage = await second.newPage();
      await secondPage.goto(`${HOST}/?engine=orca`);
      const again = secondPage.getByTestId('continue-card');
      await again.getByText('Continue From my laptop').waitFor({ timeout: 120000 });
      await again.getByText(/on your Windows computer/).waitFor();
      await again.getByRole('button', { name: 'Continue' }).click();
      await secondPage.getByText('Snapmaker Orca 2.4').first().waitFor({ timeout: 120000 });
      await secondPage.locator('.project-busy').waitFor({ state: 'detached', timeout: 120000 });
      await secondPage.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      await secondPage.waitForTimeout(3000);
      assert.equal(await again.count(), 0, 'the Continue card shows once');
      // It keeps its engine: this tab started on OrcaSlicer and switched back.
      assert.equal(await pickerOf(secondPage, 'Slicer engine').inputValue(), 'snapmaker', 'the project opened in the engine it was made with');

      // Changing only the engine is a change AutoSave keeps in this browser: coming back opens it in the new engine.
      await pickerOf(secondPage, 'Slicer engine').selectOption('orca');
      const sw = secondPage.getByRole('dialog').filter({ hasText: /Switch/ });
      if (await sw.getByRole('button', { name: 'Switch' }).isVisible({ timeout: 3000 }).catch(() => false)) await sw.getByRole('button', { name: 'Switch' }).click();
      await secondPage.getByRole('button', { name: /^Project/ }).getByText('Saved in this browser').waitFor({ timeout: 90000 });
      assert.equal((await (await carol.json('/api/projects/from-laptop')).json()).project.engine, 'snapmaker', 'nothing went to Drive');
      await secondPage.goto(HOST);
      const card3 = secondPage.getByTestId('continue-card');
      await card3.getByText('Continue where you left off?').waitFor({ timeout: 120000 });
      await card3.getByRole('button', { name: 'Continue' }).click();
      await secondPage.getByText('OrcaSlicer 2.4').first().waitFor({ timeout: 120000 });
      await secondPage.locator('.project-busy').waitFor({ state: 'detached', timeout: 120000 });
      assert.equal(await pickerOf(secondPage, 'Slicer engine').inputValue(), 'orca', 'Continue opened the work in the engine it was switched to');
      await carol.fetch(`${HOST}/api/projects/from-laptop`, { method: 'DELETE', headers: { Origin: HOST } });

      // A saved project keeps its engine too: one made in OrcaSlicer opens in it here.
      const orcaSave = await putProject(carol, 'orca-made', { name: 'Made in OrcaSlicer', engine: 'orca' }, bytes);
      assert.equal(orcaSave.status, 200, await orcaSave.clone().text());
      // A project whose file was deleted in Drive says so, and Remove takes it off the list.
      const goneSave = await putProject(carol, 'deleted-in-drive', { name: 'Deleted in Drive' }, bytes);
      driveFiles.delete((await goneSave.json()).project.driveFile);
      await secondPage.getByRole('button', { name: /^Project/ }).click();
      await secondPage.getByRole('menuitem', { name: 'Online projects…' }).click();
      const list2 = secondPage.getByRole('dialog', { name: 'Online projects' });
      const goneCard = list2.locator('.project-card', { hasText: 'Deleted in Drive' });
      await goneCard.getByTestId('project-not-in-drive').waitFor({ timeout: 30000 });
      if (process.env.ACCOUNTS_SHOTS) await secondPage.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-not-in-drive.png') });
      await goneCard.getByRole('button', { name: 'Remove…' }).click();
      const goneAsk = secondPage.getByTestId('project-gone');
      await goneAsk.getByText('is no longer in your Google Drive').waitFor();
      if (process.env.ACCOUNTS_SHOTS) await secondPage.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-gone-dialog.png') });
      await goneAsk.getByRole('button', { name: 'Remove' }).click();
      await goneCard.waitFor({ state: 'detached', timeout: 30000 });
      assert.equal((await carol.json('/api/projects/deleted-in-drive')).status, 404, 'removed from the list');
      await list2.getByRole('button', { name: 'Made in OrcaSlicer', exact: true }).click();
      const leave = secondPage.getByTestId('ask-dialog');
      if (await leave.isVisible().catch(() => false)) await leave.getByRole('button', { name: /Don.t save|Discard/ }).click();
      await secondPage.getByText('OrcaSlicer 2.4').first().waitFor({ timeout: 120000 });
      await secondPage.locator('.project-busy').waitFor({ state: 'detached', timeout: 120000 });
      assert.equal(await pickerOf(secondPage, 'Slicer engine').inputValue(), 'orca', 'the saved project opened in the engine it was made with');
      await second.close();
      await carol.fetch(`${HOST}/api/projects/orca-made`, { method: 'DELETE', headers: { Origin: HOST } });

      await projectButton.click();
      await page.getByRole('menuitem', { name: 'Online projects…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Online projects' });
      await dialog.getByText('3DBenchy', { exact: true }).waitFor();
      await dialog.locator('img').first().waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'projects-list.png') });
      await dialog.getByRole('button', { name: 'Open 3DBenchy', exact: true }).click();
      await page.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      // After a reload the engine's settings can still be arriving when the model shows.
      await waitFor(async () => (await layer.inputValue()) === '0.28', 'the saved setting came back', 30000);
      await projectButton.getByText('3DBenchy').waitFor();
      // The settings show before opening finishes (mixes are read after them), so wait for it.
      await projectButton.getByLabel('unsaved changes').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
      assert.equal(await projectButton.getByLabel('unsaved changes').count(), 0, 'clean after opening');

      await projectButton.click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download 3MF' }).click()]);
      assert.equal(download.suggestedFilename(), '3DBenchy.3mf');

      // Save a copy offers "3DBenchy (copy)"; a name another project has gets a number instead of a twin.
      await projectButton.click();
      await page.getByRole('menuitem', { name: 'Save a copy…' }).click();
      const copying = page.getByRole('dialog', { name: 'Save a copy' });
      assert.equal(await copying.getByLabel('Project name').inputValue(), '3DBenchy (copy)');
      await copying.getByLabel('Project name').fill('3DBenchy');
      await copying.getByRole('button', { name: 'Save' }).click();
      const copied = page.getByText('Saved “3DBenchy (2)” to your projects');
      await copied.waitFor({ timeout: 60000 });
      const names = (await (await carol.json('/api/projects')).json()).projects.map((p) => p.name);
      assert.equal(names.filter((n) => n === '3DBenchy').length, 1, `one 3DBenchy: ${names.join(', ')}`);
      assert.ok(names.includes('3DBenchy (2)'), `the copy is 3DBenchy (2): ${names.join(', ')}`);
      // The "Saved" note goes away by itself.
      await copied.waitFor({ state: 'detached', timeout: 15000 });

      // Online projects: search, sort, the List view, and Rename and Delete in their own windows.
      await projectButton.click();
      await page.getByRole('menuitem', { name: 'Online projects…' }).click();
      await dialog.getByRole('button', { name: '3DBenchy (2)', exact: true }).waitFor();
      await dialog.getByLabel('Search projects').fill('benchy (2');
      await waitFor(async () => (await dialog.locator('.project-card').count()) === 1, 'search leaves only the copy', 10000);
      await dialog.getByLabel('Search projects').fill('no such project');
      await dialog.getByText('No projects match “no such project”.').waitFor();
      await dialog.getByLabel('Search projects').fill('');
      await pick(dialog, 'Sort', 'name');
      const byName = await dialog.locator('.project-card-name').allTextContents();
      assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })), `Name A–Z: ${byName.join(', ')}`);
      await dialog.getByRole('radio', { name: 'List' }).click();
      await dialog.locator('.project-row').first().waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'projects-list-rows.png') });
      await dialog.getByRole('button', { name: 'More for 3DBenchy (2)' }).click();
      await page.getByRole('menuitem', { name: 'Rename…' }).click();
      const renameWin = page.getByTestId('rename-project');
      await renameWin.getByLabel('Project name').fill('Benchy renamed');
      await renameWin.getByRole('button', { name: 'Rename' }).click();
      await renameWin.waitFor({ state: 'detached', timeout: 30000 });
      await dialog.getByRole('button', { name: 'Benchy renamed', exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'More for Benchy renamed' }).click();
      await page.getByRole('menuitem', { name: 'Delete…' }).click();
      const deleteWin = page.getByTestId('delete-project');
      // The copy is the open project: it stays open, unsaved.
      await deleteWin.getByText('it stays open here as an unsaved project').waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'projects-delete.png') });
      await deleteWin.getByRole('button', { name: 'Delete' }).click();
      await deleteWin.waitFor({ state: 'detached', timeout: 30000 });
      await dialog.getByRole('button', { name: 'Benchy renamed', exact: true }).waitFor({ state: 'detached' });
      const left = (await (await carol.json('/api/projects')).json()).projects.map((p) => p.name);
      assert.ok(!left.includes('Benchy renamed'), `deleted on the server: ${left.join(', ')}`);
      await dialog.getByRole('radio', { name: 'Cards' }).click();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });

      await page.setViewportSize({ width: 390, height: 800 });
      await projectButton.click();
      await page.getByRole('menuitem', { name: 'Online projects…' }).click();
      await dialog.getByText('3DBenchy', { exact: true }).waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'projects-list-phone.png') });
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: without Google Drive, Online projects is grayed out and Connect is in the account menu', async () => {
    users.jill = { sub: 'g-jill', name: 'Jill', email: 'jill@example.com', email_verified: true };
    const jill = new Browser();
    declineDrive = true;
    await signIn(jill, 'jill');
    declineDrive = false;
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addCookies([...jill.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const page = await context.newPage();
      await page.goto(HOST);
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
      const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
      if (await wizard.waitFor({ timeout: 5000 }).then(() => true, () => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
      // Signed in as far as the page knows before the menu is looked at.
      await page.getByRole('button', { name: /Jill/ }).waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: /^Project/ }).click();
      assert.equal(await page.getByRole('menuitem', { name: 'Online projects…' }).isDisabled(), true);
      await page.getByTestId('online-projects-off').getByText('Connect Google Drive in the account menu').waitFor();
      await page.waitForTimeout(400);
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'online-projects-no-drive-phone.png') });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /Jill/ }).click();
      await page.getByRole('button', { name: 'Connect Google Drive' }).waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'account-menu-no-drive-phone.png') });
    } finally {
      await browser.close();
    }
  });

/**
 * Google's file window, as public/drive-picker.html loads it from apis.google.com: a stand-in that checks what the page
 * hands Google and "picks" `docs` at once (or cancels when `docs` is null).
 */
function fakePicker(docs) {
  return `
    window.gapi = { load: (name, cb) => cb() };
    class Chain { constructor() { const p = new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => p) }); return p; } }
    class PickerBuilder extends Chain {
      setOAuthToken(t) { this.token = t; return this; }
      setDeveloperKey(k) { this.key = k; return this; }
      setAppId(a) { this.appId = a; return this; }
      setCallback(cb) { this.cb = cb; return this; }
      build() {
        const b = this;
        return { setVisible() {
          window.__picker = { token: b.token, key: b.key, appId: b.appId };
          const docs = ${JSON.stringify(docs)};
          setTimeout(() => b.cb(docs ? { action: 'picked', docs } : { action: 'cancel' }), 50);
        } };
      }
    }
    window.google = { picker: { PickerBuilder, DocsView: Chain, ViewId: {}, Feature: {}, Action: { PICKED: 'picked', CANCEL: 'cancel' } } };
  `;
}

if (withApp)
  test('browser: Open from Google Drive opens picked files, and the first Save keeps a copy in the Cloud Slicer folder', async () => {
    users.pia = { sub: 'g-pia', name: 'Pia', email: 'pia@example.com', email_verified: true };
    const pia = new Browser();
    await signIn(pia, 'pia');
    const me = await pia.me();
    assert.equal(me.drive, true);
    assert.equal(me.drivePicker, true, 'the site has the key for Google\'s file window');
    const token = await (await pia.json('/api/drive/token', 'POST')).json();
    assert.deepEqual(token.picker, { key: 'picker-key', appId: '123456789012' }, 'the app id is the project number from the client id');
    // Their own file, somewhere in their Drive (not in the Cloud Slicer folder).
    const stl = readFileSync(join(web, '../../fixtures/tetrahedron.stl'));
    driveFiles.set('their-stl', { name: 'tetrahedron.stl', parents: ['their-folder'], bytes: stl });
    let docs = [{ id: 'their-stl', name: 'tetrahedron.stl', mimeType: 'application/octet-stream', sizeBytes: String(stl.length) }];
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addCookies([...pia.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      await context.route('https://apis.google.com/js/api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fakePicker(docs) }));
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
      await page.goto(HOST);
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
      const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
      if (await wizard.waitFor({ timeout: 5000 }).then(() => true, () => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
      await page.getByRole('button', { name: /Pia/ }).waitFor({ timeout: 30000 });

      // The empty plate's button opens Google's window in a window of its own, without the app's isolation.
      const fromPlate = page.getByTestId('empty-open-from-drive');
      await waitFor(async () => !(await fromPlate.isDisabled()), 'Open from Google Drive is ready');
      assert.equal(await page.getByTestId('empty-drive-note').count(), 0, 'no note when it works');
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'empty-plate-desktop.png') });
      // Listen before the click: the stand-in picks at once, so the window can be gone before a later listener.
      const [popup, popupResponse] = await Promise.all([
        context.waitForEvent('page'),
        context.waitForEvent('response', (r) => new URL(r.url()).pathname === '/drive-picker'),
        fromPlate.click(),
      ]);
      assert.equal(popupResponse.headers()['cross-origin-embedder-policy'], undefined, 'the picker page is not isolated');
      if (!popup.isClosed()) await popup.waitForEvent('close', { timeout: 30000 });

      // It opens like a file from the device, and says that Save keeps a copy.
      await page.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      const note = page.getByTestId('project-message');
      await note.getByText('Opened “tetrahedron.stl” from your Google Drive. Save keeps a copy in your Cloud Slicer folder. The file in Drive stays as it is.').waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'opened-note-desktop.png') });

      // The first Save says plainly it makes a copy, and names their file.
      await page.keyboard.press('Control+s');
      const naming = page.getByRole('dialog', { name: 'Save a copy to Cloud Slicer' });
      await naming.getByTestId('save-as-note').getByText('tetrahedron.stl').waitFor();
      await page.waitForTimeout(400);
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'save-copy-desktop.png') });
      await naming.getByRole('button', { name: 'Save copy' }).click();
      await page.getByText('Saved “tetrahedron” to your projects').waitFor({ timeout: 60000 });
      const saved = (await (await pia.json('/api/projects')).json()).projects.find((p) => p.name === 'tetrahedron');
      assert.ok(saved, 'saved as a project');
      const top = [...driveFiles].find(([, f]) => f.folder && f.name === 'Cloud Slicer')?.[0];
      assert.deepEqual(driveFiles.get(saved.driveFile).parents, [top], 'the copy is in the Cloud Slicer folder');
      assert.notEqual(saved.driveFile, 'their-stl');
      assert.ok(driveFiles.get('their-stl').bytes.equals(stl), 'their file in Drive is not changed');
      // After the first save, the Save window is the plain one again.
      await page.getByRole('button', { name: /^Project/ }).click();
      const row = page.getByRole('menuitem', { name: 'Open from Google Drive…' });
      assert.equal(await row.isDisabled(), false);
      await page.waitForTimeout(400);
      if (process.env.ACCOUNTS_SHOTS) {
        await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-menu-desktop.png') });
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('button', { name: /^Project/ }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-menu-phone.png') });
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1280, height: 860 });
        await page.getByRole('button', { name: /^Project/ }).click();
      }

      // A file the slicer can't open is named and left out.
      docs = [{ id: 'their-pdf', name: 'notes.pdf', mimeType: 'application/pdf', sizeBytes: '10' }];
      const [popup2] = await Promise.all([context.waitForEvent('page'), row.click()]);
      if (!popup2.isClosed()) await popup2.waitForEvent('close', { timeout: 30000 });
      await note.getByText('Cloud Slicer can’t open “notes.pdf”.').or(note.getByText("Cloud Slicer can't open “notes.pdf”.")).waitFor();

      // Closing Google's window without picking leaves everything as it was.
      docs = null;
      await page.getByRole('button', { name: /^Project/ }).click();
      const [popup3] = await Promise.all([context.waitForEvent('page'), page.getByRole('menuitem', { name: 'Open from Google Drive…' }).click()]);
      if (!popup3.isClosed()) await popup3.waitForEvent('close', { timeout: 30000 });
      assert.equal(await page.getByRole('button', { name: /^Project/ }).getByText('tetrahedron').count(), 1, 'the open project stays');
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: Open from Google Drive on a phone, and grayed out without Drive', async () => {
    users.mona = { sub: 'g-mona', name: 'Mona', email: 'mona@example.com', email_verified: true };
    const mona = new Browser();
    declineDrive = true;
    await signIn(mona, 'mona');
    declineDrive = false;
    const browser = await launchBrowser();
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addCookies([...mona.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const page = await context.newPage();
      await page.goto(HOST);
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
      const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
      if (await wizard.waitFor({ timeout: 5000 }).then(() => true, () => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
      await page.getByRole('button', { name: /Mona/ }).waitFor({ timeout: 30000 });
      assert.equal(await page.getByTestId('empty-open-from-drive').isDisabled(), true);
      await page.getByTestId('empty-drive-note').getByText('Connect Google Drive in the account menu first.').waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'empty-plate-no-drive-phone.png') });
      await page.getByRole('button', { name: /^Project/ }).click();
      assert.equal(await page.getByRole('menuitem', { name: 'Open from Google Drive…' }).isDisabled(), true);
      await page.getByTestId('online-projects-off').getByText('Connect Google Drive in the account menu to open files from it').waitFor();
      await page.waitForTimeout(400);
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-menu-no-drive-phone.png') });
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: AutoSave keeps unsaved work in this browser, never in Drive, and a reload offers it back', async () => {
    users.lena = { sub: 'g-lena', name: 'Lena', email: 'lena@example.com', email_verified: true };
    const browser = await launchBrowser();
    try {
      const kim = new Browser();
      await signIn(kim, 'lena');
      await kim.json('/api/settings/setup', 'PUT', { value: { printers: ['Snapmaker U1 (0.4 nozzle)'] } });
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addCookies([...kim.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
      await page.addLocatorHandler(page.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Not now' }).click());
      await page.goto(HOST);
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });
      await page.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/3DBenchy.stl'));
      await page.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      // Kept in this browser a few seconds later, without a question, and nothing in Drive.
      await waitFor(
        () => page.evaluate(() => new Promise((ok) => {
          const open = indexedDB.open('cloud-slicer-unsaved');
          open.onsuccess = () => {
            const get = open.result.transaction('work').objectStore('work').get('unsaved');
            get.onsuccess = () => ok(Boolean(get.result));
            get.onerror = () => ok(false);
          };
          open.onerror = () => ok(false);
        })),
        'the unsaved work is kept in this browser',
        60000,
      );
      { const l = (await (await kim.json('/api/projects')).json()).projects; assert.equal(l.length, 0, 'nothing went to Drive: ' + JSON.stringify(l)); }
      await page.getByRole('button', { name: /^Project/ }).getByText('Saved in this browser').waitFor({ timeout: 30000 });
      assert.equal(await page.getByTestId('autosave-question').count(), 0, 'nothing is asked');
      await page.getByRole('button', { name: /^Project/ }).click();
      await page.getByTestId('autosave-note').getByText('AutoSave keeps your changes in this browser as you work. They go to your Google Drive when you Save.').waitFor();
      assert.equal(await page.getByRole('menuitemcheckbox', { name: /AutoSave/ }).count(), 0, 'no AutoSave switch');
      if (process.env.ACCOUNTS_SHOTS) {
        await page.waitForTimeout(400); // the menu fades in
        await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-menu-autosave.png') });
      }
      await page.keyboard.press('Escape');

      // A reload (or a crash) offers it back, still unsaved.
      await page.reload();
      const card = page.getByTestId('continue-card');
      await card.getByText('Continue where you left off?').waitFor({ timeout: 120000 });
      await card.getByText(/3DBenchy, changed .*Kept in this browser, not saved\./).waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'continue-local.png') });
      // A 3MF made for a printer this account doesn't have asks to convert, as any opened project does.
      const convert = page.getByRole('dialog', { name: 'Convert this project?' });
      await card.getByRole('button', { name: 'Continue' }).click();
      const projectButton = page.getByRole('button', { name: /^Project/ });
      await Promise.race([
        convert.waitFor({ timeout: 60000 }).then(() => convert.getByRole('button', { name: 'Convert' }).click()),
        projectButton.getByLabel('unsaved changes').waitFor({ timeout: 60000 }),
      ]);
      await projectButton.getByText('3DBenchy').waitFor({ timeout: 60000 });
      await projectButton.getByLabel('unsaved changes').waitFor();
      await page.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      await projectButton.getByText('Saved in this browser').waitFor();
      assert.equal((await (await kim.json('/api/projects')).json()).projects.length, 0, 'still nothing in Drive');
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: the setup wizard waits until the Continue card is answered', async () => {
    const browser = await launchBrowser();
    try {
      // Someone new (no printers set up yet) with a project just saved on another device.
      const gina = new Browser();
      await signIn(gina, 'gina');
      const bytes = readFileSync(join(web, '../../fixtures/colored_3DBenchy.3mf'));
      const other = await putProject(gina, 'laptop-gina', { name: 'Gina’s boat', device: 'gina-laptop', deviceName: 'Windows computer', engine: 'snapmaker' }, bytes);
      assert.equal(other.status, 200, await other.clone().text());
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addCookies([...gina.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const page = await context.newPage();
      await page.goto(HOST);
      const card = page.getByTestId('continue-card');
      const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
      await card.getByText('Continue Gina’s boat').waitFor({ timeout: 120000 });
      await page.waitForTimeout(3000);
      assert.equal(await wizard.count(), 0, 'the wizard opened over the Continue card');
      await card.getByRole('button', { name: 'Not now' }).click();
      await wizard.waitFor({ timeout: 30000 });
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: a project deleted on another computer stays open here, kept in this browser', async () => {
    const browser = await launchBrowser();
    try {
      const hank = new Browser();
      await signIn(hank, 'hank');
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addCookies([...hank.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const a = await context.newPage();
      a.on('pageerror', (e) => console.error(`page error: ${e.message}`));
      await a.addLocatorHandler(a.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Not now' }).click());
      await a.goto(HOST);
      const changeLayer = async (value) => {
        const layer = a.getByLabel('Layer height', { exact: true });
        await layer.fill(value);
        await layer.press('Enter');
      };

      // Computer A: a saved project, then a change that isn't saved yet.
      await a.getByText('Open a model to start').waitFor({ timeout: 120000 });
      await a.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/3DBenchy.stl'));
      await a.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      const projectButton = a.getByRole('button', { name: /^Project/ });
      await projectButton.getByText('3DBenchy').waitFor({ timeout: 30000 });
      await a.keyboard.press('Control+s');
      await a.getByRole('dialog', { name: 'Save project' }).getByRole('button', { name: 'Save' }).click();
      await a.getByText('Saved “3DBenchy” to your projects').waitFor({ timeout: 60000 });
      const saved = (await (await hank.json('/api/projects')).json()).projects.find((p) => p.name === '3DBenchy');
      await changeLayer('0.28');

      // Taken over on the phone, then deleted there: A's "Edit here instead" used to
      // spin and stay view only. Now A keeps its work, kept in this browser.
      assert.equal((await hank.json(`/api/projects/${saved.id}/device`, 'POST', { device: 'b-device-12345', deviceName: 'phone' })).status, 200);
      await a.evaluate(() => window.dispatchEvent(new Event('focus')));
      const banner = a.getByTestId('view-only-banner');
      await banner.getByText('being edited on your phone').waitFor({ timeout: 15000 });
      await hank.fetch(`${HOST}/api/projects/${saved.id}`, { method: 'DELETE', headers: { Origin: HOST } });
      await banner.getByRole('button', { name: 'Edit here instead' }).click();
      await banner.waitFor({ state: 'detached', timeout: 30000 });
      await a.getByText('“3DBenchy” was deleted on your phone. It’s still open here, not saved.').waitFor({ timeout: 15000 });
      if (process.env.ACCOUNTS_SHOTS) await a.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'deleted-elsewhere.png') });
      assert.equal(await projectButton.getByText('View only').count(), 0, 'still view only');
      assert.equal(await a.getByLabel('Layer height', { exact: true }).inputValue(), '0.28', "A's change is still there");
      await projectButton.getByText('Saved in this browser').waitFor({ timeout: 30000 });
      await changeLayer('0.2');
      assert.equal(await a.getByLabel('Layer height', { exact: true }).inputValue(), '0.2', 'A can edit again');
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: print history marks plates printed, changed since, kept, marked by hand, and caught after Upload only', async () => {
    const { startMockPrinter } = await import('./device/mock-printer.mjs');
    const printer = await startMockPrinter({ printStep: 0.01 });
    const browser = await launchBrowser();
    const shot = (page, name) => process.env.ACCOUNTS_SHOTS && page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, `${name}.png`) });
    try {
      const ivy = new Browser();
      await signIn(ivy, 'ivy');
      assert.equal((await ivy.json('/api/devices/u1-mock', 'PUT', { name: 'U1-mock', preset: 'Snapmaker U1 (0.4 nozzle)', url: printer.url, extra: { kind: 'direct' } })).status, 200);
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addCookies([...ivy.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
      await page.addLocatorHandler(page.getByRole('dialog', { name: 'Set up your printers' }), (d) => d.getByRole('button', { name: 'Not now' }).click());
      await page.goto(HOST);
      await page.getByText('Open a model to start').waitFor({ timeout: 120000 });

      // Two plates: Benchy on plate 1, a tetrahedron on plate 2, saved online.
      await page.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/3DBenchy.stl'));
      await page.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      await page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Add plate' }).click();
      const tabs = page.getByRole('tablist', { name: 'Plates' });
      await tabs.getByRole('tab', { name: /^2/ }).waitFor();
      await tabs.getByRole('tab', { name: /^2/ }).click();
      await page.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/tetrahedron.stl'));
      await tabs.getByRole('tab', { name: /^2.*· 1/ }).waitFor({ timeout: 60000 });
      await page.keyboard.press('Control+s');
      await page.getByRole('dialog', { name: 'Save project' }).getByRole('button', { name: 'Save' }).click();
      await page.getByText(/Saved “.*” to your projects/).waitFor({ timeout: 60000 });
      const projectId = (await (await ivy.json('/api/projects')).json()).projects[0].id;
      const prints = async () => (await (await ivy.json(`/api/projects/${projectId}/prints`)).json()).prints;

      // Plate 1: Upload and print. Blue while it prints, green when the printer says it finished.
      await tabs.getByRole('tab', { name: /^1/ }).click();
      await page.getByRole('button', { name: /^Slice plate/ }).click();
      await page.getByTestId('slice-stats').waitFor({ timeout: 300000 });
      await page.getByRole('button', { name: 'Send to printer' }).click();
      await page.getByRole('dialog').getByTestId('upload-and-print').click();
      await waitFor(async () => (await prints()).some((p) => p.plate === 0 && ['sent', 'printing', 'printed'].includes(p.status)), 'a record for plate 1', 30000);
      // Sending opens the Device tab (it watches the print); back to Prepare for the plate tabs.
      await page.getByRole('tab', { name: 'Device' }).waitFor();
      await page.getByRole('tab', { name: 'Prepare' }).click();
      await tabs.getByTestId('print-mark-sent').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500); // the 3D view drawn again after the tab switch
      await shot(page, 'print-history-printing');
      await tabs.getByTestId('print-mark-printed').waitFor({ timeout: 60000 });
      const first = (await prints()).find((p) => p.plate === 0);
      assert.equal(first.status, 'printed');
      assert.equal(first.printerName, 'U1-mock');
      assert.ok(first.fingerprint && first.summary, 'kept what the plate printed');
      const progress = page.getByTestId('print-progress');
      await progress.filter({ hasText: 'Printed 1 of' }).waitFor();
      await page.getByTestId('print-next').filter({ hasText: 'Next: plate 2' }).waitFor();
      await shot(page, 'print-history-printed');

      // A change to plate 1 shows amber, the window says what changed; Keep as printed makes it green again.
      const layer = page.getByLabel('Layer height', { exact: true });
      await layer.fill('0.28');
      await layer.press('Enter');
      await tabs.getByTestId('print-mark-changed').waitFor({ timeout: 30000 });
      await tabs.getByTestId('print-mark-changed').click();
      const history = page.getByTestId('print-history');
      await history.getByTestId('print-changes').filter({ hasText: 'Layer height' }).waitFor();
      await history.getByTestId('print-list').getByText('U1-mock').waitFor();
      await shot(page, 'print-history-changed');
      await history.getByTestId('print-keep').click();
      await tabs.getByTestId('print-mark-printed').waitFor({ timeout: 30000 });
      await history.getByRole('button', { name: 'Close', exact: true }).click();
      // Back to how it was printed: still green (Keep made 0.28 the printed one, so 0.2 is a change).
      await layer.fill('0.2');
      await layer.press('Enter');
      await tabs.getByTestId('print-mark-changed').waitFor({ timeout: 30000 });
      await layer.fill('0.28');
      await layer.press('Enter');
      await tabs.getByTestId('print-mark-printed').waitFor({ timeout: 30000 });

      // Plate 2 marked by hand from its history: 2 of 2, no Next.
      await page.getByTestId('print-next').click();
      await progress.click();
      await history.getByTestId('print-mark').click();
      await waitFor(async () => (await tabs.getByTestId('print-mark-printed').count()) === 2, 'both plates green');
      await progress.filter({ hasText: 'Printed 2 of' }).waitFor();
      assert.equal(await page.getByTestId('print-next').count(), 0);
      await history.getByTestId('print-unmark').click();
      await waitFor(async () => (await tabs.getByTestId('print-mark-printed').count()) === 1, 'plate 2 not printed again');
      await history.getByRole('button', { name: 'Close', exact: true }).click();

      // Plate 2: Upload only, then started on the Device tab's file list: caught as printed.
      await page.getByRole('button', { name: /^Slice plate/ }).click();
      await page.getByTestId('slice-stats').waitFor({ timeout: 300000 });
      await page.getByRole('button', { name: 'Send to printer' }).click();
      await page.getByRole('dialog').getByTestId('upload-only').click();
      await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 });
      await waitFor(async () => (await prints()).some((p) => p.plate === 1 && p.status === 'uploaded'), 'an uploaded record for plate 2');
      assert.equal(printer.state.print_stats.state, 'complete', 'Upload only started a print');
      const file = (await prints()).find((p) => p.plate === 1 && p.status === 'uploaded').file;
      await page.getByRole('tab', { name: 'Device' }).click();
      await page.getByTestId('files-card').locator('li', { hasText: file.replace(/^.*\//, '') }).getByRole('button', { name: 'Print…' }).click();
      await page.getByRole('dialog').getByTestId('upload-and-print').click();
      await waitFor(async () => (await prints()).some((p) => p.plate === 1 && p.status === 'printed'), 'the print started on the printer counts', 60000);
      await page.getByRole('tab', { name: 'Prepare' }).click();
      await progress.filter({ hasText: 'Printed 2 of' }).waitFor({ timeout: 30000 });
      await shot(page, 'print-history-all-printed');

      // Saved again, the projects list says how many plates were printed.
      await page.keyboard.press('Control+s');
      await page.getByText(/Saved “.*” to your projects/).waitFor({ timeout: 60000 });
      await progress.filter({ hasText: 'Printed 2 of' }).waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: /^Project/ }).click();
      await page.getByRole('menuitem', { name: 'Online projects…' }).click();
      const projects = page.getByRole('dialog', { name: 'Online projects' });
      await projects.getByTestId('project-printed').filter({ hasText: '2/2 printed' }).waitFor({ timeout: 30000 });
      await shot(page, 'print-history-projects');
      await page.keyboard.press('Escape');
      await projects.waitFor({ state: 'detached' });

      // Phone width: the top bar and the window fit.
      // The project name shortens instead of running under the mark (it used to overlap it).
      for (const width of [360, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await progress.waitFor();
        const name = await page.locator('.topbar .project-button').boundingBox();
        const mark = await progress.boundingBox();
        assert.ok(name.x + name.width <= mark.x + 0.5, `at ${width} px the project name ends at ${name.x + name.width}, under the print mark at ${mark.x}`);
      }
      await shot(page, 'print-history-phone');
      await progress.click();
      await history.waitFor();
      await shot(page, 'print-history-phone-window');
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(wide, false, 'the page scrolls sideways on a phone');
    } finally {
      await browser.close();
      await printer.close?.();
    }
  });

let failed = 0;
try {
  await waitForServer();
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (e) {
      failed++;
      console.error(`not ok - ${name}\n${e.stack}`);
    }
  }
} catch (e) {
  failed++;
  console.error(e.message);
} finally {
  mock.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  rmSync(state, { recursive: true, force: true });
}
if (failed) console.error(`\n${failed} failed\n--- wrangler log ---\n${log.slice(-4000)}`);
else console.log(`\nACCOUNTS OK (${tests.length} tests)`);
process.exit(failed ? 1 : 0);
