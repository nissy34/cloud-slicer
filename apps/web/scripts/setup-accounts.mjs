#!/usr/bin/env node
// CI, before `wrangler pages deploy`: gives the deploy its accounts backend.
//
//  1. Finds (or creates) the D1 database and writes its id into wrangler.toml.
//     If the Cloudflare token can't reach D1, it drops the D1 block instead so
//     the deploy still works, just without accounts.
//  2. Finds (or creates) the R2 bucket for saved projects. If R2 isn't turned
//     on for the account or the token can't reach it, drops the R2 block so
//     the deploy works without online projects.
//  3. Copies the Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//     repository secrets) into Pages secrets, for production and previews.
//  4. Creates BETTER_AUTH_SECRET (sessions) and ACCOUNT_ENC_KEY (printer API
//     keys) once, if missing. Production and previews share them.
//  5. The Admin page: copies OWNER_EMAILS (who may open it) and, if set,
//     CLOUDFLARE_ANALYTICS_TOKEN (a read-only token for its usage numbers).
//  6. Creates the relay ticket key pair once: the private half signs tickets
//     (Pages secret RELAY_TICKET_KEY), the public half goes to the relay
//     Worker (secret RELAY_TICKET_PUBLIC_KEY), which then only lets in
//     browsers of signed-in, allowed accounts.
//
// Prints `d1=ok|missing` and `r2=ok|missing` for $GITHUB_OUTPUT. Never fails the build.
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… PROJECT=cloud-slicer node scripts/setup-accounts.mjs
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const tomlPath = join(web, 'wrangler.toml');
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
const project = process.env.PROJECT || 'cloud-slicer';
const DB_NAME = 'cloud-slicer';
const BUCKET = 'cloud-slicer-projects';
const SECRET_NAMES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const RELAY_WORKER = process.env.RELAY_WORKER || 'cloud-slicer-relay';

const warn = (msg) => console.log(`::warning::${msg}`);
const output = (line) => {
  console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
};

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false)
    throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${(body.errors ?? []).map((e) => e.message).join('; ')}`);
  return body.result;
}

async function setupD1() {
  try {
    let db = (await cf(`/d1/database?name=${DB_NAME}`)).find((d) => d.name === DB_NAME);
    if (!db) {
      db = await cf('/d1/database', { method: 'POST', body: JSON.stringify({ name: DB_NAME }) });
      console.log(`created D1 database ${DB_NAME}`);
    }
    const toml = readFileSync(tomlPath, 'utf8').replace(/^database_id = ".*"$/m, `database_id = "${db.uuid}"`);
    writeFileSync(tomlPath, toml);
    console.log(`D1 ${DB_NAME}: ${db.uuid}`);
    return true;
  } catch (e) {
    warn(`Accounts disabled for this deploy: the Cloudflare token can't use D1 (${e.message}). Give it "D1: Edit".`);
    const toml = readFileSync(tomlPath, 'utf8');
    writeFileSync(tomlPath, toml.slice(0, toml.indexOf('# --- D1')));
    return false;
  }
}

async function setupR2() {
  try {
    const { buckets = [] } = (await cf(`/r2/buckets?name_contains=${BUCKET}`)) ?? {};
    if (!buckets.some((b) => b.name === BUCKET)) {
      await cf('/r2/buckets', { method: 'POST', body: JSON.stringify({ name: BUCKET }) });
      console.log(`created R2 bucket ${BUCKET}`);
    }
    console.log(`R2 ${BUCKET}: ok`);
    return true;
  } catch (e) {
    warn(
      `Online projects disabled for this deploy: R2 isn't usable (${e.message}). ` +
        'Turn on R2 in the Cloudflare dashboard (free up to 10 GB) and give the token "Workers R2 Storage: Edit".',
    );
    const toml = readFileSync(tomlPath, 'utf8');
    const start = toml.indexOf('# --- R2');
    writeFileSync(tomlPath, toml.slice(0, start) + toml.slice(toml.indexOf('# --- D1')));
    return false;
  }
}

