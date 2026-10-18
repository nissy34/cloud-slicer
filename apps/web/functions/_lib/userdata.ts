// A user's setup choices (small JSON values by key) and physical printers.
import { requireUser } from './auth';
import { decrypt, encrypt } from './crypto';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env } from './types';

const MAX_SETTINGS = 100;
const MAX_SETTING_BYTES = 64 * 1024;
const MAX_DEVICES = 50;

const validKey = (key: string) => {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new HttpError(400, 'Setting keys are 1-64 letters, digits, _ . -');
  return key;
};

/** Optimistic concurrency: with baseVersion, only save over that version (0 = must not exist). */
function checkVersion(base: unknown, current: { version: number } | null, current_body: unknown) {
  if (typeof base === 'number' && (current?.version ?? 0) !== base)
    throw new HttpError(409, 'This was changed on another device', { current: current_body });
}

async function count(env: Env, table: string, userId: string) {
  const r = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(userId).first<{ n: number }>();
  return r?.n ?? 0;
}

// ---- settings ---------------------------------------------------------------

interface SettingRow {
  key: string;
  value: string;
  version: number;
  updated_at: number;
}
const toSetting = (r: SettingRow) => ({ key: r.key, value: JSON.parse(r.value) as unknown, version: r.version, updatedAt: r.updated_at });

/** GET /api/settings */
export async function listSettings(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  const rows = await env.DB!.prepare('SELECT * FROM user_settings WHERE user_id = ? ORDER BY key').bind(user.id).all<SettingRow>();
  return json({ settings: rows.results.map(toSetting) });
}

/** PUT /api/settings/<key>  { value, baseVersion? } */
export async function putSetting(env: Env, request: Request, rawKey: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const key = validKey(rawKey);
  const body = await readJson<{ value?: unknown; baseVersion?: unknown }>(request);
  if (body.value === undefined) throw new HttpError(400, 'value is required');
  const value = JSON.stringify(body.value);
  if (value.length > MAX_SETTING_BYTES) throw new HttpError(413, 'Setting is too large');

  const d = env.DB!;
  const current = await d.prepare('SELECT * FROM user_settings WHERE user_id = ? AND key = ?').bind(user.id, key).first<SettingRow>();
  checkVersion(body.baseVersion, current, current ? toSetting(current) : null);
  if (!current && (await count(env, 'user_settings', user.id)) >= MAX_SETTINGS) throw new HttpError(413, 'Too many settings');
  const row = { key, value, version: (current?.version ?? 0) + 1, updated_at: Date.now() };
  await d
    .prepare(
      `INSERT INTO user_settings (user_id, key, value, version, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, version = excluded.version, updated_at = excluded.updated_at`,
    )
    .bind(user.id, key, row.value, row.version, row.updated_at)
    .run();
  return json({ setting: toSetting(row) });
}

/** DELETE /api/settings/<key> */
export async function deleteSetting(env: Env, request: Request, rawKey: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  await env.DB!.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').bind(user.id, validKey(rawKey)).run();
  return json({ ok: true });
}

// ---- devices (the user's physical printers) -----------------------------------

interface DeviceRow {
  id: string;
  name: string;
  preset: string;
  url: string;
  api_key_enc: string | null;
  extra: string;
  version: number;
  updated_at: number;
}
/** The API key itself is never listed; GET /api/devices/<id>/secret returns it. */
const toDevice = (r: DeviceRow) => ({
  id: r.id,
  name: r.name,
  preset: r.preset,
  url: r.url,
  hasApiKey: r.api_key_enc !== null,
  extra: JSON.parse(r.extra) as Record<string, unknown>,
  version: r.version,
  updatedAt: r.updated_at,
});

const validId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, 'Bad printer id');
  return id;
};
const str = (v: unknown, field: string, max: number) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${field} must be text up to ${max} characters`);
  return v.trim();
};
const keyContext = (userId: string, deviceId: string) => `device-api-key:${userId}:${deviceId}`;

function encKey(env: Env): string {
  if (!env.ACCOUNT_ENC_KEY) throw new HttpError(503, "Saving printer API keys isn't set up on this site yet");
  return env.ACCOUNT_ENC_KEY;
}

/** GET /api/devices */
export async function listDevices(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  const rows = await env.DB!.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY name, id').bind(user.id).all<DeviceRow>();
  return json({ devices: rows.results.map(toDevice) });
}

/** GET /api/devices/<id>/secret -> { apiKey } (null when none is saved) */
export async function deviceSecret(env: Env, request: Request, rawId: string): Promise<Response> {
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const row = await env.DB!.prepare('SELECT api_key_enc FROM devices WHERE user_id = ? AND id = ?').bind(user.id, id).first<DeviceRow>();
  if (!row) throw new HttpError(404, 'No such printer');
  const apiKey = row.api_key_enc ? await decrypt(encKey(env), row.api_key_enc, keyContext(user.id, id)) : null;
  return json({ apiKey });
}

/**
 * PUT /api/devices/<id>  { name, preset?, url?, apiKey?, extra?, baseVersion? }
 * apiKey: a string sets it, null removes it, left out keeps the saved one.
 */
export async function putDevice(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const body = await readJson<Record<string, unknown>>(request, 64 * 1024);
  const name = str(body.name, 'name', 128);
  if (!name) throw new HttpError(400, 'Printer name is required');
  const preset = str(body.preset, 'preset', 128);
  const url = str(body.url, 'url', 512);
  if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'Printer address must start with http:// or https://');
  const extra = body.extra ?? {};
  if (typeof extra !== 'object' || Array.isArray(extra)) throw new HttpError(400, 'extra must be an object');
  const extraJson = JSON.stringify(extra);
  if (extraJson.length > 32 * 1024) throw new HttpError(413, 'extra is too large');

  const d = env.DB!;
  const current = await d.prepare('SELECT * FROM devices WHERE user_id = ? AND id = ?').bind(user.id, id).first<DeviceRow>();
  checkVersion(body.baseVersion, current, current ? toDevice(current) : null);
  if (!current && (await count(env, 'devices', user.id)) >= MAX_DEVICES) throw new HttpError(413, `You can save up to ${MAX_DEVICES} printers`);

  let apiKeyEnc = current?.api_key_enc ?? null;
  if (body.apiKey === null || body.apiKey === '') apiKeyEnc = null;
  else if (body.apiKey !== undefined) apiKeyEnc = await encrypt(encKey(env), str(body.apiKey, 'apiKey', 512), keyContext(user.id, id));

  const row: DeviceRow = { id, name, preset, url, api_key_enc: apiKeyEnc, extra: extraJson, version: (current?.version ?? 0) + 1, updated_at: Date.now() };
  await d
    .prepare(
      `INSERT INTO devices (user_id, id, name, preset, url, api_key_enc, extra, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, preset = excluded.preset, url = excluded.url,
         api_key_enc = excluded.api_key_enc, extra = excluded.extra, version = excluded.version, updated_at = excluded.updated_at`,
    )
    .bind(user.id, id, name, preset, url, apiKeyEnc, extraJson, row.version, row.updated_at)
    .run();
  return json({ device: toDevice(row) });
}

/** DELETE /api/devices/<id> */
export async function deleteDevice(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  await env.DB!.prepare('DELETE FROM devices WHERE user_id = ? AND id = ?').bind(user.id, validId(rawId)).run();
  return json({ ok: true });
}
