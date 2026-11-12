// Talks to one engine in its own thread (worker.ts). Calls run one at a time,
// in order, like the site's engine client: the engine holds one project.
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

export type Progress = (pct: number, stage: string) => void;

export interface EngineInfo {
  flavor: 'snapmaker' | 'orca';
  name: string;
  version: string;
  mixing?: boolean;
}

export class EngineStopped extends Error {}

export class EngineClient {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; progress?: Progress }>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<EngineInfo>;
  stopped: string | null = null;

  /** `dir`: the engine's folder (orca-engine.js, orca-engine.wasm, profiles.json, profiles/). */
  constructor(dir: string, here: string) {
    this.worker = new Worker(resolve(here, 'worker.mjs'), { workerData: { dir } });
    this.ready = new Promise((ok, fail) => {
      this.worker.once('message', (m) => (m.ready ? ok(m.info) : fail(new Error('the engine did not start'))));
      this.worker.once('error', fail);
    });
    this.worker.on('message', (m) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.progress) return p.progress?.(m.progress.pct, m.progress.stage);
      this.pending.delete(m.id);
      if ('error' in m) p.reject(new Error(m.error));
      else p.resolve(m.result);
    });
    // A wasm trap (out of memory) or a crash ends the thread: everything still
    // waiting fails, and the server starts a fresh engine on the next call.
    const stop = (why: string) => {
      this.stopped = why;
      for (const p of this.pending.values()) p.reject(new EngineStopped(why));
      this.pending.clear();
    };
    this.worker.on('error', (e) => stop(e.message));
    this.worker.on('exit', (code) => stop(`the engine stopped (exit ${code})`));
  }

  request<T = unknown>(method: string, args: unknown[] = [], progress?: Progress): Promise<T> {
    const run = () =>
      new Promise<T>((ok, fail) => {
        if (this.stopped) return fail(new EngineStopped(this.stopped));
        const id = this.next++;
        this.pending.set(id, { resolve: ok as (v: unknown) => void, reject: fail, progress });
        this.worker.postMessage({ id, method, args });
      });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async close() {
    await this.worker.terminate();
  }
}
