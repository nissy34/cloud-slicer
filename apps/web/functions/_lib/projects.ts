// Projects saved online: each is an Orca 3MF project in R2 with a PNG
// thumbnail beside it, indexed by a D1 row. The limits keep the whole site
// inside R2's free 10 GB. Storage per user is set on the Admin page
// (access.ts storageBytes; 0 = presets only, no online projects).
import { storageBytes } from './access';
import { requireUser } from './auth';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env, R2Bucket } from './types';

export const LIMITS = {
  projectBytes: 50 * 1024 * 1024,
  userProjects: 200,
  siteBytes: 8 * 1024 * 1024 * 1024,
  thumbnailBytes: 512 * 1024,
};

interface ProjectRow {
  id: string;
  name: string;
  size: number;
  file_key: string;
  thumb_key: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  /** null: saved before there were two engines (Snapmaker Orca). */
  engine: string | null;
}
const toProject = (r: ProjectRow) => ({
  id: r.id,
  name: r.name,
  size: r.size,
  hasThumbnail: r.thumb_key !== null,
  version: r.version,
  engine: r.engine ?? 'snapmaker',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function bucket(env: Env): R2Bucket {
  if (!env.PROJECTS) throw new HttpError(503, "Online projects aren't set up on this site yet");
  return env.PROJECTS;
}

const validId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, 'Bad project id');
  return id;
};
function validName(v: unknown) {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name || name.length > 128) throw new HttpError(400, 'Project names are 1-128 characters');
  return name;
}
const ENGINES = ['snapmaker', 'orca'];
function validEngine(v: string | null) {
  if (v === null || v === '') return 'snapmaker';
  if (!ENGINES.includes(v)) throw new HttpError(400, 'Bad engine');
  return v;
}
function baseVersion(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'Bad baseVersion');
  return n;
}
const prefix = (userId: string) => `projects/${userId}/`;
const randomPart = () => crypto.randomUUID().slice(0, 8);

async function row(env: Env, userId: string, id: string) {
  return env.DB!.prepare('SELECT * FROM projects WHERE user_id = ? AND id = ?').bind(userId, id).first<ProjectRow>();
}
async function mustRow(env: Env, userId: string, id: string) {
  const r = await row(env, userId, id);
  if (!r) throw new HttpError(404, 'No such project');
  return r;
}
function conflict(current: ProjectRow | null) {
  return new HttpError(409, 'This project was saved on another device', { current: current ? toProject(current) : null });
}

async function usage(env: Env, userId: string) {
  const u = await env.DB!.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM projects WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number; bytes: number }>();
  return { count: u?.n ?? 0, bytes: u?.bytes ?? 0 };
}

/** GET /api/projects -> { projects, usage, limits } (newest first) */
export async function list(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  const rows = await env.DB!.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').bind(user.id).all<ProjectRow>();
  return json({
    enabled: Boolean(env.PROJECTS),
    projects: rows.results.map(toProject),
    usage: await usage(env, user.id),
    limits: { projectBytes: LIMITS.projectBytes, userBytes: await storageBytes(env, user.id), userProjects: LIMITS.userProjects },
  });
}

/** GET /api/projects/<id>/file -> the 3MF */
export async function file(env: Env, request: Request, rawId: string): Promise<Response> {
  const user = await requireUser(env, request);
  const r = await mustRow(env, user.id, validId(rawId));
  const obj = await bucket(env).get(r.file_key);
  if (!obj) throw new HttpError(404, "The project's file is missing");
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'model/3mf',
      'Content-Length': String(obj.size),
      'Cache-Control': 'private, no-store',
      'X-Project-Version': String(r.version),
    },
  });
}

