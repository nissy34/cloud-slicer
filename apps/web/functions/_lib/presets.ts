// A user's own printer, filament and process presets. Same model as Orca's
// user presets: `config` holds only the options that differ from the system
// preset named in `inherits` (Orca option key -> serialized value). That is
// what Snapmaker Orca loads; `engines` holds OrcaSlicer's part (see
// src/lib/preset-engines.ts), stored as is.
import { requireUser } from './auth';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env } from './types';

export const PRESET_TYPES = ['printer', 'filament', 'process'] as const;
export type PresetType = (typeof PRESET_TYPES)[number];

const MAX_PRESETS = 1000;
const MAX_NAME = 128;
const MAX_KEYS = 3000;
const MAX_CONFIG_BYTES = 256 * 1024;

interface Row {
  type: PresetType;
  name: string;
  inherits: string;
  config: string;
  engines: string | null;
  version: number;
  updated_at: number;
}

const toPreset = (r: Row) => ({
  type: r.type,
  name: r.name,
  inherits: r.inherits,
  config: JSON.parse(r.config) as Record<string, string>,
  ...(r.engines ? { engines: JSON.parse(r.engines) as Record<string, unknown> } : {}),
  version: r.version,
  updatedAt: r.updated_at,
});

function presetType(value: string): PresetType {
  if (!PRESET_TYPES.includes(value as PresetType)) throw new HttpError(404, 'Unknown preset type');
  return value as PresetType;
}

/** Preset names become file names in the engine's profile folder. */
export function validName(name: unknown): string {
  if (typeof name !== 'string') throw new HttpError(400, 'Preset name is required');
  const n = name.trim();
  // eslint-disable-next-line no-control-regex
  if (!n || n.length > MAX_NAME || /[/\\:*?"<>|\u0000-\u001f]/.test(n))
    throw new HttpError(400, `Preset names are 1-${MAX_NAME} characters without / \\ : * ? " < > |`);
  return n;
}

function validConfig(config: unknown): Record<string, string> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new HttpError(400, 'config must be an object');
  const entries = Object.entries(config as Record<string, unknown>);
  if (entries.length > MAX_KEYS) throw new HttpError(413, 'Too many options in one preset');
  for (const [k, v] of entries)
    if (!/^[a-z0-9_]{1,100}$/i.test(k) || typeof v !== 'string') throw new HttpError(400, `Bad option ${k.slice(0, 100)}`);
  return config as Record<string, string>;
}

/**
 * A preset's part per engine: { shared?, orca?: { inherits?, config }, pending?,
 * flowIndex?, apart? }. Only the shape is checked; the page reads it.
 */
function validEngines(engines: unknown): string | null {
  if (engines === undefined || engines === null) return null;
  if (typeof engines !== 'object' || Array.isArray(engines)) throw new HttpError(400, 'engines must be an object');
  const e = engines as Record<string, unknown>;
  for (const k of Object.keys(e)) if (!['shared', 'orca', 'pending', 'flowIndex', 'apart'].includes(k)) throw new HttpError(400, `Unknown engines field ${k.slice(0, 40)}`);
  if (e.shared !== undefined && !Number.isInteger(e.shared)) throw new HttpError(400, 'engines.shared must be a number');
  if (e.flowIndex !== undefined && !Number.isInteger(e.flowIndex)) throw new HttpError(400, 'engines.flowIndex must be a number');
  if (e.pending !== undefined) validConfig(e.pending);
  if (e.apart !== undefined && (!Array.isArray(e.apart) || e.apart.some((k) => typeof k !== 'string' || !/^[a-z0-9_]{1,100}$/i.test(k))))
    throw new HttpError(400, 'engines.apart must list option names');
  if (e.orca !== undefined) {
    const o = e.orca as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new HttpError(400, 'engines.orca must be an object');
    if (o.inherits !== undefined && typeof o.inherits !== 'string') throw new HttpError(400, 'engines.orca.inherits must be text');
    validConfig(o.config);
  }
  return JSON.stringify(e);
}

/** GET /api/presets[?type=filament] */
export async function list(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  const type = new URL(request.url).searchParams.get('type');
  const stmt = type
    ? env.DB!.prepare('SELECT * FROM presets WHERE user_id = ? AND type = ? ORDER BY type, name').bind(user.id, presetType(type))
    : env.DB!.prepare('SELECT * FROM presets WHERE user_id = ? ORDER BY type, name').bind(user.id);
  const rows = await stmt.all<Row>();
  return json({ presets: rows.results.map(toPreset) });
}

/**
 * PUT /api/presets/<type>/<name>  { inherits, config, engines?, baseVersion? }
 * With baseVersion, the save only goes through if the stored preset is still
 * that version (else 409 with the stored one), so two devices can't silently
 * overwrite each other. baseVersion 0 means "create, don't overwrite".
 */
export async function put(env: Env, request: Request, typeName: string, rawName: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const type = presetType(typeName);
  const name = validName(rawName);
  const body = await readJson<{ inherits?: unknown; config?: unknown; engines?: unknown; baseVersion?: unknown }>(request);
  const inherits = typeof body.inherits === 'string' ? body.inherits.slice(0, MAX_NAME) : '';
  const config = JSON.stringify(validConfig(body.config));
  const engines = validEngines(body.engines);
  if (config.length + (engines?.length ?? 0) > MAX_CONFIG_BYTES) throw new HttpError(413, 'Preset is too large');

  const d = env.DB!;
  const current = await d
    .prepare('SELECT * FROM presets WHERE user_id = ? AND type = ? AND name = ?')
    .bind(user.id, type, name)
    .first<Row>();
  const base = typeof body.baseVersion === 'number' ? body.baseVersion : null;
  if (base !== null && (current?.version ?? 0) !== base)
    throw new HttpError(409, 'This preset was changed on another device', { current: current ? toPreset(current) : null });
  if (!current) {
    const count = await d.prepare('SELECT COUNT(*) AS n FROM presets WHERE user_id = ?').bind(user.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_PRESETS) throw new HttpError(413, `You can keep up to ${MAX_PRESETS} presets`);
  }

  const version = (current?.version ?? 0) + 1;
  const now = Date.now();
  await d
    .prepare(
      `INSERT INTO presets (user_id, type, name, inherits, config, engines, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, type, name) DO UPDATE SET inherits = excluded.inherits, config = excluded.config,
         engines = excluded.engines, version = excluded.version, updated_at = excluded.updated_at`,
    )
    .bind(user.id, type, name, inherits, config, engines, version, now)
    .run();
  return json({ preset: toPreset({ type, name, inherits, config, engines, version, updated_at: now }) });
}

/** DELETE /api/presets/<type>/<name> */
export async function remove(env: Env, request: Request, typeName: string, rawName: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  await env
    .DB!.prepare('DELETE FROM presets WHERE user_id = ? AND type = ? AND name = ?')
    .bind(user.id, presetType(typeName), validName(rawName))
    .run();
  return json({ ok: true });
}
