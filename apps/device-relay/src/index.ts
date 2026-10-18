// Relay between browsers and bridge agents. Each bridge (one per home network)
// is a Durable Object holding the agent's websocket and the browsers'
// websockets, and passing messages between them unchanged:
//
//   browser  --text-->  relay  --{c, m: text}-->  agent  --> printer's Moonraker
//   browser  <--text--  relay  <--{c, m: text}--  agent
//
// Control messages: agent -> relay {ctl:'hello', printers, version} and
// {ctl:'drop', c, reason}; relay -> agent {ctl:'open', c, printer} and
// {ctl:'close', c}. Browsers also get notify_bridge_status notifications.
// Sockets hibernate, so an idle bridge costs nothing.
import { DurableObject } from 'cloudflare:workers';
import agentSource from '../../device-bridge/bridge.mjs';

export interface Env {
  BRIDGE: DurableObjectNamespace<Bridge>;
  /** Websocket connects per IP (wrangler.toml [[ratelimits]]). */
  CONNECT_LIMIT: RateLimit;
  /** New bridge ids claimed per IP. */
  CLAIM_LIMIT: RateLimit;
}

const BRIDGE_ID = /^[\w-]{8,64}$/;
const MAX_CLIENTS = 16;
const MAX_MESSAGE = 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The key browsers use, derived from the agent's secret key. The pairing code
 * carries only this one, so holding a pairing code is not enough to connect
 * as the bridge agent. Same derivation as browserKey() in bridge.mjs.
 */
async function browserKey(key: string): Promise<string> {
  const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode('cloud-slicer browser key')));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const clientIp = (req: Request) => req.headers.get('CF-Connecting-IP') ?? 'unknown';