/** GET /api/projects/<id>/thumbnail -> PNG */
export async function thumbnail(env: Env, request: Request, rawId: string): Promise<Response> {
  const user = await requireUser(env, request);
  const r = await mustRow(env, user.id, validId(rawId));
  const obj = r.thumb_key ? await bucket(env).get(r.thumb_key) : null;
  if (!obj) throw new HttpError(404, 'No thumbnail');
  // The key changes with every save, so the browser may keep it.
  return new Response(obj.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' } });
}

/**
 * PUT /api/projects/<id>?name=…&baseVersion=…&engine=…  body: the 3MF
 * baseVersion: the version this save started from (0 = a new project);
 * left out, the save goes over whatever is there.
 * engine: snapmaker (the default) or orca, the engine the project slices with.
 */
export async function put(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const b = bucket(env);
  const id = validId(rawId);
  const url = new URL(request.url);
  const name = validName(url.searchParams.get('name'));
  const base = baseVersion(url.searchParams.get('baseVersion'));
  const engine = validEngine(url.searchParams.get('engine'));

  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > LIMITS.projectBytes) throw new HttpError(413, `Projects can be up to ${LIMITS.projectBytes / 1024 / 1024} MB`);
  const current = await row(env, user.id, id);
  if (base !== undefined && (current?.version ?? 0) !== base) throw conflict(current);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > LIMITS.projectBytes) throw new HttpError(413, `Projects can be up to ${LIMITS.projectBytes / 1024 / 1024} MB`);
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new HttpError(400, "That isn't a 3MF file");

  const userBytes = await storageBytes(env, user.id);
  if (!userBytes) throw new HttpError(403, "Online projects aren't available for your account. Your presets and printers still save; download the project to keep it.", { code: 'presets-only' });
  const mine = await usage(env, user.id);
  if (!current && mine.count >= LIMITS.userProjects) throw new HttpError(413, `You can save up to ${LIMITS.userProjects} projects online`);
  const grow = bytes.byteLength - (current?.size ?? 0);
  if (mine.bytes + grow > userBytes)
    throw new HttpError(413, `Your online projects would use more than ${Math.round(userBytes / 1024 / 1024)} MB. Delete some or download this one instead.`);
  const site = await env.DB!.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM projects').first<{ bytes: number }>();
  if ((site?.bytes ?? 0) + grow > LIMITS.siteBytes) throw new HttpError(507, 'Online project storage is full. Download the project instead.');

  // A new key per save: the row only points at it once the version check
  // below passes, so a save that lost a race leaves the newer file alone.
  const version = (current?.version ?? 0) + 1;
  const key = `${prefix(user.id)}${id}/${version}-${randomPart()}.3mf`;
  await b.put(key, bytes, { httpMetadata: { contentType: 'model/3mf' } });
  const now = Date.now();
  const d = env.DB!;
  const res = current
    ? await d
        .prepare('UPDATE projects SET name = ?, size = ?, file_key = ?, version = ?, updated_at = ?, engine = ? WHERE user_id = ? AND id = ? AND version = ?')
        .bind(name, bytes.byteLength, key, version, now, engine, user.id, id, current.version)
        .run()
    : await d
        .prepare(
          `INSERT INTO projects (user_id, id, name, size, file_key, thumb_key, version, created_at, updated_at, engine)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO NOTHING`,
        )
        .bind(user.id, id, name, bytes.byteLength, key, version, now, now, engine)
        .run();
  if (!res.meta.changes) {
    await b.delete(key);
    throw conflict(await row(env, user.id, id));
  }
  if (current) await b.delete(current.file_key);
  return json({ project: toProject({ ...(current ?? { thumb_key: null, created_at: now }), id, name, size: bytes.byteLength, file_key: key, version, updated_at: now, engine } as ProjectRow) });
}

/** PUT /api/projects/<id>/thumbnail  body: PNG. Doesn't change the version. */
export async function putThumbnail(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const b = bucket(env);
  const r = await mustRow(env, user.id, validId(rawId));
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > LIMITS.thumbnailBytes) throw new HttpError(413, 'Thumbnail is too large');
  const sig = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (sig[0] !== 0x89 || sig[1] !== 0x50 || sig[2] !== 0x4e || sig[3] !== 0x47) throw new HttpError(400, 'Thumbnails are PNG images');
  const key = `${prefix(user.id)}${r.id}/thumb-${randomPart()}.png`;
  await b.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
  await env.DB!.prepare('UPDATE projects SET thumb_key = ? WHERE user_id = ? AND id = ?').bind(key, user.id, r.id).run();
  if (r.thumb_key) await b.delete(r.thumb_key);
  return json({ ok: true });
}

/** PATCH /api/projects/<id>  { name, baseVersion? }: rename. */
export async function rename(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const body = await readJson<{ name?: unknown; baseVersion?: unknown }>(request, 4096);
  const name = validName(body.name);
  const r = await mustRow(env, user.id, id);
  if (typeof body.baseVersion === 'number' && body.baseVersion !== r.version) throw conflict(r);
  const now = Date.now();
  await env.DB!.prepare('UPDATE projects SET name = ?, version = ?, updated_at = ? WHERE user_id = ? AND id = ?')
    .bind(name, r.version + 1, now, user.id, id)
    .run();
  return json({ project: toProject({ ...r, name, version: r.version + 1, updated_at: now }) });
}

/** DELETE /api/projects/<id> */
export async function remove(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const r = await row(env, user.id, id);
  if (!r) return json({ ok: true });
  await env.DB!.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(user.id, id).run();
  await bucket(env).delete([r.file_key, ...(r.thumb_key ? [r.thumb_key] : [])]);
  return json({ ok: true });
}

/** Deletes every stored file of a user (their account is being deleted; D1 rows cascade). */
export async function deleteAllFiles(env: Env, userId: string) {
  const b = env.PROJECTS;
  if (!b) return;
  let cursor: string | undefined;
  do {
    const page = await b.list({ prefix: prefix(userId), cursor });
    if (page.objects.length) await b.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
