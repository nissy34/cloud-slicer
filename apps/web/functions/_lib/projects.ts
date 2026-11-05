// Projects saved online. Each is an Orca 3MF project in the person's own
// Google Drive (drive.ts), indexed by a D1 row that also keeps its list
// picture. Cloud Slicer has no project storage of its own, so the only limit
// is the number of projects; the owner can turn online projects off for a
// person on the Admin page (access.ts projectsAllowed).
//
// AutoSave: a new project is kept as a draft (draft = 1) until its first Save
// names it. Each device keeps one draft (a new one replaces that device's old
// one), so discarding a draft on one device never takes another device's work
// with it; a person has at most MAX_DRAFTS, the oldest go first. The device
// editing a project is recorded with each save; a save from another device is
// refused (409, code "elsewhere") until that device takes over (POST .../device).
//
// Every save is a new file in Drive (the page uploads it, then PUT ?drive=<id>
// points the row at it, and the file before goes), so a save that lost a race
// never replaces the newer file. A save also checks the file it replaces is
// still the one last saved: one changed in Drive since is a conflict too
// (409, code "changed-in-drive").
import { projectsAllowed } from './access';
import { checkDriveFile, driveConnected, driveDelete, driveKey, driveMd5, driveRename, driveToken, fileIdOf, validDriveId } from './drive';
import { printedCounts } from './prints';
import { requireUser } from './auth';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env } from './types';

export const LIMITS = {
  /** A safety guard only, never shown as "N of 200" (each project is just a row + picture here). */
  userProjects: 200,
  /** The list picture, kept in the row: 256 px WebP is about 15 KB. */
  thumbnailBytes: 64 * 1024,
};
/** Drafts kept per person (one per device; past this the oldest go). */
export const MAX_DRAFTS = 3;

