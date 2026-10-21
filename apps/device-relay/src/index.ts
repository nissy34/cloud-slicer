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
// {relay:'ticket', ticket}. A bridge joins an account with a setup code from
// the site (POST /v1/bridges/<id>/claim, which the site checks): until then
// the relay turns it away, and so it does one whose owner was blocked
// (POST /v1/revoke).
import { DurableObject } from 'cloudflare:workers';
import { importJWK, jwtVerify, type JWK, type JWTPayload } from 'jose';
import installCmd from '../../device-bridge/install.cmd';
import installPs1 from '../../device-bridge/install.ps1';
import installScript from '../../device-bridge/install.sh';

export interface Env {
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
  /** The site that makes setup codes; bridges spending one are checked there (POST /api/relay/claim). */
  SITE_ORIGIN?: string;
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
/** A setup code as the site makes them (functions/_lib/relay.ts). */
const SETUP_CODE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
/** Not set up yet: what the bridge shows. */
const NOT_SET_UP = "This bridge isn't set up. In Cloud Slicer open Printers & bridges, Add a bridge, and run the command there.";
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
    const script = { '/install.sh': installScript, '/install.ps1': installPs1, '/install.cmd': installCmd }[url.pathname];
    if (script) {
      // The setup code rides in the link (?code=), so one command does it all.
      const code = (url.searchParams.get('code') ?? '').toUpperCase();
      const text = script.replaceAll('__RELAY_URL__', url.origin).replaceAll('__SETUP_CODE__', SETUP_CODE.test(code) ? code : '');
      const type = url.pathname.endsWith('.sh') ? 'text/x-shellscript' : 'text/plain';
      // Command Prompt runs batch files with Windows line ends only.
      return new Response(url.pathname.endsWith('.cmd') ? text.replace(/\r?\n/g, '\r\n') : text, { headers: { ...cors, 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' } });
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
          'Content-Disposition': `attachment; filename="${file}"`,
          'Cache-Control': 'no-cache',
          ETag: object.httpEtag,
        },
      });
    }
    if (url.pathname === '/v1/info') return Response.json({ accounts: Boolean(env.RELAY_TICKET_PUBLIC_KEY) }, { headers: cors });
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
    const claim = /^\/v1\/bridges\/([^/]+)\/claim$/.exec(url.pathname);
    if (claim && req.method === 'POST') return claimBridge(req, env, claim[1]);
    const m = /^\/v1\/bridges\/([^/]+)\/(agent|client)$/.exec(url.pathname);
    if (m) {
      if (!BRIDGE_ID.test(m[1])) return new Response('Bad bridge id', { status: 400, headers: cors });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426, headers: cors });
      if (!(await env.CONNECT_LIMIT.limit({ key: clientIp(req) })).success) return new Response('Too many connections; try again in a minute.', { status: 429, headers: cors });
      // Browsers need the site's ticket; it is checked here, before the bridge's Durable Object is woken.
      const headers = new Headers(req.headers);
      headers.delete('X-Relay-Ticket');
      if (m[2] === 'client' && env.RELAY_TICKET_PUBLIC_KEY) {
        const t = await readTicket(env, url.searchParams.get('ticket') ?? '', m[1]);
        if (!t) return refuseSocket(4401, 'Sign in to Cloud Slicer to use the bridge.');
        headers.set('X-Relay-Ticket', JSON.stringify(t));
      }
      return env.BRIDGE.get(env.BRIDGE.idFromName(m[1])).fetch(new Request(req, { headers }));
    }
    if (url.pathname === '/') {
      return new Response('Cloud Slicer device relay. Add a bridge from Cloud Slicer (Printers & bridges, Add a bridge): it gives the install command. Self-update: /bridge-release.json.\n', { headers: { ...cors, 'Content-Type': 'text/plain' } });
    }
    return new Response('Not found', { status: 404, headers: cors });
  },
} satisfies ExportedHandler<Env>;

/**
 * POST /v1/bridges/<id>/claim { key, code, host?, system?, place? }: a bridge
 * spends a setup code. The site checks the code and answers with a short claim
 * it signed; the bridge's Durable Object then keeps the bridge's key and its
 * owner, and lets it connect from then on.
 */
