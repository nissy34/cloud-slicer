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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const codes = new Map(); // code -> { user, challenge }
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// Unsigned id_token: the site reads the profile from the token Google returned
// straight to it over TLS, without checking a signature (as Google documents).
const idToken = (claims) => `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(claims))}.`;

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, MOCK);
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (url.pathname === '/google/authorize') {
    const q = url.searchParams;
    assert.equal(q.get('client_id'), 'google-id');
    assert.equal(q.get('code_challenge_method'), 'S256');
    const code = `code-${codes.size + 1}-${Math.random()}`;
    codes.set(code, { user: users[nextUser], challenge: q.get('code_challenge') });
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
      scope: 'openid email profile',
      id_token: idToken({ iss: 'https://accounts.google.com', aud: 'google-id', iat: now, exp: now + 3600, ...c.user }),
    });
  }
  send(404, {});
});
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
  GOOGLE_CLIENT_ID: 'google-id',
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
  // A tiny zip-looking file stands in for the 3MF; the server only checks the signature.
  const file = (text) => new Blob([Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from(text)])]);
  const save = (b, id, name, body, baseVersion) =>
    b.fetch(`${HOST}/api/projects/${id}?${new URLSearchParams({ name, ...(baseVersion !== undefined ? { baseVersion: String(baseVersion) } : {}) })}`, {
      method: 'PUT',
      headers: { Origin: HOST, 'Content-Type': 'model/3mf' },
      body,
    });
  assert.equal((await new Browser().json('/api/projects')).status, 401, 'signed out');
  assert.equal(
    (await alice.fetch(`${HOST}/api/projects/p1?name=x`, { method: 'PUT', headers: { 'Content-Type': 'model/3mf' }, body: file('a') })).status,
    403,
    'writes need the page origin',
  );
  assert.equal((await save(alice, 'p1', 'Benchy', new Blob(['not a zip']), 0)).status, 400, 'only 3MF (zip) files');

  const created = await save(alice, 'p1', 'Benchy', file('version one'), 0);
  assert.equal(created.status, 200, await created.clone().text());
  const p1 = (await created.json()).project;
  assert.deepEqual([p1.name, p1.version, p1.hasThumbnail], ['Benchy', 1, false]);
  const got = await alice.fetch(`${HOST}/api/projects/p1/file`);
  assert.equal(got.headers.get('X-Project-Version'), '1');
  assert.match(Buffer.from(await got.arrayBuffer()).toString(), /version one$/);

  // Both devices opened version 1; the phone saves first.
  const phone = new Browser();
  await signIn(phone, 'alice');
  assert.equal((await save(phone, 'p1', 'Benchy', file('from the phone'), 1)).status, 200);
  const stale = await save(alice, 'p1', 'Benchy', file('from the laptop'), 1);
  assert.equal(stale.status, 409, 'a save based on an old version is refused');
  assert.equal((await stale.json()).current.version, 2);
  assert.match(Buffer.from(await (await alice.fetch(`${HOST}/api/projects/p1/file`)).arrayBuffer()).toString(), /from the phone$/, 'the newer save is kept');
  assert.equal((await save(alice, 'p1', 'Benchy', file('overwrite'), undefined)).status, 200, 'overwrite without baseVersion');
  assert.equal((await save(alice, 'p1', 'Benchy', file('x'), 0)).status, 409, 'baseVersion 0 never replaces a project');

  // Thumbnail: PNG only, replaced on the next upload.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const thumb = (body) => alice.fetch(`${HOST}/api/projects/p1/thumbnail`, { method: 'PUT', headers: { Origin: HOST, 'Content-Type': 'image/png' }, body });
  assert.equal((await thumb(Buffer.from('GIF89a'))).status, 400);
  assert.equal((await thumb(png)).status, 200);
  const shown = await alice.fetch(`${HOST}/api/projects/p1/thumbnail`);
  assert.equal(shown.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await shown.arrayBuffer()), png);

  await save(alice, 'p2', 'Cube', file('cube'), 0);
  const renamed = await alice.json('/api/projects/p1', 'PATCH', { name: 'Benchy v2' });
  assert.equal((await renamed.json()).project.name, 'Benchy v2');
  const list = await (await alice.json('/api/projects')).json();
  assert.equal(list.enabled, true);
  assert.deepEqual(list.projects.map((p) => [p.name, p.hasThumbnail]), [['Benchy v2', true], ['Cube', false]], 'newest first');
  assert.equal(list.usage.count, 2);
  assert.ok(list.usage.bytes > 0 && list.limits.userBytes > list.usage.bytes);

  const bob = new Browser();
  await signIn(bob, 'bob');
  assert.equal((await (await bob.json('/api/projects')).json()).projects.length, 0, "users don't see each other's projects");
  assert.equal((await bob.fetch(`${HOST}/api/projects/p1/file`)).status, 404);

  assert.equal((await alice.json('/api/projects/p2', 'DELETE')).status, 200);
  assert.deepEqual((await (await alice.json('/api/projects')).json()).projects.map((p) => p.id), ['p1']);
  assert.equal((await alice.fetch(`${HOST}/api/projects/p2/file`)).status, 404);
  assert.equal((await alice.json('/api/projects/bad%20id', 'DELETE')).status, 400);
});

