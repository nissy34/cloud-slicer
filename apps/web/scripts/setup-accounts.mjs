#!/usr/bin/env node
// CI, before `wrangler pages deploy`: gives the deploy its accounts backend.
//
//  1. Finds (or creates) the D1 database and writes its id into wrangler.toml.
//     If the Cloudflare token can't reach D1, it drops the D1 block instead so
//     the deploy still works, just without accounts.
//  2. Copies the Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//     repository secrets) into Pages secrets, for production and previews.
//  3. Creates BETTER_AUTH_SECRET (sessions) and ACCOUNT_ENC_KEY (printer API
//     keys) once, if missing. Production and previews share them.
//
// Prints `d1=ok|missing` for $GITHUB_OUTPUT. Never fails the build.
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… PROJECT=cloud-slicer node scripts/setup-accounts.mjs
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const tomlPath = join(web, 'wrangler.toml');
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
const project = process.env.PROJECT || 'cloud-slicer';
const DB_NAME = 'cloud-slicer';
const SECRET_NAMES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

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
    if (!Object.keys(vars).length) return;
    const env_vars = Object.fromEntries(Object.entries(vars).map(([k, value]) => [k, { type: 'secret_text', value }]));
    await cf(`/pages/projects/${project}`, {
      method: 'PATCH',
      body: JSON.stringify({ deployment_configs: { production: { env_vars }, preview: { env_vars } } }),
    });
    console.log(`Pages secrets set: ${Object.keys(vars).join(', ')}`);
  } catch (e) {
    warn(`Could not set the Pages secrets (${e.message}).`);
  }
}

if (!token || !account) {
  warn('No Cloudflare credentials: skipping accounts setup');
  output('d1=missing');
} else {
  const d1 = await setupD1();
  await setupSecrets();
  output(`d1=${d1 ? 'ok' : 'missing'}`);
}
