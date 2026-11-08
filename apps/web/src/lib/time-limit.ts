// Time limits and Cancel for network requests. A fetch on a connection that
// stalls (VPN, Wi-Fi change, a laptop waking up) can wait forever without
// failing; a save waiting on one would say "Saving…" for good (#276).

/** The person pressed Cancel. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}

/** The other side didn't answer within the time limit. */
export class TimedOut extends Error {
  constructor(message = "It didn't answer in time") {
    super(message);
    this.name = 'TimedOut';
  }
}

export const isCancelled = (e: unknown) => e instanceof Cancelled;

/** A signal that fires after `ms` (Infinity: never), or when `signal` (Cancel) fires first. */
export function within(ms: number, signal?: AbortSignal): AbortSignal {
  const ctl = new AbortController();
  if (signal?.aborted) ctl.abort();
  const t = Number.isFinite(ms) ? setTimeout(() => ctl.abort(), ms) : undefined;
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(t);
      ctl.abort();
    },
    { once: true },
  );
  return ctl.signal;
}

/**
 * fetch with a time limit (for the answer and its body, which the caller reads
 * within the same time). Rejects with Cancelled when `signal` fired, TimedOut
 * when the time ran out, else as fetch does.
 */
export async function fetchWithin(ms: number, url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  if (signal?.aborted) throw new Cancelled();
  const limit = within(ms, signal);
  try {
    return await fetch(url, { ...init, signal: limit });
  } catch (e) {
    throw failure(e, limit, signal);
  }
}

/** What an error thrown while `limit` was running means. */
export function failure(e: unknown, limit: AbortSignal, signal?: AbortSignal): unknown {
  if (signal?.aborted) return new Cancelled();
  if (limit.aborted) return new TimedOut();
  return e;
}

/** Waits for `work`, or rejects with Cancelled as soon as `signal` fires (the work itself carries on). */
export function unlessCancelled<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Cancelled());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Cancelled());
    signal.addEventListener('abort', stop, { once: true });
    work.then(
      (v) => (signal.removeEventListener('abort', stop), resolve(v)),
      (e) => (signal.removeEventListener('abort', stop), reject(e)),
    );
  });
}
