// Relay between browsers and bridge agents. Each bridge (one per home network)
// is a Durable Object holding the agent's websocket and the browsers'
// websockets, and passing messages between them unchanged:
//
//   browser  --text-->  relay  --{c, m: text}-->  agent  --> printer's Moonraker
//   browser  <--text--  relay  <--{c, m: text}--  agent
//
// Control messages: agent -> relay {ctl:'hello', printers, version, build, place, system, host} and
// {ctl:'drop', c, reason}; relay -> agent {ctl:'open', c, printer} and
// {ctl:'close', c}. Browsers also get notify_bridge_status notifications.
// Sockets hibernate, so an idle bridge costs nothing.
//
// Accounts: when RELAY_TICKET_PUBLIC_KEY is set, a browser needs a ticket
// from the site (a JWT for one signed-in, allowed user and one bridge; see
// apps/web/functions/_lib/relay.ts), renewed over the socket with
// {relay:'ticket', ticket}. The first account to use a bridge owns it; a
// bridge nobody has used within UNOWNED_GRACE_MS of its first connect is
// turned away, and so is one whose owner was blocked (POST /v1/revoke).
//
// Print alerts (src/alerts.ts): a browser turns them on with the JSON-RPC call
// relay.alerts over its socket; the relay tells the agent what to watch with
// {ctl:'alerts', printers}, the agent answers {ctl:'alert', printer, event, ...},
// and the relay sends Web Push to each browser that wants it.
import { DurableObject } from 'cloudflare:workers';
import { importJWK, jwtVerify, type JWK, type JWTPayload } from 'jose';
import installScript from '../../device-bridge/install.sh';
import {
  agentConfig,
  cleanAlert,
  cleanPrefs,
  cleanSubscription,
  fanOut,
  MAX_ALERTS_PER_HOUR,
  MAX_PICTURE,
  MAX_PICTURES_PER_HOUR,
  MAX_SUBS,
  OFFLINE_AFTER_MS,
  pushEndpointOk,
  sendPush,
  subKey,
  urgentEvent,
  vapidPublicKey,
  type PushEnv,
  type StoredSub,
} from './alerts';
import { alertText } from '../../web/src/device/alert-text';

export interface Env extends PushEnv {
  BRIDGE: DurableObjectNamespace<Bridge>;
  /** Websocket connects per IP (wrangler.toml [[ratelimits]]). */
  CONNECT_LIMIT: RateLimit;
  /** New bridge ids claimed per IP. */
  CLAIM_LIMIT: RateLimit;
  /** The one-file bridge apps, uploaded by CI (.github/workflows/device.yml). */
  DOWNLOADS?: R2Bucket;
  /** The site's ticket public key (JWK). Unset: no accounts, anyone with a pairing code may connect. */
  RELAY_TICKET_PUBLIC_KEY?: string;
  /** CI's throwaway key for checking the deployed relay; good only for bridge ids starting "ci-". */
  RELAY_TEST_PUBLIC_KEY?: string;
  /**
   * Set only on the test relay (cloud-slicer-relay-test, see device.yml): what it
   * runs, like "PR #113" or "main". Its bridge downloads are test builds, named
   * so they install next to the real bridge.
   */
  TEST_RELAY?: string;
}

/** Bridge apps: download name -> the file name people get. Stored in R2 as bridge/<name>. */
export const APPS: Record<string, string> = {
  'windows-x64': 'cloud-slicer-bridge.exe',
  'mac-arm64': 'cloud-slicer-bridge-mac.zip',
  'mac-x64': 'cloud-slicer-bridge-mac-intel.zip',
  'linux-x64': 'cloud-slicer-bridge',
  'linux-arm64': 'cloud-slicer-bridge',
  'linux-armv7': 'cloud-slicer-bridge',
  'linux-mipsle': 'cloud-slicer-bridge',
};

