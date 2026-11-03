import { describe, expect, it, vi } from 'vitest';
import type { BridgeStatus, LinkHandlers, PrinterLink, RpcMessage } from './link/types';
import { CHECK_MS, PrinterSession } from './session';

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

describe('printer session when the network changes', () => {
  it('reconnects at once instead of waiting out the back-off', async () => {
    // The test runs outside a browser: a stand-in window and page to send the events.
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    const { link } = fakeLink();
    let opens = 0;
    const open = link.open.bind(link);
    link.open = async (h) => {
      opens++;
      if (opens === 1) throw new Error('no network');
      return open(h);
    };
    const states: string[] = [];
    const s = new PrinterSession(link, { onState: (st) => states.push(st), onObjects: noop, onFacts: noop, onConsole: noop, onFilesChanged: noop });
    s.start();
    await settle();
    expect(states.at(-1)).toBe('offline');
    win.dispatchEvent(new Event('online'));
    await settle();
    await settle();
    expect(opens).toBe(2);
    expect(states.at(-1)).toBe('online');
    s.stop();
    vi.unstubAllGlobals();
  });

  it('a connection that no longer answers is started again', async () => {
    const { link } = fakeLink();
    const s = new PrinterSession(link, { onState: noop, onObjects: noop, onFacts: noop, onConsole: noop, onFilesChanged: noop });
    s.start();
    await settle();
    await settle();
    let opens = 0;
    const send = link.send.bind(link);
    link.send = () => {}; // the old network: nothing comes back
    const open = link.open.bind(link);
    link.open = async (h) => {
      opens++;
      link.send = send;
      return open(h);
    };
    vi.useFakeTimers();
    const checked = s.checkNow();
    vi.advanceTimersByTime(CHECK_MS);
    vi.useRealTimers();
    await checked;
    expect(opens).toBe(1);
    s.stop();
  });
});
