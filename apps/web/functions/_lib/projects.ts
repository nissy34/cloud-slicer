// Projects saved online: each is an Orca 3MF project in R2 with a PNG
// thumbnail beside it, indexed by a D1 row. The limits keep the whole site
// inside R2's free 10 GB. Storage per user is set on the Admin page
// (access.ts storageBytes; 0 = presets only, no online projects).
//
// AutoSave: a new project is kept as a draft (draft = 1) until its first Save
// names it. Each device keeps one draft (a new one replaces that device's old
// one), so discarding a draft on one device never takes another device's work
// with it; a person has at most MAX_DRAFTS, the oldest go first. The device
// editing a project is recorded with each save; a save from another device is
// refused (409, code "elsewhere") until that device takes over (POST .../device).
import { storageBytes } from './access';
import { printedCounts } from './prints';
import { requireUser } from './auth';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env, R2Bucket } from './types';

export const LIMITS = {
  /** One project can use all of the person's storage, up to what one upload can carry
   * (Cloudflare's free plan takes request bodies up to 100 MB). */
  projectBytes: 95 * 1024 * 1024,
  userProjects: 200,
  siteBytes: 8 * 1024 * 1024 * 1024,
  thumbnailBytes: 512 * 1024,
};
/** Drafts kept per person (one per device; past this the oldest go). */
export const MAX_DRAFTS = 3;

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
  /** 1: the person's unsaved draft. */
  draft: number;
  /** The device editing it (an id the browser keeps), and its name ("phone"). */
  device: string | null;
  device_name: string | null;
  /** How many plates it has (null: saved before this was kept). */
  plates: number | null;
}
const toProject = (r: ProjectRow, printed?: number) => ({
  id: r.id,
  name: r.name,
  size: r.size,
  hasThumbnail: r.thumb_key !== null,
  version: r.version,
  engine: r.engine ?? 'snapmaker',
  draft: Boolean(r.draft),
  device: r.device,
  deviceName: r.device_name,
  plates: r.plates ?? null,
  /** Plates with a printed mark (functions/_lib/prints.ts), in the Projects list only. */
  ...(printed !== undefined && { printedPlates: printed }),
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
const validDevice = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null);
const validDeviceName = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\w .'-]/g, '').slice(0, 40) || null : null);
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
/** Another device took the project over: this one only views it until it takes it back. */
function elsewhere(current: ProjectRow) {
  return new HttpError(409, `This project is being edited on your ${current.device_name ?? 'other device'}`, { code: 'elsewhere', current: toProject(current) });
}

/** The person's limits: a project can be as big as their whole storage, up to LIMITS.projectBytes. */
export const limitsFor = (userBytes: number) => ({
  projectBytes: Math.min(userBytes, LIMITS.projectBytes),
  userBytes,
  userProjects: LIMITS.userProjects,
});

// Bytes count every file, the draft too; the project count leaves the draft out.
async function usage(env: Env, userId: string) {
  const u = await env.DB!.prepare('SELECT COALESCE(SUM(draft = 0), 0) AS n, COALESCE(SUM(size), 0) AS bytes FROM projects WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number; bytes: number }>();
  return { count: u?.n ?? 0, bytes: u?.bytes ?? 0 };
}

/** GET /api/projects -> { projects, usage, limits } (newest first; the draft, if any, is among them with draft: true) */
export async function list(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  const rows = await env.DB!.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').bind(user.id).all<ProjectRow>();
  const printed = await printedCounts(env, user.id);
  return json({
    enabled: Boolean(env.PROJECTS),
    projects: rows.results.map((r) => toProject(r, printed.get(r.id) ?? 0)),
    usage: await usage(env, user.id),
    limits: limitsFor(await storageBytes(env, user.id)),
  });
}

/** GET /api/projects/<id> -> { project }: its version and the device editing it, checked when a tab comes back into view. */
export async function get(env: Env, request: Request, rawId: string): Promise<Response> {
  const user = await requireUser(env, request);
  return json({ project: toProject(await mustRow(env, user.id, validId(rawId))) });
}

/** POST /api/projects/<id>/device { device, deviceName }: this device edits the project from now on. */
export async function takeOver(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const body = await readJson<{ device?: unknown; deviceName?: unknown }>(request, 4096);
  const device = validDevice(body.device);
  if (!device) throw new HttpError(400, 'Bad device');
  const r = await mustRow(env, user.id, id);
  const deviceName = validDeviceName(body.deviceName);
  await env.DB!.prepare('UPDATE projects SET device = ?, device_name = ? WHERE user_id = ? AND id = ?').bind(device, deviceName, user.id, id).run();
  return json({ project: toProject({ ...r, device, device_name: deviceName }) });
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
 * draft=1: this device's draft (it replaces the device's old one); a save
 * without it turns the draft into a normal project.
 * device, deviceName: the device saving; a save from a device other than the
 * one editing the project is refused unless baseVersion is left out.
 * plates: how many plates the project has.
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
  const draft = url.searchParams.get('draft') === '1' ? 1 : 0;
  const device = validDevice(url.searchParams.get('device'));
  const deviceName = validDeviceName(url.searchParams.get('deviceName'));
  const platesParam = Number(url.searchParams.get('plates'));
  const plates = Number.isInteger(platesParam) && platesParam > 0 && platesParam < 1000 ? platesParam : null;

  // The body streams straight to R2 (a Worker has 128 MB of memory, a project up to 95 MB),
  // so its size is known up front from Content-Length, which the runtime holds the body to.
  const size = Number(request.headers.get('Content-Length') ?? '');
  if (!request.body || !Number.isInteger(size) || size <= 0) throw new HttpError(411, 'The project file has no size');
  const userBytes = await storageBytes(env, user.id);
  if (!userBytes) throw new HttpError(403, "Online projects aren't available for your account. Your presets and printers still save; download the project to keep it.", { code: 'presets-only' });
  const maxBytes = limitsFor(userBytes).projectBytes;
  if (size > maxBytes) throw new HttpError(413, `Projects can be up to ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const current = await row(env, user.id, id);
  if (base !== undefined && current?.device && device && current.device !== device) throw elsewhere(current);
  if (base !== undefined && (current?.version ?? 0) !== base) throw conflict(current);
  if (draft && current && !current.draft) throw new HttpError(400, 'A saved project cannot become a draft again');

  const mine = await usage(env, user.id);
  if (!draft && (!current || current.draft) && mine.count >= LIMITS.userProjects)
    throw new HttpError(413, `You can save up to ${LIMITS.userProjects} projects online`);
  const grow = size - (current?.size ?? 0);
  if (mine.bytes + grow > userBytes)
    throw new HttpError(413, `Your online projects would use more than ${Math.round(userBytes / 1024 / 1024)} MB. Delete some or download this one instead.`);
  const site = await env.DB!.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM projects').first<{ bytes: number }>();
  if ((site?.bytes ?? 0) + grow > LIMITS.siteBytes) throw new HttpError(507, 'Online project storage is full. Download the project instead.');

  // A new key per save: the row only points at it once the version check
  // below passes, so a save that lost a race leaves the newer file alone.
  const version = (current?.version ?? 0) + 1;
  const key = `${prefix(user.id)}${id}/${version}-${randomPart()}.3mf`;
  const stored = await b.put(key, request.body, { httpMetadata: { contentType: 'model/3mf' } });
  const head = await b.get(key, { range: { offset: 0, length: 2 } });
  const magic = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
  if (stored?.size !== size || magic[0] !== 0x50 || magic[1] !== 0x4b) {
    await b.delete(key);
    throw new HttpError(400, "That isn't a 3MF file");
  }
  const now = Date.now();
  const d = env.DB!;
  const res = current
    ? await d
        .prepare(
          'UPDATE projects SET name = ?, size = ?, file_key = ?, version = ?, updated_at = ?, engine = ?, draft = ?, device = ?, device_name = ?, plates = COALESCE(?, plates) WHERE user_id = ? AND id = ? AND version = ?',
        )
        .bind(name, size, key, version, now, engine, draft, device, deviceName, plates, user.id, id, current.version)
        .run()
    : await d
        .prepare(
          `INSERT INTO projects (user_id, id, name, size, file_key, thumb_key, version, created_at, updated_at, engine, draft, device, device_name, plates)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO NOTHING`,
        )
        .bind(user.id, id, name, size, key, version, now, now, engine, draft, device, deviceName, plates)
        .run();
  if (!res.meta.changes) {
    await b.delete(key);
    throw conflict(await row(env, user.id, id));
  }
  if (current) await b.delete(current.file_key);
  // One draft per device: a new one replaces the one before it on this device,
  // and the oldest drafts of other devices go past MAX_DRAFTS.
  if (draft && !current) {
    const others = await d
      .prepare('SELECT * FROM projects WHERE user_id = ? AND draft = 1 AND id != ? ORDER BY updated_at DESC')
      .bind(user.id, id)
      .all<ProjectRow>();
    const old = others.results.filter((r, i) => !device || !r.device || r.device === device || i >= MAX_DRAFTS - 1);
    for (const r of old) {
      await d.prepare('DELETE FROM project_prints WHERE user_id = ? AND project_id = ?').bind(user.id, r.id).run();
      await d.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(user.id, r.id).run();
      await b.delete([r.file_key, ...(r.thumb_key ? [r.thumb_key] : [])]);
    }
  }
  return json({
    project: toProject({
      ...(current ?? { thumb_key: null, created_at: now }),
      id,
      name,
      size,
      file_key: key,
      version,
      updated_at: now,
      engine,
      draft,
      device,
      device_name: deviceName,
      plates: plates ?? current?.plates ?? null,
    } as ProjectRow),
  });
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
  // Its print history goes with it.
  await env.DB!.prepare('DELETE FROM project_prints WHERE user_id = ? AND project_id = ?').bind(user.id, id).run();
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