test('projects: a draft per device, the device editing a project, taking it over (AutoSave)', async () => {
  const file = (text) => new Blob([Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from(text)])]);
  const save = (b, id, name, body, baseVersion, extra = {}) =>
    b.fetch(`${HOST}/api/projects/${id}?${new URLSearchParams({ name, ...(baseVersion !== undefined ? { baseVersion: String(baseVersion) } : {}), ...extra })}`, {
      method: 'PUT',
      headers: { Origin: HOST, 'Content-Type': 'model/3mf' },
      body,
    });
  const laptop = { device: 'laptop-device-1', deviceName: 'Windows computer' };
  const phoneDevice = { device: 'phone-device-1', deviceName: 'phone' };
  const before = (await (await alice.json('/api/projects')).json()).usage.count;

  // A draft: listed with draft: true, not counted as a project; a second draft replaces the first.
  const d1 = await save(alice, 'd1', 'Benchy', file('draft one'), 0, { draft: '1', ...laptop });
  assert.equal(d1.status, 200, await d1.clone().text());
  assert.deepEqual(
    (({ draft, device, deviceName }) => ({ draft, device, deviceName }))((await d1.json()).project),
    { draft: true, device: laptop.device, deviceName: 'Windows computer' },
  );
  let list = await (await alice.json('/api/projects')).json();
  assert.equal(list.usage.count, before, "the draft isn't counted as a project");
  assert.ok(list.projects.find((p) => p.id === 'd1')?.draft);
  assert.equal((await save(alice, 'd2', 'Cube', file('draft two'), 0, { draft: '1', ...laptop })).status, 200);
  list = await (await alice.json('/api/projects')).json();
  assert.deepEqual(list.projects.filter((p) => p.draft).map((p) => p.id), ['d2'], 'one draft per device');
  assert.equal((await alice.fetch(`${HOST}/api/projects/d1/file`)).status, 404, "the old draft's file is gone");
  // Each device keeps its own draft: the phone's doesn't replace the laptop's
  // (discarding one on a device never takes another device's work with it).
  assert.equal((await save(alice, 'dp', 'Clip', file('phone draft'), 0, { draft: '1', ...phoneDevice })).status, 200);
  list = await (await alice.json('/api/projects')).json();
  assert.deepEqual(list.projects.filter((p) => p.draft).map((p) => p.id).sort(), ['d2', 'dp'], "the phone's draft sits beside the laptop's");
  // At most three drafts a person: the oldest go first.
  for (const n of [1, 2, 3]) {
    assert.equal((await save(alice, `dx${n}`, 'Extra', file(`extra ${n}`), 0, { draft: '1', device: `extra-device-${n}`, deviceName: 'Mac' })).status, 200);
  }
  list = await (await alice.json('/api/projects')).json();
  assert.deepEqual(list.projects.filter((p) => p.draft).map((p) => p.id).sort(), ['dx1', 'dx2', 'dx3'], 'only the newest three drafts are kept');
  for (const id of ['dx1', 'dx2', 'dx3']) await alice.fetch(`${HOST}/api/projects/${id}`, { method: 'DELETE', headers: { Origin: HOST } });
  assert.equal((await save(alice, 'd2', 'Cube', file('draft two again'), undefined, { draft: '1', ...laptop })).status, 200, 'the laptop saves its draft again');

  // The first Save names it: same id, no longer a draft, now counted.
  const named = await save(alice, 'd2', 'My cube', file('named'), 1, laptop);
  assert.equal(named.status, 200, await named.clone().text());
  assert.equal((await named.json()).project.draft, false);
  assert.equal((await (await alice.json('/api/projects')).json()).usage.count, before + 1);
  assert.equal((await save(alice, 'd2', 'My cube', file('again a draft'), 2, { draft: '1', ...laptop })).status, 400, 'a saved project never becomes a draft');

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
  const file = new Blob([Buffer.from('PK\x03\x04 plates')]);
  const save = (id, plates) =>
    ivy.fetch(`${HOST}/api/projects/${id}?${new URLSearchParams({ name: id, plates: String(plates) })}`, { method: 'PUT', headers: { Origin: HOST, 'Content-Type': 'model/3mf' }, body: file });
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
  const file = new Blob([Buffer.from('PK\x03\x04 plates')]);
  const saved = await kim.fetch(`${HOST}/api/projects/kp?${new URLSearchParams({ name: 'kp', plates: '3' })}`, { method: 'PUT', headers: { Origin: HOST, 'Content-Type': 'model/3mf' }, body: file });
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
  assert.deepEqual(data.settings, { inviteOnly: false, storageMb: 200 });
  const emails = data.users.map((u) => u.email);
  assert.ok(emails.includes('alice@example.com') && emails.includes('bob@example.com'), emails.join());
  const a = data.users.find((u) => u.email === 'alice@example.com');
  assert.equal(a.owner, true);
  assert.ok(a.projects >= 1 && a.bytes > 0 && a.presets >= 1, JSON.stringify(a));
  assert.ok(a.createdAt > Date.now() - 3600_000 && a.lastSeen > Date.now() - 3600_000, `dates: ${a.createdAt} ${a.lastSeen}`);
  assert.equal(data.usage.analytics, 'not-set-up');
  assert.ok(data.usage.meters.find((m) => m.key === 'projects').used > 0);
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