async function claimBridge(req: Request, env: Env, bridgeId: string): Promise<Response> {
  const fail = (status: number, error: string, code?: string) => Response.json({ error, ...(code && { code }) }, { status, headers: cors });
  if (!BRIDGE_ID.test(bridgeId)) return fail(400, 'Bad bridge id');
  if (!env.RELAY_TICKET_PUBLIC_KEY) return fail(404, 'This relay takes no setup codes.');
  if (!(await env.CLAIM_LIMIT.limit({ key: clientIp(req) })).success) return fail(429, 'Too many tries from this address; wait a minute.');
  let body: { key?: unknown; code?: unknown; claim?: unknown; host?: unknown; system?: unknown; place?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Expected JSON');
  }
  const key = String(body.key ?? '');
  if (key.length < 16 || key.length > 128) return fail(400, 'Bad bridge key');
  const stub = env.BRIDGE.get(env.BRIDGE.idFromName(bridgeId));
  const keyHash = await sha256(key);
  const browser = await browserKey(key);
  // CI's check of the deployed relay brings a claim signed with its own test key, for a "ci-" bridge only.
  if (typeof body.claim === 'string') {
    try {
      const { payload, test } = await verifyTicket(env, body.claim);
      if (!test || !testBridge(bridgeId) || payload.claim !== true || payload.b !== bridgeId) throw new Error('not a test claim');
      const done = await stub.fetch('https://bridge/claim', { method: 'POST', body: JSON.stringify({ keyHash, clientHash: await sha256(browser), owner: payload.sub }) });
      return done.ok ? Response.json({ ok: true, name: 'Bridge' }, { headers: cors }) : fail(409, await done.text());
    } catch {
      return fail(403, 'Bad claim');
    }
  }
  // Typed by hand: any case, with or without the dash.
  const bare = String(body.code ?? '').replace(/[\s-]+/g, '').toUpperCase();
  const code = `${bare.slice(0, 4)}-${bare.slice(4)}`;
  if (!SETUP_CODE.test(code)) return fail(404, "That isn't a setup code. Copy it again from Cloud Slicer.", 'wrong');
  if (!env.SITE_ORIGIN) return fail(503, "This relay doesn't know its site.");
  const free = await stub.fetch('https://bridge/claimable', { method: 'POST', body: JSON.stringify({ keyHash }) });
  if (!free.ok) return fail(409, await free.text());
  let site: Response;
  try {
    site = await fetch(`${env.SITE_ORIGIN.replace(/\/+$/, '')}/api/relay/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, relay: new URL(req.url).origin, bridgeId, browserKey: browser, host: body.host, system: body.system, place: body.place }),
    });
  } catch {
    return fail(502, "Couldn't reach Cloud Slicer to check the setup code. Try again in a minute.");
  }
  const answer = (await site.json().catch(() => ({}))) as { claim?: string; name?: string; error?: string; code?: string };
  if (!site.ok || !answer.claim) return fail(site.status === 200 ? 502 : site.status, answer.error ?? "Cloud Slicer didn't accept the setup code.", answer.code);
  let owner: string;
  try {
    const { payload, test } = await verifyTicket(env, answer.claim);
    if (payload.claim !== true || payload.b !== bridgeId || (test && !testBridge(bridgeId))) throw new Error('not this bridge');
    owner = payload.sub!;
  } catch {
    return fail(502, "Cloud Slicer's answer couldn't be checked.");
  }
  const done = await stub.fetch('https://bridge/claim', { method: 'POST', body: JSON.stringify({ keyHash, clientHash: await sha256(browser), owner }) });
  if (!done.ok) return fail(409, await done.text());
  return Response.json({ ok: true, name: answer.name }, { headers: cors });
}

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
    if (url.pathname === '/claimable' || url.pathname === '/claim') {
      const c = (await req.json()) as { keyHash: string; clientHash?: string; owner?: string };
      const stored = await this.ctx.storage.get<string>('keyHash');
      // A bridge id is its own: another bridge can't take it over with a code.
      if (stored && !same(stored, c.keyHash)) return new Response('This bridge id belongs to another bridge.', { status: 409 });
      const owner = await this.ctx.storage.get<string>('owner');
      if (owner && c.owner && owner !== c.owner) return new Response('This bridge is already in another Cloud Slicer account.', { status: 409 });
      if (url.pathname === '/claim') await this.ctx.storage.put({ keyHash: c.keyHash, clientHash: c.clientHash!, owner: c.owner! });
      return new Response('ok');
    }
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
      if (this.env.RELAY_TICKET_PUBLIC_KEY) {
        // With accounts, only a bridge that spent a setup code (claimBridge) gets in, owned by that account.
        if (!stored || !(await this.ctx.storage.get<string>('owner'))) return reject(4003, NOT_SET_UP);
        if (!same(stored, hash)) return reject(4003, 'This bridge id belongs to someone else.');
        if (await this.ctx.storage.get<boolean>('off')) return reject(4003, "The site's owner turned this bridge off.");
        if (await this.ctx.storage.get<boolean>('blocked')) return reject(4003, "This bridge's Cloud Slicer account is blocked.");
      } else if (!stored) {
        // Without accounts (a test or private relay), the first agent to connect claims the bridge id.
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
    let ticket: Ticket | null = null;
    if (this.env.RELAY_TICKET_PUBLIC_KEY) {
      // Checked by the Worker in front; a request without it never came through there.
      ticket = JSON.parse(req.headers.get('X-Relay-Ticket') ?? 'null') as Ticket | null;
      if (!ticket) return reject(4401, 'Sign in to Cloud Slicer to use the bridge.');
      if (await this.ctx.storage.get<boolean>('off')) return reject(4403, "The site's owner turned this bridge off.");
      if (ticket.user === (await this.ctx.storage.get<string>('owner')) && (await this.ctx.storage.get<boolean>('blocked'))) return reject(4003, 'This account is blocked.');
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
      else if (typeof msg.m === 'string') {
        if (this.expired(client)) return;
        client.send(msg.m);
      }
      return;
    }

    const a = ws.deserializeAttachment() as ClientAttachment;
    if (message.startsWith('{"relay":"ticket"')) return this.renew(ws, a, message);
    if (this.expired(ws, a)) return;
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
      if (!this.ctx.getWebSockets('agent').some((other) => other !== ws)) await this.broadcastStatus(false);
      return;
    }
    const a = ws.deserializeAttachment() as ClientAttachment | null;
    if (a) this.agent()?.send(JSON.stringify({ ctl: 'close', c: a.id }));
  }
}
