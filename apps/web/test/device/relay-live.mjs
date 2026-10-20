#!/usr/bin/env node
// Checks a deployed relay end to end without a browser: a bridge agent here
// serves the mock U1 through the relay, and a pretend browser asks for the
// printer's info and a camera frame. Also checks a wrong key is refused.
//
//   node test/device/relay-live.mjs https://cloud-slicer-relay.<account>.workers.dev [--app <bridge app>]
//
// With --app, a one-file bridge app (bun build --compile) is the agent instead
// of bridge.mjs in this process.
//
// A relay that wants account tickets: give RELAY_TICKET_PRIVATE_KEY (the JWK
// of the key pair whose public half the relay has) and the pretend browsers
// carry tickets, as the site would sign them. Then it also checks a browser
// without one is refused, the camera cap, and that blocking an account drops it.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserKey, pairingCode, runBridge } from '../../../device-bridge/bridge.mjs';
import { importJWK, SignJWT } from 'jose';
import { startMockPrinter } from './mock-printer.mjs';

const relay = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(relay)) throw new Error('usage: relay-live.mjs <relay url>');
const mock = await startMockPrinter();
const cfg = { relay, bridgeId: `ci-${randomBytes(9).toString('base64url')}`, key: randomBytes(24).toString('base64url'), printers: [{ id: 'u1', name: 'U1-mock', url: mock.url, apiKey: '' }] };
const app = process.argv.indexOf('--app') > 0 ? process.argv[process.argv.indexOf('--app') + 1] : null;
const bridge = app ? startApp(app) : runBridge(cfg, { log: (m) => console.log(`bridge: ${m}`) });