interface ProjectRow {
  id: string;
  name: string;
  size: number;
  /** "drive:<file id>" (rows from before Drive have an old key: their file is gone). */
  file_key: string;
  /** 1 when the row has a picture (the picture itself is only read by GET .../thumbnail). */
  has_thumb: number;
  drive_md5: string | null;
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
/** Every column but the picture, so listing 200 projects doesn't read 200 pictures. */
const COLUMNS =
  'id, name, size, file_key, thumb IS NOT NULL AS has_thumb, drive_md5, version, created_at, updated_at, engine, draft, device, device_name, plates';

const toProject = (r: ProjectRow, printed?: number) => ({
  id: r.id,
  name: r.name,
  size: r.size,
  hasThumbnail: Boolean(r.has_thumb),
  version: r.version,
  engine: r.engine ?? 'snapmaker',
  draft: Boolean(r.draft),
  device: r.device,
  deviceName: r.device_name,
  plates: r.plates ?? null,
  /** Its file in the person's Google Drive (the page downloads it from there); null: no file. */
  driveFile: fileIdOf(r.file_key),
  /** Plates with a printed mark (functions/_lib/prints.ts), in the Projects list only. */
  ...(printed !== undefined && { printedPlates: printed }),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

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

async function row(env: Env, userId: string, id: string) {
  return env.DB!.prepare(`SELECT ${COLUMNS} FROM projects WHERE user_id = ? AND id = ?`).bind(userId, id).first<ProjectRow>();
}
async function mustRow(env: Env, userId: string, id: string) {
  const r = await row(env, userId, id);
  if (!r) throw new HttpError(404, 'No such project');
  return r;
}
function conflict(current: ProjectRow | null, code?: string) {
  const message = code === 'changed-in-drive' ? 'This project was changed in your Google Drive' : 'This project was saved on another device';
  return new HttpError(409, message, { current: current ? toProject(current) : null, ...(code && { code }) });
}
/** Another device took the project over: this one only views it until it takes it back. */
function elsewhere(current: ProjectRow) {
  return new HttpError(409, `This project is being edited on your ${current.device_name ?? 'other device'}`, { code: 'elsewhere', current: toProject(current) });
}
const presetsOnly = () =>
  new HttpError(403, "Online projects aren't available for your account. Your presets and printers still save; download the project to keep it.", {
    code: 'presets-only',
  });

/** Saved projects; the draft isn't counted. */
async function projectCount(env: Env, userId: string) {
  const u = await env.DB!.prepare('SELECT COALESCE(SUM(draft = 0), 0) AS n FROM projects WHERE user_id = ?').bind(userId).first<{ n: number }>();
  return u?.n ?? 0;
}

/** GET /api/projects -> { enabled, projects, count, drive } (newest first; the draft, if any, is among them with draft: true) */
export async function list(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  const rows = await env.DB!.prepare(`SELECT ${COLUMNS} FROM projects WHERE user_id = ? ORDER BY updated_at DESC`).bind(user.id).all<ProjectRow>();
  const printed = await printedCounts(env, user.id);
  return json({
    enabled: await projectsAllowed(env, user.id),
    projects: rows.results.map((r) => toProject(r, printed.get(r.id) ?? 0)),
    count: rows.results.filter((r) => !r.draft).length,
    drive: { connected: await driveConnected(env, user.id) },
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

/** GET /api/projects/<id>/thumbnail -> the list picture */
export async function thumbnail(env: Env, request: Request, rawId: string): Promise<Response> {
  const user = await requireUser(env, request);
  const r = await env.DB!.prepare('SELECT thumb, thumb_type FROM projects WHERE user_id = ? AND id = ?')
    .bind(user.id, validId(rawId))
    .first<{ thumb: ArrayBuffer | number[] | null; thumb_type: string | null }>();
  if (!r?.thumb) throw new HttpError(404, 'No thumbnail');
  // The address carries the project's version, so the browser may keep it.
  return new Response(new Uint8Array(r.thumb as ArrayBuffer), {
    headers: { 'Content-Type': r.thumb_type ?? 'image/png', 'Cache-Control': 'private, max-age=86400' },
  });
}

/**
 * PUT /api/projects/<id>?drive=…&name=…&baseVersion=…&engine=…  (no body)
 * drive: the file the page just uploaded to the person's Google Drive; the
 * project points at it from now on and the file before goes.
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
  const driveId = validDriveId(url.searchParams.get('drive'));
  if (!driveId) throw new HttpError(400, 'Save the project to your Google Drive first');

  const files = driveFiles(env, request, user.id);
  // A Drive file the save didn't keep goes again, so a refused save leaves nothing behind in Drive.
  const refuse = async (e: Error): Promise<never> => {
    await files.remove([driveKey(driveId)]).catch(() => {});
    throw e;
  };
  if (!(await projectsAllowed(env, user.id))) await refuse(presetsOnly());
  const { size, md5 } = await checkDriveFile(await files.token(), driveId);
  const current = await row(env, user.id, id);
  if (base !== undefined && current?.device && device && current.device !== device) await refuse(elsewhere(current));
  if (base !== undefined && (current?.version ?? 0) !== base) await refuse(conflict(current));
  if (draft && current && !current.draft) await refuse(new HttpError(400, 'A saved project cannot become a draft again'));
  // Changed in Drive since it was last saved here (opened in another app, say): ask before replacing it.
  if (base !== undefined && current?.drive_md5) {
    const now = await driveMd5(await files.token(), current.file_key);
    if (now && now !== current.drive_md5) await refuse(conflict(current, 'changed-in-drive'));
  }
  if (!draft && (!current || current.draft) && (await projectCount(env, user.id)) >= LIMITS.userProjects)
    await refuse(new HttpError(413, `You can save up to ${LIMITS.userProjects} projects online`));

  const version = (current?.version ?? 0) + 1;
  const key = driveKey(driveId);
  const now = Date.now();
  const d = env.DB!;
  const res = current
    ? await d
        .prepare(
          'UPDATE projects SET name = ?, size = ?, file_key = ?, drive_md5 = ?, version = ?, updated_at = ?, engine = ?, draft = ?, device = ?, device_name = ?, plates = COALESCE(?, plates) WHERE user_id = ? AND id = ? AND version = ?',
        )
        .bind(name, size, key, md5, version, now, engine, draft, device, deviceName, plates, user.id, id, current.version)
        .run()
    : await d
        .prepare(
          `INSERT INTO projects (user_id, id, name, size, file_key, drive_md5, version, created_at, updated_at, engine, draft, device, device_name, plates)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO NOTHING`,
        )
        .bind(user.id, id, name, size, key, md5, version, now, now, engine, draft, device, deviceName, plates)
        .run();
  if (!res.meta.changes) await refuse(conflict(await row(env, user.id, id)));
  if (current && current.file_key !== key) await files.remove([current.file_key]);
  // One draft per device: a new one replaces the one before it on this device,
  // and the oldest drafts of other devices go past MAX_DRAFTS.
  if (draft && !current) {
    const others = await d
      .prepare(`SELECT ${COLUMNS} FROM projects WHERE user_id = ? AND draft = 1 AND id != ? ORDER BY updated_at DESC`)
      .bind(user.id, id)
      .all<ProjectRow>();
    const old = others.results.filter((r, i) => !device || !r.device || r.device === device || i >= MAX_DRAFTS - 1);
    for (const r of old) {
      await d.prepare('DELETE FROM project_prints WHERE user_id = ? AND project_id = ?').bind(user.id, r.id).run();
      await d.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(user.id, r.id).run();
      await files.remove([r.file_key]);
    }
  }
  return json({
    project: toProject({
      ...(current ?? { has_thumb: 0, created_at: now }),
      id,
      name,
      size,
      file_key: key,
      drive_md5: md5,
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

/** PUT /api/projects/<id>/thumbnail  body: a WebP or PNG picture. Doesn't change the version. */
export async function putThumbnail(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const r = await mustRow(env, user.id, validId(rawId));
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > LIMITS.thumbnailBytes) throw new HttpError(413, 'Thumbnail is too large');
  const type = pictureType(new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)));
  if (!type) throw new HttpError(400, 'Thumbnails are WebP or PNG pictures');
  await env.DB!.prepare('UPDATE projects SET thumb = ?, thumb_type = ? WHERE user_id = ? AND id = ?').bind(bytes, type, user.id, r.id).run();
  return json({ ok: true });
}

/** The picture's type from its first bytes: PNG or WebP, else null. */
function pictureType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
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
  // The file in their Drive takes the new name too (best effort: the name here is what the app shows).
  await driveToken(env, request, user.id)
    .then((t) => driveRename(t.accessToken, r.file_key, name))
    .catch((e) => console.warn('Drive rename failed:', e));
  return json({ project: toProject({ ...r, name, version: r.version + 1, updated_at: now }) });
}

/** DELETE /api/projects/<id>: the project and its file in Drive (a file already gone is fine). */
export async function remove(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const r = await row(env, user.id, id);
  if (!r) return json({ ok: true });
  // Its print history goes with it.
  await env.DB!.prepare('DELETE FROM project_prints WHERE user_id = ? AND project_id = ?').bind(user.id, id).run();
  await env.DB!.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').bind(user.id, id).run();
  await driveFiles(env, request, user.id).remove([r.file_key]);
  return json({ ok: true });
}

/**
 * Deletes files in the person's Google Drive, with a Drive key fetched once,
 * only when needed. A file we can't reach (access taken away) stays in their Drive.
 */
function driveFiles(env: Env, request: Request, userId: string) {
  let token: Promise<string> | null = null;
  const getToken = () => (token ??= driveToken(env, request, userId).then((t) => t.accessToken));
  return {
    token: getToken,
    async remove(keys: string[]) {
      for (const k of keys.filter((k) => fileIdOf(k)))
        await getToken()
          .then((t) => driveDelete(t, k))
          .catch((e) => console.warn('Drive delete failed:', e));
    },
  };
}
