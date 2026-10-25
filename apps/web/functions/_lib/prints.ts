// Print history of saved projects (src/lib/prints.ts has the logic around it):
// a row per send or mark of a plate; the page works out each plate's mark.
// Rows go with their project (deleted with it, copied with "Save a copy").
import { requireUser } from './auth';
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env } from './types';

/** Rows kept per plate; past this the oldest go. */
export const MAX_PER_PLATE = 50;
/** Bytes of one row's summary (a short hash per setting, about 20 KB). */
const MAX_SUMMARY = 64 * 1024;

const STATUSES = ['uploaded', 'sent', 'printing', 'printed', 'failed', 'cancelled', 'marked', 'unmarked', 'unknown'];
const OPEN = ['uploaded', 'sent', 'printing'];
/** A record waits this long for the printer's word, then counts as "no word" (src/lib/prints.ts OPEN_FOR_MS). */
const OPEN_FOR_MS = 7 * 24 * 3600 * 1000;
const inOpen = `status IN (${OPEN.map((s) => `'${s}'`).join(',')})`;

/** Records waiting longer than a week get no word now: a printer doesn't print one file for a week. */
function expire(env: Env, userId: string) {
  const now = Date.now();
  return env.DB!.prepare(`UPDATE project_prints SET status = 'unknown', ended_at = ? WHERE user_id = ? AND ${inOpen} AND at < ?`).bind(now, userId, now - OPEN_FOR_MS);
}

interface PrintRow {
  id: string;
  project_id: string;
  plate: number;
  status: string;
  at: number;
  ended_at: number | null;
  duration: number | null;
  progress: number | null;
  printer: string | null;
  printer_name: string | null;
  file: string | null;
  fingerprint: string | null;
  summary: string | null;
}
const toPrint = (r: PrintRow) => ({
  id: r.id,
  projectId: r.project_id,
  plate: r.plate,
  status: r.status,
  at: r.at,
  endedAt: r.ended_at,
  duration: r.duration,
  progress: r.progress,
  printer: r.printer,
  printerName: r.printer_name,
  file: r.file,
  fingerprint: r.fingerprint,
  summary: r.summary ? (JSON.parse(r.summary) as unknown) : null,
});

const validId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, 'Bad id');
  return id;
};
const plateOf = (v: unknown) => {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 999) throw new HttpError(400, 'Bad plate');
  return v as number;
};
const text = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function summaryOf(v: unknown) {
  if (v == null) return null;
  const s = JSON.stringify(v);
  if (s.length > MAX_SUMMARY) throw new HttpError(413, 'Summary too large');
  return s;
}

async function mustProject(env: Env, userId: string, id: string) {
  const p = await env.DB!.prepare('SELECT id FROM projects WHERE user_id = ? AND id = ?').bind(userId, id).first();
  if (!p) throw new HttpError(404, 'No such project');
}

/** GET /api/projects/<id>/prints -> { prints } (oldest first) */
export async function list(env: Env, request: Request, rawId: string): Promise<Response> {
  const user = await requireUser(env, request);
  const id = validId(rawId);
  await expire(env, user.id).run();
  const rows = await env.DB!.prepare('SELECT * FROM project_prints WHERE user_id = ? AND project_id = ? ORDER BY at, id').bind(user.id, id).all<PrintRow>();
  return json({ prints: rows.results.map(toPrint) });
}

/** GET /api/prints/open -> { prints }: every project's prints still waiting for the printer (no summaries). */
export async function open(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  await expire(env, user.id).run();
  const rows = await env.DB!.prepare(
    `SELECT id, project_id, plate, status, at, ended_at, duration, progress, printer, printer_name, file, fingerprint, NULL AS summary
     FROM project_prints WHERE user_id = ? AND status IN (${OPEN.map(() => '?').join(',')}) ORDER BY at`,
  )
    .bind(user.id, ...OPEN)
    .all<PrintRow>();
  return json({ prints: rows.results.map(toPrint) });
}