function startApp(path) {
  const config = join(mkdtempSync(join(tmpdir(), 'bridge-app-')), 'bridge.json');
  writeFileSync(config, JSON.stringify(cfg));
  const child = spawn(path, ['run', '--no-browser', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.stdout.write(`app: ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`app: ${d}`));
  return { stop: () => child.kill() };
}
/** Every pretend-browser socket, closed at the end so a failure can't keep the process alive. */
const open = new Set();
const clientKey = browserKey(cfg.key);
const signer = process.env.RELAY_TICKET_PRIVATE_KEY ? await importJWK(JSON.parse(process.env.RELAY_TICKET_PRIVATE_KEY), 'ES256') : null;
/** What the site signs (apps/web/functions/_lib/relay.ts). */
const sign = (user, claims, seconds = 600) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'ES256' }).setSubject(user).setAudience('cloud-slicer-relay').setIssuedAt().setExpirationTime(`${seconds}s`).sign(signer);
const mint = (user = 'ci-user', claims = {}) => (signer ? sign(user, { b: cfg.bridgeId, cams: 2, ...claims }) : Promise.resolve(''));
const ownerTicket = await mint();
const socket = (key, printer, role = 'client', ticket = ownerTicket) =>
  new WebSocket(`${relay.replace(/^http/, 'ws')}/v1/bridges/${cfg.bridgeId}/${role}?key=${key}&printer=${printer}${ticket && role === 'client' ? `&ticket=${ticket}` : ''}`);
/** One call through a fresh socket; resolves to the answer message. */
function ask(ticket, call) {
  return new Promise((resolve, reject) => {
    const ws = socket(clientKey, 'u1', 'client', ticket);
    open.add(ws);
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', ...call }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === call.id) resolve({ m, ws });
    };
    ws.onclose = (e) => reject(new Error(`closed: ${e.code} ${e.reason}`));
  });
}
const closeCode = (ws) => new Promise((resolve) => (ws.onclose = (e) => resolve(e)));
const timeout = setTimeout(() => {
  console.error('RELAY LIVE FAIL: timed out');
  process.exit(1);
}, 90_000);

try {
  // Wait until the agent has claimed the bridge id.
  for (let i = 0; ; i++) {
    const status = await new Promise((resolve) => {
      const ws = socket(clientKey, '');
      ws.onmessage = (e) => {
        resolve(JSON.parse(e.data).params?.[0]);
        ws.close();
      };
      ws.onclose = () => resolve(null);
    });
    if (status?.agent === 'online') {
      console.log(`bridge online with ${status.printers.map((p) => p.name).join(', ')}`);
      break;
    }
    if (i > 20) throw new Error('the bridge never came online');
    await new Promise((r) => setTimeout(r, 500));
  }

  const results = await new Promise((resolve, reject) => {
    const ws = socket(clientKey, 'u1');
    const got = {};
    open.add(ws);
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'printer.info' }));
      // Like the real U1, the mock only has a camera frame once the monitor is on.
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'camera.start_monitor', params: {} }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.error) reject(new Error(m.error.message));
      if (m.id === 2) ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'b1', method: 'bridge.snapshot', params: { url: '/server/files/camera/monitor.jpg' } }));
      if (m.id != null) got[m.id] = m.result;
      if (got[1] && got.b1) {
        ws.close();
        resolve(got);
      }
    };
    ws.onclose = (e) => reject(new Error(`closed: ${e.code} ${e.reason}`));
  });
  if (results[1].hostname !== 'U1-mock') throw new Error(`unexpected printer.info: ${JSON.stringify(results[1])}`);
  if (!Buffer.from(results.b1.data, 'base64').subarray(1, 4).equals(Buffer.from('PNG'))) throw new Error('snapshot is not a PNG');
  console.log('printer.info and a camera frame came back through the relay');

  // A G-code upload in chunks, as the Device tab sends it, and a call the bridge must refuse.
  const gcode = Buffer.from('G28\n' + 'G1 X10 Y10 E1\n'.repeat(30_000));
  const upload = await new Promise((resolve, reject) => {
    const ws = socket(clientKey, 'u1');
    open.add(ws);
    const pending = new Map();
    let next = 1;
    const call = (method, params) =>
      new Promise((res, rej) => {
        const id = next++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message));
      else p.res(m.result);
    };
    ws.onclose = (e) => reject(new Error(`closed: ${e.code} ${e.reason}`));
    ws.onopen = async () => {
      try {
        const refusedKey = await call('access.get_api_key').then(() => null, (e) => e.message);
        if (!refusedKey) throw new Error('the bridge passed on access.get_api_key');
        const { uploadId } = await call('bridge.upload_begin', { path: 'relay-live.gcode', size: gcode.length });
        for (let offset = 0; offset < gcode.length; offset += 192 * 1024) {
          await call('bridge.upload_chunk', { uploadId, offset, data: gcode.subarray(offset, offset + 192 * 1024).toString('base64') });
        }
        const done = await call('bridge.upload_end', { uploadId });
        const list = await call('server.files.list', { root: 'gcodes' });
        ws.onclose = null;
        ws.close();
        resolve({ done, listed: list.find((f) => f.path === 'relay-live.gcode') });
      } catch (e) {
        reject(e);
      }
    };
  });
  if (upload.done.path !== 'relay-live.gcode' || upload.listed?.size !== gcode.length) throw new Error(`upload went wrong: ${JSON.stringify(upload)}`);
  console.log(`uploaded ${gcode.length} bytes of G-code in chunks; access.* refused`);

  const refused = await closeCode(socket('wrong-key-wrong-key-wrong', 'u1'));
  if (refused.code !== 4003) throw new Error(`a wrong key was not refused (${refused.code})`);
  console.log(`wrong key refused: ${refused.reason}`);
  // The pairing code's key can't take over the bridge, and the secret key isn't a browser key.
  const asAgent = await closeCode(socket(clientKey, '', 'agent'));
  if (asAgent.code !== 4003) throw new Error(`the browser key connected as the agent (${asAgent.code})`);
  console.log(`browser key refused as the agent: ${asAgent.reason}`);
  const secretAsBrowser = await closeCode(socket(cfg.key, 'u1'));
  if (secretAsBrowser.code !== 4003) throw new Error(`the secret key connected as a browser (${secretAsBrowser.code})`);
  console.log(`secret key refused as a browser: ${secretAsBrowser.reason}`);
  console.log(`pairing code format ok (${pairingCode(cfg).length} chars)`);

  const { accounts } = await (await fetch(`${relay}/v1/info`)).json();
  if (signer && !accounts) console.log('this relay takes no tickets (it has no ticket key): skipping the account checks');
  if (signer && accounts) {
    const none = await closeCode(socket(clientKey, 'u1', 'client', ''));
    if (none.code !== 4401) throw new Error(`a browser without a ticket was let in (${none.code})`);
    const other = await closeCode(socket(clientKey, 'u1', 'client', await sign('ci-user', { b: 'some-other-bridge', cams: 2 })));
    if (other.code !== 4401) throw new Error(`another bridge's ticket was accepted (${other.code})`);
    const stale = await closeCode(socket(clientKey, 'u1', 'client', await sign('ci-user', { b: cfg.bridgeId }, -10)));
    if (stale.code !== 4401) throw new Error(`an expired ticket was accepted (${stale.code})`);
    console.log(`tickets: none, another bridge's and an expired one refused (${none.reason})`);

    // One camera allowed: a second camera is refused, the first keeps working.
    const one = await mint('ci-cams', { cams: 1 });
    const a = await ask(one, { id: 'c1', method: 'bridge.snapshot', params: { url: '/server/files/camera/monitor.jpg' } });
    a.ws.close();
    const b = await ask(one, { id: 'c2', method: 'bridge.snapshot', params: { url: '/webcam2/snapshot.jpg' } });
    b.ws.close();
    if (a.m.error?.code === -32002 || b.m.error?.code !== -32002) throw new Error(`camera cap: ${JSON.stringify([a.m.error, b.m.error])}`);
    console.log(`camera cap: ${b.m.error.message}`);

    // Blocking an account drops its browsers at once; the bridge's owner is not touched.
    const blocked = await mint('ci-blocked');
    const live = socket(clientKey, 'u1', 'client', blocked);
    open.add(live);
    await new Promise((r, j) => ((live.onmessage = r), (live.onclose = (e) => j(new Error(`closed early: ${e.code}`)))));
    const dropped = closeCode(live);
    const order = await sign('ci-blocked', { revoke: [cfg.bridgeId], blocked: true }, 300);
    const res = await fetch(`${relay}/v1/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${order}` } });
    if (!res.ok) throw new Error(`revoke: HTTP ${res.status}`);
    const forged = await fetch(`${relay}/v1/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${order.slice(0, -4)}AAAA` } });
    if (forged.status !== 403) throw new Error(`a forged revoke was accepted (${forged.status})`);
    if ((await dropped).code !== 4403) throw new Error('the blocked account was not dropped');
    const still = await ask(ownerTicket, { id: 9, method: 'printer.info' });
    still.ws.close();
    if (still.m.result?.hostname !== 'U1-mock') throw new Error('the owner lost the bridge');
    console.log('blocking an account drops it; a forged order is refused; the owner keeps the bridge');

    const siteOrder = async (claims) => {
      const r = await fetch(`${relay}/v1/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${await sign('site', { revoke: [cfg.bridgeId], ...claims }, 300)}` } });
      if (!r.ok) throw new Error(`order: HTTP ${r.status}`);
    };
    const openSocket = async (ticket) => {
      const ws = socket(clientKey, 'u1', 'client', ticket);
      open.add(ws);
      await new Promise((r, j) => ((ws.onmessage = r), (ws.onclose = (e) => j(new Error(`closed early: ${e.code}`)))));
      return ws;
    };
    // Signed-out browsers go when the site stops letting them in; signed-in ones stay.
    const guest = await openSocket(await sign(`guest:${cfg.bridgeId}`, { b: cfg.bridgeId, cams: 1 }));
    const member = await openSocket(ownerTicket);
    const guestGone = closeCode(guest);
    await siteOrder({ guests: true });
    if ((await guestGone).code !== 4401) throw new Error('the signed-out browser was not dropped');
    if (member.readyState !== WebSocket.OPEN) throw new Error('a signed-in browser was dropped with the guests');
    // The owner turns the whole bridge off: everyone goes, nobody gets back in, until it is turned on.
    const memberGone = closeCode(member);
    await siteOrder({ bridgeOff: true });
    if ((await memberGone).code !== 4403) throw new Error('turning the bridge off did not close its browsers');
    const refusedOff = await closeCode(socket(clientKey, 'u1'));
    if (refusedOff.code !== 4403) throw new Error(`a browser got onto a bridge that is off (${refusedOff.code})`);
    await siteOrder({ bridgeOff: false });
    const back = await openSocket(ownerTicket);
    back.close();
    console.log('signed-out browsers dropped on their own; a bridge turned off and on again');
  }
  console.log('RELAY LIVE OK');
} catch (e) {
  console.error(`RELAY LIVE FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  for (const ws of open) ws.close();
  bridge.stop();
  await mock.close();
  // Exit even if a socket or timer is still open: CI waits on this step.
  process.exit();
}