test('block: signed out everywhere and refused; unblock lets them back', async () => {
  const bob = new Browser();
  await signIn(bob, 'bob');
  const bob2 = new Browser();
  await signIn(bob2, 'bob');
  const bobId = (await bob.me()).id;
  assert.equal((await alice.json(`/api/admin/users/${(await alice.me()).id}/block`, 'POST', {})).status, 400, "the owner can't be blocked");
  assert.equal((await alice.json(`/api/admin/users/${bobId}/block`, 'POST', {})).status, 200);
  assert.equal(await bob.me(), null);
  assert.equal(await bob2.me(), null);
  assert.equal((await bob.json('/api/presets')).status, 401);
  assert.match(await popupResult(bob, 'bob'), /blocked/);
  const row = (await (await alice.json('/api/admin')).json()).users.find((u) => u.id === bobId);
  assert.equal(row.blocked, true);
  assert.equal((await alice.json(`/api/admin/users/${bobId}/unblock`, 'POST', {})).status, 200);
  assert.equal(await popupResult(bob, 'bob'), null);
});

test('storage per user: presets only refuses online projects, presets still save', async () => {
  const bob = new Browser();
  await signIn(bob, 'bob');
  const bobId = (await bob.me()).id;
  assert.equal((await alice.json(`/api/admin/users/${bobId}/storage`, 'PUT', { storageMb: 0 })).status, 200);
  const list = await (await bob.json('/api/projects')).json();
  assert.equal(list.limits.userBytes, 0);
  const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]);
  const put = await bob.fetch(`${HOST}/api/projects/p1?name=x&baseVersion=0`, { method: 'PUT', headers: { Origin: HOST, 'Content-Type': 'model/3mf' }, body: zip });
  assert.equal(put.status, 403);
  assert.equal((await put.json()).code, 'presets-only');
  assert.equal((await bob.json('/api/presets/process/Mine', 'PUT', { inherits: 'x', config: {} })).status, 200);
  // A site default, then back to it.
  assert.equal((await alice.json('/api/admin/settings', 'PUT', { storageMb: 50 })).status, 200);
  assert.equal((await alice.json(`/api/admin/users/${bobId}/storage`, 'PUT', { storageMb: null })).status, 200);
  const fifty = (await (await bob.json('/api/projects')).json()).limits;
  assert.equal(fifty.userBytes, 50 * 1024 * 1024);
  assert.equal(fifty.projectBytes, 50 * 1024 * 1024, 'a project can be as big as the storage');
  // More storage for one person: one project may then be bigger than 50 MB, up to what an upload carries.
  assert.equal((await alice.json(`/api/admin/users/${bobId}/storage`, 'PUT', { storageMb: 200 })).status, 200);
  const more = (await (await bob.json('/api/projects')).json()).limits;
  assert.equal(more.userBytes, 200 * 1024 * 1024);
  assert.equal(more.projectBytes, 95 * 1024 * 1024);
  const big = new Uint8Array(60 * 1024 * 1024);
  big.set([0x50, 0x4b, 3, 4]);
  const bigPut = await bob.fetch(`${HOST}/api/projects/big?name=big&baseVersion=0`, { method: 'PUT', headers: { Origin: HOST, 'Content-Type': 'model/3mf' }, body: big });
  assert.equal(bigPut.status, 200, await bigPut.clone().text());
  assert.equal((await bigPut.json()).project.size, big.byteLength);
  const notZip = await bob.fetch(`${HOST}/api/projects/nz?name=nz&baseVersion=0`, { method: 'PUT', headers: { Origin: HOST, 'Content-Type': 'model/3mf' }, body: new Uint8Array(10) });
  assert.equal(notZip.status, 400);
  assert.equal((await bob.json('/api/projects/big', 'DELETE')).status, 200);
  assert.equal((await alice.json(`/api/admin/users/${bobId}/storage`, 'PUT', { storageMb: null })).status, 200);
  assert.equal((await alice.json(`/api/admin/users/${bobId}/storage`, 'PUT', { storageMb: 99999 })).status, 400);
  await alice.json('/api/admin/settings', 'PUT', { storageMb: 200 });
});

