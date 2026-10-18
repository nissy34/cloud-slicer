#!/usr/bin/env node
// Accounts end to end against the real Pages Functions runtime (wrangler pages
// dev, local D1) and a mock Google/GitHub OAuth server. No browser and no real
// provider: the test follows each redirect itself with its own cookie jar.
//
//   node test/accounts.mjs [site dir]     # default dist/ (after npm run build)
//
// With the built app it also signs in through the real Sign in button in
// Chromium, using the popup flow.
//
// The site is reached as two origins on one port: sign-ins start on
// http://localhost:<port> and the providers call back to http://127.0.0.1:<port>
// (AUTH_ORIGIN), the same split a branch preview has with production.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790;
const MOCK_PORT = 8791;
const HOST = `http://localhost:${PORT}`; // where the user is
const AUTH = `http://127.0.0.1:${PORT}`; // AUTH_ORIGIN
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;

// ---- mock OAuth provider ----------------------------------------------------
const users = {
  github: { alice: { id: 1001, login: 'alice', name: 'Alice' }, bob: { id: 1002, login: 'bob', name: null } },
  google: { alice: { sub: 'g-alice', name: 'Alice G', email: 'alice@example.com', email_verified: true } },
};
let nextUser = 'alice';
const codes = new Map(); // code -> { provider, user, challenge }
const tokens = new Map(); // token -> profile
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, MOCK);
  const [, provider, step] = url.pathname.split('/');
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (step === 'authorize') {
    const q = url.searchParams;
    assert.equal(q.get('client_id'), `${provider}-id`);
    assert.equal(q.get('code_challenge_method'), 'S256');
    const code = `code-${codes.size + 1}`;
    codes.set(code, { provider, user: users[provider][nextUser], challenge: q.get('code_challenge') });
    const back = new URL(q.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', q.get('state'));
    return send(302, undefined, { Location: back.toString() });
  }
  if (step === 'token' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const f = new URLSearchParams(body);
    const c = codes.get(f.get('code'));
    codes.delete(f.get('code'));
    const pkceOk = c && b64url(createHash('sha256').update(f.get('code_verifier') ?? '').digest()) === c.challenge;
    if (!c || !pkceOk || f.get('client_secret') !== `${provider}-secret`) return send(400, { error: 'bad_verification_code' });
    const token = `tok-${Math.random()}`;
    tokens.set(token, c.user);
    return send(200, { access_token: token, token_type: 'bearer' });
  }
  if (step === 'user') {
    const profile = tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));
    return profile ? send(200, profile) : send(401, { message: 'Bad credentials' });
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

