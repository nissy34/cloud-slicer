import { describe, expect, it } from 'vitest';
import type { BridgeStatus, LinkHandlers, PrinterLink, RpcMessage } from './link/types';
import { PrinterSession } from './session';

/** A link that answers like Moonraker and lets the test speak as the relay. */
function fakeLink() {
  let h: LinkHandlers | null = null;
  const calls: string[] = [];
  const link = {
    label: 'fake',
    async open(handlers: LinkHandlers) {
      h = handlers;
    },
    close() {},
    send(msg: RpcMessage) {
      calls.push(msg.method ?? '');
      const result =
        msg.method === 'server.info'
          ? { klippy_state: 'ready' }
          : msg.method === 'printer.objects.list'
            ? { objects: ['print_stats'] }
            : msg.method === 'printer.objects.subscribe'
              ? { status: { print_stats: { state: 'printing' } } }
              : {};
      queueMicrotask(() => h?.onMessage({ jsonrpc: '2.0', id: msg.id, result } as RpcMessage));
    },
  } as unknown as PrinterLink;
  const bridge = (agent: BridgeStatus['agent']) => h?.onBridge?.({ agent, printers: [] });
  return { link, calls, bridge };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const noop = () => {};

describe('printer session through the bridge', () => {
  it('subscribes again when the bridge comes back while the page stayed connected', async () => {
    const { link, calls, bridge } = fakeLink();
    const s = new PrinterSession(link, { onState: noop, onObjects: noop, onFacts: noop, onConsole: noop, onFilesChanged: noop });
    s.start();
    await settle();
    bridge('online'); // the status the relay sends with the socket
    await settle();
    const subscribes = () => calls.filter((m) => m === 'printer.objects.subscribe').length;
    expect(subscribes()).toBe(1);
    bridge('offline');
    bridge('online'); // the bridge said hello again: a fresh printer connection with no subscription
    await settle();
    await settle();
    expect(subscribes()).toBe(2);
    s.stop();
  });
});
