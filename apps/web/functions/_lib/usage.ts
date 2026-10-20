// Use of Cloudflare's free tier, for the Admin page. What D1 knows (users,
// saved project bytes, bridges) is always there; today's request counts come
// from Cloudflare's GraphQL Analytics API when the site has a read-only
// analytics token (CF_ANALYTICS_TOKEN + CF_ACCOUNT_ID), and are left out
// otherwise.
import type { Env } from './types';

/** Free plan limits (https://developers.cloudflare.com/workers/platform/pricing/). */
export const FREE = {
  r2Bytes: 10 * 1024 ** 3,
  /** Our own cap for online projects, under R2's 10 GB (projects.ts LIMITS.siteBytes). */
  projectBytes: 8 * 1024 ** 3,
  d1Bytes: 5 * 1024 ** 3,
  d1RowsReadPerDay: 5_000_000,
  d1RowsWrittenPerDay: 100_000,
  workerRequestsPerDay: 100_000,
  doRequestsPerDay: 100_000,
};

export interface Meter {
  key: string;
  label: string;
  used: number;
  limit: number;
  unit: 'bytes' | 'count';
  /** What it means, in a few words. */
  note?: string;
}

export interface Usage {
  meters: Meter[];
  /** Why today's request counts are missing, when they are. */
  analytics: 'ok' | 'not-set-up' | 'failed';
  analyticsError?: string;
}

async function graphql<T>(env: Env, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] | null };
  if (!res.ok || body.errors?.length) throw new Error(body.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`);
  return body.data as T;
}

type Accounts<T> = { viewer: { accounts: T[] } };
const sumOf = <K extends string>(groups: { sum: Record<K, number> }[] | undefined, k: K) => (groups ?? []).reduce((n, g) => n + (g.sum[k] ?? 0), 0);

/** Today's (UTC) counts, one query per dataset so one unknown field doesn't hide the rest. */
async function today(env: Env): Promise<{ meters: Meter[]; errors: string[] }> {
  const date = new Date().toISOString().slice(0, 10);
  const vars = { account: env.CF_ACCOUNT_ID, date };
  const meters: Meter[] = [];
  const errors: string[] = [];
  const run = async <T>(name: string, fields: string, use: (a: T) => void) => {
    try {
      const d = await graphql<Accounts<T>>(
        env,
        `query($account: String!, $date: Date!) { viewer { accounts(filter: { accountTag: $account }) { ${fields} } } }`,
        vars,
      );
      const a = d.viewer.accounts[0];
      if (a) use(a);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  };
  await Promise.all([
    run<{ w: { sum: { requests: number } }[] }>('Workers', 'w: workersInvocationsAdaptive(limit: 10000, filter: { date: $date }) { sum { requests } }', (a) =>
      meters.push({
        key: 'workers',
        label: 'Site and relay requests today',
        used: sumOf(a.w, 'requests'),
        limit: FREE.workerRequestsPerDay,
        unit: 'count',
        note: 'Every /api call and relay connection. Over the limit, they fail until 00:00 UTC.',
      }),
    ),
    run<{ d: { sum: { requests: number } }[] }>('Durable Objects', 'd: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { date: $date }) { sum { requests } }', (a) => {
      const raw = sumOf(a.d, 'requests');
      meters.push({
        key: 'relay',
        label: 'Relay (bridge) requests today',
        // Nearly all of these are websocket messages, which the free tier counts 20 to 1.
        used: Math.round(raw / 20),
        limit: FREE.doRequestsPerDay,
        unit: 'count',
        note: `About: ${raw.toLocaleString('en')} messages, counted 20 to 1. Mostly bridge cameras.`,
      });
    }),
    run<{ d1: { sum: { rowsRead: number; rowsWritten: number } }[] }>(
      'D1',
      'd1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date: $date }) { sum { rowsRead rowsWritten } }',
      (a) => {
        meters.push({ key: 'd1-read', label: 'Database rows read today', used: sumOf(a.d1, 'rowsRead'), limit: FREE.d1RowsReadPerDay, unit: 'count' });
        meters.push({ key: 'd1-write', label: 'Database rows written today', used: sumOf(a.d1, 'rowsWritten'), limit: FREE.d1RowsWrittenPerDay, unit: 'count' });
      },
    ),
  ]);
  return { meters, errors };
}

export async function usage(env: Env): Promise<Usage> {
  const d = env.DB!;
  const [users, projects, bridges] = await Promise.all([
    d.prepare('SELECT COUNT(*) AS n FROM "user"').first<{ n: number }>(),
    d.prepare('SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS n FROM projects').first<{ bytes: number; n: number }>(),
    d.prepare('SELECT COUNT(DISTINCT bridge_id) AS n FROM relay_bridges').first<{ n: number }>().catch(() => ({ n: 0 })),
  ]);
  const meters: Meter[] = [
    {
      key: 'projects',
      label: 'Online projects storage',
      used: projects?.bytes ?? 0,
      limit: FREE.projectBytes,
      unit: 'bytes',
      note: `${(projects?.n ?? 0).toLocaleString('en')} projects. The site stops taking new ones at 8 GB (R2 is free up to 10 GB).`,
    },
    { key: 'users', label: 'Accounts', used: users?.n ?? 0, limit: 0, unit: 'count' },
    {
      key: 'bridges',
      label: 'Bridges in use',
      used: bridges?.n ?? 0,
      limit: 75,
      unit: 'count',
      note: 'About 75 bridges used for a few hours a day fit in the relay’s free requests.',
    },
  ];
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return { meters, analytics: 'not-set-up' };
  const t = await today(env);
  return {
    meters: [...meters, ...t.meters],
    analytics: t.errors.length && !t.meters.length ? 'failed' : 'ok',
    analyticsError: t.errors.join(' · ') || undefined,
  };
}
