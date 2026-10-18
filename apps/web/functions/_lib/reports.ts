// Engine start-up failures sent by the page (POST /api/engine-errors). CI prints
// the latest ones after each deploy, so a failure on someone's machine can be
// read without them copying it from the console.
import { HttpError, json, readJson, requireSameOrigin } from './http';
import type { Env } from './types';

const KEEP = 200;
const clip = (v: unknown, max: number) => String(v ?? '').slice(0, max);

export async function engineError(env: Env, request: Request): Promise<Response> {
  requireSameOrigin(request);
  if (!env.DB) throw new HttpError(503, 'Reports are not set up');
  const body = await readJson<{ message?: string; stack?: string; engineVersion?: string }>(request, 16 * 1024);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO engine_errors (created_at, user_agent, engine_version, message, stack) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      Date.now(),
      clip(request.headers.get('User-Agent'), 500),
      clip(body.engineVersion, 40),
      clip(body.message, 1000),
      clip(body.stack, 8000),
    ),
    env.DB.prepare(`DELETE FROM engine_errors WHERE id <= (SELECT MAX(id) FROM engine_errors) - ${KEEP}`),
  ]);
  return json({ ok: true });
}
