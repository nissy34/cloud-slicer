/**
 * Wraps an async job so bursts of calls run it at most once at a time and at
 * most once per `gapMs`: calls that arrive while it runs, or too soon after,
 * fold into one trailing run. Every caller's promise settles when a run that
 * started after its call has finished.
 */
export function coalesce(job: () => Promise<void>, gapMs: number): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let lastStart = -Infinity;
  const run = (): Promise<void> => {
    lastStart = Date.now();
    running = job()
      .catch(() => {})
      .finally(() => {
        running = null;
      });
    return running;
  };
  return () => {
    if (queued) return queued;
    const wait = Math.max(0, lastStart + gapMs - Date.now());
    if (!running && wait === 0) return run();
    queued = (async () => {
      if (running) await running;
      const rest = Math.max(0, lastStart + gapMs - Date.now());
      if (rest) await new Promise((r) => setTimeout(r, rest));
      queued = null;
      await run();
    })();
    return queued;
  };
}