/**
 * POST /api/projects/<id>/prints { plate, status, printer?, printerName?, file?, fingerprint?, summary? } -> { print }
 * A send (uploaded or sent) or a mark by hand (marked, unmarked).
 * Records still waiting that this one replaces get "no word" (unknown): a send
 * of the same file to the same printer (the printer overwrote it; any project),
 * or a mark of the same plate (the person said how it went).
 */
export async function add(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const b = await readJson<Record<string, unknown>>(request, MAX_SUMMARY + 8192);
  const plate = plateOf(b.plate);
  const status = String(b.status);
  if (!['uploaded', 'sent', 'marked', 'unmarked'].includes(status)) throw new HttpError(400, 'Bad status');
  await mustProject(env, user.id, id);
  const row: PrintRow = {
    id: crypto.randomUUID(),
    project_id: id,
    plate,
    status,
    at: Date.now(),
    ended_at: null,
    duration: null,
    progress: null,
    printer: text(b.printer, 64),
    printer_name: text(b.printerName, 80),
    file: text(b.file, 512),
    fingerprint: text(b.fingerprint, 64),
    summary: summaryOf(b.summary),
  };
  const d = env.DB!;
  const superseded =
    status === 'uploaded' || status === 'sent'
      ? row.printer && row.file
        ? d.prepare(`UPDATE project_prints SET status = 'unknown', ended_at = ? WHERE user_id = ? AND ${inOpen} AND printer = ? AND file = ?`).bind(row.at, user.id, row.printer, row.file)
        : null
      : d.prepare(`UPDATE project_prints SET status = 'unknown', ended_at = ? WHERE user_id = ? AND ${inOpen} AND project_id = ? AND plate = ?`).bind(row.at, user.id, id, plate);
  await d.batch([
    ...(superseded ? [superseded] : []),
    d
      .prepare(
        `INSERT INTO project_prints (user_id, project_id, id, plate, status, at, printer, printer_name, file, fingerprint, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(user.id, id, row.id, plate, status, row.at, row.printer, row.printer_name, row.file, row.fingerprint, row.summary),
    // The oldest rows of the plate past MAX_PER_PLATE go.
    d
      .prepare(
        `DELETE FROM project_prints WHERE user_id = ? AND project_id = ? AND plate = ? AND id NOT IN
         (SELECT id FROM project_prints WHERE user_id = ? AND project_id = ? AND plate = ? ORDER BY at DESC LIMIT ?)`,
      )
      .bind(user.id, id, plate, user.id, id, plate, MAX_PER_PLATE),
  ]);
  return json({ print: toPrint(row) });
}

/**
 * PATCH /api/prints/<printId> { status?, duration?, progress?, fingerprint?, summary? } -> { print }
 * The printer said how it went (printing, printed, failed, cancelled), or
 * "Keep as printed" took the plate as it is now (fingerprint + summary).
 */
export async function update(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const b = await readJson<Record<string, unknown>>(request, MAX_SUMMARY + 8192);
  const r = await env.DB!.prepare('SELECT * FROM project_prints WHERE user_id = ? AND id = ?').bind(user.id, id).first<PrintRow>();
  if (!r) throw new HttpError(404, 'No such print');
  const next = { ...r };
  if (b.status !== undefined) {
    const s = String(b.status);
    if (!STATUSES.includes(s) || ['uploaded', 'sent', 'marked', 'unmarked', 'unknown'].includes(s)) throw new HttpError(400, 'Bad status');
    // Another page may have seen the end first: an ended print stays ended.
    if (!OPEN.includes(r.status)) return json({ print: toPrint(r) });
    next.status = s;
    if (s !== 'printing') next.ended_at = Date.now();
  }
  if (b.duration !== undefined) next.duration = num(b.duration);
  if (b.progress !== undefined) next.progress = num(b.progress);
  if (b.fingerprint !== undefined) {
    next.fingerprint = text(b.fingerprint, 64);
    next.summary = summaryOf(b.summary);
  }
  await env.DB!.prepare(
    'UPDATE project_prints SET status = ?, ended_at = ?, duration = ?, progress = ?, fingerprint = ?, summary = ? WHERE user_id = ? AND id = ?',
  )
    .bind(next.status, next.ended_at, next.duration, next.progress, next.fingerprint, next.summary, user.id, id)
    .run();
  return json({ print: toPrint(next) });
}

/**
 * POST /api/projects/<id>/prints/plates { order } -> { ok }
 * The plates were deleted or reordered: order[new index] = old index; a plate
 * left out was deleted and its rows go.
 */
export async function plates(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const { order } = await readJson<{ order?: unknown }>(request, 64 * 1024);
  if (!Array.isArray(order) || order.length > 1000) throw new HttpError(400, 'Bad order');
  const olds = order.map(plateOf);
  if (new Set(olds).size !== olds.length) throw new HttpError(400, 'Bad order');
  const d = env.DB!;
  // Through negative numbers, so no two plates share an index on the way.
  await d.batch([
    olds.length
      ? d.prepare(`DELETE FROM project_prints WHERE user_id = ? AND project_id = ? AND plate NOT IN (${olds.map(() => '?').join(',')})`).bind(user.id, id, ...olds)
      : d.prepare('DELETE FROM project_prints WHERE user_id = ? AND project_id = ?').bind(user.id, id),
    ...olds.map((old, i) => d.prepare('UPDATE project_prints SET plate = ? WHERE user_id = ? AND project_id = ? AND plate = ?').bind(-1 - i, user.id, id, old)),
    d.prepare('UPDATE project_prints SET plate = -1 - plate WHERE user_id = ? AND project_id = ? AND plate < 0').bind(user.id, id),
  ]);
  return json({ ok: true });
}

/** POST /api/projects/<id>/prints/copy { from } -> { ok }: a saved copy starts with the original's history. */
export async function copy(env: Env, request: Request, rawId: string): Promise<Response> {
  requireSameOrigin(request);
  const user = await requireUser(env, request);
  const id = validId(rawId);
  const { from } = await readJson<{ from?: unknown }>(request, 4096);
  const src = validId(String(from ?? ''));
  await mustProject(env, user.id, id);
  const rows = await env.DB!.prepare('SELECT * FROM project_prints WHERE user_id = ? AND project_id = ?').bind(user.id, src).all<PrintRow>();
  const d = env.DB!;
  // Prints still waiting for the printer stay the original's: its answer goes there.
  const stmts = rows.results.filter((r) => !OPEN.includes(r.status)).map((r) =>
    d
      .prepare(
        `INSERT INTO project_prints (user_id, project_id, id, plate, status, at, ended_at, duration, progress, printer, printer_name, file, fingerprint, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(user.id, id, crypto.randomUUID(), r.plate, r.status, r.at, r.ended_at, r.duration, r.progress, r.printer, r.printer_name, r.file, r.fingerprint, r.summary),
  );
  for (let i = 0; i < stmts.length; i += 50) await d.batch(stmts.slice(i, i + 50));
  return json({ ok: true });
}

/** How many plates of each project have a printed mark now (the Projects list's "6/10 printed"). */
export async function printedCounts(env: Env, userId: string): Promise<Map<string, number>> {
  const rows = await env.DB!.prepare(
    "SELECT project_id, plate, status, at FROM project_prints WHERE user_id = ? AND status IN ('printed', 'marked', 'unmarked') ORDER BY at",
  )
    .bind(userId)
    .all<{ project_id: string; plate: number; status: string }>();
  const last = new Map<string, string>();
  for (const r of rows.results) last.set(`${r.project_id}\n${r.plate}`, r.status);
  const out = new Map<string, number>();
  for (const [k, s] of last) {
    if (s === 'unmarked') continue;
    const p = k.split('\n')[0];
    out.set(p, (out.get(p) ?? 0) + 1);
  }
  return out;
}