const BRIDGE_ID = /^[\w-]{8,64}$/;
const MAX_CLIENTS = 16;
const MAX_MESSAGE = 1024 * 1024;
/** How long a new bridge may wait for its first signed-in browser before the relay turns it away. */
const UNOWNED_GRACE_MS = 7 * 24 * 3600 * 1000;
/** A camera counts as watched while frames were asked for in the last few seconds. */
const CAMERA_WINDOW_MS = 5000;

interface Ticket {
  user: string;
  bridge: string;
  exp: number;
  cams: number;
}

const keys = new Map<string, CryptoKey>();
async function publicKey(jwk: string): Promise<CryptoKey> {
  let k = keys.get(jwk);
  if (!k) keys.set(jwk, (k = (await importJWK(JSON.parse(jwk) as JWK, 'ES256')) as CryptoKey));
  return k;
}

/** Checks a ticket (or a revoke order) the site signed; `test` when it was CI's key. Throws when it isn't valid. */
async function verifyTicket(env: Env, token: string): Promise<{ payload: JWTPayload; test: boolean }> {
  const check = async (jwk: string) => {
    const { payload } = await jwtVerify(token, await publicKey(jwk), { audience: 'cloud-slicer-relay', algorithms: ['ES256'] });
    if (!payload.sub || !payload.exp) throw new Error('incomplete');
    return payload;
  };
  try {
    return { payload: await check(env.RELAY_TICKET_PUBLIC_KEY!), test: false };
  } catch (e) {
    if (!env.RELAY_TEST_PUBLIC_KEY) throw e;
    return { payload: await check(env.RELAY_TEST_PUBLIC_KEY), test: true };
  }
}

const testBridge = (id: string) => id.startsWith('ci-');

async function readTicket(env: Env, token: string, bridge: string): Promise<Ticket | null> {
  try {
    const { payload: p, test } = await verifyTicket(env, token);
    if (p.b !== bridge || (test && !testBridge(bridge))) return null;
    return { user: p.sub!, bridge, exp: p.exp! * 1000, cams: Math.max(1, Math.min(16, Number(p.cams) || 2)) };
  } catch {
    return null;
  }
}