async function setupSecrets() {
  const vars = {};
  for (const name of SECRET_NAMES) if (process.env[name]) vars[name] = process.env[name];
  const missing = SECRET_NAMES.filter((n) => !process.env[n]);
  if (missing.length) warn(`Sign-in secrets not set in GitHub: ${missing.join(', ')}`);
  try {
    const info = await cf(`/pages/projects/${project}`);
    const existing = info.deployment_configs?.production?.env_vars ?? {};
    // Generated once and then kept: changing them signs everyone out
    // (BETTER_AUTH_SECRET) or loses saved printer API keys (ACCOUNT_ENC_KEY).
    for (const name of ['BETTER_AUTH_SECRET', 'ACCOUNT_ENC_KEY'])
      if (!existing[name]) {
        vars[name] = randomBytes(32).toString('base64');
        console.log(`created ${name}`);
      }
    // The Admin page.
    if (process.env.OWNER_EMAILS) vars.OWNER_EMAILS = process.env.OWNER_EMAILS;
    else warn('No OWNER_EMAILS repository secret: nobody can open the Admin page. Add your Google email as that secret.');
    const plain = {};
    if (process.env.CLOUDFLARE_ANALYTICS_TOKEN) {
      vars.CF_ANALYTICS_TOKEN = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
      plain.CF_ACCOUNT_ID = account;
    }
    // Relay tickets: generated once. The public half is plain text so later runs can hand it to the relay.
    let publicKey = existing.RELAY_TICKET_PUBLIC_KEY?.value;
    if (!existing.RELAY_TICKET_KEY || !publicKey) {
      const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      vars.RELAY_TICKET_KEY = JSON.stringify(pair.privateKey.export({ format: 'jwk' }));
      publicKey = JSON.stringify(pair.publicKey.export({ format: 'jwk' }));
      plain.RELAY_TICKET_PUBLIC_KEY = publicKey;
      console.log('created RELAY_TICKET_KEY');
    }
    await relayPublicKey(publicKey, Boolean(plain.RELAY_TICKET_PUBLIC_KEY));
    if (!Object.keys(vars).length && !Object.keys(plain).length) return;
    const env_vars = {
      ...Object.fromEntries(Object.entries(vars).map(([k, value]) => [k, { type: 'secret_text', value }])),
      ...Object.fromEntries(Object.entries(plain).map(([k, value]) => [k, { type: 'plain_text', value }])),
    };
    await cf(`/pages/projects/${project}`, {
      method: 'PATCH',
      body: JSON.stringify({ deployment_configs: { production: { env_vars }, preview: { env_vars } } }),
    });
    console.log(`Pages settings set: ${Object.keys(env_vars).join(', ')}`);
  } catch (e) {
    warn(`Could not set the Pages secrets (${e.message}).`);
  }
}

/** Gives the relay Worker the ticket public key when it lacks it (or the key is new). */
async function relayPublicKey(publicKey, isNew) {
  try {
    const names = ((await cf(`/workers/scripts/${RELAY_WORKER}/secrets`)) ?? []).map((x) => x.name);
    if (names.includes('RELAY_TICKET_PUBLIC_KEY') && !isNew) return;
    await cf(`/workers/scripts/${RELAY_WORKER}/secrets`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'RELAY_TICKET_PUBLIC_KEY', text: publicKey, type: 'secret_text' }),
    });
    console.log(`relay ${RELAY_WORKER}: ticket key set`);
  } catch (e) {
    warn(`Could not give the relay its ticket key (${e.message}); it lets any pairing code in until it has one.`);
  }
}

if (!token || !account) {
  warn('No Cloudflare credentials: skipping accounts setup');
  output('d1=missing');
  output('r2=missing');
} else {
  const r2 = await setupR2();
  const d1 = await setupD1();
  await setupSecrets();
  output(`d1=${d1 ? 'ok' : 'missing'}`);
  output(`r2=${r2 ? 'ok' : 'missing'}`);
}