/** Constant-time comparison of two hex digests. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/bridge.mjs') {
      // ?site= is the page the user downloaded it from, so pairing links open that same site.
      const site = /^https:\/\/[\w.-]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.exec(url.searchParams.get('site') ?? '')?.[0];
      return new Response(agentSource.replaceAll('__RELAY_URL__', url.origin).replaceAll('__SITE_URL__', site ?? '__SITE_URL__'), {
        headers: { ...cors, 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Disposition': 'attachment; filename="cloud-slicer-bridge.mjs"' },
      });
    }
    const m = /^\/v1\/bridges\/([^/]+)\/(agent|client)$/.exec(url.pathname);
    if (m) {
      if (!BRIDGE_ID.test(m[1])) return new Response('Bad bridge id', { status: 400, headers: cors });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426, headers: cors });
      if (!(await env.CONNECT_LIMIT.limit({ key: clientIp(req) })).success) return new Response('Too many connections; try again in a minute.', { status: 429, headers: cors });
      return env.BRIDGE.get(env.BRIDGE.idFromName(m[1])).fetch(req);
    }
    if (url.pathname === '/') {
      return new Response('Cloud Slicer device relay. Download the bridge agent from /bridge.mjs.\n', { headers: { ...cors, 'Content-Type': 'text/plain' } });
    }
    return new Response('Not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;

interface ClientAttachment {
  id: string;
  printer: string;
}

interface BridgeInfo {
  printers: { id: string; name: string }[];
  version: string;
}

export class Bridge extends DurableObject<Env> {
  private agent(): WebSocket | undefined {
    return this.ctx.getWebSockets('agent')[0];
  }

  private clients(): WebSocket[] {
    return this.ctx.getWebSockets('client');
  }

  private async info(): Promise<BridgeInfo> {
    return (await this.ctx.storage.get<BridgeInfo>('info')) ?? { printers: [], version: '' };
  }

  private statusMessage(info: BridgeInfo, online: boolean) {
    return JSON.stringify({ jsonrpc: '2.0', method: 'notify_bridge_status', params: [{ agent: online ? 'online' : 'offline', printers: info.printers, version: info.version }] });
  }

  private async broadcastStatus(online: boolean) {
    const msg = this.statusMessage(await this.info(), online);
    for (const ws of this.clients()) ws.send(msg);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const role = url.pathname.endsWith('/agent') ? 'agent' : 'client';
    const key = url.searchParams.get('key') ?? '';
    const pair = new WebSocketPair();
    const [browserEnd, ours] = Object.values(pair);

    const reject = (code: number, reason: string) => {
      // Accept, then close with a reason, so the browser can show why.
      ours.accept();
      ours.close(code, reason);
      return new Response(null, { status: 101, webSocket: browserEnd });
    };

    if (key.length < 16 || key.length > 128) return reject(4003, 'Wrong pairing code.');
    const hash = await sha256(key);
    const stored = await this.ctx.storage.get<string>('keyHash');

    if (role === 'agent') {
      // The first agent to connect claims the bridge id; later ones must hold the same key.
      if (!stored) {
        if (!(await this.env.CLAIM_LIMIT.limit({ key: clientIp(req) })).success) return reject(4029, 'Too many new bridges from this address; try again later.');
        await this.ctx.storage.put('keyHash', hash);
      } else if (!same(stored, hash)) return reject(4003, 'This bridge id belongs to someone else.');
      // Bridges claimed before browser keys existed learn theirs on their next connect.
      if (!(await this.ctx.storage.get<string>('clientHash'))) await this.ctx.storage.put('clientHash', await sha256(await browserKey(key)));
      for (const old of this.ctx.getWebSockets('agent')) old.close(4000, 'Another bridge agent connected with this id.');
      this.ctx.acceptWebSocket(ours, ['agent']);
      return new Response(null, { status: 101, webSocket: browserEnd });
    }

    const clientHash = await this.ctx.storage.get<string>('clientHash');
    if (!stored) return reject(4003, 'This bridge has never connected. Start the bridge first.');
    if (same(stored, hash)) return reject(4003, 'This pairing code is from an older bridge. Download the new bridge, restart it and pair again.');
    if (!clientHash) return reject(4003, 'Restart the bridge, then pair again.');
    if (!same(clientHash, hash)) return reject(4003, 'Wrong pairing code.');
    if (this.clients().length >= MAX_CLIENTS) return reject(4029, 'Too many open windows for this bridge.');
    const id = crypto.randomUUID().slice(0, 8);
    const printer = (url.searchParams.get('printer') ?? '').slice(0, 64);
    this.ctx.acceptWebSocket(ours, ['client', `c:${id}`]);
    ours.serializeAttachment({ id, printer } satisfies ClientAttachment);
    const agent = this.agent();
    ours.send(this.statusMessage(await this.info(), !!agent));
    if (agent && printer) agent.send(JSON.stringify({ ctl: 'open', c: id, printer }));
    return new Response(null, { status: 101, webSocket: browserEnd });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    const tags = this.ctx.getTags(ws);

    if (tags.includes('agent')) {
      let msg: { ctl?: string; c?: string; m?: string; reason?: string; printers?: unknown; version?: unknown };
      try {
        msg = JSON.parse(message);
      } catch {
        return;
      }
      if (msg.ctl === 'hello') {
        const printers = (Array.isArray(msg.printers) ? msg.printers : [])
          .slice(0, 32)
          .map((p: { id?: unknown; name?: unknown }) => ({ id: String(p.id ?? '').slice(0, 64), name: String(p.name ?? '').slice(0, 80) }));
        await this.ctx.storage.put('info', { printers, version: String(msg.version ?? '') } satisfies BridgeInfo);
        await this.broadcastStatus(true);
        // Browsers that were waiting for the agent get their sessions now.
        for (const c of this.clients()) {
          const a = c.deserializeAttachment() as ClientAttachment;
          if (a.printer) ws.send(JSON.stringify({ ctl: 'open', c: a.id, printer: a.printer }));
        }
        return;
      }
      if (!msg.c) return;
      const client = this.ctx.getWebSockets(`c:${msg.c}`)[0];
      if (!client) {
        ws.send(JSON.stringify({ ctl: 'close', c: msg.c }));
        return;
      }
      if (msg.ctl === 'drop') client.close(4010, String(msg.reason ?? 'The bridge closed the connection.').slice(0, 120));
      else if (typeof msg.m === 'string') client.send(msg.m);
      return;
    }

    const a = ws.deserializeAttachment() as ClientAttachment;
    const agent = this.agent();
    if (agent && a.printer) {
      agent.send(JSON.stringify({ c: a.id, m: message }));
      return;
    }
    // No agent: answer requests at once rather than letting them time out.
    try {
      const msg = JSON.parse(message) as { id?: unknown };
      if (msg.id != null) ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: agent ? 'No printer chosen.' : 'The bridge is offline.' } }));
    } catch {
      // not JSON
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.closed(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.closed(ws);
  }

  private async closed(ws: WebSocket) {
    const tags = this.ctx.getTags(ws);
    if (tags.includes('agent')) {
      if (!this.ctx.getWebSockets('agent').some((other) => other !== ws)) await this.broadcastStatus(false);
      return;
    }
    const a = ws.deserializeAttachment() as ClientAttachment | null;
    if (a) this.agent()?.send(JSON.stringify({ ctl: 'close', c: a.id }));
  }
}