test('relay tickets: signed-in accounts only, for one bridge, with a bridge cap', async () => {
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
  for (const id of ['bridge-0002', 'bridge-0003', 'bridge-0001']) assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: id })).status, 200);
  const fourth = await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0004' });
  assert.equal(fourth.status, 403);
  assert.equal((await fourth.json()).code, 'bridge-limit');
  assert.equal((await carol.json('/api/relay/bridges/bridge-0002', 'DELETE')).status, 200);
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0004' })).status, 200, 'a removed bridge frees a place');
  assert.equal((await carol.json('/api/relay/ticket', 'POST', { relay: 'http://evil.example', bridgeId: 'bridge-0005' })).status, 400);
  const row = (await (await alice.json('/api/admin')).json()).users.find((u) => u.email === 'carol@example.com');
  assert.equal(row.bridges, 3);
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
  // One person: no bridges at all, then allowed again; storage settings are kept.
  await alice.json(`/api/admin/users/${carolId}/storage`, 'PUT', { storageMb: 100 });
  assert.equal((await alice.json(`/api/admin/users/${carolId}/bridges`, 'PUT', { allowed: false })).status, 200);
  const none = await carol.json('/api/relay/ticket', 'POST', { relay, bridgeId: 'bridge-0003' });
  assert.equal(none.status, 403);
  assert.equal((await none.json()).code, 'no-bridges');
  const row = (await (await alice.json('/api/admin')).json()).users.find((u) => u.id === carolId);
  assert.equal(row.bridgesAllowed, false);
  assert.equal(row.storageMb, 100);
  await alice.json(`/api/admin/users/${carolId}/storage`, 'PUT', { storageMb: null });
  assert.equal((await alice.json(`/api/admin/users/${carolId}/bridges`, 'PUT', { allowed: true })).status, 200);
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

  // An hour later the code is no good.
  const late = await (await frank.json('/api/relay/setup', 'POST', { relay })).json();
  const sql = `UPDATE bridge_setup_codes SET expires_at = 1 WHERE used_at IS NULL`;
  assert.equal(spawnSync(wrangler, ['d1', 'execute', 'cloud-slicer', '--local', '--persist-to', state, '--command', sql], { cwd: web, encoding: 'utf8' }).status, 0);
  assert.equal((await (await frank.json(`/api/relay/setup/${late.code}`)).json()).state, 'expired');
  assert.equal((await claim({ code: late.code, bridgeId: 'bridge-f002' })).status, 410);

  // Three bridges per account: a fourth code isn't given out.
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

