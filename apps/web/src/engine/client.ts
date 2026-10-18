import type { ModelInfo, SliceOptions, SliceResult, WorkerReply } from './protocol';

type Pending = { resolve: (reply: WorkerReply) => void; reject: (e: Error) => void };

export interface EngineEvents {
  onReady(core: string): void;
  onProgress(pct: number, stage: string): void;
  onFatal(message: string): void;
}

/** Promise wrapper around the engine worker. One request runs at a time. */
export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private events: EngineEvents) {
    this.worker = new Worker('/engine/slicer-worker.js', { name: 'engine' });
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => this.receive(data);
    this.worker.onerror = (e) => events.onFatal(e.message || 'The engine worker failed to load.');
  }

  private receive(reply: WorkerReply) {
    switch (reply.type) {
      case 'ready':
        this.events.onReady(reply.core);
        return;
      case 'progress':
        this.events.onProgress(reply.pct, reply.stage);
        return;
      case 'log':
        return;
      case 'error':
        if (reply.id == null) {
          this.events.onFatal(reply.message);
          return;
        }
        this.pending.get(reply.id)?.reject(new Error(reply.message));
        this.pending.delete(reply.id);
        return;
      default:
        this.pending.get(reply.id)?.resolve(reply);
        this.pending.delete(reply.id);
    }
  }

  private request(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<WorkerReply> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }

  async load(file: File): Promise<{ info: ModelInfo; positions: Float32Array }> {
    const bytes = await file.arrayBuffer();
    const reply = await this.request({ type: 'load', name: file.name, bytes }, [bytes]);
    if (reply.type !== 'loaded') throw new Error('Unexpected reply from the engine.');
    return { info: reply.info, positions: reply.positions };
  }

  async slice(options: SliceOptions): Promise<{ result: SliceResult; gcode: ArrayBuffer; ms: number }> {
    const reply = await this.request({ type: 'slice', options });
    if (reply.type !== 'sliced') throw new Error('Unexpected reply from the engine.');
    return { result: reply.result, gcode: reply.gcode, ms: reply.ms };
  }
}