/** Accepts then closes a websocket with a reason, so the browser can show why. */
function refuseSocket(code: number, reason: string) {
  const [theirs, ours] = Object.values(new WebSocketPair());
  ours.accept();
  ours.close(code, reason);
  return new Response(null, { status: 101, webSocket: theirs });
}

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
 * as the bridge agent. Same derivation as browserKey() in the bridge (pairing.go).
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
    if (url.pathname === '/install.sh') {
      return new Response(installScript.replaceAll('__RELAY_URL__', url.origin), { headers: { ...cors, 'Content-Type': 'text/x-shellscript; charset=utf-8' } });
    }
    if (url.pathname === '/downloads.json') {
      // Which apps CI has uploaded, so the Device tab only offers what exists.
      const listed = env.DOWNLOADS ? await env.DOWNLOADS.list({ prefix: 'bridge/' }) : { objects: [] };
      const apps = listed.objects
        .map((o) => ({ name: o.key.slice('bridge/'.length), size: o.size, uploaded: o.uploaded.toISOString() }))
        .filter((a) => a.name in APPS);
      // The newest signed build, so the Device tab can offer to update an older bridge.
      const release = env.DOWNLOADS ? await env.DOWNLOADS.get('bridge/release.json') : null;
      const build = release ? Number(((await release.json()) as { build?: unknown }).build) || undefined : undefined;
      return Response.json({ apps, build }, { headers: { ...cors, 'Cache-Control': 'max-age=60' } });
    }
    if (url.pathname === '/bridge-release.json') {
      // What bridges update themselves from: the newest build with each download's size,
      // SHA-256 and signature (made by CI with a key the relay never has; the bridges check it).
      const release = env.DOWNLOADS ? await env.DOWNLOADS.get('bridge/release.json') : null;
      if (!release) return new Response('No bridge release yet.\n', { status: 404, headers: cors });
      return new Response(release.body, { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } });
    }
    const dl = /^\/download\/([\w-]+)$/.exec(url.pathname);
    if (dl) {
      const file = APPS[dl[1]];
      const object = file && env.DOWNLOADS ? await env.DOWNLOADS.get(`bridge/${dl[1]}`) : null;
      if (!object) return new Response('That bridge app is not available yet.\n', { status: 404, headers: cors });
      return new Response(object.body, {
        headers: {
          ...cors,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(object.size),
          'Content-Disposition': `attachment; filename="${env.TEST_RELAY ? file.replace('cloud-slicer-bridge', 'cloud-slicer-bridge-test') : file}"`,
          'Cache-Control': 'no-cache',
          ETag: object.httpEtag,
        },
      });
    }
    if (url.pathname === '/v1/info') return Response.json({ accounts: Boolean(env.RELAY_TICKET_PUBLIC_KEY), push: vapidPublicKey(env), test: env.TEST_RELAY || undefined }, { headers: cors });
    const pic = /^\/v1\/pictures\/([0-9a-f-]{36})\.jpg$/.exec(url.pathname);
    if (pic) {
      // An alert's camera picture: only someone holding its (random) name can fetch it, for a day.
      const object = env.DOWNLOADS ? await env.DOWNLOADS.get(`alerts/${pic[1]}`) : null;
      if (!object) return new Response('That picture is gone.\n', { status: 404, headers: cors });
      return new Response(object.body, { headers: { ...cors, 'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
    }
    if (url.pathname === '/v1/revoke' && req.method === 'POST') {
      // The site blocked (or unblocked) an account: its browsers on these bridges go now.
      if (!env.RELAY_TICKET_PUBLIC_KEY) return new Response('Accounts are off on this relay', { status: 404, headers: cors });
      let order: JWTPayload;
      let test = false;
      try {
        ({ payload: order, test } = await verifyTicket(env, (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')));
      } catch {
        return new Response('Bad signature', { status: 403, headers: cors });
      }
      const bridges = (Array.isArray(order.revoke) ? order.revoke : [])
        .filter((b): b is string => typeof b === 'string' && BRIDGE_ID.test(b) && (!test || testBridge(b)))
        .slice(0, 50);
      const body = JSON.stringify({
        user: order.sub,
        blocked: order.blocked === true,
        // From the site itself: turn whole bridges off or on, or drop signed-out browsers.
        bridgeOff: order.sub === 'site' && typeof order.bridgeOff === 'boolean' ? order.bridgeOff : undefined,
        guests: order.sub === 'site' && order.guests === true,
      });
      await Promise.all(bridges.map((b) => env.BRIDGE.get(env.BRIDGE.idFromName(b)).fetch('https://bridge/revoke', { method: 'POST', body })));
      return Response.json({ ok: true, bridges: bridges.length }, { headers: cors });
    }
    const m = /^\/v1\/bridges\/([^/]+)\/(agent|client)$/.exec(url.pathname);
    if (m) {
      if (!BRIDGE_ID.test(m[1])) return new Response('Bad bridge id', { status: 400, headers: cors });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426, headers: cors });
      if (!(await env.CONNECT_LIMIT.limit({ key: clientIp(req) })).success) return new Response('Too many connections; try again in a minute.', { status: 429, headers: cors });
      // Browsers need the site's ticket; it is checked here, before the bridge's Durable Object is woken.
      const headers = new Headers(req.headers);
      headers.delete('X-Relay-Ticket');
      // Where alert pictures are served from, and which bridge this is (alerts name it, to open the right printer).
      headers.set('X-Relay-Origin', url.origin);
      headers.set('X-Bridge-Id', m[1]);
      if (m[2] === 'client' && env.RELAY_TICKET_PUBLIC_KEY) {
        const t = await readTicket(env, url.searchParams.get('ticket') ?? '', m[1]);
        if (!t) return refuseSocket(4401, 'Sign in to Cloud Slicer to use the bridge.');
        headers.set('X-Relay-Ticket', JSON.stringify(t));
      }
      return env.BRIDGE.get(env.BRIDGE.idFromName(m[1])).fetch(new Request(req, { headers }));
    }
    if (url.pathname === '/') {
      return new Response('Cloud Slicer device relay. Bridge apps: /downloads.json and /download/<system> (self-update: /bridge-release.json); macOS, Linux and Raspberry Pi: curl -fsSL <this relay>/install.sh | sh.\n', { headers: { ...cors, 'Content-Type': 'text/plain' } });
    }
    return new Response('Not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;

interface RevokeOrder {
  user: string;
  blocked: boolean;
  bridgeOff?: boolean;
  guests?: boolean;
}

interface ClientAttachment {
  id: string;
  printer: string;
  /** With accounts: whose ticket, and until when (ms). */
  user?: string;
  bridge?: string;
  exp?: number;
  cams?: number;
}

interface BridgeInfo {
  printers: { id: string; name: string }[];
  version: string;
  /** When the bridge was built (the commit's Unix time); "0" for a build that doesn't update itself. */
  build?: string;
  /** 'printer' when the bridge runs on the printer's own Klipper computer. */
  place?: 'printer';
  /** The bridge computer's system (win32, darwin, linux), so the Device tab's help fits it. */
  system?: string;
  /** The bridge computer's name, so the Device tab can call the bridge "Bridge on <name>". */
  host?: string;
}

export class Bridge extends DurableObject<Env> {
  /** Cameras each account is watching right now: user -> camera url -> last frame asked (ms). */
  private cameras = new Map<string, Map<string, number>>();

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
    return JSON.stringify({ jsonrpc: '2.0', method: 'notify_bridge_status', params: [{ agent: online ? 'online' : 'offline', printers: info.printers, version: info.version, build: info.build, place: info.place, system: info.system, host: info.host }] });
  }

  private async broadcastStatus(online: boolean) {
    const msg = this.statusMessage(await this.info(), online);
    for (const ws of this.clients()) ws.send(msg);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/revoke') return this.revoke((await req.json()) as RevokeOrder);
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
      if (this.env.RELAY_TICKET_PUBLIC_KEY) {
        if (await this.ctx.storage.get<boolean>('off')) return reject(4003, "The site's owner turned this bridge off.");
        if (await this.ctx.storage.get<boolean>('blocked')) return reject(4003, "This bridge's Cloud Slicer account is blocked.");
        // Bridges from before accounts start their wait now.
        let claimedAt = await this.ctx.storage.get<number>('claimedAt');
        if (!claimedAt) await this.ctx.storage.put('claimedAt', (claimedAt = Date.now()));
        if (!(await this.ctx.storage.get<string>('owner')) && Date.now() - claimedAt > UNOWNED_GRACE_MS)
          return reject(4003, 'Open the pairing link on Cloud Slicer while signed in, then restart the bridge.');
      }
      // Bridges claimed before browser keys existed learn theirs on their next connect.
      if (!(await this.ctx.storage.get<string>('clientHash'))) await this.ctx.storage.put('clientHash', await sha256(await browserKey(key)));
      for (const old of this.ctx.getWebSockets('agent')) old.close(4000, 'Another bridge agent connected with this id.');
      this.ctx.acceptWebSocket(ours, ['agent']);
      // Back before the "bridge offline" alert went out.
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete('offlineSent');
      const origin = req.headers.get('X-Relay-Origin');
      if (origin) await this.ctx.storage.put('origin', origin);
      const bridgeId = req.headers.get('X-Bridge-Id');
      if (bridgeId) await this.ctx.storage.put('bridgeId', bridgeId);
      return new Response(null, { status: 101, webSocket: browserEnd });
    }

    const clientHash = await this.ctx.storage.get<string>('clientHash');
    if (!stored) return reject(4003, 'This bridge has never connected. Start the bridge first.');
    if (same(stored, hash)) return reject(4003, 'This pairing code is from an older bridge. Download the new bridge, restart it and pair again.');
    if (!clientHash) return reject(4003, 'Restart the bridge, then pair again.');
    if (!same(clientHash, hash)) return reject(4003, 'Wrong pairing code.');
    if (this.clients().length >= MAX_CLIENTS) return reject(4029, 'Too many open windows for this bridge.');
    let ticket: Ticket | null = null;
    if (this.env.RELAY_TICKET_PUBLIC_KEY) {
      // Checked by the Worker in front; a request without it never came through there.
      ticket = JSON.parse(req.headers.get('X-Relay-Ticket') ?? 'null') as Ticket | null;
      if (!ticket) return reject(4401, 'Sign in to Cloud Slicer to use the bridge.');
      if (await this.ctx.storage.get<boolean>('off')) return reject(4403, "The site's owner turned this bridge off.");
      const owner = await this.ctx.storage.get<string>('owner');
      if (!owner) await this.ctx.storage.put('owner', ticket.user);
      else if (owner === ticket.user && (await this.ctx.storage.get<boolean>('blocked'))) return reject(4003, 'This account is blocked.');
    }
    const id = crypto.randomUUID().slice(0, 8);
    const printer = (url.searchParams.get('printer') ?? '').slice(0, 64);
    this.ctx.acceptWebSocket(ours, ['client', `c:${id}`]);
    ours.serializeAttachment({ id, printer, user: ticket?.user, bridge: ticket?.bridge, exp: ticket?.exp, cams: ticket?.cams } satisfies ClientAttachment);
    const agent = this.agent();
    ours.send(this.statusMessage(await this.info(), !!agent));
    if (agent && printer) agent.send(JSON.stringify({ ctl: 'open', c: id, printer }));
    return new Response(null, { status: 101, webSocket: browserEnd });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    const tags = this.ctx.getTags(ws);

    if (tags.includes('agent')) {
      let msg: { ctl?: string; c?: string; m?: string; reason?: string; printers?: unknown; version?: unknown; build?: unknown; place?: unknown; system?: unknown; host?: unknown };
      try {
        msg = JSON.parse(message);
      } catch {
        return;
      }
      if (msg.ctl === 'hello') {
        const printers = (Array.isArray(msg.printers) ? msg.printers : [])
          .slice(0, 32)
          .map((p: { id?: unknown; name?: unknown }) => ({ id: String(p.id ?? '').slice(0, 64), name: String(p.name ?? '').slice(0, 80) }));
        const system = ['win32', 'darwin', 'linux'].includes(String(msg.system)) ? String(msg.system) : undefined;
        const host = typeof msg.host === 'string' ? msg.host.replace(/[^\w .'-]/g, '').slice(0, 64) || undefined : undefined;
        await this.ctx.storage.put('info', { printers, version: String(msg.version ?? ''), build: /^\d{1,12}$/.test(String(msg.build)) ? String(msg.build) : undefined, place: msg.place === 'printer' ? 'printer' : undefined, system, host } satisfies BridgeInfo);
        await this.broadcastStatus(true);
        await this.sendAlertConfig();
        // Browsers that were waiting for the agent get their sessions now.
        for (const c of this.clients()) {
          const a = c.deserializeAttachment() as ClientAttachment;
          if (a.printer) ws.send(JSON.stringify({ ctl: 'open', c: a.id, printer: a.printer }));
        }
        return;
      }
      if (msg.ctl === 'alert') return this.alert(msg as Record<string, unknown>);
      if (!msg.c) return;
      const client = this.ctx.getWebSockets(`c:${msg.c}`)[0];
      if (!client) {
        ws.send(JSON.stringify({ ctl: 'close', c: msg.c }));
        return;
      }
      if (msg.ctl === 'drop') client.close(4010, String(msg.reason ?? 'The bridge closed the connection.').slice(0, 120));
      else if (typeof msg.m === 'string') {
        if (this.expired(client)) return;
        client.send(msg.m);
      }
      return;
    }

    const a = ws.deserializeAttachment() as ClientAttachment;
    if (message.startsWith('{"relay":"ticket"')) return this.renew(ws, a, message);
    if (this.expired(ws, a)) return;
    if (message.includes('"relay.alerts"')) {
      let call: { id?: unknown; method?: unknown; params?: unknown } = {};
      try {
        call = JSON.parse(message);
      } catch {
        // not JSON: passed on below like anything else
      }
      if (call.method === 'relay.alerts') {
        const answer = await this.alertsCall(a, call.params as Record<string, unknown>).then(
          (result) => ({ result }),
          (e: Error) => ({ error: { code: -32003, message: e.message } }),
        );
        return ws.send(JSON.stringify({ jsonrpc: '2.0', id: call.id, ...answer }));
      }
    }
    if (a.user && message.includes('"bridge.snapshot"')) {
      const refusal = this.cameraRefusal(a, message);
      if (refusal) return ws.send(refusal);
    }
    const agent = this.agent();
    if (agent && a.printer) {
      agent.send(JSON.stringify({ c: a.id, m: message }));
      return;
    }
    // A window with no printer chosen may still manage the bridge (add or remove printers).
    if (agent) {
      try {
        const msg = JSON.parse(message) as { method?: unknown };
        if (typeof msg.method === 'string' && msg.method.startsWith('bridge.')) {
          agent.send(JSON.stringify({ c: a.id, m: message }));
          return;
        }
      } catch {
        // not JSON
      }
    }
    // No agent: answer requests at once rather than letting them time out.
    try {
      const msg = JSON.parse(message) as { id?: unknown };
      if (msg.id != null) ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: agent ? 'No printer chosen.' : 'The bridge is offline.' } }));
    } catch {
      // not JSON
    }
  }

  /** A browser whose ticket ran out (the page renews it well before) is closed; it reconnects with a new one. */
  private expired(ws: WebSocket, a = ws.deserializeAttachment() as ClientAttachment | null) {
    if (!a?.exp || Date.now() < a.exp) return false;
    ws.close(4401, 'Your sign-in to the bridge ran out. Reconnecting.');
    return true;
  }

  private async renew(ws: WebSocket, a: ClientAttachment, message: string) {
    if (!this.env.RELAY_TICKET_PUBLIC_KEY) return;
    let token = '';
    try {
      token = String((JSON.parse(message) as { ticket?: unknown }).ticket ?? '');
    } catch {
      return;
    }
    const t = a.bridge ? await readTicket(this.env, token, a.bridge) : null;
    if (!t || t.user !== a.user) return;
    ws.serializeAttachment({ ...a, exp: t.exp, cams: t.cams } satisfies ClientAttachment);
  }

  /** Too many cameras at once for this account: the answer to send instead of asking the bridge. */
  private cameraRefusal(a: ClientAttachment, message: string): string | null {
    let call: { id?: unknown; params?: { url?: unknown } };
    try {
      call = JSON.parse(message);
    } catch {
      return null;
    }
    const camera = String(call.params?.url ?? '');
    const now = Date.now();
    const watching = this.cameras.get(a.user!) ?? new Map<string, number>();
    for (const [url, at] of watching) if (now - at > CAMERA_WINDOW_MS) watching.delete(url);
    if (!watching.has(camera) && watching.size >= (a.cams ?? 2)) {
      this.cameras.set(a.user!, watching);
      return JSON.stringify({
        jsonrpc: '2.0',
        id: call.id,
        error: { code: -32002, message: `Up to ${a.cams ?? 2} camera${a.cams === 1 ? '' : 's'} at a time through the bridge. Close one to watch this one.` },
      });
    }
    watching.set(camera, now);
    this.cameras.set(a.user!, watching);
    return null;
  }

  /** The site blocked (or unblocked) an account: close its browsers here; if it owns this bridge, the bridge too. */
  private async revoke({ user, blocked, bridgeOff, guests }: RevokeOrder): Promise<Response> {
    if (!user) return new Response('No user', { status: 400 });
    if (bridgeOff !== undefined) {
      if (!bridgeOff) {
        await this.ctx.storage.delete('off');
        return Response.json({ ok: true });
      }
      await this.ctx.storage.put('off', true);
      for (const ws of this.clients()) ws.close(4403, "The site's owner turned this bridge off.");
      for (const ws of this.ctx.getWebSockets('agent')) ws.close(4003, "The site's owner turned this bridge off.");
      return Response.json({ ok: true });
    }
    if (guests) {
      for (const ws of this.clients()) {
        const a = ws.deserializeAttachment() as ClientAttachment | null;
        if (a?.user?.startsWith('guest:')) ws.close(4401, 'Sign in to Cloud Slicer to use the bridge.');
      }
      return Response.json({ ok: true });
    }
    const owner = await this.ctx.storage.get<string>('owner');
    if (blocked) {
      // Its alerts stop too.
      for (const [key, s] of await this.subs()) if (s.user === user) await this.ctx.storage.delete(key);
      await this.sendAlertConfig();
      for (const ws of this.clients()) {
        const a = ws.deserializeAttachment() as ClientAttachment | null;
        if (a?.user === user) ws.close(4403, 'This account is blocked.');
      }
      if (owner === user) {
        await this.ctx.storage.put('blocked', true);
        for (const ws of this.ctx.getWebSockets('agent')) ws.close(4003, "This bridge's Cloud Slicer account is blocked.");
      }
    } else if (owner === user) await this.ctx.storage.delete('blocked');
    return Response.json({ ok: true });
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
      if (!this.ctx.getWebSockets('agent').some((other) => other !== ws)) {
        await this.broadcastStatus(false);
        // Someone wants to know when the bridge goes quiet: check again in a while.
        if ((await this.subs()).some(([, s]) => Object.values(s.printers).some((p) => p.events.includes('offline')))) await this.ctx.storage.setAlarm(Date.now() + OFFLINE_AFTER_MS);
      }
      return;
    }
    const a = ws.deserializeAttachment() as ClientAttachment | null;
    if (a) this.agent()?.send(JSON.stringify({ ctl: 'close', c: a.id }));
  }

  // ---- Print alerts ----

  /** Alerts and pictures sent this hour (kept in memory: a rough cap against a misbehaving bridge). */
  private sent = { hour: 0, alerts: 0, pictures: 0 };

  private async bridgeId(): Promise<string> {
    return (await this.ctx.storage.get<string>('bridgeId')) ?? 'bridge';
  }

  private async subs(): Promise<[string, StoredSub][]> {
    return [...(await this.ctx.storage.list<StoredSub>({ prefix: 'push:' })).entries()];
  }

  /** Tells the agent what to watch for (an empty list: watch nothing). */
  private async sendAlertConfig() {
    const agent = this.agent();
    if (!agent) return;
    agent.send(JSON.stringify({ ctl: 'alerts', printers: agentConfig((await this.subs()).map(([, s]) => s)) }));
  }

  /** relay.alerts from a browser: get, set or test its alerts for the printer its socket is on. */
  private async alertsCall(a: ClientAttachment, params: Record<string, unknown> | undefined): Promise<unknown> {
    if (!vapidPublicKey(this.env)) throw new Error("This relay can't send alerts yet.");
    if (!a.printer) throw new Error('No printer chosen.');
    const op = params?.op;
    const endpoint = typeof params?.endpoint === 'string' ? params.endpoint : '';
    if (!pushEndpointOk(this.env, endpoint)) throw new Error("This browser's push service isn't one the relay knows.");
    const key = await subKey(endpoint);
    const stored = await this.ctx.storage.get<StoredSub>(key);
    if (op === 'get') return { prefs: stored?.printers[a.printer] ?? null };
    if (op === 'test') {
      if (!stored?.printers[a.printer]) throw new Error('Turn alerts on first.');
      const printer = (await this.info()).printers.find((p) => p.id === a.printer);
      const text = alertText({ event: 'test' }, printer?.name ?? 'your printer');
      const bridgeId = await this.bridgeId();
      const sent = await sendPush(this.env, stored, { ...text, tag: `${bridgeId}.${a.printer}:test`, printer: `${bridgeId}.${a.printer}` }, false);
      if (sent === 'gone') await this.ctx.storage.delete(key);
      if (sent !== 'ok') throw new Error(sent === 'gone' ? 'This browser dropped its alerts. Turn them off and on again.' : "The browser's push service didn't take the test alert. Try again in a minute.");
      return { sent: true };
    }
    if (op !== 'set') throw new Error('Unknown alerts call.');
    const prefs = params?.prefs == null ? null : cleanPrefs(params.prefs);
    if (params?.prefs != null && !prefs) throw new Error('Those alert settings are not valid.');
    const next: StoredSub | null = prefs
      ? (() => {
          const sub = cleanSubscription(params);
          if (!sub) throw new Error("This browser's push subscription is not valid.");
          return { ...sub, user: a.user ?? stored?.user, printers: { ...(stored?.printers ?? {}), [a.printer]: prefs } };
        })()
      : stored
        ? { ...stored, printers: Object.fromEntries(Object.entries(stored.printers).filter(([id]) => id !== a.printer)) }
        : null;
    if (next && !stored && (await this.subs()).length >= MAX_SUBS) throw new Error(`Up to ${MAX_SUBS} browsers can get alerts from one bridge.`);
    if (next && Object.keys(next.printers).length) await this.ctx.storage.put(key, next);
    else await this.ctx.storage.delete(key);
    await this.sendAlertConfig();
    return { prefs: next?.printers[a.printer] ?? null };
  }

  /** {ctl:'alert'} from the agent: push it to everyone who wants it. */
  private async alert(msg: Record<string, unknown>) {
    const alert = cleanAlert(msg);
    const printer = (await this.info()).printers.find((p) => p.id === String(msg.printer ?? ''));
    if (!alert || !printer) return;
    const hour = Math.floor(Date.now() / 3600_000);
    if (this.sent.hour !== hour) this.sent = { hour, alerts: 0, pictures: 0 };
    if (++this.sent.alerts > MAX_ALERTS_PER_HOUR) return;
    const subs = await this.subs();
    const bridgeId = await this.bridgeId();
    let image: string | undefined;
    if (typeof msg.picture === 'string' && msg.picture.length < (MAX_PICTURE * 4) / 3 + 4 && this.env.DOWNLOADS && this.sent.pictures < MAX_PICTURES_PER_HOUR) {
      const origin = await this.ctx.storage.get<string>('origin');
      const bytes = Uint8Array.from(atob(msg.picture), (c) => c.charCodeAt(0));
      if (origin && bytes.length > 0) {
        this.sent.pictures++;
        const name = crypto.randomUUID();
        await this.env.DOWNLOADS.put(`alerts/${name}`, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
        image = `${origin}/v1/pictures/${name}.jpg`;
      }
    }
    const { to, clearLayer } = fanOut(subs, printer, bridgeId, alert, image);
    const results = await Promise.all(to.map(([, s, push]) => sendPush(this.env, s, push, urgentEvent(alert.event))));
    let changed = false;
    for (let i = 0; i < to.length; i++) {
      if (results[i] !== 'gone') continue;
      await this.ctx.storage.delete(to[i][0]);
      changed = true;
    }
    for (const key of clearLayer) {
      const s = await this.ctx.storage.get<StoredSub>(key);
      if (!s?.printers[printer.id]) continue;
      await this.ctx.storage.put(key, { ...s, printers: { ...s.printers, [printer.id]: { ...s.printers[printer.id], layer: null } } });
      changed = true;
    }
    if (changed) await this.sendAlertConfig();
  }

  /** The bridge has been offline for a while: tell whoever asked, once. */
  async alarm() {
    if (this.agent() || (await this.ctx.storage.get<boolean>('offlineSent'))) return;
    await this.ctx.storage.put('offlineSent', true);
    const info = await this.info();
    const bridge = info.host ? `The bridge on ${info.host}` : 'The bridge';
    const bridgeId = await this.bridgeId();
    for (const [key, s] of await this.subs()) {
      const printer = Object.entries(s.printers).find(([, p]) => p.events.includes('offline'));
      if (!printer) continue;
      const text = alertText({ event: 'offline' }, '', bridge);
      if ((await sendPush(this.env, s, { ...text, tag: `${bridgeId}:offline`, printer: `${bridgeId}.${printer[0]}` }, true)) === 'gone') await this.ctx.storage.delete(key);
    }
  }
}