test('delete a person: account, presets, printers, projects and files go', async () => {
  const erin = new Browser();
  users.erin = { sub: 'g-erin', name: 'Erin', email: 'erin@example.com', email_verified: true };
  await signIn(erin, 'erin');
  const erinId = (await erin.me()).id;
  await erin.json('/api/presets/process/Fast', 'PUT', { inherits: 'x', config: {} });
  await erin.json('/api/devices/e1', 'PUT', { name: 'E1', url: 'http://10.0.0.5', apiKey: 'k' });
  const zip = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);
  const put = await erin.fetch(`${HOST}/api/projects/ep?name=x&baseVersion=0`, { method: 'PUT', headers: { Origin: HOST, 'Content-Type': 'model/3mf' }, body: zip });
  assert.equal(put.status, 200, await put.clone().text());
  const before = (await (await alice.json('/api/admin')).json()).usage.meters.find((m) => m.key === 'projects').used;
  assert.equal((await alice.json(`/api/admin/users/${(await alice.me()).id}/delete`, 'POST', {})).status, 400, "the owner can't delete themself here");
  assert.equal((await alice.json(`/api/admin/users/${erinId}/delete`, 'POST', {})).status, 200);
  assert.equal(await erin.me(), null);
  const after = await (await alice.json('/api/admin')).json();
  assert.ok(!after.users.some((u) => u.id === erinId));
  assert.equal(after.usage.meters.find((m) => m.key === 'projects').used, before - zip.length);
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
  test('browser: the owner opens the Admin page from the account menu (desktop and phone)', async () => {
    const owner = new Browser();
    await signIn(owner, 'alice');
    const dave = new Browser();
    await signIn(dave, 'dave');
    await owner.json(`/api/admin/users/${(await dave.me()).id}/block`, 'POST', {});
    await owner.json('/api/admin/invites', 'POST', { email: 'frank@example.com' });
    const browser = await chromium.launch(
      process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
    );
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
    const browser = await chromium.launch(
      process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
    );
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
    const browser = await chromium.launch(
      process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
    );
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

      // AutoSave keeps a new project as the draft, named after its model.
      await projectButton.getByText('Draft, not saved yet').waitFor({ timeout: 30000 });
      await waitFor(async () => (await (await carol.json('/api/projects')).json()).projects.some((p) => p.draft && p.name === '3DBenchy'), 'the draft is saved');
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-draft.png') });

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
      assert.equal(saved.draft, false, 'the draft became the project');
      assert.equal(list.projects.filter((p) => p.draft).length, 0, 'no draft left');

      // AutoSave: a change saves by itself a few seconds later.
      await layer.fill('0.24');
      await layer.press('Enter');
      await waitFor(async () => (await (await carol.json('/api/projects')).json()).projects.find((p) => p.id === saved.id)?.version > saved.version, 'AutoSave saved the change', 60000);
      await projectButton.getByText('Saved', { exact: true }).waitFor({ timeout: 30000 });

      // An AutoSave the server refuses stops AutoSave and says so; a Save that works ends that.
      const refuse = (route) =>
        route.request().method() === 'PUT' && !route.request().url().includes('/thumbnail')
          ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test refusal' }) })
          : route.fallback();
      await page.route('**/api/projects/**', refuse);
      await layer.fill('0.2');
      await layer.press('Enter');
      await projectButton.getByText('Not saved', { exact: true }).waitFor({ timeout: 60000 });
      await page.unroute('**/api/projects/**', refuse);
      await page.keyboard.press('Control+s');
      await page.getByText('Saved “3DBenchy” to your projects').waitFor({ timeout: 60000 });
      await projectButton.getByText('Saved', { exact: true }).waitFor({ timeout: 10000 });
      // ...and AutoSave carries on.
      const now = (await (await carol.json('/api/projects')).json()).projects.find((p) => p.id === saved.id).version;
      await layer.fill('0.24');
      await layer.press('Enter');
      await waitFor(async () => (await (await carol.json('/api/projects')).json()).projects.find((p) => p.id === saved.id)?.version > now, 'AutoSave saved after the error', 60000);
      await projectButton.getByText('Saved', { exact: true }).waitFor({ timeout: 30000 });

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
      await page.keyboard.press('Control+s');
      await page.getByText('Saved “3DBenchy” to your projects').waitFor({ timeout: 60000 });
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'project-saved.png') });

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

      // Continue opens the unsaved project, and the card doesn't come back. This tab
      // starts on the other engine, so opening it restarts the engine, which used to
      // look for the card again while the project was still loading.
      const bytes = await (await carol.fetch(`${HOST}/api/projects/${saved.id}/file`)).arrayBuffer();
      const draftSave = await carol.fetch(`${HOST}/api/projects/draft-continue?${new URLSearchParams({ name: 'Untitled', draft: '1', device: 'laptop-device-9', deviceName: 'Windows computer', engine: 'snapmaker' })}`, {
        method: 'PUT',
        headers: { Origin: HOST, 'Content-Type': 'model/3mf' },
        body: bytes,
      });
      assert.equal(draftSave.status, 200, await draftSave.clone().text());
      const second = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await second.addCookies([...carol.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const secondPage = await second.newPage();
      await secondPage.goto(`${HOST}/?engine=orca`);
      const again = secondPage.getByTestId('continue-card');
      await again.getByText('Continue your unsaved project?').waitFor({ timeout: 120000 });
      await again.getByRole('button', { name: 'Continue' }).click();
      await secondPage.getByText('Snapmaker Orca 2.4').first().waitFor({ timeout: 120000 });
      await secondPage.locator('.project-busy').waitFor({ state: 'detached', timeout: 120000 });
      await secondPage.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      await secondPage.waitForTimeout(3000);
      assert.equal(await again.count(), 0, 'the Continue card shows once');
      // The draft keeps its engine: this tab started on OrcaSlicer and switched back.
      assert.equal(await pickerOf(secondPage, 'Slicer engine').inputValue(), 'snapmaker', 'the draft opened in the engine it was made with');

      // Changing only the engine is a change AutoSave keeps: Continue on a new tab opens it in the new engine.
      const draftBefore = (await (await carol.json('/api/projects/draft-continue')).json()).project;
      await pickerOf(secondPage, 'Slicer engine').selectOption('orca');
      const sw = secondPage.getByRole('dialog').filter({ hasText: /Switch/ });
      if (await sw.getByRole('button', { name: 'Switch' }).isVisible({ timeout: 3000 }).catch(() => false)) await sw.getByRole('button', { name: 'Switch' }).click();
      await waitFor(async () => {
        const d = (await (await carol.json('/api/projects/draft-continue')).json()).project;
        return d.engine === 'orca' && d.version > draftBefore.version;
      }, 'AutoSave saved the engine change', 90000);
      const third = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await third.addCookies([...carol.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const thirdPage = await third.newPage();
      await thirdPage.goto(HOST);
      const card3 = thirdPage.getByTestId('continue-card');
      await card3.getByText('Continue your unsaved project?').waitFor({ timeout: 120000 });
      await card3.getByRole('button', { name: 'Continue' }).click();
      await thirdPage.getByText('OrcaSlicer 2.4').first().waitFor({ timeout: 120000 });
      await thirdPage.locator('.project-busy').waitFor({ state: 'detached', timeout: 120000 });
      assert.equal(await pickerOf(thirdPage, 'Slicer engine').inputValue(), 'orca', 'Continue opened the draft in the engine it was switched to');
      await third.close();
      await carol.fetch(`${HOST}/api/projects/draft-continue`, { method: 'DELETE', headers: { Origin: HOST } });

      // A saved project keeps its engine too: one made in OrcaSlicer opens in it here.
      const orcaSave = await carol.fetch(`${HOST}/api/projects/orca-made?${new URLSearchParams({ name: 'Made in OrcaSlicer', engine: 'orca' })}`, {
        method: 'PUT',
        headers: { Origin: HOST, 'Content-Type': 'model/3mf' },
        body: bytes,
      });
      assert.equal(orcaSave.status, 200, await orcaSave.clone().text());
      await secondPage.getByRole('button', { name: /^Project/ }).click();
      await secondPage.getByRole('menuitem', { name: 'Online projects…' }).click();
      const list2 = secondPage.getByRole('dialog', { name: 'Online projects' });
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
      const names = (await (await carol.json('/api/projects')).json()).projects.filter((p) => !p.draft).map((p) => p.name);
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
  test('browser: the setup wizard waits until the Continue card is answered', async () => {
    const browser = await chromium.launch(
      process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
    );
    try {
      // Someone new (no printers set up yet) with an unsaved project from another device.
      const gina = new Browser();
      await signIn(gina, 'gina');
      const bytes = readFileSync(join(web, '../../fixtures/colored_3DBenchy.3mf'));
      const draft = await gina.fetch(`${HOST}/api/projects/draft-gina?${new URLSearchParams({ name: 'Untitled', draft: '1', device: 'gina-laptop', deviceName: 'Windows computer', engine: 'snapmaker' })}`, {
        method: 'PUT',
        headers: { Origin: HOST, 'Content-Type': 'model/3mf' },
        body: bytes,
      });
      assert.equal(draft.status, 200, await draft.clone().text());
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      await context.addCookies([...gina.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
      const page = await context.newPage();
      await page.goto(HOST);
      const card = page.getByTestId('continue-card');
      const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
      await card.getByText('Continue your unsaved project?').waitFor({ timeout: 120000 });
      await page.waitForTimeout(3000);
      assert.equal(await wizard.count(), 0, 'the wizard opened over the Continue card');
      await card.getByRole('button', { name: 'Discard' }).click();
      await wizard.waitFor({ timeout: 30000 });
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: a draft discarded on another computer stays open here and is saved again', async () => {
    const browser = await chromium.launch(
      process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
    );
    try {
      const hank = new Browser();
      await signIn(hank, 'hank');
      const drafts = async () => (await (await hank.json('/api/projects')).json()).projects.filter((p) => p.draft);
      const open = async (viewport) => {
        const context = await browser.newContext({ viewport });
        await context.addCookies([...hank.jar.get(new URL(HOST).host)].map(([name, value]) => ({ name, value, url: HOST })));
        const page = await context.newPage();
        page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
        await page.goto(HOST);
        return page;
      };
      const skipWizard = async (page) => {
        const wizard = page.getByRole('dialog', { name: 'Set up your printers' });
        await page.waitForTimeout(2000);
        if (await wizard.isVisible().catch(() => false)) await wizard.getByRole('button', { name: 'Not now' }).click();
      };
      const changeLayer = async (page, value) => {
        const layer = page.getByLabel('Layer height', { exact: true });
        await layer.fill(value);
        await layer.press('Enter');
      };

      // Computer A: a new project, kept online as its draft.
      const a = await open({ width: 1280, height: 860 });
      await a.getByText('Open a model to start').waitFor({ timeout: 120000 });
      await skipWizard(a);
      await a.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/3DBenchy.stl'));
      await a.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      const projectButton = a.getByRole('button', { name: /^Project/ });
      await projectButton.getByText('Draft, not saved yet').waitFor({ timeout: 30000 });
      await waitFor(async () => (await drafts()).length === 1, 'A saved its draft');
      const first = (await drafts())[0];

      // Computer B: the Continue card, Discard; then B starts its own project (its own draft).
      const b = await open({ width: 390, height: 800 });
      const card = b.getByTestId('continue-card');
      await card.getByText('Continue your unsaved project?').waitFor({ timeout: 120000 });
      await card.getByRole('button', { name: 'Discard' }).click();
      await card.waitFor({ state: 'detached' });
      await waitFor(async () => (await drafts()).length === 0, "B discarded A's draft");
      await skipWizard(b);
      await b.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/3DBenchy.stl'));
      await waitFor(async () => (await drafts()).length === 1, 'B saved its own draft', 60000);
      const bDraft = (await drafts())[0];

      // Back on A, a change: AutoSave finds its draft gone. No "Saved on another
      // device" question (it used to come back after every answer): A says what
      // happened and keeps its work as a new draft, beside B's.
      await changeLayer(a, '0.28');
      const toast = a.getByText('Your unsaved project was discarded on another device. It’s still open here, and AutoSave keeps it as a new draft.');
      await toast.waitFor({ timeout: 60000 });
      assert.equal(await a.getByRole('alertdialog').count(), 0, 'A asked about a project it no longer has');
      if (process.env.ACCOUNTS_SHOTS) await a.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'draft-discarded-desktop.png') });
      await a.setViewportSize({ width: 390, height: 800 });
      await a.waitForTimeout(500);
      if (process.env.ACCOUNTS_SHOTS) await a.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'draft-discarded-phone.png') });
      await a.setViewportSize({ width: 1280, height: 860 });
      await waitFor(async () => (await drafts()).length === 2, "A saved its work again, beside B's draft", 90000);
      const ids = (await drafts()).map((p) => p.id);
      assert.ok(ids.includes(bDraft.id), "B's draft is still there");
      assert.ok(!ids.includes(first.id), 'A saved a new draft');
      await projectButton.getByText('Draft, not saved yet').waitFor({ timeout: 30000 });
      assert.equal(await a.getByLabel('Layer height', { exact: true }).inputValue(), '0.28', "A's change is still there");

      // B's next change saves into its own draft, no question either.
      await changeLayer(b, '0.12');
      await waitFor(async () => (await drafts()).find((p) => p.id === bDraft.id)?.version > bDraft.version, "B's AutoSave went on", 90000);
      assert.equal(await b.getByRole('alertdialog').count(), 0, 'B was asked about its draft');

      // A's draft taken over on B (Continue), then discarded there: A's "Edit
      // here instead" used to spin and stay view only. Now A keeps its work.
      const aDraft = (await drafts()).find((p) => p.id !== bDraft.id);
      assert.equal((await hank.json(`/api/projects/${aDraft.id}/device`, 'POST', { device: 'b-device-12345', deviceName: 'phone' })).status, 200);
      await a.evaluate(() => window.dispatchEvent(new Event('focus')));
      const banner = a.getByTestId('view-only-banner');
      await banner.getByText('being edited on your phone').waitFor({ timeout: 15000 });
      await hank.fetch(`${HOST}/api/projects/${aDraft.id}`, { method: 'DELETE', headers: { Origin: HOST } });
      await banner.getByRole('button', { name: 'Edit here instead' }).click();
      await banner.waitFor({ state: 'detached', timeout: 30000 });
      await a.getByText('Your unsaved project was discarded on your phone. It’s still open here, and AutoSave keeps it as a new draft.').waitFor({ timeout: 15000 });
      if (process.env.ACCOUNTS_SHOTS) await a.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'draft-discarded-edit-here.png') });
      assert.equal(await projectButton.getByText('View only').count(), 0, 'still view only');
      await waitFor(async () => (await drafts()).some((p) => p.id !== bDraft.id), 'A saved its work again', 90000);
      await changeLayer(a, '0.2');
      assert.equal(await a.getByLabel('Layer height', { exact: true }).inputValue(), '0.2', 'A can edit again');
    } finally {
      await browser.close();
    }
  });