const bindings = {
  AUTH_ORIGIN: AUTH,
  OAUTH_TEST_BASE: MOCK,
  GITHUB_CLIENT_ID: 'github-id',
  GITHUB_CLIENT_SECRET: 'github-secret',
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
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
      url = new URL(res.headers.get('location'), url).toString();
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

async function signIn(browser, provider, user, query = '') {
  nextUser = user;
  return browser.navigate(`${HOST}/api/auth/${provider}/start?return=${encodeURIComponent('/?tab=prepare')}${query}`);
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('signed out: /api/me says accounts are on and lists providers', async () => {
  const me = await (await fetch(`${HOST}/api/me`)).json();
  assert.deepEqual(me, { enabled: true, providers: { google: true, github: true }, user: null });
});

const alice = new Browser();
test('GitHub sign-in hands the session back to the starting host', async () => {
  const { res, visited, url } = await signIn(alice, 'github', 'alice');
  assert.equal(url, `${HOST}/?tab=prepare`);
  assert.equal(res.status, 200);
  assert.ok(visited.some((v) => v.startsWith(`${AUTH}/api/auth/github/callback`)), 'callback went to AUTH_ORIGIN');
  assert.ok(visited.some((v) => v.startsWith(`${HOST}/api/auth/finish?code=`)), 'finish ran on the starting host');
  assert.ok(alice.cookie(`localhost:${PORT}`, '__Host-cs_session'));
  assert.equal(alice.cookie(`127.0.0.1:${PORT}`, '__Host-cs_session'), undefined, 'no session on the auth host');
  const me = await alice.me();
  assert.equal(me.name, 'Alice');
  assert.deepEqual(me.identities, [{ provider: 'github', login: 'alice', email: null }]);
});

test('a handoff code works once, and only in the browser that started the sign-in', async () => {
  const thief = new Browser();
  nextUser = 'alice';
  const start = await alice.fetch(`${HOST}/api/auth/github/start?return=/`);
  const authorize = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const cb = await fetch(authorize.headers.get('location'), { redirect: 'manual' });
  const finish = cb.headers.get('location');
  assert.match(finish, /\/api\/auth\/finish\?code=/);
  const stolen = await thief.fetch(finish);
  assert.equal(stolen.status, 400, 'finish without the nonce cookie is refused');
  assert.equal(thief.cookie(`localhost:${PORT}`, '__Host-cs_session'), undefined);
  const again = await alice.fetch(finish);
  assert.equal(again.status, 400, 'a used code is refused');
});

test('state from the callback cannot be reused', async () => {
  nextUser = 'alice';
  const b = new Browser();
  const start = await b.fetch(`${HOST}/api/auth/github/start?return=/`);
  const authorize = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const cbUrl = authorize.headers.get('location');
  assert.equal((await fetch(cbUrl, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(cbUrl, { redirect: 'manual' })).status, 400);
});

test('return paths never leave the site', async () => {
  const b = new Browser();
  nextUser = 'bob';
  const { url } = await b.navigate(`${HOST}/api/auth/github/start?return=${encodeURIComponent('//evil.example/x')}`);
  assert.equal(url, `${HOST}/`);
});

test('cancelling at the provider returns with an error in the hash', async () => {
  const b = new Browser();
  const start = await b.fetch(`${HOST}/api/auth/google/start?return=/somewhere`);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const { url } = await b.navigate(`${AUTH}/api/auth/google/callback?error=access_denied&state=${state}`);
  assert.equal(url, `${HOST}/somewhere#auth-error=Sign-in%20was%20cancelled`);
  assert.equal(await b.me(), null);
});

test('popup sign-in ends on a page that tells the app window', async () => {
  const b = new Browser();
  const { res, url } = await signIn(b, 'github', 'bob', '&popup=1');
  assert.match(url, /\/api\/auth\/finish\?code=/);
  const html = await res.text();
  assert.match(html, /BroadcastChannel\('cloud-slicer-auth'\)/);
  assert.match(html, /"type":"signed-in"/);
  assert.equal((await b.me()).name, 'bob', 'GitHub login stands in for a missing name');
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

  assert.equal((await alice.json('/api/presets/filament/a%2Fb', 'PUT', body)).status, 400, 'no slashes in names');
  assert.equal((await alice.json('/api/presets/widget/x', 'PUT', body)).status, 404);
  assert.equal((await alice.json('/api/presets/filament/x', 'PUT', { config: { k: 1 } })).status, 400, 'values are strings');

  const bob = new Browser();
  await signIn(bob, 'github', 'bob');
  assert.equal((await (await bob.json('/api/presets')).json()).presets.length, 0, "users don't see each other's presets");
  assert.equal((await new Browser().json('/api/presets')).status, 401);

  await alice.json('/api/presets/filament/My%20PLA', 'DELETE');
  const left = (await (await alice.json('/api/presets')).json()).presets;
  assert.deepEqual(left.map((x) => x.name), ['My U1']);
});

test('linking Google to a signed-in GitHub user', async () => {
  const { url } = await signIn(alice, 'google', 'alice', '&link=1');
  assert.equal(url, `${HOST}/?tab=prepare`);
  const me = await alice.me();
  assert.deepEqual(me.identities.map((i) => i.provider), ['github', 'google']);
  assert.equal(me.email, 'alice@example.com', 'email filled in from Google');

  const viaGoogle = new Browser();
  await signIn(viaGoogle, 'google', 'alice');
  assert.equal((await viaGoogle.me()).id, me.id, 'signing in with Google finds the same account');
});

test("an identity can't be linked to a second account", async () => {
  const bob = new Browser();
  await signIn(bob, 'github', 'bob');
  const { url } = await signIn(bob, 'google', 'alice', '&link=1');
  assert.match(decodeURIComponent(url), /#auth-error=That Google account already belongs to another/);
});

test('sign out, then delete the account and its presets', async () => {
  const other = new Browser();
  await signIn(other, 'github', 'alice');
  assert.equal((await other.json('/api/auth/logout', 'POST')).status, 200);
  assert.equal(await other.me(), null);

  assert.equal((await alice.json('/api/me', 'DELETE')).status, 200);
  assert.equal(await alice.me(), null);
  const fresh = new Browser();
  await signIn(fresh, 'github', 'alice');
  const me = await fresh.me();
  assert.deepEqual(me.identities.map((i) => i.provider), ['github'], 'a new, empty account');
  assert.equal((await (await fresh.json('/api/presets')).json()).presets.length, 0);
});

if (withApp)
  test('browser: Sign in button, popup sign-in, account menu, sign out', async () => {
    const browser = await chromium.launch(
      process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? { executablePath: '/opt/pw-browsers/chromium' } : {},
    );
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(HOST);
      nextUser = 'bob';
      await page.getByRole('button', { name: 'Sign in' }).click();
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Continue with GitHub' }).click()]);
      if (!popup.isClosed()) await popup.waitForEvent('close', { timeout: 30000 });
      const menu = page.getByRole('button', { name: /bob/ });
      await menu.waitFor({ timeout: 30000 });
      await menu.click();
      await page.getByText('Signed in with GitHub as bob').waitFor();
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'account-menu.png') });
      await page.setViewportSize({ width: 390, height: 800 });
      if (process.env.ACCOUNTS_SHOTS) await page.screenshot({ path: join(process.env.ACCOUNTS_SHOTS, 'account-menu-phone.png') });
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByRole('button', { name: 'Sign in' }).waitFor();
    } finally {
      await browser.close();
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