if (withApp)
  test('browser: print history marks plates printed, changed since, kept, marked by hand, and caught after Upload only', async () => {
    const { startMockPrinter } = await import('./device/mock-printer.mjs');
    const printer = await startMockPrinter({ printStep: 0.01 });
    const browser = await chromium.launch(
      process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
    );
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

      // Two plates: Benchy on plate 1, a tetrahedron on plate 2; AutoSave keeps it online.
      await page.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/3DBenchy.stl'));
      await page.getByRole('button', { name: 'Add model' }).waitFor({ timeout: 60000 });
      await page.getByRole('toolbar', { name: 'Object tools' }).getByRole('button', { name: 'Add plate' }).click();
      const tabs = page.getByRole('tablist', { name: 'Plates' });
      await tabs.getByRole('tab', { name: /^2/ }).waitFor();
      await tabs.getByRole('tab', { name: /^2/ }).click();
      await page.getByTestId('model-input').setInputFiles(join(web, '../../fixtures/tetrahedron.stl'));
      await tabs.getByRole('tab', { name: /^2.*· 1/ }).waitFor({ timeout: 60000 });
      await waitFor(async () => (await (await ivy.json('/api/projects')).json()).projects.some((p) => p.draft), 'the draft is saved', 60000);
      const projectId = (await (await ivy.json('/api/projects')).json()).projects.find((p) => p.draft).id;
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

      // Saved (no longer a draft), the projects list says how many plates were printed.
      await page.keyboard.press('Control+s');
      await page.getByRole('dialog', { name: 'Save project' }).getByRole('button', { name: 'Save' }).click();
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
      await page.setViewportSize({ width: 390, height: 844 });
      await progress.waitFor();
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
